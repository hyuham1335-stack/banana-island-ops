import type { CostItem, CostStage } from "@/types";

/**
 * FR-020 원가 계산 — 계약(run 20260920-0107-4265) 「유닛 · lib/cost-calc.ts」.
 * 순수 함수, I/O 없음. 결과를 저장하지 않는다(ADR-005 — 환산 원화 컬럼을 만들지 않는다).
 */

export interface CostFx {
  usdKrw: string;
  phpKrw: string;
}

export interface CostSheetSummary {
  stages: { ph: number | null; kr: number | null; us: number | null };
  unitCostKrw: number;
}

function fxRateFor(currency: CostItem["currency"], fx: CostFx): number {
  if (currency === "KRW") return 1;
  if (currency === "PHP") return Number(fx.phpKrw);
  return Number(fx.usdKrw);
}

export function perUnitKrw(
  item: Pick<CostItem, "amount" | "currency" | "basis" | "batchQty">,
  fx: CostFx,
): number {
  const divisor = item.basis === "per_batch" ? (item.batchQty ?? 1) : 1;
  return (Number(item.amount) / divisor) * fxRateFor(item.currency, fx);
}

export function summarizeCostSheet(items: CostItem[], fx: CostFx | null): CostSheetSummary | null {
  if (fx === null) return null;

  const stages: CostStage[] = ["ph", "kr", "us"];
  const stageSums: Record<CostStage, number | null> = { ph: null, kr: null, us: null };

  for (const stage of stages) {
    const stageItems = items.filter((item) => item.stage === stage);
    if (stageItems.length === 0) continue;
    stageSums[stage] = stageItems.reduce((sum, item) => sum + perUnitKrw(item, fx), 0);
  }

  const unitCostKrw = (stageSums.ph ?? 0) + (stageSums.kr ?? 0) + (stageSums.us ?? 0);

  return { stages: stageSums, unitCostKrw };
}
