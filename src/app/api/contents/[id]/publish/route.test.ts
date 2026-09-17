import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-013(_workspace/contract_fr-013-publish.md) 「진입점 · POST /api/contents/{id}/publish」
// submit/route.test.ts·reject/route.test.ts 패턴 재사용 — transition() 을 모킹해 Result.ok/err
// 각각에서 응답 상태·봉투만 확인한다. publish 는 별도 서비스 함수 없이 transition(deps, id,
// "publish", actor, { publishedUrl }) 을 라우트에서 직접 호출한다(submit·reject 와 같은 얇은
// 라우트 형태).
//
// 계약이 명시한 차이점: 요청 본문 파싱이 `request.json().catch(() => ({}))` 다(다른 라우트의
// `.catch(() => null)` 과 다르다) — publishedUrl 이 선택값이라 본문 자체가 없어도 유효해야
// 한다. 인가 없음(누구나) — getActor 모킹 역할은 임의로 "editor" 를 쓴다.

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

const PUBLISH_RESULT = {
  id: 1,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko" as const,
  postType: "health_info" as const,
  targetPersona: "30대 직장인",
  status: "published" as const,
  title: "제목",
  body: "본문",
  regenCount: 0,
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-1",
  validation: { blocks: [], warns: [], missing: [] },
  ruleSnapshot: { ruleIds: [], version: "v0", exampleIds: [] },
  sentPrompt: "===SYSTEM===\n...\n\n===USER===\n...",
  model: "claude-test-model",
  rejectReason: null,
  publishedUrl: "https://blog.naver.com/post/1",
  urlCheck: "ok" as const,
  authorId: null,
  reviewerId: 42,
  publisherId: 5,
  submittedAt: "2026-09-10T00:00:00.000Z",
  reviewedAt: "2026-09-15T01:00:00.000Z",
  publishedAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  createdAt: "2026-09-14T00:00:00.000Z",
  isExample: false,
  historyCount: 1,
  autoRegenerated: false,
  channelFormat: null,
};

function reqWithBody(id: string, body: unknown): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

// 본문 자체가 없는 요청 — request.json() 이 던지고 .catch(() => ({})) 가 받는 경로를 재현한다.
function reqWithoutBody(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}/publish`, { method: "POST" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents/{id}/publish", () => {
  it("maxDuration 이 15초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(15);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 transition 을 호출하지 않는다", async () => {
    const { request, ctx } = reqWithBody("abc", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(transition).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqWithBody("0", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

  it("publishedUrl 이 URL 형태가 아니면 400 VALIDATION_ERROR 를 돌려주고 transition 을 호출하지 않는다", async () => {
    const { request, ctx } = reqWithBody("1", { publishedUrl: "이것은-url이-아니다" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(transition).not.toHaveBeenCalled();
  });

  it("본문 없이 POST 해도(요청 본문 자체가 없어도) 200 으로 성공한다 — request.json().catch(() => ({})) 경로", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: true,
      data: { ...PUBLISH_RESULT, publishedUrl: null, urlCheck: "skipped" },
    });

    const { request, ctx } = reqWithoutBody("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "publish",
      { role: "editor" },
      { publishedUrl: undefined },
    );
  });

  it("빈 객체 본문({})으로 POST 하면 200 으로 성공한다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: true,
      data: { ...PUBLISH_RESULT, publishedUrl: null, urlCheck: "skipped" },
    });

    const { request, ctx } = reqWithBody("1", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(transition).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "publish",
      { role: "editor" },
      { publishedUrl: undefined },
    );
  });

  it("정상 성공 — publishedUrl 이 유효한 URL 이면 transition(deps, id, 'publish', actor, { publishedUrl }) 을 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({ ok: true, data: PUBLISH_RESULT });

    const { request, ctx } = reqWithBody("1", { publishedUrl: "https://blog.naver.com/post/1" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: PUBLISH_RESULT });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "publish",
      { role: "editor" },
      { publishedUrl: "https://blog.naver.com/post/1" },
    );
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });

    const { request, ctx } = reqWithBody("999", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "콘텐츠를 찾을 수 없습니다.", details: { resource: "content", id: 999 } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다 — approved 가 아닌 콘텐츠에 시도한 경우", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "publish" },
      },
    });

    const { request, ctx } = reqWithBody("1", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "현재 상태에서 허용되지 않는 전이입니다.",
        details: { from: "draft", action: "publish" },
      },
    });
  });

  it("Result.err(URL_UNREACHABLE) 면 422 + { error } 봉투를 돌려준다 — URL 이 실제로 확인되지 않으면 발행완료로 전이되지 않는다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: {
        code: "URL_UNREACHABLE",
        message: "URL을 확인할 수 없어 발행을 완료하지 못했습니다.",
        details: { publishedUrl: "https://blog.naver.com/post/dead" },
      },
    });

    const { request, ctx } = reqWithBody("1", { publishedUrl: "https://blog.naver.com/post/dead" });
    const res = await POST(request, ctx);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: "URL_UNREACHABLE",
        message: "URL을 확인할 수 없어 발행을 완료하지 못했습니다.",
        details: { publishedUrl: "https://blog.naver.com/post/dead" },
      },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(transition).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });

    const { request, ctx } = reqWithBody("1", {});
    const res = await POST(request, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." },
    });
  });
});
