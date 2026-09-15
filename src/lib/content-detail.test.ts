import { describe, expect, it } from "vitest";
import { toContentDetail, type ContentsRow } from "./content-detail";

// 계약: FR-009(런 20260915-1754-5568) 「유닛 · src/lib/content-detail.ts · toContentDetail(row, extra)」
// — 골든 테스트. ContentDetail 의 정확한 형태는 계약 「데이터 형태」절에 고정돼 있다.
// extra 의 실제 형태(validation·link·isExample·historyCount·autoRegenerated 5개 필드)는
// 구현 파일(src/lib/content-detail.ts) 자체에서 확인했다 — toContentDetail 은 순수 매퍼로,
// row.detectedTerms 를 직접 쓰지 않고 항상 extra.validation 을 쓴다(호출자가 최신 재검증
// 결과를 넘길 수 있게 하기 위함).

const BASE_ROW: ContentsRow = {
  id: 501,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  templateId: 900,
  authorId: null,
  reviewerId: null,
  publisherId: null,
  lang: "ko",
  postType: "health_info",
  targetPersona: "30대 직장인",
  status: "draft",
  title: "여름철 든든한 간식",
  titleCandidates: null,
  body: "정상적인 본문입니다.",
  regenCount: 0,
  ruleSnapshot: { ruleIds: [1, 2], version: "v3", exampleIds: [9] },
  detectedTerms: { blocks: [], warns: [], missing: [] },
  sentPrompt: "===SYSTEM===\n...\n\n===USER===\n...",
  model: "claude-test-model",
  rejectReason: null,
  publishedUrl: null,
  urlCheck: null,
  submittedAt: null,
  reviewedAt: null,
  publishedAt: null,
  updatedAt: new Date("2026-09-15T00:01:00Z"),
  createdAt: new Date("2026-09-15T00:00:00Z"),
};

const EXTRA = {
  validation: { blocks: [], warns: [], missing: [] },
  link: "https://shop.banana-island.co.kr/?utm_campaign=c-501",
  isExample: false,
  historyCount: 0,
  autoRegenerated: false,
};

describe("toContentDetail", () => {
  it("모든 필드를 ContentDetail 형태로 매핑한다 — Date→ISO 변환 포함(골든)", () => {
    const result = toContentDetail(BASE_ROW, EXTRA);

    expect(result).toEqual({
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
      ruleSnapshot: { ruleIds: [1, 2], version: "v3", exampleIds: [9] },
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
    });
  });

  it("ruleSnapshot 이 null 인 행은 null 을 그대로 통과시킨다", () => {
    const row: ContentsRow = { ...BASE_ROW, ruleSnapshot: null };
    const result = toContentDetail(row, EXTRA);
    expect(result.ruleSnapshot).toBeNull();
  });

  it("ruleSnapshot 값이 있는 행은 그 값을 그대로 반영한다", () => {
    const snapshot = { ruleIds: [7], version: "v9", exampleIds: [] };
    const row: ContentsRow = { ...BASE_ROW, ruleSnapshot: snapshot };
    const result = toContentDetail(row, EXTRA);
    expect(result.ruleSnapshot).toEqual(snapshot);
  });

  it("submittedAt·reviewedAt·publishedAt 이 Date 값이면 ISO 문자열로 변환된다", () => {
    const row: ContentsRow = {
      ...BASE_ROW,
      status: "in_review",
      submittedAt: new Date("2026-09-15T01:00:00Z"),
      reviewedAt: new Date("2026-09-15T02:00:00Z"),
      publishedAt: new Date("2026-09-15T03:00:00Z"),
    };
    const result = toContentDetail(row, EXTRA);
    expect(result.submittedAt).toBe("2026-09-15T01:00:00.000Z");
    expect(result.reviewedAt).toBe("2026-09-15T02:00:00.000Z");
    expect(result.publishedAt).toBe("2026-09-15T03:00:00.000Z");
  });

  it("submittedAt·reviewedAt·publishedAt 이 null 이면 null 을 그대로 통과시킨다", () => {
    const result = toContentDetail(BASE_ROW, EXTRA);
    expect(result.submittedAt).toBeNull();
    expect(result.reviewedAt).toBeNull();
    expect(result.publishedAt).toBeNull();
  });

  it("body 가 null 인 행(아직 본문 생성 전)도 null 을 그대로 통과시킨다", () => {
    const row: ContentsRow = { ...BASE_ROW, body: null };
    const result = toContentDetail(row, EXTRA);
    expect(result.body).toBeNull();
  });

  it("productId·publishPlanId·sourceContentId·rejectReason·publishedUrl·urlCheck 가 null 이면 그대로 통과시킨다", () => {
    const result = toContentDetail(BASE_ROW, EXTRA);
    expect(result.productId).toBeNull();
    expect(result.publishPlanId).toBeNull();
    expect(result.sourceContentId).toBeNull();
    expect(result.rejectReason).toBeNull();
    expect(result.publishedUrl).toBeNull();
    expect(result.urlCheck).toBeNull();
  });

  it("row.detectedTerms 가 아니라 extra.validation 을 쓴다(호출자의 최신 재검증 결과 우선)", () => {
    const row: ContentsRow = {
      ...BASE_ROW,
      detectedTerms: { blocks: [{ ruleId: 1, label: "옛 검출", matched: "완치", index: 0, severity: "block", alternative: null, reason: null }], warns: [], missing: [] },
    };
    const freshValidation = { blocks: [], warns: [], missing: [] };
    const result = toContentDetail(row, { ...EXTRA, validation: freshValidation });
    expect(result.validation).toBe(freshValidation);
  });

  it("extra.link·isExample·historyCount·autoRegenerated 를 그대로 반영한다", () => {
    const result = toContentDetail(BASE_ROW, { ...EXTRA, isExample: true, historyCount: 3, autoRegenerated: true });
    expect(result.link).toBe(EXTRA.link);
    expect(result.isExample).toBe(true);
    expect(result.historyCount).toBe(3);
    expect(result.autoRegenerated).toBe(true);
  });
});
