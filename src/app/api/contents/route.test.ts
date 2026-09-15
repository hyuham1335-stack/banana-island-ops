import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-005(_workspace/contract_fr-005-body-generation.md) 「진입점 · POST /api/contents」
// src/app/api/contents/titles/route.test.ts 패턴 그대로 재사용 — createContentWithBody 를
// 모킹해 Result.ok/err 각각에서 응답 상태·봉투만 확인한다. getEnv·getDb·createAnthropicClient
// 는 route.ts 가 deps 생성을 위해 호출하는 값이라 함께 모킹한다. 역할 검사는 계약상 없다
// (누구나, API_SPEC.md).

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
  createContentWithBody: vi.fn(),
}));

import { createContentWithBody, type ContentDetail } from "@/services/content-generation";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const validBody = {
  publishPlanId: null,
  productId: null,
  channelId: 10,
  lang: "ko",
  postType: "health_info",
  topicMemo: "여름 다이어트 간식",
  targetPersona: "30대 직장인",
  title: "여름철 든든한 간식",
  angle: "다이어트 중에도 부담 없이",
  titleCandidates: [
    { title: "여름철 든든한 간식", angle: "다이어트 중에도 부담 없이" },
    { title: "제목2", angle: "앵글2" },
    { title: "제목3", angle: "앵글3" },
  ],
};

const validContentDetail: ContentDetail = {
  id: 501,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  lang: "ko",
  postType: "health_info",
  targetPersona: "30대 직장인",
  status: "draft",
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
  historyCount: 0,
  autoRegenerated: false,
};

function reqWith(body: unknown): Request {
  return new Request("http://localhost/api/contents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contents", () => {
  it("maxDuration 이 60초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(60);
  });

  it("정상 body 면 createContentWithBody 를 호출하고 Result.ok 를 201 + { data } 로 돌려준다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({ ok: true, data: validContentDetail });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: validContentDetail });
    expect(createContentWithBody).toHaveBeenCalledTimes(1);
    // deps 자리에 getDb()·createAnthropicClient()·productBaseUrl·model 이, 두 번째 인자에
    // 파싱된 body 가 그대로 전달됐는지만 본다(내부 구현 세부는 서비스 단위테스트가 본다).
    expect(createContentWithBody).toHaveBeenCalledWith(expect.anything(), validBody);
  });

  it("productId·publishPlanId 를 숫자로 채워 보내도 정상 처리된다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({ ok: true, data: validContentDetail });

    const body = { ...validBody, productId: 5, publishPlanId: 900 };
    const res = await POST(reqWith(body));

    expect(res.status).toBe(201);
    expect(createContentWithBody).toHaveBeenCalledWith(expect.anything(), body);
  });

  it("Result.err(NOT_FOUND) 면 404 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });

    const res = await POST(reqWith({ ...validBody, channelId: 999 }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "채널을 찾을 수 없습니다.", details: { resource: "channel", id: 999 } },
    });
  });

  it("Result.err(INVALID_TRANSITION) 면 409 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "이미 이 계획에 연결된 콘텐츠가 있습니다.",
        details: { from: "plan_already_linked", action: "create" },
      },
    });

    const res = await POST(reqWith({ ...validBody, publishPlanId: 900 }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_TRANSITION",
        message: "이미 이 계획에 연결된 콘텐츠가 있습니다.",
        details: { from: "plan_already_linked", action: "create" },
      },
    });
  });

  it("Result.err(LLM_FAILED) 면 502 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({
      ok: false,
      error: { code: "LLM_FAILED", message: "본문 생성에 실패했습니다.", details: { contentId: 501, attempt: 1 } },
    });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "LLM_FAILED", message: "본문 생성에 실패했습니다.", details: { contentId: 501, attempt: 1 } },
    });
  });

  it("Result.err(LLM_TIMEOUT) 면 504 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({
      ok: false,
      error: { code: "LLM_TIMEOUT", message: "본문 생성이 시간 초과되었습니다.", details: { contentId: 501 } },
    });

    const res = await POST(reqWith(validBody));

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      error: { code: "LLM_TIMEOUT", message: "본문 생성이 시간 초과되었습니다.", details: { contentId: 501 } },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(createContentWithBody).mockResolvedValue({
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
    expect(createContentWithBody).not.toHaveBeenCalled();
  }

  it("channelId 가 없으면 400 VALIDATION_ERROR 를 돌려주고 createContentWithBody 를 호출하지 않는다", async () => {
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

  it("publishPlanId 가 숫자도 null 도 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ ...validBody, publishPlanId: "not-a-number" });
  });

  it("topicMemo 가 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { topicMemo: _topicMemo, ...rest } = validBody;
    await expectValidationError(rest);
  });

  it("targetPersona 가 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { targetPersona: _targetPersona, ...rest } = validBody;
    await expectValidationError(rest);
  });

  it("title 이 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { title: _title, ...rest } = validBody;
    await expectValidationError(rest);
  });

  it("angle 이 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { angle: _angle, ...rest } = validBody;
    await expectValidationError(rest);
  });

  it("titleCandidates 가 3개가 아니면(예: 2개) 400 VALIDATION_ERROR 를 돌려준다", async () => {
    await expectValidationError({ ...validBody, titleCandidates: validBody.titleCandidates.slice(0, 2) });
  });

  it("titleCandidates 가 아예 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { titleCandidates: _titleCandidates, ...rest } = validBody;
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
