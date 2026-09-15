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
}));

import { getContentDetail } from "@/services/content-workflow";
import { GET, maxDuration } from "./route";

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
