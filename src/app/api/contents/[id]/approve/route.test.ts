import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-010·FR-011(런 20260915-2042-728c) 「진입점 · POST /api/contents/{id}/approve」
// submit/route.test.ts 패턴 재사용 — approveContent() 를 모킹해 Result.ok/err 각각에서
// 응답 상태·봉투만 확인한다. getDb·getEnv·getActor 는 route.ts 가 deps 를 만들기 위해
// 호출하는 값이라 함께 모킹한다.

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr" })),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "admin" })),
}));

vi.mock("@/services/content-workflow", () => ({
  approveContent: vi.fn(),
}));

import { approveContent } from "@/services/content-workflow";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const APPROVE_RESULT = {
  id: 1,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  targetPersona: "30대 직장인",
  status: "approved" as const,
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
  reviewerId: 42,
  publisherId: null,
  submittedAt: "2026-09-10T00:00:00.000Z",
  reviewedAt: "2026-09-15T01:00:00.000Z",
  publishedAt: null,
  updatedAt: "2026-09-15T01:00:00.000Z",
  createdAt: "2026-09-14T00:00:00.000Z",
  isExample: false,
  historyCount: 1,
  autoRegenerated: false,
  exampleRegistered: false,
  exampleSkippedReason: null,
};

function reqFor(id: string, body: unknown): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/{id}/approve", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 approveContent 를 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("abc", { registerAsExample: false });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(approveContent).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("0", { registerAsExample: false });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(approveContent).not.toHaveBeenCalled();
  });

  it("바디 파싱 실패(registerAsExample 누락) → 400 VALIDATION_ERROR, approveContent 미호출", async () => {
    const { request, ctx } = reqFor("1", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(approveContent).not.toHaveBeenCalled();
  });

  it("바디의 registerAsExample 이 문자열 타입이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("1", { registerAsExample: "true" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(approveContent).not.toHaveBeenCalled();
  });

  it("성공하면 approveContent(deps, id, actor, registerAsExample) 을 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(approveContent).mockResolvedValue({ ok: true, data: APPROVE_RESULT });

    const { request, ctx } = reqFor("1", { registerAsExample: true });
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: APPROVE_RESULT });
    expect(approveContent).toHaveBeenCalledTimes(1);
    expect(approveContent).toHaveBeenCalledWith(expect.anything(), 1, { role: "admin" }, true);
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(approveContent).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = reqFor("999", { registerAsExample: false });
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(FORBIDDEN_ROLE) 면 403 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(approveContent).mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN_ROLE", message: "이 작업을 수행할 권한이 없습니다.", details: { required: "admin" } },
    });

    const { request, ctx } = reqFor("1", { registerAsExample: false });
    const res = await POST(request, ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN_ROLE", message: "이 작업을 수행할 권한이 없습니다.", details: { required: "admin" } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(approveContent).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "approve" },
      },
    });

    const { request, ctx } = reqFor("1", { registerAsExample: false });
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "approve" },
      },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(approveContent).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqFor("1", { registerAsExample: false });
    const res = await POST(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });
  });
});
