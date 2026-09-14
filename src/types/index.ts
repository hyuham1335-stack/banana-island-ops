/**
 * 공통 타입 — docs/API_SPEC.md 「공통 규약」의 공통 타입 표.
 * FR-002 계약: ContentStatus 는 src/lib/db/schema.ts 의 contentStatusEnum 값과 리터럴이 같아야 한다.
 */

export type ContentStatus = "draft" | "in_review" | "approved" | "rejected" | "published";

export type PlanStatus = "scheduled" | "generating" | "in_review" | "approved" | "published" | "on_hold";
