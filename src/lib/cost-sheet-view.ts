import type { CostCurrency, CostItem, CostRoute, CostSheet, CostStage } from "@/types";

/**
 * FR-020 원가표 화면 뷰 변환 — 계약(run 20260920-0107-4265) 「유닛 · lib/cost-sheet-view.ts」.
 * 순수 함수, I/O 없음. 화면(CostSheetEditor·NewCostSheetForm)은 이 변환만 쓴다.
 */

export interface EditableCostItem {
  stage: CostStage;
  costKind: string;
  amount: string;
  currency: CostCurrency;
  basis: "per_unit" | "per_batch";
  batchQty: string;
}

export const COST_ROUTES: { value: CostRoute; label: string }[] = [
  { value: "kr_domestic", label: "한국내수" },
  { value: "us_export", label: "미국수출" },
  { value: "ph_local", label: "필리핀현지" },
];

export const COST_STAGE_LABELS: Record<CostStage, string> = {
  ph: "필리핀",
  kr: "한국",
  us: "미국",
};

export function formatKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function emptyCostItem(): EditableCostItem {
  return { stage: "ph", costKind: "", amount: "", currency: "PHP", basis: "per_unit", batchQty: "" };
}

function trimAmount(amount: string): string {
  if (!amount.includes(".")) return amount;
  return amount.replace(/0+$/, "").replace(/\.$/, "");
}

export function toEditableItems(items: CostItem[]): EditableCostItem[] {
  return items.map((item) => ({
    stage: item.stage,
    costKind: item.costKind,
    amount: trimAmount(item.amount),
    currency: item.currency,
    basis: item.basis,
    batchQty: item.batchQty === null ? "" : String(item.batchQty),
  }));
}

export interface UpdateCostSheetPayloadItem {
  stage: CostStage;
  costKind: string;
  amount: string;
  currency: CostCurrency;
  basis: "per_unit" | "per_batch";
  batchQty: number | null;
}

export function toUpdateInput(
  name: string,
  rows: EditableCostItem[],
): { name: string; items: UpdateCostSheetPayloadItem[] } {
  return {
    name: name.trim(),
    items: rows.map((row) => ({
      stage: row.stage,
      costKind: row.costKind.trim(),
      amount: row.amount.trim(),
      currency: row.currency,
      basis: row.basis,
      batchQty: row.basis === "per_unit" ? null : row.batchQty === "" ? null : Number(row.batchQty),
    })),
  };
}

export function isDirty(original: CostSheet, name: string, rows: EditableCostItem[]): boolean {
  const current = toUpdateInput(name, rows);
  const originalInput = toUpdateInput(original.name, toEditableItems(original.items));
  return JSON.stringify(current) !== JSON.stringify(originalInput);
}

export function describeCostSheetError(status: number, body: unknown): string {
  if (status === 409) return "이미 확정된 원가표입니다. 새로고침하세요.";
  if (status === 403) return "대표만 원가표를 다룰 수 있습니다.";
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    body.error !== null &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof (body.error as { message: unknown }).message === "string"
  ) {
    return (body.error as { message: string }).message;
  }
  return "요청을 처리하지 못했습니다.";
}
