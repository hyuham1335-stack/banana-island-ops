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
import { mergeRules } from "@/lib/rules-merge";
import type { BrandRuleRow } from "@/lib/rules-merge";
import { resolveRules } from "./rules";

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — src/services/plans.test.ts 의 makeChainNode 패턴 재사용.
// ---------------------------------------------------------------------------

function makeChainNode(resolvedValue: unknown) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue),
    catch: () => node,
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (..._args: unknown[]) => node;
    },
  });
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
