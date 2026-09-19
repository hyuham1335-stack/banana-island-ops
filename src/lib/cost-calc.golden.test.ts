import { describe, expect, it } from "vitest";
import { perUnitKrw, summarizeCostSheet } from "./cost-calc";
import type { CostFx, CostSheetSummary } from "./cost-calc";
import type { CostItem } from "@/types";

/**
 * 계약: FR-020(런 20260920-0107-4265) 「유닛 · lib/cost-calc.ts」
 *
 * perUnitKrw · summarizeCostSheet 는 둘 다 순수 함수(DB·I/O 없음) — 입력·기대 출력 표로
 * 골든 테스트한다. 반올림하지 않는다(계약 명시) — 소수 그대로 비교한다.
 */

const FX: CostFx = { usdKrw: "1380", phpKrw: "24.5" };

function item(overrides: Partial<CostItem>): CostItem {
  return {
    id: 1,
    stage: "ph",
    costKind: "원료",
    amount: "0",
    currency: "KRW",
    basis: "per_unit",
    batchQty: null,
    ...overrides,
  };
}

describe("perUnitKrw", () => {
  interface Case {
    label: string;
    input: Pick<CostItem, "amount" | "currency" | "basis" | "batchQty">;
    expected: number;
  }

  const CASES: Case[] = [
    {
      label: "KRW · per_unit — 환산 없이 그대로",
      input: { amount: "1200", currency: "KRW", basis: "per_unit", batchQty: null },
      expected: 1200,
    },
    {
      label: "PHP · per_unit — × phpKrw",
      input: { amount: "56", currency: "PHP", basis: "per_unit", batchQty: null },
      expected: 1372, // 56 * 24.5
    },
    {
      label: "USD · per_batch — ÷ batchQty × usdKrw",
      input: { amount: "100", currency: "USD", basis: "per_batch", batchQty: 10 },
      expected: 13800, // 100 / 10 * 1380
    },
    {
      label: "소수 금액 — 반올림하지 않는다",
      input: { amount: "12.5", currency: "KRW", basis: "per_unit", batchQty: null },
      expected: 12.5,
    },
  ];

  it.each(CASES)("$label", ({ input, expected }) => {
    expect(perUnitKrw(input, FX)).toBe(expected);
  });
});

describe("summarizeCostSheet", () => {
  it("fx 가 null 이면 null", () => {
    expect(summarizeCostSheet([item({ stage: "ph", amount: "100" })], null)).toBeNull();
  });

  it("빈 항목 배열 → 세 단계 모두 null, unitCostKrw 는 0", () => {
    const expected: CostSheetSummary = { stages: { ph: null, kr: null, us: null }, unitCostKrw: 0 };
    expect(summarizeCostSheet([], FX)).toEqual(expected);
  });

  it("ph·kr 만 있는 시트 → us 는 null(0 이 아니다)", () => {
    const items: CostItem[] = [
      item({ id: 1, stage: "ph", amount: "56", currency: "PHP", basis: "per_unit", batchQty: null }),
      item({ id: 2, stage: "kr", amount: "1200", currency: "KRW", basis: "per_unit", batchQty: null }),
    ];

    const result = summarizeCostSheet(items, FX);

    expect(result).toEqual({
      stages: { ph: 1372, kr: 1200, us: null },
      unitCostKrw: 2572, // null 은 0 으로 취급해 합산
    });
  });

  it("여러 항목 단계 합 · 전체 합 — 한 단계에 항목이 여럿이면 단계 내 합, unitCostKrw 는 세 단계 합", () => {
    const items: CostItem[] = [
      item({ id: 1, stage: "ph", amount: "56", currency: "PHP", basis: "per_unit", batchQty: null }),
      item({ id: 2, stage: "ph", amount: "100", currency: "USD", basis: "per_batch", batchQty: 10 }),
      item({ id: 3, stage: "kr", amount: "500", currency: "KRW", basis: "per_unit", batchQty: null }),
      item({ id: 4, stage: "us", amount: "20", currency: "USD", basis: "per_unit", batchQty: null }),
    ];

    const result = summarizeCostSheet(items, FX);

    expect(result).toEqual({
      stages: {
        ph: 15172, // 1372 + 13800
        kr: 500,
        us: 27600, // 20 * 1380
      },
      unitCostKrw: 43272, // 15172 + 500 + 27600
    });
  });

  it("결과를 어딘가에 저장하지 않는다 — 같은 입력을 두 번 호출해도 같은 결과이고 항목 배열을 바꾸지 않는다", () => {
    const items: CostItem[] = [item({ id: 1, stage: "ph", amount: "56", currency: "PHP", batchQty: null })];
    const before = JSON.stringify(items);

    const first = summarizeCostSheet(items, FX);
    const second = summarizeCostSheet(items, FX);

    expect(first).toEqual(second);
    expect(JSON.stringify(items)).toBe(before);
  });
});
