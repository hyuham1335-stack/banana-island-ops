import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「진입점 · POST /api/contents/{id}/submit」
// src/app/api/rules/resolve/route.test.ts 패턴 재사용 — transition() 을 모킹해 Result.ok/err
// 각각에서 응답 상태·봉투만 확인한다. getDb·getEnv·getActor 는 route.ts 가 deps 를 만들기
// 위해 호출하는 값이라 함께 모킹한다. submit 은 역할 무관(누구나, API_SPEC.md) 이므로
// getActor 의 반환값 자체를 분기 검증할 필요는 없다 — deps 전달 배선만 본다.

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr" })),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "editor" })),
}));

vi.mock("@/services/content-workflow", () => ({
  transition: vi.fn(),
}));

import { transition } from "@/services/content-workflow";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const CONTENT_DETAIL = {
  id: 1,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  targetPersona: "30대 직장인",
  status: "in_review" as const,
  title: "제목",
  body: "본문",
  regenCount: 0,
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-1",
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
  submittedAt: "2026-09-15T00:05:00.000Z",
  reviewedAt: null,
  publishedAt: null,
  updatedAt: "2026-09-15T00:05:00.000Z",
  createdAt: "2026-09-15T00:00:00.000Z",
  isExample: false,
  historyCount: 1,
  autoRegenerated: false,
  channelFormat: null,
};

function reqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/submit`, { method: "POST" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/{id}/submit", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("성공하면 transition(deps, id, 'submit', actor) 을 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({ ok: true, data: CONTENT_DETAIL });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: CONTENT_DETAIL });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(expect.anything(), 1, "submit", { role: "editor" });
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 transition 을 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("abc");
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(transition).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("-1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = reqFor("999");
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "in_review", action: "submit" },
      },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "in_review", action: "submit" },
      },
    });
  });

  it("Result.err(BLOCKED_TERMS_REMAIN) 면 422 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: {
        code: "BLOCKED_TERMS_REMAIN",
        message: "차단된 표현이 남아 있어 검수 요청을 보낼 수 없습니다.",
        details: { blocks: [{ ruleId: 1, label: "질병 치료·예방 표현", matched: "완치", index: 0, severity: "block", alternative: null, reason: null }] },
      },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("BLOCKED_TERMS_REMAIN");
    expect(body.error.details.blocks).toHaveLength(1);
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });
  });
});
