import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「진입점 · GET /api/contents/{id}」— 07 code-review
// 수리 라운드(CONTRACT_DEFECT): 이 라우트는 원래 DB 조회(contents·content_history 카운트)와
// resolveContentLink()·toContentDetail() 조립을 라우트 안에서 직접 했으나, 그 로직 전체가
// services/content-workflow.ts::getContentDetail() 로 옮겨져 submit·cancel-review 라우트와
// 같은 얇은 디스패치가 됐다(src/app/api/contents/[id]/submit/route.test.ts 패턴 재사용) —
// getContentDetail() 을 모킹해 id 파싱과 Result → 상태 코드 매핑만 검증한다.

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr" })),
}));

vi.mock("@/services/content-workflow", () => ({
  getContentDetail: vi.fn(),
  deleteContent: vi.fn(),
}));

vi.mock("@/services/content-generation", () => ({
  editContent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "editor" })),
}));

import { getContentDetail, deleteContent } from "@/services/content-workflow";
import { editContent } from "@/services/content-generation";
import { getActor } from "@/lib/auth";
import { GET, PATCH, DELETE, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const CONTENT_DETAIL = {
  id: 501,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  targetPersona: "30대 직장인",
  status: "draft" as const,
  title: "여름철 든든한 간식",
  body: "정상적인 본문입니다.",
  regenCount: 0,
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-501",
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
  updatedAt: "2026-09-15T00:01:00.000Z",
  createdAt: "2026-09-15T00:00:00.000Z",
  isExample: false,
  historyCount: 2,
  autoRegenerated: false,
  channelFormat: null,
};

function reqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}`),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/contents/{id}", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("성공하면 getContentDetail(deps, id) 를 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(getContentDetail).mockResolvedValue({ ok: true, data: CONTENT_DETAIL });

    const { request, ctx } = reqFor("501");
    const res = await GET(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: CONTENT_DETAIL });
    expect(getContentDetail).toHaveBeenCalledTimes(1);
    expect(getContentDetail).toHaveBeenCalledWith(expect.anything(), 501);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 getContentDetail 을 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("abc");
    const res = await GET(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(getContentDetail).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("0");
    const res = await GET(request, ctx);

    expect(res.status).toBe(400);
    expect(getContentDetail).not.toHaveBeenCalled();
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getContentDetail).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = reqFor("999");
    const res = await GET(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getContentDetail).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "콘텐츠 조회 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqFor("501");
    const res = await GET(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "콘텐츠 조회 중 오류가 발생했습니다." },
    });
  });
});

// 계약: FR-008(_workspace/contract_fr-008-direct-edit.md) 「진입점 · PATCH /api/contents/{id}」
// editContent() 를 모킹해 id 파싱·EditContentInputSchema 검증(실물)·Result → 상태 코드 매핑만
// 검증한다 — GET 스위트와 같은 원칙(getContentDetail 을 모킹하는 것과 대칭).

function patchReqFor(id: string, body?: unknown): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  const init: RequestInit = { method: "PATCH" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(`http://localhost/api/contents/${id}`, init),
    ctx: { params: Promise.resolve({ id }) },
  };
}

describe("PATCH /api/contents/{id}", () => {
  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 editContent 를 호출하지 않는다", async () => {
    const { request, ctx } = patchReqFor("abc", { title: "새 제목" });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(editContent).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = patchReqFor("0", { title: "새 제목" });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    expect(editContent).not.toHaveBeenCalled();
  });

  it("요청 바디 자체가 없으면(JSON 파싱 실패) 400 VALIDATION_ERROR 를 돌려준다 — regenerate 와 달리 title·body 중 최소 하나가 필수라 catch(() => null) 로 통일한다", async () => {
    const { request, ctx } = patchReqFor("501");
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(editContent).not.toHaveBeenCalled();
  });

  it("빈 객체({}) 본문은 title·body 둘 다 없어 400 VALIDATION_ERROR 를 돌려준다(refine 거부)", async () => {
    const { request, ctx } = patchReqFor("501", {});
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(editContent).not.toHaveBeenCalled();
  });

  it("title 이 201자면 400 VALIDATION_ERROR 를 돌려주고 editContent 를 호출하지 않는다", async () => {
    const { request, ctx } = patchReqFor("501", { title: "가".repeat(201) });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(editContent).not.toHaveBeenCalled();
  });

  it("성공하면 editContent(deps, id, input) 을 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(editContent).mockResolvedValue({ ok: true, data: CONTENT_DETAIL });

    const { request, ctx } = patchReqFor("501", { title: "새 제목", body: "새 본문" });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: CONTENT_DETAIL });
    expect(editContent).toHaveBeenCalledTimes(1);
    const [, id, input] = vi.mocked(editContent).mock.calls[0];
    expect(id).toBe(501);
    expect(input).toEqual({ title: "새 제목", body: "새 본문" });
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(editContent).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = patchReqFor("999", { title: "새 제목" });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다(published 는 수정 불가)", async () => {
    vi.mocked(editContent).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "발행된 콘텐츠는 수정할 수 없습니다.",
        details: { from: "published" },
      },
    });

    const { request, ctx } = patchReqFor("501", { title: "새 제목" });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "발행된 콘텐츠는 수정할 수 없습니다.",
        details: { from: "published" },
      },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(editContent).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "콘텐츠 수정 중 오류가 발생했습니다." },
    });

    const { request, ctx } = patchReqFor("501", { title: "새 제목" });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "콘텐츠 수정 중 오류가 발생했습니다." },
    });
  });
});

// 계약: DELETE /api/contents/{id} — 콘텐츠 삭제(하드 삭제). deleteContent() 를 모킹해
// id 파싱·getActor 전달·Result → 상태 코드 매핑만 검증한다(위 GET/PATCH 스위트와 같은 원칙).

function deleteReqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}`, { method: "DELETE" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

describe("DELETE /api/contents/{id}", () => {
  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 deleteContent 를 호출하지 않는다", async () => {
    const { request, ctx } = deleteReqFor("abc");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(deleteContent).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = deleteReqFor("0");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(400);
    expect(deleteContent).not.toHaveBeenCalled();
  });

  it("성공하면 deleteContent(deps, id, actor) 를 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(deleteContent).mockResolvedValue({ ok: true, data: { id: 501 } });

    const { request, ctx } = deleteReqFor("501");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: { id: 501 } });
    expect(deleteContent).toHaveBeenCalledTimes(1);
    expect(deleteContent).toHaveBeenCalledWith(expect.anything(), 501, { role: "admin" });
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(deleteContent).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = deleteReqFor("999");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(FORBIDDEN_ROLE) 면 403 + { error } 봉투를 돌려준다(승인된 콘텐츠를 editor 가 삭제 시도)", async () => {
    vi.mocked(deleteContent).mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN_ROLE", message: "승인된 콘텐츠는 대표만 삭제할 수 있습니다.", details: { required: "admin" } },
    });

    const { request, ctx } = deleteReqFor("501");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN_ROLE", message: "승인된 콘텐츠는 대표만 삭제할 수 있습니다.", details: { required: "admin" } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다(발행 완료된 콘텐츠)", async () => {
    vi.mocked(deleteContent).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "발행 완료된 콘텐츠는 삭제할 수 없습니다.",
        details: { from: "published", action: "delete" },
      },
    });

    const { request, ctx } = deleteReqFor("501");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "발행 완료된 콘텐츠는 삭제할 수 없습니다.",
        details: { from: "published", action: "delete" },
      },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(deleteContent).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "콘텐츠 삭제 중 오류가 발생했습니다." },
    });

    const { request, ctx } = deleteReqFor("501");
    const res = await DELETE(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "콘텐츠 삭제 중 오류가 발생했습니다." },
    });
  });
});
