import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-014(_workspace/contract_fr-014-new-version.md) 「진입점 ·
// POST /api/contents/{id}/new-version」— publish/route.test.ts·regenerate/route.test.ts 패턴
// 재사용. createNewVersion() 을 모킹해 Result.ok/err 각각에서 응답 상태·봉투만 확인한다.
// 이 라우트는 요청 본문을 파싱하지 않고(API_SPEC 에 요청 스키마 없음) getActor 도 호출하지
// 않는다(인가 없음 — "나머지는 두 역할 모두").

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr" })),
}));

vi.mock("@/services/content-workflow", () => ({
  createNewVersion: vi.fn(),
}));

import { createNewVersion } from "@/services/content-workflow";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const NEW_VERSION_RESULT = {
  id: 2,
  publishPlanId: 77,
  sourceContentId: 1,
  productId: null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  targetPersona: "30대 직장인",
  status: "draft" as const,
  title: "제목 (v2)",
  body: "원본 본문입니다.",
  regenCount: 0,
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-2",
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
  updatedAt: "2026-09-17T00:10:00.000Z",
  createdAt: "2026-09-17T00:10:00.000Z",
  isExample: false,
  historyCount: 0,
  autoRegenerated: false,
  channelFormat: null,
};

function reqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/new-version`, { method: "POST" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/{id}/new-version", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 createNewVersion 을 호출하지 않는다", async () => {
    const { request, ctx } = reqFor("abc");
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createNewVersion).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("0");
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(createNewVersion).not.toHaveBeenCalled();
  });

  it("서비스 성공 — createNewVersion(deps, id) 을 호출하고 Result.ok 를 201 + { data } 로 돌려주며, data.sourceContentId 가 요청한 id 와 같다", async () => {
    vi.mocked(createNewVersion).mockResolvedValue({ ok: true, data: NEW_VERSION_RESULT });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: NEW_VERSION_RESULT });
    expect(NEW_VERSION_RESULT.sourceContentId).toBe(1); // 요청한 id 와 일치(픽스처 자체 검증)
    expect(createNewVersion).toHaveBeenCalledTimes(1);
    expect(createNewVersion).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createNewVersion).mockResolvedValue({
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

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다 — published 가 아닌 콘텐츠에 시도한 경우", async () => {
    vi.mocked(createNewVersion).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "new_version" },
      },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "new_version" },
      },
    });
  });

  it("Result.err(resolveRules 전파 — 예: 채널 NOT_FOUND) 면 404 + { error } 봉투를 그대로 돌려준다(새 코드로 재매핑하지 않는다)", async () => {
    vi.mocked(createNewVersion).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createNewVersion).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "콘텐츠 조회 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "콘텐츠 조회 중 오류가 발생했습니다." },
    });
  });
});
