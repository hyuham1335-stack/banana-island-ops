import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 계약: FR-004(런 20260914-2058-0053) 「유닛 · src/services/content-generation.ts::generateTitles」
//
// 외부 경계(계약): "테스트가 모킹할 대상은 LlmClient(generateJson)와 Db(drizzle) 뿐이다."
// Db 는 src/services/rules.test.ts 의 makeChainNode 패턴을 그대로 재사용한다 — resolveRules 는
// 모킹하지 않고 실물을 그대로 통과시킨다(내부 호출이지 외부 경계가 아니다). 다만
// "productId: null 이 undefined 로 변환되어 resolveRules 에 전달되는가"는 호출 인자를
// 관측해야 하므로, vi.mock(importOriginal) 로 resolveRules 를 감싸는 스파이를 만든다 —
// 구현은 실물 그대로 위임하고 호출 인자만 기록한다(동작을 바꾸지 않는 관측이다).
//
// 시간 예산(2.2·2.5절, 01_plan.md 단일 출처): TITLE_TOTAL_BUDGET_MS=28_000,
// MIN_REGEN_BUDGET_MS=3_000, 재생성 timeoutMs = min(8_000, remaining-1_000). llm.generateJson
// 을 모킹하는 김에 vi.useFakeTimers() 로 Date.now() 를 통제해 "예산 소진" 분기를 실시간
// 대기 없이 결정론적으로 재현한다.

vi.mock("@/services/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rules")>();
  return { ...actual, resolveRules: vi.fn(actual.resolveRules) };
});

import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { LlmFailedError, LlmTimeoutError } from "@/lib/llm/client";
import { combineSentPrompt } from "@/lib/llm/prompts";
import {
  LlmBodyDraftSchema,
  LlmTitleCandidatesSchema,
  LlmTitleItemSchema,
  type CreateContentInput,
} from "@/lib/schemas";
import type { BrandRuleRow } from "@/lib/rules-merge";
import { buildUtmLink } from "@/lib/utm";
import { resolveRules } from "@/services/rules";
import { BODY_TOTAL_BUDGET_MS, MIN_BODY_REGEN_BUDGET_MS, createContentWithBody, generateTitles } from "./content-generation";

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — src/services/rules.test.ts 와 동일한 패턴(그 파일을 export 하지 않으므로
// 이 파일에서 다시 선언한다).
// ---------------------------------------------------------------------------

// delayMs > 0 이면 resolve 직전에 vi.advanceTimersByTime 으로 지연을 흉내 낸다 — 아래
// timedResolve(LLM 목)와 동일한 기법이다. resolveRules 는 이 DB 조회를 await 하므로,
// 이 지연은 곧 resolveRules 자체가 그만큼의 시간을 소모한 것으로 관측된다.
function makeChainNode(resolvedValue: unknown, delayMs = 0) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => {
      if (delayMs > 0) vi.advanceTimersByTime(delayMs);
      resolve(resolvedValue);
    },
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

function createDbMock(opts: {
  channelRows: ChannelRow[];
  ruleRows: BrandRuleRow[];
  // resolveRules 전체(채널 조회 → brand_rules 조회, 순차)가 소모하는 시간을 흉내 낸다.
  // 첫 쿼리(salesChannels)의 resolve 지점에 몰아서 지연을 건다 — 두 조회가 순차이므로
  // resolveRules 완료 시점의 총 경과시간은 지연을 어느 쪽에 걸든 동일하다.
  resolveRulesDelayMs?: number;
}) {
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.salesChannels) return makeChainNode(opts.channelRows, opts.resolveRulesDelayMs ?? 0);
      if (table === schema.brandRules) return makeChainNode(opts.ruleRows);
      throw new Error("unexpected select().from() table in test mock");
    }),
  }));
  return { db: { select } as unknown as Db, select };
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

// "완치" 를 block 으로 잡는 단일 금칙어 규칙 — 재생성 트리거용 픽스처.
const CURE_BAN_RULE = ruleRow({
  id: 1,
  scope: "common",
  ruleType: "ban",
  content: "질병 치료·예방 표현",
  detectPattern: "완치",
  severity: "block",
  version: 1,
});

const baseInput = {
  productId: null as number | null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  topicMemo: "여름 다이어트 간식",
  targetPersona: "30대 직장인",
};

function timedResolve<T>(advanceMs: number, value: T) {
  return () => {
    vi.advanceTimersByTime(advanceMs);
    return Promise.resolve(value);
  };
}

function timedReject(advanceMs: number, error: unknown) {
  return () => {
    vi.advanceTimersByTime(advanceMs);
    return Promise.reject(error);
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("generateTitles", () => {
  it("정상 3안 — 차단어가 없으면 재생성 없이 초기 응답을 그대로 돌려준다", async () => {
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows: [] });
    const items = [
      { title: "제목1", angle: "앵글1" },
      { title: "제목2", angle: "앵글2" },
      { title: "제목3", angle: "앵글3" },
    ];
    const generateJson = vi.fn().mockImplementation(timedResolve(1000, { items }));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toEqual(items);
      expect(result.data.regeneratedIdx).toEqual([]);
    }
    expect(generateJson).toHaveBeenCalledTimes(1);
    const [system, user, schemaArg, timeoutMs] = generateJson.mock.calls[0];
    expect(typeof system).toBe("string");
    expect(typeof user).toBe("string");
    expect(schemaArg).toBe(LlmTitleCandidatesSchema);
    expect(timeoutMs).toBe(20_000);
  });

  it("1개 차단 → 재생성 성공 — 해당 항목만 새 값으로 교체되고 regeneratedIdx 에 기록된다", async () => {
    const { db } = createDbMock({
      channelRows: [{ id: 10, country: "KR" }],
      ruleRows: [CURE_BAN_RULE],
    });
    const items = [
      { title: "깨끗한 제목1", angle: "앵글1" },
      { title: "당뇨 완치 프로젝트", angle: "앵글2" }, // "완치" 매치 → block
      { title: "깨끗한 제목3", angle: "앵글3" },
    ];
    const regenerated = { title: "완치 표현 없는 새 제목", angle: "새 앵글" };
    const generateJson = vi
      .fn()
      .mockImplementationOnce(timedResolve(0, { items }))
      .mockImplementationOnce(timedResolve(0, regenerated));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[0]).toEqual(items[0]);
      expect(result.data.items[1]).toEqual(regenerated);
      expect(result.data.items[2]).toEqual(items[2]);
      expect(result.data.regeneratedIdx).toEqual([1]);
    }
    expect(generateJson).toHaveBeenCalledTimes(2);
    const [, , regenSchema, regenTimeoutMs] = generateJson.mock.calls[1];
    expect(regenSchema).toBe(LlmTitleItemSchema);
    // remaining = 28_000 - 0 = 28_000 → timeoutMs = min(8_000, 28_000 - 1_000) = 8_000
    expect(regenTimeoutMs).toBe(8_000);
  });

  it("합산 예산이 소진되면(remaining < 3_000) 남은 차단 항목의 재생성을 건너뛰고 원래 값을 유지한다", async () => {
    const { db } = createDbMock({
      channelRows: [{ id: 10, country: "KR" }],
      ruleRows: [CURE_BAN_RULE],
    });
    const blockedItem = { title: "당뇨 완치 프로젝트", angle: "앵글2" };
    const items = [{ title: "제목1", angle: "앵글1" }, blockedItem, { title: "제목3", angle: "앵글3" }];
    // 초기 호출이 26_000ms 를 소모 → remaining = 28_000 - 26_000 = 2_000 < MIN_REGEN_BUDGET_MS(3_000).
    const generateJson = vi.fn().mockImplementationOnce(timedResolve(26_000, { items }));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[1]).toEqual(blockedItem); // 원래 값 그대로
      expect(result.data.regeneratedIdx).toEqual([]);
    }
    // 예산이 없어 재생성 자체를 시도하지 않는다 — 초기 호출 1회만.
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["LlmTimeoutError", () => new LlmTimeoutError("timeout")],
    ["LlmFailedError", () => new LlmFailedError("failed")],
  ])(
    "재생성 호출 자체가 %s 를 던져도 전체 요청은 성공하고 그 항목만 원래 값을 유지한다",
    async (_label, makeError) => {
      const { db } = createDbMock({
        channelRows: [{ id: 10, country: "KR" }],
        ruleRows: [CURE_BAN_RULE],
      });
      const blockedItem = { title: "당뇨 완치 프로젝트", angle: "앵글2" };
      const items = [{ title: "제목1", angle: "앵글1" }, blockedItem, { title: "제목3", angle: "앵글3" }];
      const generateJson = vi
        .fn()
        .mockImplementationOnce(timedResolve(0, { items }))
        .mockImplementationOnce(timedReject(0, makeError()));
      const llm = { generateJson };

      const result = await generateTitles({ db, llm }, baseInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items[1]).toEqual(blockedItem);
        expect(result.data.regeneratedIdx).toEqual([]);
      }
      expect(generateJson).toHaveBeenCalledTimes(2);
    },
  );

  it("재생성 후에도 차단이 남아 있으면(여전히 매치) 새 값으로 교체하되 regeneratedIdx 에는 기록한다", async () => {
    const { db } = createDbMock({
      channelRows: [{ id: 10, country: "KR" }],
      ruleRows: [CURE_BAN_RULE],
    });
    const items = [
      { title: "제목1", angle: "앵글1" },
      { title: "당뇨 완치 프로젝트", angle: "앵글2" },
      { title: "제목3", angle: "앵글3" },
    ];
    // 재생성 결과도 여전히 "완치" 를 포함 — 1회 상한이므로 더 재요청하지 않는다.
    const stillBlocked = { title: "그래도 완치를 강조", angle: "새 앵글" };
    const generateJson = vi
      .fn()
      .mockImplementationOnce(timedResolve(0, { items }))
      .mockImplementationOnce(timedResolve(0, stillBlocked));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[1]).toEqual(stillBlocked);
      expect(result.data.regeneratedIdx).toEqual([1]);
    }
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it("resolveRules 가 NOT_FOUND 를 돌려주면 그대로 전파하고 LLM 을 호출하지 않는다", async () => {
    const { db } = createDbMock({ channelRows: [], ruleRows: [] });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, { ...baseInput, channelId: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("초기 호출이 LlmTimeoutError 를 던지면 LLM_TIMEOUT 으로 매핑한다", async () => {
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows: [] });
    const generateJson = vi.fn().mockRejectedValueOnce(new LlmTimeoutError("timeout"));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_TIMEOUT");
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["LlmFailedError", () => new LlmFailedError("failed")],
    ["그 밖의 오류(기타)", () => new Error("boom")],
  ])("초기 호출이 %s 를 던지면 LLM_FAILED 로 매핑한다", async (_label, makeError) => {
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows: [] });
    const generateJson = vi.fn().mockRejectedValueOnce(makeError());
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_FAILED");
  });

  it("productId: null 입력은 resolveRules 에 undefined 로 전달된다", async () => {
    const { db } = createDbMock({ channelRows: [{ id: 10, country: "KR" }], ruleRows: [] });
    const generateJson = vi.fn().mockImplementation(
      timedResolve(0, {
        items: [
          { title: "제목1", angle: "앵글1" },
          { title: "제목2", angle: "앵글2" },
          { title: "제목3", angle: "앵글3" },
        ],
      }),
    );
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, { ...baseInput, productId: null });

    expect(result.ok).toBe(true);
    expect(resolveRules).toHaveBeenCalledWith(
      { db },
      { channelId: baseInput.channelId, lang: baseInput.lang, productId: undefined },
    );
  });

  // 계약: PR #7(FR-004) Major 3건 수리 — 경과시간 측정 시작점을 resolveRules 호출 전으로
  // 옮기고, remainingForInitial = TITLE_TOTAL_BUDGET_MS - (그 시점까지의 경과시간) 을
  // 1차 generateJson 의 timeoutMs 계산에 반영한다.

  it("resolveRules 가 26_000ms 를 소모하면 재생성이 예산 부족(remaining=2_000<3_000)으로 스킵되고 원래 값을 유지한다", async () => {
    const { db } = createDbMock({
      channelRows: [{ id: 10, country: "KR" }],
      ruleRows: [CURE_BAN_RULE],
      resolveRulesDelayMs: 26_000,
    });
    const blockedItem = { title: "당뇨 완치 프로젝트", angle: "앵글2" };
    const items = [{ title: "제목1", angle: "앵글1" }, blockedItem, { title: "제목3", angle: "앵글3" }];
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { items }));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items[1]).toEqual(blockedItem); // 원래 값 그대로
      expect(result.data.regeneratedIdx).toEqual([]);
    }
    // resolveRules 가 이미 26_000ms 를 소모했으므로 1차 호출은 일어나되(remaining=2_000>0),
    // 재생성은 예산 부족(2_000<MIN_REGEN_BUDGET_MS)으로 시도되지 않는다 — 1차 호출 1회만.
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("resolveRules 가 12_000ms 를 소모하면 1차 generateJson 의 timeoutMs 는 min(20_000, 28_000-12_000)=16_000 이다", async () => {
    const { db } = createDbMock({
      channelRows: [{ id: 10, country: "KR" }],
      ruleRows: [],
      resolveRulesDelayMs: 12_000,
    });
    const items = [
      { title: "제목1", angle: "앵글1" },
      { title: "제목2", angle: "앵글2" },
      { title: "제목3", angle: "앵글3" },
    ];
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { items }));
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
    const [, , , timeoutMs] = generateJson.mock.calls[0];
    expect(timeoutMs).toBe(16_000);
  });

  it("resolveRules 가 28_000ms 이상을 소모하면 generateJson 을 한 번도 호출하지 않고 즉시 LLM_TIMEOUT 을 반환한다", async () => {
    const { db } = createDbMock({
      channelRows: [{ id: 10, country: "KR" }],
      ruleRows: [],
      resolveRulesDelayMs: 29_000,
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await generateTitles({ db, llm }, baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_TIMEOUT");
    }
    expect(generateJson).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 계약: FR-005(_workspace/contract_fr-005-body-generation.md) 「유닛 · createContentWithBody」
//
// 외부 경계(계약): LlmClient(generateJson)·Db(drizzle)·resolveRules(실물 통과, 위 generateTitles
// 스위트와 같은 스파이 래핑)·validate(실물, CURE_BAN_RULE 로 차단 트리거)·buildUtmLink(실물,
// 링크 조립 오라클로 재사용) 뿐이다.
//
// DB 쿼리 형태(계약이 고정하지 않은 부분, plans.test.ts 의 선례를 따라 이 파일이 고른 가정):
//   - publishPlanId 가 있을 때만 select().from(publishPlans) 를 1회 호출한다(LEFT JOIN 결과 행
//     { contentId: number|null, body: string|null } — 행 자체가 없으면 plan 미존재).
//   - select().from(salesChannels) 는 createContentWithBody 자신의 채널 조회(step3)와
//     resolveRules 내부 조회(step5) 양쪽에서 호출될 수 있으므로 항상 같은 고정 행을 돌려준다.
//   - select().from(promptTemplates) 는 "채널 전용 → 없으면 공통" 순차 조건부 조회로 가정한다
//     (계약 101행 "없으면"의 가장 자연스러운 해석) — templateQueue 로 호출 순서대로 소비한다.
//   - insert(contents)/update(contents) 는 .values()/.set() 인자를 캡처해 배선을 검증하고,
//     .returning() 의 결과(또는 에러)를 큐로 소비한다(재시도 UPDATE → 최종 UPDATE 순서).
// =============================================================================

function makeThrowingNode(error: unknown) {
  const node: Record<string, unknown> = {
    then: () => {
      throw error;
    },
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

interface LinkedContentRow {
  contentId: number | null;
  // 실제 조회 컬럼명(구현 확인) — planRow.contentBody 로 destructure 된다.
  contentBody: string | null;
}

interface ChannelDetailRow {
  id: number;
  name: string;
  country: string;
  utmSource: string | null;
  utmMedium: string | null;
  linkPolicy: "inline" | "bio" | "none";
}

interface ProductDetailRow {
  productCode: string;
  name: string;
}

interface TemplateRow {
  id: number;
  body: string;
}

interface ExampleRow {
  id: number;
  summary: string;
}

function createBodyDbMock(opts: {
  publishPlanRows?: LinkedContentRow[]; // 비우면(undefined) publishPlans 조회 자체를 기대하지 않는다
  channelRows: ChannelDetailRow[];
  productRows?: ProductDetailRow[];
  ruleRows?: BrandRuleRow[];
  templateQueue?: TemplateRow[][]; // 호출 순서대로 소비 — [채널전용결과, 공통결과]
  exampleRows?: ExampleRow[];
  contentsSelectRows?: Record<string, unknown>[]; // 최종 UPDATE 0행 시 폴백 SELECT
  insertResult?: Record<string, unknown>[] | Error;
  updateQueue?: (Record<string, unknown>[] | Error)[]; // 재시도 UPDATE → 최종 UPDATE 순서로 소비
  preLlmDelayMs?: number; // brandExamples 조회 resolve 시점에 소비하는 가짜 시간(예산 소진 테스트용)
}) {
  const templateQueue = [...(opts.templateQueue ?? [])];
  const updateQueue = [...(opts.updateQueue ?? [])];
  const selectCalls: string[] = [];
  const insertValuesCalls: unknown[] = [];
  const updateSetCalls: unknown[] = [];

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.publishPlans) {
        selectCalls.push("publishPlans");
        return makeChainNode(opts.publishPlanRows ?? []);
      }
      if (table === schema.salesChannels) {
        selectCalls.push("salesChannels");
        return makeChainNode(opts.channelRows);
      }
      if (table === schema.brandRules) {
        selectCalls.push("brandRules");
        return makeChainNode(opts.ruleRows ?? []);
      }
      if (table === schema.products) {
        selectCalls.push("products");
        return makeChainNode(opts.productRows ?? []);
      }
      if (table === schema.promptTemplates) {
        selectCalls.push("promptTemplates");
        return makeChainNode(templateQueue.shift() ?? []);
      }
      if (table === schema.brandExamples) {
        selectCalls.push("brandExamples");
        if (opts.preLlmDelayMs) vi.advanceTimersByTime(opts.preLlmDelayMs);
        return makeChainNode(opts.exampleRows ?? []);
      }
      if (table === schema.contents) {
        selectCalls.push("contents");
        return makeChainNode(opts.contentsSelectRows ?? []);
      }
      throw new Error(`unexpected select().from() table in test mock: ${String(table)}`);
    }),
  }));

  const insert = vi.fn((table: unknown) => {
    if (table !== schema.contents) throw new Error("unexpected insert() table in test mock");
    return {
      values: vi.fn((vals: unknown) => {
        insertValuesCalls.push(vals);
        return {
          returning: vi.fn(() => {
            if (opts.insertResult instanceof Error) return makeThrowingNode(opts.insertResult);
            return makeChainNode(opts.insertResult ?? []);
          }),
        };
      }),
    };
  });

  const update = vi.fn((table: unknown) => {
    if (table !== schema.contents) throw new Error("unexpected update() table in test mock");
    return {
      set: vi.fn((vals: unknown) => {
        updateSetCalls.push(vals);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => {
              const next = updateQueue.shift();
              if (next instanceof Error) return makeThrowingNode(next);
              return makeChainNode(next ?? []);
            }),
          })),
        };
      }),
    };
  });

  return {
    db: { select, insert, update } as unknown as Db,
    select,
    insert,
    update,
    selectCalls,
    insertValuesCalls,
    updateSetCalls,
  };
}

const CHANNEL_ROW: ChannelDetailRow = {
  id: 10,
  name: "카카오스토어",
  country: "KR",
  utmSource: "kakao",
  utmMedium: "sns",
  linkPolicy: "inline",
};

const TEMPLATE_ROW: TemplateRow = {
  id: 900,
  body: "{제품명} 소식 - 타깃: {타깃} - 링크: {링크}",
};

const baseBodyInput: CreateContentInput = {
  publishPlanId: null,
  productId: null,
  channelId: 10,
  lang: "ko",
  postType: "health_info",
  topicMemo: "여름 다이어트 간식",
  targetPersona: "30대 직장인",
  title: "여름철 든든한 간식",
  angle: "다이어트 중에도 부담 없이",
  titleCandidates: [
    { title: "여름철 든든한 간식", angle: "다이어트 중에도 부담 없이" },
    { title: "제목2", angle: "앵글2" },
    { title: "제목3", angle: "앵글3" },
  ],
};

describe("createContentWithBody", () => {
  it("상수 export — BODY_TOTAL_BUDGET_MS·MIN_BODY_REGEN_BUDGET_MS 가 계약 고정값이다", () => {
    expect(BODY_TOTAL_BUDGET_MS).toBe(55_000);
    expect(MIN_BODY_REGEN_BUDGET_MS).toBe(5_000);
  });

  it("정상 경로(publishPlanId 없음, 차단어 없음) — INSERT 로 신규 생성하고 ContentDetail 을 조립해 ok 를 돌려준다", async () => {
    const { db, insert, update, insertValuesCalls, updateSetCalls } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [
        { id: 1, summary: "여름 간식 후기 예시" },
        { id: 2, summary: "직장인 타깃 예시" },
      ],
      insertResult: [{ id: 501, createdAt: new Date("2026-09-15T00:00:00Z"), updatedAt: new Date("2026-09-15T00:00:00Z") }],
      updateQueue: [[{ updatedAt: new Date("2026-09-15T00:01:00Z") }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "정상적인 본문입니다." }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.id).toBe(501);
    expect(result.data.status).toBe("draft");
    expect(result.data.body).toBe("정상적인 본문입니다.");
    expect(result.data.regenCount).toBe(0);
    expect(result.data.autoRegenerated).toBe(false);
    expect(result.data.publishPlanId).toBeNull();
    expect(result.data.sourceContentId).toBeNull();
    expect(result.data.rejectReason).toBeNull();
    expect(result.data.publishedUrl).toBeNull();
    expect(result.data.urlCheck).toBeNull();
    expect(result.data.authorId).toBeNull();
    expect(result.data.reviewerId).toBeNull();
    expect(result.data.publisherId).toBeNull();
    expect(result.data.submittedAt).toBeNull();
    expect(result.data.reviewedAt).toBeNull();
    expect(result.data.publishedAt).toBeNull();
    expect(result.data.isExample).toBe(false);
    expect(result.data.historyCount).toBe(0);
    expect(result.data.model).toBe("claude-test-model");

    // 링크 — buildUtmLink 실물을 오라클로 재사용해 배선을 검증한다(제품 없음 → 루트 URL).
    const expectedLink = buildUtmLink({
      baseUrl: "https://shop.banana-island.co.kr",
      productCode: null,
      utmSource: "kakao",
      utmMedium: "sns",
      contentId: 501,
    });
    expect(result.data.link).toBe(expectedLink);

    // exampleIds — brand_examples 조회 결과의 id 가 ruleSnapshot 에 그대로 매핑된다.
    expect(result.data.ruleSnapshot!.exampleIds).toEqual([1, 2]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1); // 최종 UPDATE 1회(신규 경로엔 재시도 UPDATE 없음)
    expect(insertValuesCalls).toHaveLength(1);
    expect(updateSetCalls).toHaveLength(1);
  });

  it("publishPlanId 있음 + 연결된 콘텐츠 없음 — INSERT 경로를 그대로 타되 publishPlanId 를 저장한다", async () => {
    const { db, insert, update, selectCalls } = createBodyDbMock({
      publishPlanRows: [{ contentId: null, contentBody: null }],
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 502, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, publishPlanId: 900 });

    expect(result.ok).toBe(true);
    expect(selectCalls[0]).toBe("publishPlans");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("publishPlanId 를 넘기지 않으면(null) publishPlans 조회 자체를 하지 않는다", async () => {
    const { db, selectCalls } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 503, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(selectCalls).not.toContain("publishPlans");
  });

  it("plan 이 없으면 NOT_FOUND(resource:'plan') 를 돌려주고 이후 어떤 쓰기도 하지 않는다", async () => {
    const { db, insert, update } = createBodyDbMock({
      publishPlanRows: [], // 행 없음 = plan 미존재
      channelRows: [CHANNEL_ROW],
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, publishPlanId: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.details).toEqual({ resource: "plan", id: 999 });
    }
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("plan 이 이미 완료된 콘텐츠(body 있음)에 연결돼 있으면 INVALID_TRANSITION(409) 을 돌려준다", async () => {
    const { db, insert, update } = createBodyDbMock({
      publishPlanRows: [{ contentId: 77, contentBody: "이미 완성된 본문" }],
      channelRows: [CHANNEL_ROW],
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, publishPlanId: 900 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "plan_already_linked", action: "create" });
    }
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("재시도 경로 — plan 에 연결된 미완성 행(body IS NULL)이 있으면 INSERT 대신 UPDATE 로 진행해 성공한다", async () => {
    const { db, insert, update, selectCalls } = createBodyDbMock({
      publishPlanRows: [{ contentId: 77, contentBody: null }],
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      // 재시도 UPDATE(step7) 성공 → 최종 UPDATE(step19) 성공, 순서대로 큐 소비.
      updateQueue: [[{ id: 77, createdAt: new Date(), updatedAt: new Date() }], [{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "재시도 본문" }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, publishPlanId: 900 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(77);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(2);
    expect(selectCalls[0]).toBe("publishPlans");
  });

  // 동시성 가드 1 — 재시도 UPDATE(step7)가 0행이면(그 사이 다른 요청이 먼저 채움) 409.
  it("동시성: 재시도 UPDATE(step7) 가 0행이면 INVALID_TRANSITION(409) 을 돌려주고 LLM 을 호출하지 않는다", async () => {
    const { db, update } = createBodyDbMock({
      publishPlanRows: [{ contentId: 77, contentBody: null }],
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      updateQueue: [[]], // 재시도 UPDATE 0행
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, publishPlanId: 900 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "plan_already_linked", action: "create" });
    }
    expect(update).toHaveBeenCalledTimes(1); // 최종 UPDATE 까지 가지 않는다
    expect(generateJson).not.toHaveBeenCalled();
  });

  // 동시성 가드 2 — 최종 UPDATE(step19)가 0행이면(나중 도착한 재시도) 덮어쓰지 않고
  // SELECT 로 다시 읽어 멱등 성공으로 응답한다.
  it("동시성: 최종 UPDATE(step19) 가 0행이면 SELECT 로 재조회해 멱등 성공(ok)을 돌려준다", async () => {
    // 최종 UPDATE(step19)의 폴백 SELECT 가 실제로 읽는 컬럼만 담는다(구현 확인:
    // body·regenCount·detectedTerms·ruleSnapshot·sentPrompt·model·updatedAt·sourceContentId).
    const existingRow = {
      body: "먼저 도착한 요청이 이미 채운 본문",
      regenCount: 0,
      detectedTerms: { blocks: [], warns: [], missing: [] },
      ruleSnapshot: { ruleIds: [], version: "v0", exampleIds: [] },
      sentPrompt: "===SYSTEM===\n...\n\n===USER===\n...",
      model: "claude-test-model",
      updatedAt: new Date("2026-09-15T00:05:00Z"),
      sourceContentId: null,
    };
    const { db, select } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 501, createdAt: new Date("2026-09-15T00:00:00Z"), updatedAt: new Date("2026-09-15T00:00:00Z") }],
      updateQueue: [[]], // 최종 UPDATE 0행 — 늦게 도착한 요청
      contentsSelectRows: [existingRow],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "늦게 도착한 요청이 만든 본문(버려짐)" }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    // 낭비된 LLM 호출을 사용자에게 노출하지 않고 성공으로 응답한다 — 먼저 채운 데이터로.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(501);
      expect(result.data.body).toBe("먼저 도착한 요청이 이미 채운 본문");
    }
    expect(select).toHaveBeenCalled();
  });

  it("INSERT 동시 경합(23505 unique_violation) 이면 INVALID_TRANSITION(409) 을 돌려준다(500 아님)", async () => {
    const conflictError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    const { db } = createBodyDbMock({
      publishPlanRows: [{ contentId: null, contentBody: null }],
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: conflictError,
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, publishPlanId: 900 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "plan_already_linked", action: "create" });
    }
    expect(generateJson).not.toHaveBeenCalled();
  });

  // F-2(05-code-review 1라운드, major) — 계약 「오류 어휘」INTERNAL(500): "DB 예외 등
  // 그 외(로그만, details 없음)". INSERT 가 23505(unique_violation) 가 아닌 일반 DB 예외를
  // 던지면 step6 의 내부 catch 가 그것을 재던지고(throw err), 바깥 try/catch(591행)의
  // catch-all 이 INTERNAL 로 매핑한다 — details 가 실려 있지 않은지까지 검증한다.
  it("INSERT 가 유니크 위반이 아닌 일반 DB 오류를 던지면 INTERNAL(500, details 없음)로 매핑한다", async () => {
    const dbError = new Error("connection terminated unexpectedly");
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      insertResult: dbError,
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody(
      { db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" },
      baseBodyInput,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toBe("본문 생성 중 오류가 발생했습니다.");
      expect(result.error.details).toBeUndefined();
    }
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("채널이 없으면 NOT_FOUND(resource:'channel') 를 돌려주고 resolveRules 를 호출하지 않는다", async () => {
    const { db } = createBodyDbMock({ channelRows: [] });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, channelId: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.details).toEqual({ resource: "channel", id: 999 });
    }
    expect(resolveRules).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("productId 가 있는데 제품이 없으면 NOT_FOUND(resource:'product') 를 돌려주고 resolveRules 를 호출하지 않는다", async () => {
    const { db } = createBodyDbMock({ channelRows: [CHANNEL_ROW], productRows: [] });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, productId: 12345 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.details).toEqual({ resource: "product", id: 12345 });
    }
    expect(resolveRules).not.toHaveBeenCalled();
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("productId: null 은 resolveRules 에 undefined 로 변환되어 전달된다", async () => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 504, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, { ...baseBodyInput, productId: null });

    expect(resolveRules).toHaveBeenCalledWith(
      { db },
      { channelId: baseBodyInput.channelId, lang: baseBodyInput.lang, productId: undefined },
    );
  });

  it("prompt_template 이 채널전용·공통 둘 다 없으면 NOT_FOUND(resource:'prompt_template', id:0) 를 돌려주고 contentId 를 details 에 담지 않는다(닫힌 형식 준수)", async () => {
    const { db, insert } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[], []], // 채널전용 없음, 공통도 없음
      exampleRows: [],
      insertResult: [{ id: 505, createdAt: new Date(), updatedAt: new Date() }],
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.details).toEqual({ resource: "prompt_template", id: 0 });
    }
    expect(generateJson).not.toHaveBeenCalled();
    // step6(INSERT)은 template 조회(step9~10)보다 먼저 일어나므로 이미 호출됐어야 한다.
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("prompt_template 이 채널전용에 없고 공통(channelId IS NULL)에 있으면 그것으로 진행한다", async () => {
    const commonTemplate: TemplateRow = { id: 901, body: "공통 템플릿 - 타깃: {타깃}" };
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[], [commonTemplate]],
      exampleRows: [],
      insertResult: [{ id: 506, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "공통 템플릿 기반 본문" }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("LLM 예산이 이미 소진되면(remainingForInitial<=0) LLM 을 호출하지 않고 LLM_TIMEOUT(contentId 포함) 을 돌려준다", async () => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 507, createdAt: new Date(), updatedAt: new Date() }],
      preLlmDelayMs: 52_000, // LLM_BUDGET_MS(52_000) 전부 소진
    });
    const generateJson = vi.fn();
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_TIMEOUT");
      expect(result.error.details).toEqual({ contentId: 507 });
    }
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("초기 LLM 호출이 LlmTimeoutError 를 던지면 LLM_TIMEOUT(contentId 포함) 으로 매핑한다", async () => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 508, createdAt: new Date(), updatedAt: new Date() }],
    });
    const generateJson = vi.fn().mockRejectedValueOnce(new LlmTimeoutError("timeout"));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_TIMEOUT");
      expect(result.error.details).toEqual({ contentId: 508 });
    }
  });

  it.each([
    ["LlmFailedError", () => new LlmFailedError("failed")],
    ["그 밖의 오류(기타)", () => new Error("boom")],
  ])("초기 LLM 호출이 %s 를 던지면 LLM_FAILED(contentId, attempt:1) 로 매핑한다", async (_label, makeError) => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 509, createdAt: new Date(), updatedAt: new Date() }],
    });
    const generateJson = vi.fn().mockRejectedValueOnce(makeError());
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_FAILED");
      expect(result.error.details).toEqual({ contentId: 509, attempt: 1 });
    }
  });

  it("초기 호출의 schema·purpose·timeoutMs 배선 — LlmBodyDraftSchema, purpose='body', timeoutMs=min(45_000, remaining)", async () => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 510, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(generateJson).toHaveBeenCalledTimes(1);
    const [, , schemaArg, timeoutMs, purpose] = generateJson.mock.calls[0];
    expect(schemaArg).toBe(LlmBodyDraftSchema);
    expect(timeoutMs).toBe(45_000);
    expect(purpose).toBe("body");
  });

  it("차단어 없음 — 재생성 없이 LLM 1회 호출로 성공하고 autoRegenerated=false, regenCount=0 이다", async () => {
    const { db, updateSetCalls } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [], // 금칙어 없음 → validate 가 blocks: [] 를 돌려준다
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 511, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "깨끗한 본문" }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.autoRegenerated).toBe(false);
      expect(result.data.regenCount).toBe(0);
      expect(result.data.body).toBe("깨끗한 본문");
    }
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ regenCount: 0 });
  });

  it("차단어 있음 → 재생성 성공 — finalBody 가 교체되고 autoRegenerated=true, regenCount=1 이다", async () => {
    const { db, updateSetCalls } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [CURE_BAN_RULE],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 512, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi
      .fn()
      .mockImplementationOnce(timedResolve(0, { body: "당뇨 완치 효과가 있습니다" })) // 초기 — 차단어 포함
      .mockImplementationOnce(timedResolve(0, { body: "건강 관리에 도움을 주는 본문입니다" })); // 재생성 — 깨끗
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toBe("건강 관리에 도움을 주는 본문입니다");
      expect(result.data.autoRegenerated).toBe(true);
      expect(result.data.regenCount).toBe(1);
    }
    expect(generateJson).toHaveBeenCalledTimes(2);
    const [, , regenSchema, regenTimeoutMs, regenPurpose] = generateJson.mock.calls[1];
    expect(regenSchema).toBe(LlmBodyDraftSchema);
    expect(regenPurpose).toBe("body_regenerate");
    // elapsedMs=0 이므로 remaining=52_000, regenTimeoutMs=min(45_000, 52_000-1_000)=45_000.
    expect(regenTimeoutMs).toBe(45_000);
    expect(updateSetCalls[0]).toMatchObject({ regenCount: 1 });
  });

  it("차단어 있음 + 재생성 예산 소진(remaining<5_000) → 재생성을 건너뛰고 원래 값을 유지한다", async () => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [CURE_BAN_RULE],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 513, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    // 초기 호출이 48_000ms 를 소모 → elapsedMs=48_000, remaining=52_000-48_000=4_000<5_000.
    const generateJson = vi.fn().mockImplementationOnce(timedResolve(48_000, { body: "당뇨 완치 프로젝트 본문" }));
    const llm = { generateJson };

    const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toBe("당뇨 완치 프로젝트 본문"); // 원래(차단된) 값 그대로
      expect(result.data.autoRegenerated).toBe(false);
      expect(result.data.regenCount).toBe(0);
    }
    expect(generateJson).toHaveBeenCalledTimes(1); // 재생성 시도 자체가 없다
  });

  it.each([
    ["LlmTimeoutError", () => new LlmTimeoutError("timeout")],
    ["LlmFailedError", () => new LlmFailedError("failed")],
  ])(
    "차단어 있음 + 재생성 호출이 %s 를 던져도 항목 단위로 흡수되어 전체 요청은 성공한다(원래 본문 유지)",
    async (_label, makeError) => {
      const { db } = createBodyDbMock({
        channelRows: [CHANNEL_ROW],
        ruleRows: [CURE_BAN_RULE],
        templateQueue: [[TEMPLATE_ROW]],
        exampleRows: [],
        insertResult: [{ id: 514, createdAt: new Date(), updatedAt: new Date() }],
        updateQueue: [[{ updatedAt: new Date() }]],
      });
      const generateJson = vi
        .fn()
        .mockImplementationOnce(timedResolve(0, { body: "당뇨 완치 프로젝트 본문" }))
        .mockImplementationOnce(timedReject(0, makeError()));
      const llm = { generateJson };

      const result = await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.body).toBe("당뇨 완치 프로젝트 본문");
        expect(result.data.autoRegenerated).toBe(false);
        expect(result.data.regenCount).toBe(0);
      }
      expect(generateJson).toHaveBeenCalledTimes(2);
    },
  );

  it("sentPrompt = combineSentPrompt(system, finalUser) 를 최종 UPDATE 에 그대로 전달한다", async () => {
    const { db, updateSetCalls } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 515, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    expect(generateJson).toHaveBeenCalledTimes(1);
    const [system, user] = generateJson.mock.calls[0];
    const expectedSentPrompt = combineSentPrompt(system, user);
    expect(updateSetCalls[0]).toMatchObject({ sentPrompt: expectedSentPrompt });
  });

  it("system 프롬프트는 본문 출력 형식({ body })을 지시하고, 제목 생성용 items 형식을 지시하지 않는다(07 코드리뷰: LlmBodyDraftSchema 와 system 이 지시하는 형식이 모순되면 실제 LLM 호출에서 스키마 불일치로 매번 실패한다)", async () => {
    const { db } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 517, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    const [system] = generateJson.mock.calls[0];
    expect(system).toContain('출력 형식: { "body": string }.');
    expect(system).not.toContain("items");
  });

  it("linkPolicy='none' 이면 렌더링된 템플릿에 실제 링크 대신 빈 문자열이 들어간다", async () => {
    const noneChannel: ChannelDetailRow = { ...CHANNEL_ROW, linkPolicy: "none" };
    const { db } = createBodyDbMock({
      channelRows: [noneChannel],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]], // "{제품명} 소식 - 타깃: {타깃} - 링크: {링크}"
      exampleRows: [],
      insertResult: [{ id: 516, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJson = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llm = { generateJson };

    await createContentWithBody({ db, llm, productBaseUrl: "https://shop.banana-island.co.kr", model: "claude-test-model" }, baseBodyInput);

    const [, user] = generateJson.mock.calls[0];
    expect(user).toContain("링크: ");
    expect(user).not.toContain("https://shop.banana-island.co.kr");
  });

  it("productId 가 있으면 제품명이 렌더링된 템플릿에 반영되고, 없으면 '브랜드 소식' 기본값을 쓴다", async () => {
    const { db: dbWithProduct } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      productRows: [{ productCode: "BANANA-001", name: "황금바나나칩" }],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 517, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJsonWithProduct = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llmWithProduct = { generateJson: generateJsonWithProduct };
    await createContentWithBody(
      {
        db: dbWithProduct,
        llm: llmWithProduct,
        productBaseUrl: "https://shop.banana-island.co.kr",
        model: "claude-test-model",
      },
      { ...baseBodyInput, productId: 1 },
    );
    const [, userWithProduct] = generateJsonWithProduct.mock.calls[0];
    expect(userWithProduct).toContain("황금바나나칩");

    const { db: dbNoProduct } = createBodyDbMock({
      channelRows: [CHANNEL_ROW],
      ruleRows: [],
      templateQueue: [[TEMPLATE_ROW]],
      exampleRows: [],
      insertResult: [{ id: 518, createdAt: new Date(), updatedAt: new Date() }],
      updateQueue: [[{ updatedAt: new Date() }]],
    });
    const generateJsonNoProduct = vi.fn().mockImplementation(timedResolve(0, { body: "본문" }));
    const llmNoProduct = { generateJson: generateJsonNoProduct };
    await createContentWithBody(
      {
        db: dbNoProduct,
        llm: llmNoProduct,
        productBaseUrl: "https://shop.banana-island.co.kr",
        model: "claude-test-model",
      },
      baseBodyInput,
    );
    const [, userNoProduct] = generateJsonNoProduct.mock.calls[0];
    expect(userNoProduct).toContain("브랜드 소식");
  });
});
