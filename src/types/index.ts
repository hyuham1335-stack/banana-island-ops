/**
 * 공통 타입 — docs/API_SPEC.md 「공통 규약」의 공통 타입 표.
 * FR-002 계약: ContentStatus 는 src/lib/db/schema.ts 의 contentStatusEnum 값과 리터럴이 같아야 한다.
 */

export type ContentStatus = "draft" | "in_review" | "approved" | "rejected" | "published";

export type PlanStatus = "scheduled" | "generating" | "in_review" | "approved" | "published" | "on_hold";

/**
 * FR-020 원가표 — 계약(run 20260920-0107-4265).
 */
export type CostRoute = "kr_domestic" | "us_export" | "ph_local";

export type CostStage = "ph" | "kr" | "us";

export type CostCurrency = "KRW" | "PHP" | "USD";

export interface CostItem {
  id: number;
  stage: CostStage;
  costKind: string;
  amount: string;
  currency: CostCurrency;
  basis: "per_unit" | "per_batch";
  batchQty: number | null;
}

export interface CostSheet {
  id: number;
  productId: number;
  distributionRoute: CostRoute;
  name: string;
  effectiveFrom: string | null;
  status: "draft" | "confirmed";
  confirmedAt: string | null;
  items: CostItem[];
}
