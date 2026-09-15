import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「진입점 · POST /api/contents/{id}/cancel-review」
// submit/route.test.ts 와 같은 패턴 — transition() 을 모킹한다. 이 라우트는 editor 만
// 허용하고 그 판정은 transition() 내부(FORBIDDEN_ROLE)에서 이뤄지므로, 여기서는
// getActor 의 반환값에 따라 route 가 transition 에 그 actor 를 정확히 전달하는지와,
// transition 이 FORBIDDEN_ROLE 을 돌려줬을 때 403 으로 매핑되는지만 본다.

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr" })),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(),
}));

vi.mock("@/services/content-workflow", () => ({
  transition: vi.fn(),
}));

import { getActor } from "@/lib/auth";
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
  status: "draft" as const,
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
  submittedAt: null,
  reviewedAt: null,
  publishedAt: null,
  updatedAt: "2026-09-15T00:05:00.000Z",
  createdAt: "2026-09-15T00:00:00.000Z",
  isExample: false,
  historyCount: 1,
  autoRegenerated: false,
};

function reqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/cancel-review`, { method: "POST" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/{id}/cancel-review", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("role=editor 면 성공(200) — transition(deps, id, 'cancel_review', {role:'editor'}) 을 호출한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
    vi.mocked(transition).mockResolvedValue({ ok: true, data: CONTENT_DETAIL });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: CONTENT_DETAIL });
    expect(transition).toHaveBeenCalledWith(expect.anything(), 1, "cancel_review", { role: "editor" });
  });

  it("role=admin 이면 transition 이 FORBIDDEN_ROLE 을 돌려주고 라우트는 403 으로 매핑한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN_ROLE", message: "이 작업을 수행할 권한이 없습니다.", details: { required: "editor" } },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN_ROLE", message: "이 작업을 수행할 권한이 없습니다.", details: { required: "editor" } },
    });
    expect(transition).toHaveBeenCalledWith(expect.anything(), 1, "cancel_review", { role: "admin" });
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 transition 을 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const { request, ctx } = reqFor("abc");
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(transition).not.toHaveBeenCalled();
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
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
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "cancel_review" },
      },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "cancel_review" },
      },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
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
