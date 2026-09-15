import type { contents } from "@/lib/db/schema";
import type { ValidationResult } from "@/lib/validator";
import type { ChannelFormat } from "@/lib/channel-format";

/**
 * FR-009 계약(run 20260915-1754-5568) 「데이터 형태 · ContentDetail / ContentsRow」·
 * 「유닛 · lib/content-detail.ts::toContentDetail」.
 *
 * FR-005(_workspace/contract_fr-005-body-generation.md)의 `ContentDetail`(당시
 * services/content-generation.ts 157~189행)은 "방금 생성된 draft" 전용이라 여러 필드가
 * 리터럴 타입이었다. 여기서는 GET 상세·submit·cancel-review 가 모두 공유하는 일반화된
 * 형태로 옮긴다 — services/content-generation.ts 는 이 타입을 재사용(import)한다.
 */

export type ContentsRow = typeof contents.$inferSelect;

export interface ContentDetail {
  id: number;
  publishPlanId: number | null;
  sourceContentId: number | null;
  productId: number | null;
  channelId: number;
  lang: "ko" | "en";
  postType: "health_info" | "activity_news" | "comparison" | "review";
  targetPersona: string;
  status: "draft" | "in_review" | "approved" | "rejected" | "published";
  title: string;
  body: string | null;
  regenCount: number;
  link: string;
  validation: ValidationResult;
  ruleSnapshot: { ruleIds: number[]; version: string; exampleIds: number[] } | null;
  sentPrompt: string | null;
  model: string | null;
  rejectReason: string | null;
  publishedUrl: string | null;
  urlCheck: "ok" | "unreachable" | "skipped" | null;
  authorId: number | null;
  reviewerId: number | null;
  publisherId: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
  isExample: boolean;
  historyCount: number;
  autoRegenerated: boolean;
  channelFormat: ChannelFormat | null;
}

/**
 * 순수 함수. `row`(contents 전체 컬럼)를 그대로 옮기고, Date 필드는 null 이 아니면
 * ISO 문자열로 바꾼다. `validation`·`link`·`isExample`·`historyCount`·`autoRegenerated`·
 * `channelFormat` 은 row 에 없거나(계산값) 호출자별로 다르므로 `extra` 로 받는다 —
 * `row.detectedTerms` 는 쓰지 않고 항상 `extra.validation` 을 쓴다(호출자가 최신
 * 재검증 결과를 넘길 수 있게).
 */
export function toContentDetail(
  row: ContentsRow,
  extra: {
    validation: ValidationResult;
    link: string;
    isExample: boolean;
    historyCount: number;
    autoRegenerated: boolean;
    channelFormat: ChannelFormat | null;
  },
): ContentDetail {
  return {
    id: row.id,
    publishPlanId: row.publishPlanId,
    sourceContentId: row.sourceContentId,
    productId: row.productId,
    channelId: row.channelId,
    lang: row.lang,
    postType: row.postType,
    // CONTRACT_DEFECT 후보: schema.ts 의 target_persona 컬럼은 nullable(238행, .notNull() 없음)
    // 이라 drizzle 추론 타입은 string|null 인데, 계약의 ContentDetail 은 targetPersona: string
    // (non-null)으로 선언돼 있다. 이 경로로 들어오는 행은 실제로 항상
    // CreateContentInput.targetPersona(항상 string)로 채워져 값 자체는 null 이 아니므로,
    // ruleSnapshot·detectedTerms(jsonb→unknown)와 같은 근거로 타입만 캐스팅한다.
    targetPersona: row.targetPersona as string,
    status: row.status,
    title: row.title,
    body: row.body,
    regenCount: row.regenCount,
    link: extra.link,
    validation: extra.validation,
    ruleSnapshot: row.ruleSnapshot as ContentDetail["ruleSnapshot"],
    sentPrompt: row.sentPrompt,
    model: row.model,
    rejectReason: row.rejectReason,
    publishedUrl: row.publishedUrl,
    urlCheck: row.urlCheck,
    authorId: row.authorId,
    reviewerId: row.reviewerId,
    publisherId: row.publisherId,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    isExample: extra.isExample,
    historyCount: extra.historyCount,
    autoRegenerated: extra.autoRegenerated,
    channelFormat: extra.channelFormat,
  };
}
