import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-010·FR-011(런 20260915-2042-728c) 「진입점 · POST /api/contents/{id}/reject」
// submit/route.test.ts 패턴 재사용 — transition() 을 모킹해 Result.ok/err 각각에서 응답
// 상태·봉투만 확인한다. reject 는 approve 와 달리 별도 서비스 함수 없이 transition(deps, id,
// "reject", actor, { reason }) 을 라우트에서 직접 호출한다(계약 「진입점」).

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
  transition: vi.fn(),
}));

import { transition } from "@/services/content-workflow";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const REJECT_RESULT = {
  id: 1,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  targetPersona: "30대 직장인",
  status: "rejected" as const,
  title: "제목",
  body: "본문",
  regenCount: 0,
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-1",
  validation: { blocks: [], warns: [], missing: [] },
  ruleSnapshot: { ruleIds: [], version: "v0", exampleIds: [] },
  sentPrompt: "===SYSTEM===\n...\n\n===USER===\n...",
  model: "claude-test-model",
  rejectReason: "표현 수정 필요",
  publishedUrl: null,
  urlCheck: null,
  authorId: null,
  reviewerId: 7,
  publisherId: null,
  submittedAt: "2026-09-11T00:00:00.000Z",
  reviewedAt: "2026-09-15T02:00:00.000Z",
  publishedAt: null,
  updatedAt: "2026-09-15T02:00:00.000Z",
  createdAt: "2026-09-14T00:00:00.000Z",
  isExample: false,
  historyCount: 1,
  autoRegenerated: false,
};

function reqFor(id: string, body: unknown): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/reject`, {
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

describe("POST /api/contents/{id}/reject", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 transition 을 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("abc", { reason: "사유" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(transition).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("0", { reason: "사유" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it("reason 이 없으면 400 VALIDATION_ERROR 를 돌려주고 transition 을 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("1", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(transition).not.toHaveBeenCalled();
  });

  it("reason 이 공백만이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("1", { reason: "   " });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it("reason 이 1001자면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("1", { reason: "가".repeat(1001) });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it("성공하면 transition(deps, id, 'reject', actor, { reason }) 을 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({ ok: true, data: REJECT_RESULT });

    const { request, ctx } = reqFor("1", { reason: "표현 수정 필요" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: REJECT_RESULT });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "reject",
      { role: "admin" },
      { reason: "표현 수정 필요" },
    );
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = reqFor("999", { reason: "사유" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(FORBIDDEN_ROLE) 면 403 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN_ROLE", message: "이 작업을 수행할 권한이 없습니다.", details: { required: "admin" } },
    });

    const { request, ctx } = reqFor("1", { reason: "사유" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN_ROLE", message: "이 작업을 수행할 권한이 없습니다.", details: { required: "admin" } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "reject" },
      },
    });

    const { request, ctx } = reqFor("1", { reason: "사유" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "reject" },
      },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqFor("1", { reason: "사유" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });
  });
});
