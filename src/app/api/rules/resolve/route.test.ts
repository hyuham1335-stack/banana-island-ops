import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-003 「진입점 · GET /api/rules/resolve」
// src/app/api/plans/route.test.ts 패턴 재사용 — resolveRules 를 모킹해 Result.ok/err 각각에서
// 응답 상태·봉투만 확인한다. getDb 는 route.ts 가 deps 생성을 위해 호출하는 값이라 함께
// 모킹한다. 역할 검사는 계약상 없다(인가 없음, ADR-004).

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/services/rules", () => ({
  resolveRules: vi.fn(),
}));

import { resolveRules } from "@/services/rules";
import { GET, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

function reqWith(params: Record<string, string | null>): Request {
  const url = new URL("http://localhost/api/rules/resolve");
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return new Request(url);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rules/resolve", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("channelId·lang·productId 가 모두 있으면 resolveRules 를 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    const data = {
      version: "v1",
      appliedRuleIds: [1],
      persona: "친근한 이웃",
      tone: "",
      format: "",
      must: [],
      ban: [],
    };
    vi.mocked(resolveRules).mockResolvedValue({ ok: true, data });

    const res = await GET(reqWith({ channelId: "10", lang: "ko", productId: "5" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data });
    expect(resolveRules).toHaveBeenCalledTimes(1);
    // getDb() 는 모킹되어 매 호출마다 {} 를 돌려준다 — deps.db 자리에 그 값이 그대로 전달됐는지만 본다.
    expect(resolveRules).toHaveBeenCalledWith({ db: {} }, { channelId: 10, lang: "ko", productId: 5 });
  });

  it("productId 없이도(선택값) 200 을 돌려주고 resolveRules 에는 channelId·lang 만 전달된다", async () => {
    vi.mocked(resolveRules).mockResolvedValue({
      ok: true,
      data: { version: "v0", appliedRuleIds: [], persona: "", tone: "", format: "", must: [], ban: [] },
    });

    const res = await GET(reqWith({ channelId: "10", lang: "ko", productId: null }));

    expect(res.status).toBe(200);
    expect(resolveRules).toHaveBeenCalledWith({ db: {} }, { channelId: 10, lang: "ko" });
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(resolveRules).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });

    const res = await GET(reqWith({ channelId: "999", lang: "ko" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(resolveRules).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });

    const res = await GET(reqWith({ channelId: "10", lang: "ko" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "알 수 없는 오류" } });
  });

  async function expectValidationError(params: Record<string, string | null>) {
    const res = await GET(reqWith(params));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(resolveRules).not.toHaveBeenCalled();
  }

  it("channelId 가 없으면 400 VALIDATION_ERROR 를 돌려주고 resolveRules 를 호출하지 않는다", async () => {
    await expectValidationError({ channelId: null, lang: "ko" });
  });

  it("lang 이 없으면 400 VALIDATION_ERROR 를 돌려주고 resolveRules 를 호출하지 않는다", async () => {
    await expectValidationError({ channelId: "10", lang: null });
  });

  it("lang 이 유효한 값('ko'|'en')이 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ channelId: "10", lang: "fr" });
  });

  it("channelId 가 숫자가 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ channelId: "abc", lang: "ko" });
  });

  it("channelId 가 빈 문자열이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ channelId: "", lang: "ko" });
  });

  it("productId 가 있는데 숫자가 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ channelId: "10", lang: "ko", productId: "xx" });
  });

  it("쿼리 파싱 실패 응답은 details 에 zod 이슈를 담는다", async () => {
    const res = await GET(reqWith({ channelId: "abc", lang: "ko" }));

    const body = await res.json();
    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("lang='en' 경계값도 통과한다", async () => {
    vi.mocked(resolveRules).mockResolvedValue({
      ok: true,
      data: { version: "v0", appliedRuleIds: [], persona: "", tone: "", format: "", must: [], ban: [] },
    });

    const res = await GET(reqWith({ channelId: "10", lang: "en" }));

    expect(res.status).toBe(200);
    expect(resolveRules).toHaveBeenCalledWith(expect.anything(), { channelId: 10, lang: "en" });
  });
});
