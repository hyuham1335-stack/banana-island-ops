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

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(),
}));

vi.mock("@/services/content-workflow", () => ({
  listContents: vi.fn(),
}));

import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { createContentWithBody, type ContentDetail } from "@/services/content-generation";
import { listContents } from "@/services/content-workflow";
import { GET, POST, maxDuration } from "./route";

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

// =============================================================================
// 계약: FR-009(런 20260915-1754-5568) 「진입점 · GET /api/contents?status=&mine=true」
//
// CONTRACT_DEFECT 수리(05 arch 리뷰) 이후 이 라우트(src/app/api/contents/route.ts 를 직접
// 읽어 확인)는 더 이상 DB 조회를 직접 하지 않는다 — 쿼리를 파싱해 services/content-workflow.ts
// 의 listContents() 에 위임만 하는 얇은 디스패치다(submit/cancel-review 라우트가
// transition() 을 호출하는 것과 같은 패턴). 그래서 여기서는 listContents 를 모킹해
// 라우트의 배선만 검증한다:
//   - 파싱된 status·mine(boolean 화된 값)과 getActor(request) 의 결과를 listContents 에
//     그대로 넘기는가.
//   - listContents 의 반환값을 그대로 200 + { data } 로 응답하는가(빈 배열 포함 — 결과
//     없음도 200).
//   - 쿼리가 잘못되면 400 VALIDATION_ERROR 를 돌려주고 listContents 를 호출하지 않는가.
//   - listContents 가 던지면(예상 밖 DB 오류) 라우트의 try/catch 가 500 INTERNAL 로
//     매핑하는가.
// 서비스 내부의 조회·조인·매핑 로직 자체는 content-workflow.test.ts 가 검증한다.
// =============================================================================

function reqGet(query: Record<string, string | null> = {}): Request {
  const url = new URL("http://localhost/api/contents");
  for (const [key, value] of Object.entries(query)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return new Request(url);
}

const SUMMARY_ROW = {
  id: 1,
  title: "제목1",
  status: "draft" as const,
  channelId: 10,
  lang: "ko" as const,
  publishPlanId: null,
  scheduledDate: null,
  authorId: null,
  authorName: null,
  warnCount: 0,
  updatedAt: "2026-09-15T00:00:00.000Z",
  submittedAt: null,
};

const DB_SENTINEL = { marker: "db-sentinel" } as unknown as ReturnType<typeof getDb>;

describe("GET /api/contents", () => {
  it("status·mine 없이 호출하면 listContents 를 { status: undefined, mine: false } 로, actor 를 getActor(request) 결과 그대로 호출하고 반환값을 200 + { data } 로 돌려준다", async () => {
    vi.mocked(getDb).mockReturnValue(DB_SENTINEL);
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
    vi.mocked(listContents).mockResolvedValue([SUMMARY_ROW]);

    const res = await GET(reqGet());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: [SUMMARY_ROW] });
    expect(listContents).toHaveBeenCalledTimes(1);
    expect(listContents).toHaveBeenCalledWith(
      { db: DB_SENTINEL },
      { status: undefined, mine: false },
      { role: "editor" },
    );
  });

  it("status 쿼리를 파싱해 listContents 에 그대로 전달한다", async () => {
    vi.mocked(getDb).mockReturnValue(DB_SENTINEL);
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
    vi.mocked(listContents).mockResolvedValue([]);

    const res = await GET(reqGet({ status: "in_review" }));

    expect(res.status).toBe(200);
    expect(listContents).toHaveBeenCalledWith(
      { db: DB_SENTINEL },
      { status: "in_review", mine: false },
      { role: "editor" },
    );
  });

  it("mine=true 이면 listContents 에 mine: true 로 전달된다", async () => {
    vi.mocked(getDb).mockReturnValue(DB_SENTINEL);
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(listContents).mockResolvedValue([]);

    const res = await GET(reqGet({ mine: "true" }));

    expect(res.status).toBe(200);
    expect(listContents).toHaveBeenCalledWith(
      { db: DB_SENTINEL },
      { status: undefined, mine: true },
      { role: "admin" },
    );
  });

  it("listContents 가 빈 배열을 돌려주면(결과 없음) 200 + 빈 배열을 그대로 응답한다", async () => {
    vi.mocked(getDb).mockReturnValue(DB_SENTINEL);
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
    vi.mocked(listContents).mockResolvedValue([]);

    const res = await GET(reqGet({ mine: "true" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("잘못된 status 쿼리값이면 400 을 돌려주고 listContents 를 호출하지 않는다", async () => {
    const res = await GET(reqGet({ status: "unknown_status" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(listContents).not.toHaveBeenCalled();
  });

  it("mine 이 'true' 가 아닌 값이면 400 을 돌려주고 listContents 를 호출하지 않는다", async () => {
    const res = await GET(reqGet({ mine: "false" }));

    expect(res.status).toBe(400);
    expect(listContents).not.toHaveBeenCalled();
  });

  it("listContents 가 던지면(예상 밖 DB 오류) 500 INTERNAL 로 응답한다(라우트의 try/catch)", async () => {
    vi.mocked(getDb).mockReturnValue(DB_SENTINEL);
    vi.mocked(getActor).mockReturnValue({ role: "editor" });
    vi.mocked(listContents).mockRejectedValue(new Error("db down"));

    const res = await GET(reqGet());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
  });
});
