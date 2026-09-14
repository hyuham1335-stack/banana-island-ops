import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-004(런 20260914-2058-0053) 「진입점 · POST /api/contents/titles」
// src/app/api/plans/sync/route.test.ts · src/app/api/rules/resolve/route.test.ts 패턴 재사용 —
// generateTitles 를 모킹해 Result.ok/err 각각에서 응답 상태·봉투만 확인한다. getEnv·getDb·
// createAnthropicClient 는 route.ts 가 deps 생성을 위해 호출하는 값이라 함께 모킹한다.
// 역할 검사는 계약상 없다(누구나, ADR-004).

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({})),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/llm/client", () => ({
  createAnthropicClient: vi.fn(() => ({ generateJson: vi.fn() })),
}));

vi.mock("@/services/content-generation", () => ({
  generateTitles: vi.fn(),
}));

import { generateTitles } from "@/services/content-generation";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const validBody = {
  productId: null,
  channelId: 10,
  lang: "ko",
  postType: "health_info",
  topicMemo: "여름 다이어트 간식",
  targetPersona: "30대 직장인",
};

const validCandidates = {
  items: [
    { title: "제목1", angle: "앵글1" },
    { title: "제목2", angle: "앵글2" },
    { title: "제목3", angle: "앵글3" },
  ],
  regeneratedIdx: [],
};

function reqWith(body: unknown): Request {
  return new Request("http://localhost/api/contents/titles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/titles", () => {
  it("maxDuration 이 30초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(30);
  });

  it("정상 body 면 generateTitles 를 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(generateTitles).mockResolvedValue({ ok: true, data: validCandidates });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: validCandidates });
    expect(generateTitles).toHaveBeenCalledTimes(1);
    // getDb()·createAnthropicClient() 는 모킹되어 각각 고정값을 돌려준다 — deps 자리에
    // 그 값이 그대로 전달됐는지, 그리고 파싱된 body 가 두 번째 인자로 전달됐는지만 본다.
    expect(generateTitles).toHaveBeenCalledWith(expect.anything(), validBody);
  });

  it("productId 를 생략해도(선택값 null) 정상 처리된다", async () => {
    vi.mocked(generateTitles).mockResolvedValue({ ok: true, data: validCandidates });

    const res = await POST(reqWith({ ...validBody, productId: 5 }));

    expect(res.status).toBe(200);
    expect(generateTitles).toHaveBeenCalledWith(expect.anything(), { ...validBody, productId: 5 });
  });

  it("Result.err(LLM_FAILED) 면 502 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(generateTitles).mockResolvedValue({
      ok: false,
      error: { code: "LLM_FAILED", message: "LLM 호출에 실패했습니다." },
    });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "LLM_FAILED", message: "LLM 호출에 실패했습니다." },
    });
  });

  it("Result.err(LLM_TIMEOUT) 면 504 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(generateTitles).mockResolvedValue({
      ok: false,
      error: { code: "LLM_TIMEOUT", message: "LLM 응답이 시간 안에 오지 않았습니다." },
    });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: { code: "LLM_TIMEOUT", message: "LLM 응답이 시간 안에 오지 않았습니다." },
    });
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다 (resolveRules 전파)", async () => {
    vi.mocked(generateTitles).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });

    const res = await POST(reqWith({ ...validBody, channelId: 999 }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(generateTitles).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "알 수 없는 오류" } });
  });

  async function expectValidationError(body: unknown) {
    const res = await POST(reqWith(body));

    expect(res.status).toBe(400);
    const responseBody = await res.json();
    expect(responseBody.error.code).toBe("VALIDATION_ERROR");
    expect(generateTitles).not.toHaveBeenCalled();
  }

  it("channelId 가 없으면 400 VALIDATION_ERROR 를 돌려주고 generateTitles 를 호출하지 않는다", async () => {
    const { channelId: _channelId, ...rest } = validBody;
    await expectValidationError(rest);
  });

  it("lang 이 유효한 값('ko'|'en')이 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ ...validBody, lang: "fr" });
  });

  it("postType 이 닫힌 집합 밖 값이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ ...validBody, postType: "unknown_type" });
  });

  it("productId 가 숫자도 null 도 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ ...validBody, productId: "not-a-number" });
  });

  it("topicMemo 가 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { topicMemo: _topicMemo, ...rest } = validBody;
    await expectValidationError(rest);
  });

  it("channelId 가 숫자가 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ ...validBody, channelId: "abc" });
  });

  it("검증 실패 응답은 details 에 zod 이슈를 담는다", async () => {
    const res = await POST(reqWith({ ...validBody, lang: "fr" }));

    const body = await res.json();
    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });
});
