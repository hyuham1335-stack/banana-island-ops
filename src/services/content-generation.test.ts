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
import { LlmTitleCandidatesSchema, LlmTitleItemSchema } from "@/lib/schemas";
import type { BrandRuleRow } from "@/lib/rules-merge";
import { resolveRules } from "@/services/rules";
import { generateTitles } from "./content-generation";

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — src/services/rules.test.ts 와 동일한 패턴(그 파일을 export 하지 않으므로
// 이 파일에서 다시 선언한다).
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
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.salesChannels) return makeChainNode(opts.channelRows);
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
});
