import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약: FR-003 「유닛 · src/services/rules.ts · resolveRules」
//
// 외부 경계(계약): "테스트가 모킹할 대상은 DB 클라이언트(Db, drizzle) 하나뿐이다."
// plans.test.ts 의 Proxy 체인 스텁 패턴(makeChainNode)을 재사용한다 — select().from(table) 을
// 테이블 정체성으로 분기하고, 그 뒤에 얼마나 더 체이닝(where 등)하든 항상 같은 결과로
// resolve 되는 노드를 돌려준다. 이렇게 하면 resolveRules 가 정확히 어떤 메서드를 몇 번
// 체이닝하는지에 테스트가 묶이지 않는다.
//
// 계약: "부수효과: 읽기 전용 쿼리 2회(순차, 국가값이 두 번째 쿼리 조건에 필요)." —
// 병렬(Promise.all)이 아니라 순차이므로 채널 조회가 비면 brand_rules 조회는 아예 일어나지
// 않아야 한다. fromCalls 로 select().from() 호출 순서·횟수를 직접 관찰해 이를 검증한다.

import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { buildBrandStandards, mergeRules } from "@/lib/rules-merge";
import type { BrandRuleRow, StandardChannelInput, StandardProductInput, StandardRuleRow } from "@/lib/rules-merge";
import { listBrandStandards, resolveRules } from "./rules";

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — src/services/plans.test.ts 의 makeChainNode 패턴 재사용.
// ---------------------------------------------------------------------------

// onCall: 05 리뷰(gen·test) 지적 — 기존 스텁은 .where() 인자를 그대로 버려 그 호출이
// 실제로 있었는지조차 관측할 수 없었다(예: status='active' 필터를 지워도 테스트가 그대로
// 통과). 어떤 메서드가 어떤 인자로 불렸는지 기록할 수 있게 선택적 콜백을 더한다 — 기존
// 호출부(콜백 생략)는 그대로 동작한다.
function makeChainNode(resolvedValue: unknown, onCall?: (method: string, args: unknown[]) => void) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue),
    catch: () => node,
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (...args: unknown[]) => {
        onCall?.(String(prop), args);
        return node;
      };
    },
  });
}

// 05 리뷰 지적 — 유일한 실패 테스트가 동기 throw 만 다뤘다. 실제 Neon 장애는 await 시점의
// promise reject 다(예: HTTP 드라이버가 응답 대기 중 실패). 세 병렬 쿼리 중 하나가 그렇게
// 실패하는 상황을 흉내내는 thenable 스텁.
function makeRejectingChainNode(error: unknown) {
  const node: Record<string, unknown> = {
    then: (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      reject?.(error);
      return node;
    },
    catch: (onRejected: (e: unknown) => void) => {
      onRejected(error);
      return node;
    },
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (..._args: unknown[]) => node;
    },
  });
}

// 05 리뷰 지적 — .where() 에 넘어간 drizzle SQL 조건 객체를 사람이 읽을 수 있는 문자열로
// 풀어 "status 컬럼과 'active' 값을 실제로 참조하는가"를 단언할 수 있게 한다. drizzle-orm
// 0.45 의 SQL.queryChunks 내부 구조(컬럼 청크는 {name}, 값 청크는 {value})에 기대는
// 최선 노력의 헬퍼다 — 이 파일의 테스트 전용이고 프로덕션 코드는 이를 모른다.
function sqlConditionText(condition: unknown): string {
  const chunks = (condition as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
  return chunks
    .map((chunk) => {
      if (chunk && typeof chunk === "object" && "name" in (chunk as Record<string, unknown>)) {
        return String((chunk as { name: unknown }).name);
      }
      if (chunk && typeof chunk === "object" && "value" in (chunk as Record<string, unknown>)) {
        const v = (chunk as { value: unknown }).value;
        return Array.isArray(v) ? v.join("") : String(v);
      }
      return "";
    })
    .join("");
}

interface ChannelRow {
  id: number;
  country: string;
}

function createDbMock(opts: { channelRows: ChannelRow[]; ruleRows: BrandRuleRow[] }) {
  const fromCalls: string[] = [];
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.salesChannels) {
        fromCalls.push("salesChannels");
        return makeChainNode(opts.channelRows);
      }
      if (table === schema.brandRules) {
        fromCalls.push("brandRules");
        return makeChainNode(opts.ruleRows);
      }
      throw new Error("unexpected select().from() table in test mock");
    }),
  }));
  return { db: { select } as unknown as Db, select, fromCalls };
}

function ruleRow(
  overrides: Partial<BrandRuleRow> & Pick<BrandRuleRow, "id" | "scope" | "ruleType" | "content" | "version">,
): BrandRuleRow {
  return {
    detectPattern: null,
    alternative: null,
    reason: null,
    legalBasis: null,
    severity: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveRules", () => {
  it("채널이 있으면 brand_rules 를 조회해 mergeRules 로 병합한 결과를 ok 로 돌려준다", async () => {
    const ruleRows: BrandRuleRow[] = [
      ruleRow({ id: 1, scope: "common", ruleType: "persona", content: "친근한 이웃", version: 1 }),
      ruleRow({ id: 2, scope: "channel", ruleType: "tone", content: "발랄함", version: 3 }),
      ruleRow({
        id: 3,
        scope: "country",
        ruleType: "ban",
        content: "효능 단정",
        detectPattern: "완치",
        severity: "block",
        version: 2,
      }),
    ];
    const { db, fromCalls } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows });

    const result = await resolveRules({ db }, { channelId: 10, lang: "ko" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // resolveRules 는 조회한 행을 그대로 mergeRules 에 넘겨야 한다 — mergeRules 자체는
      // rules-merge.golden.test.ts 가 전수 검증하므로 여기서는 "같은 입력을 오라클로 써서
      // 배선이 맞는가"만 본다(중복 로직을 재작성하지 않는다).
      expect(result.data).toEqual(mergeRules(ruleRows));
    }

    // 순차 호출: salesChannels 먼저, brandRules 나중.
    expect(fromCalls).toEqual(["salesChannels", "brandRules"]);
  });

  it("규칙이 하나도 없으면(결과 없음) 빈 배열들로 채워진 ResolvedRules 를 200 상당으로 돌려준다", async () => {
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows: [] });

    const result = await resolveRules({ db }, { channelId: 10, lang: "ko" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        version: "v0",
        appliedRuleIds: [],
        persona: "",
        tone: "",
        format: "",
        must: [],
        ban: [],
      });
    }
  });

  it("productId 를 넘기면 그대로 병합 대상에 반영될 수 있어야 한다(호출 자체가 거부되지 않는다)", async () => {
    const ruleRows: BrandRuleRow[] = [
      ruleRow({ id: 5, scope: "product", ruleType: "persona", content: "제품 맞춤", version: 1 }),
    ];
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows });

    const result = await resolveRules({ db }, { channelId: 10, lang: "ko", productId: 77 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.persona).toBe("제품 맞춤");
  });

  it("채널이 없으면 NOT_FOUND 를 돌려주고, brand_rules 조회는 아예 하지 않는다(순차 단락)", async () => {
    const { db, fromCalls, select } = createDbMock({ channelRows: [], ruleRows: [] });

    const result = await resolveRules({ db }, { channelId: 999, lang: "ko" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.details).toEqual({ resource: "channel", id: 999 });
    }

    expect(fromCalls).toEqual(["salesChannels"]);
    // select 자체는 채널 조회 한 번만 — brand_rules 조회가 추가로 일어나지 않았다.
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("DB 조회가 실패하면 INTERNAL 로 감싸고 console.error 로 로그를 남긴다", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const select = vi.fn(() => {
      throw new Error("connection refused");
    });
    const db = { select } as unknown as Db;

    const result = await resolveRules({ db }, { channelId: 10, lang: "ko" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("lang='en' 도 정상 처리된다(리터럴 유니온 경계값)", async () => {
    const ruleRows: BrandRuleRow[] = [
      ruleRow({ id: 6, scope: "common", ruleType: "persona", content: "friendly neighbor", version: 1 }),
    ];
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "US" }], ruleRows });

    const result = await resolveRules({ db }, { channelId: 10, lang: "en" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.persona).toBe("friendly neighbor");
  });
});

// ---------------------------------------------------------------------------
// 계약: FR-025 「유닛 · src/services/rules.ts · listBrandStandards」
// (`_workspace/contract_fr-025-brand-rules-screen.md` 47~51행)
//
// 외부 경계(계약): "테스트가 모킹할 대상은 DB 클라이언트(Db, drizzle) 하나뿐이다.
// src/services/rules.test.ts 의 기존 makeChainNode Proxy 스텁 패턴을 재사용한다 —
// select(...).from(table) 을 테이블 정체성(schema.brandRules·schema.salesChannels·
// schema.products)으로 분기해 행 배열로 resolve 되게 한다." 이 파일 상단의
// makeChainNode 를 그대로 재사용하고, 3개 테이블로 분기하는 전용 스텁만 새로 둔다.
//
// 계약: "정상: 독립 쿼리 3개를 Promise.all 로". Promise.all 이라는 전송 방식 자체는
// 계약 밖(구현 세부)이지만, "부수효과: 읽기 전용 쿼리 3회" 는 계약이므로 세 테이블 모두
// 조회되는지는 fromCalls 로 관찰한다.
// ---------------------------------------------------------------------------

function createStandardsDbMock(opts: {
  ruleRows: StandardRuleRow[];
  channelRows: StandardChannelInput[];
  productRows: StandardProductInput[];
}) {
  const fromCalls: string[] = [];
  // brandRules 체인에 걸린 메서드 호출(특히 .where())을 그대로 기록한다 —
  // 05 리뷰 지적: 기존 스텁은 이 호출을 완전히 무시해 status='active' 필터를 지워도
  // listBrandStandards 테스트가 그대로 통과했다.
  const brandRulesCalls: { method: string; args: unknown[] }[] = [];
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.brandRules) {
        fromCalls.push("brandRules");
        return makeChainNode(opts.ruleRows, (method, args) => brandRulesCalls.push({ method, args }));
      }
      if (table === schema.salesChannels) {
        fromCalls.push("salesChannels");
        return makeChainNode(opts.channelRows);
      }
      if (table === schema.products) {
        fromCalls.push("products");
        return makeChainNode(opts.productRows);
      }
      throw new Error("unexpected select().from() table in test mock");
    }),
  }));
  return { db: { select } as unknown as Db, select, fromCalls, brandRulesCalls };
}

function standardRuleRow(
  overrides: Partial<StandardRuleRow> &
    Pick<StandardRuleRow, "id" | "scope" | "ruleType" | "content" | "version" | "lang">,
): StandardRuleRow {
  return {
    detectPattern: null,
    alternative: null,
    reason: null,
    legalBasis: null,
    severity: null,
    country: null,
    channelId: null,
    productId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("listBrandStandards", () => {
  it("정상 — brand_rules(status=active)·sales_channels·products 를 조회해 buildBrandStandards 로 조립한 결과를 ok 로 돌려준다", async () => {
    const channelRows: StandardChannelInput[] = [{ id: 1, name: "채널A", country: "KR", lang: "ko" }];
    const productRows: StandardProductInput[] = [{ id: 10, name: "제품A" }];
    const ruleRows: StandardRuleRow[] = [
      standardRuleRow({ id: 1, scope: "common", ruleType: "persona", content: "친근한", lang: "ko", version: 1 }),
      standardRuleRow({ id: 2, scope: "channel", ruleType: "tone", content: "채널톤", lang: "ko", channelId: 1, version: 1 }),
    ];
    const { db, fromCalls } = createStandardsDbMock({ ruleRows, channelRows, productRows });

    const result = await listBrandStandards({ db });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // buildBrandStandards 자체는 rules-merge.golden.test.ts 가 전수 검증하므로,
      // 여기서는 "조회한 행을 그대로 넘겨 조립하는가"(배선)만 오라클로 확인한다.
      expect(result.data).toEqual(buildBrandStandards({ rules: ruleRows, channels: channelRows, products: productRows }));
    }
    expect(fromCalls.sort()).toEqual(["brandRules", "products", "salesChannels"]);
  });

  it("규칙이 0행이면(결과 없음) ok:true 이고 isEmpty:true 다 — 실패가 아니다", async () => {
    const { db } = createStandardsDbMock({
      ruleRows: [],
      channelRows: [{ id: 1, name: "채널A", country: "KR", lang: "ko" }],
      productRows: [],
    });

    const result = await listBrandStandards({ db });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isEmpty).toBe(true);
      expect(result.data.channels).toEqual([]);
      expect(result.data.bans).toEqual([]);
      expect(result.data.musts).toEqual([]);
      expect(result.data.productExceptions).toEqual([]);
    }
  });

  it("쿼리가 하나라도 throw 하면 INTERNAL 로 감싸고 console.error 에 brand_standards_failed 이벤트를 남긴다", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const select = vi.fn(() => {
      throw new Error("connection refused");
    });
    const db = { select } as unknown as Db;

    const result = await listBrandStandards({ db });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toBe("브랜드 기준 조회 중 오류가 발생했습니다.");
    }

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedArg = consoleErrorSpy.mock.calls[0]?.[0];
    expect(typeof loggedArg).toBe("string");
    const logged = JSON.parse(loggedArg as string) as { event: string; message: string };
    expect(logged.event).toBe("brand_standards_failed");
    expect(typeof logged.message).toBe("string");
    expect(logged.message.length).toBeGreaterThan(0);

    consoleErrorSpy.mockRestore();
  });

  it("brand_rules 조회는 status='active' 로 필터링된다 — where 호출 자체와 그 조건이 status·active 를 참조하는지를 스텁으로 직접 관찰한다", async () => {
    const { db, brandRulesCalls } = createStandardsDbMock({ ruleRows: [], channelRows: [], productRows: [] });

    await listBrandStandards({ db });

    const whereCalls = brandRulesCalls.filter((c) => c.method === "where");
    // .where() 자체가 안 불리면(필터 삭제) 여기서 잡힌다.
    expect(whereCalls.length).toBeGreaterThanOrEqual(1);
    const conditionText = sqlConditionText(whereCalls[0]?.args[0]);
    expect(conditionText).toContain("status");
    expect(conditionText).toContain("active");
  });

  it("세 쿼리 중 하나가 await 시점에 reject 해도(동기 throw 가 아니라) INTERNAL 로 감싸고 로그를 남긴다", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fromCalls: string[] = [];
    const select = vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === schema.brandRules) {
          fromCalls.push("brandRules");
          return makeChainNode([]);
        }
        if (table === schema.salesChannels) {
          fromCalls.push("salesChannels");
          return makeChainNode([]);
        }
        if (table === schema.products) {
          fromCalls.push("products");
          // select().from() 구성 자체는 동기적으로 성공하고, Promise.all 이 이 쿼리를
          // await 하는 시점에야 실패한다 — 실제 Neon HTTP 드라이버 장애와 같은 모양이다.
          return makeRejectingChainNode(new Error("neon await-time failure"));
        }
        throw new Error("unexpected select().from() table in test mock");
      }),
    }));
    const db = { select } as unknown as Db;

    const result = await listBrandStandards({ db });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toBe("브랜드 기준 조회 중 오류가 발생했습니다.");
    }
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedArg = consoleErrorSpy.mock.calls[0]?.[0];
    const logged = JSON.parse(loggedArg as string) as { event: string; message: string };
    expect(logged.event).toBe("brand_standards_failed");
    expect(typeof logged.message).toBe("string");
    expect(logged.message.length).toBeGreaterThan(0);

    consoleErrorSpy.mockRestore();
  });

  it("세 쿼리는 서로 독립적으로 실행된다 — 하나가 아직 resolve 되지 않아도 나머지 두 테이블은 이미 조회 요청됐다", () => {
    const pendingNode = (() => {
      const pending = new Promise(() => {
        /* 의도적으로 영원히 pending */
      });
      const node: Record<string, unknown> = { then: pending.then.bind(pending), catch: pending.catch.bind(pending) };
      return new Proxy(node, {
        get(target, prop, receiver) {
          if (prop in target) return Reflect.get(target, prop, receiver);
          if (prop === "constructor" || typeof prop === "symbol") return undefined;
          return (..._args: unknown[]) => node;
        },
      });
    })();

    const fromCalls: string[] = [];
    const select = vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === schema.brandRules) {
          fromCalls.push("brandRules");
          return pendingNode; // 절대 resolve 되지 않음
        }
        if (table === schema.salesChannels) {
          fromCalls.push("salesChannels");
          return makeChainNode([]);
        }
        if (table === schema.products) {
          fromCalls.push("products");
          return makeChainNode([]);
        }
        throw new Error("unexpected select().from() table in test mock");
      }),
    }));
    const db = { select } as unknown as Db;

    // 의도적으로 await 하지 않는다 — listBrandStandards 가 첫 await(Promise.all) 에 이르기까지
    // 동기적으로 실행되는 부분만 관찰한다.
    void listBrandStandards({ db });

    expect(fromCalls.sort()).toEqual(["brandRules", "products", "salesChannels"]);
  });
});
