import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-007(run 20260916-1614-ad59) 「진입점 · POST /api/contents/{id}/regenerate」
// src/app/api/contents/route.test.ts(POST 부분)·src/app/api/contents/[id]/reject/route.test.ts
// 패턴을 함께 재사용한다 — regenerateContentBody() 를 모킹해 Result.ok/err 각각에서
// 응답 상태·봉투만 확인한다. getEnv·getDb·createAnthropicClient 는 route.ts 가 deps 생성을
// 위해 호출하는 값이라 함께 모킹한다. 인가 없음(누구나) — getActor/역할 모킹 불필요
// (계약 「인가」: "역할 검사 테스트는 필요 없다").

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr", LLM_MODEL: "claude-test-model" })),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/llm/client", () => ({
  createAnthropicClient: vi.fn(() => ({ generateJson: vi.fn() })),
}));

vi.mock("@/services/content-generation", () => ({
  regenerateContentBody: vi.fn(),
}));

import { regenerateContentBody, type ContentDetail } from "@/services/content-generation";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const REGEN_RESULT: ContentDetail = {
  id: 601,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko",
  postType: "health_info",
  targetPersona: "30대 직장인",
  status: "draft",
  title: "여름철 든든한 간식",
  body: "다시 쓴 새 본문입니다.",
  regenCount: 1,
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-601",
  validation: { blocks: [], warns: [], missing: [] },
  ruleSnapshot: { ruleIds: [], version: "v0", exampleIds: [] },
  sentPrompt: "===SYSTEM===\n...\n\n===USER===\n...",
  model: "claude-test-model",
  rejectReason: null,
  publishedUrl: null,
  urlCheck: null,
  authorId: null,
  reviewerId: null,
  publisherId: null,
  submittedAt: null,
  reviewedAt: null,
  publishedAt: null,
  updatedAt: "2026-09-16T00:00:00.000Z",
  createdAt: "2026-09-15T00:00:00.000Z",
  isExample: false,
  historyCount: 1,
  autoRegenerated: false,
  channelFormat: null,
};

function reqFor(id: string, body?: unknown): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(`http://localhost/api/contents/${id}/regenerate`, init),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/{id}/regenerate", () => {
  it("maxDuration 이 60초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(60);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 regenerateContentBody 를 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("abc", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const resBody = await res.json();
    expect(resBody.error.code).toBe("VALIDATION_ERROR");
    expect(regenerateContentBody).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("0", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(regenerateContentBody).not.toHaveBeenCalled();
  });

  it("instruction 이 501자면 400 VALIDATION_ERROR 를 돌려주고 regenerateContentBody 를 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("601", { instruction: "가".repeat(501) });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const resBody = await res.json();
    expect(resBody.error.code).toBe("VALIDATION_ERROR");
    expect(regenerateContentBody).not.toHaveBeenCalled();
  });

  it("instruction 이 정확히 500자면 통과한다(경계값) — 400 이 아니다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({ ok: true, data: REGEN_RESULT });
    const { request, ctx } = reqFor("601", { instruction: "가".repeat(500) });
    const res = await POST(request, ctx);

    expect(res.status).not.toBe(400);
    expect(regenerateContentBody).toHaveBeenCalledTimes(1);
  });

  it("본문 없이(요청 바디 자체가 없이) POST 해도 성공한다(instruction 은 선택값)", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({ ok: true, data: REGEN_RESULT });
    const { request, ctx } = reqFor("601");
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(regenerateContentBody).toHaveBeenCalledTimes(1);
    const [, , input] = vi.mocked(regenerateContentBody).mock.calls[0];
    expect(input).toEqual({});
  });

  it("빈 객체({}) 본문으로 POST 해도 성공한다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({ ok: true, data: REGEN_RESULT });
    const { request, ctx } = reqFor("601", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(regenerateContentBody).toHaveBeenCalledTimes(1);
  });

  it("성공하면 regenerateContentBody(deps, id, input) 을 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({ ok: true, data: REGEN_RESULT });

    const { request, ctx } = reqFor("601", { instruction: "더 발랄한 톤으로" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: REGEN_RESULT });
    expect(regenerateContentBody).toHaveBeenCalledTimes(1);
    const [, id, input] = vi.mocked(regenerateContentBody).mock.calls[0];
    expect(id).toBe(601);
    expect(input).toEqual({ instruction: "더 발랄한 톤으로" });
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = reqFor("999", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다(허용 안 된 상태)", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "in_review", action: "regenerate" },
      },
    });

    const { request, ctx } = reqFor("601", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "in_review", action: "regenerate" },
      },
    });
  });

  it("Result.err(LLM_FAILED) 면 502 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({
      ok: false,
      error: { code: "LLM_FAILED", message: "본문 재생성에 실패했습니다." },
    });

    const { request, ctx } = reqFor("601", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "LLM_FAILED", message: "본문 재생성에 실패했습니다." },
    });
  });

  it("Result.err(LLM_TIMEOUT) 면 504 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({
      ok: false,
      error: { code: "LLM_TIMEOUT", message: "본문 재생성이 시간 초과되었습니다." },
    });

    const { request, ctx } = reqFor("601", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: { code: "LLM_TIMEOUT", message: "본문 재생성이 시간 초과되었습니다." },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(regenerateContentBody).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "본문 재생성 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqFor("601", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "본문 재생성 중 오류가 발생했습니다." },
    });
  });
});
