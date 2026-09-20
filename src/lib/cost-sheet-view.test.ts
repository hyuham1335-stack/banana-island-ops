import { describe, expect, it } from "vitest";
import {
  describeCostSheetError,
  emptyCostItem,
  isDirty,
  toEditableItems,
  toUpdateInput,
  formatKrw,
} from "./cost-sheet-view";
import type { EditableCostItem } from "./cost-sheet-view";
import type { CostItem, CostSheet } from "@/types";

/**
 * 계약: FR-020(런 20260920-0107-4265) 「유닛 · lib/cost-sheet-view.ts」
 * 전부 순수 함수(DB·I/O 없음). 화면 조립에 쓰이는 변환·문구만 검증한다.
 */

describe("formatKrw", () => {
  it("소수를 반올림하고 천 단위 구분 기호 + '원' 을 붙인다", () => {
    expect(formatKrw(12345.6)).toBe("12,346원");
  });

  it("정확히 .5 인 경우도 반올림한다", () => {
    expect(formatKrw(999.5)).toBe("1,000원");
  });

  it("0 은 '0원'", () => {
    expect(formatKrw(0)).toBe("0원");
  });

  it("천 단위 미만은 구분 기호가 없다", () => {
    expect(formatKrw(999.4)).toBe("999원");
  });
});

describe("emptyCostItem", () => {
  it("빈 행 — stage ph · currency PHP · basis per_unit · batchQty 빈 문자열", () => {
    expect(emptyCostItem()).toEqual({
      stage: "ph",
      costKind: "",
      amount: "",
      currency: "PHP",
      basis: "per_unit",
      batchQty: "",
    });
  });
});

function costItem(overrides: Partial<CostItem>): CostItem {
  return {
    id: 1,
    stage: "ph",
    costKind: "원료",
    amount: "1200.0000",
    currency: "PHP",
    basis: "per_unit",
    batchQty: null,
    ...overrides,
  };
}

describe("toEditableItems", () => {
  it("amount 끝의 불필요한 0 과 소수점을 뗀다 — '1200.0000' → '1200'", () => {
    const [row] = toEditableItems([costItem({ amount: "1200.0000" })]);
    expect(row.amount).toBe("1200");
  });

  it("amount '12.5000' → '12.5' — 유효 소수는 남긴다", () => {
    const [row] = toEditableItems([costItem({ amount: "12.5000" })]);
    expect(row.amount).toBe("12.5");
  });

  it("소수점이 없는 amount 는 그대로 둔다", () => {
    const [row] = toEditableItems([costItem({ amount: "500" })]);
    expect(row.amount).toBe("500");
  });

  it("batchQty null → 빈 문자열, 숫자 → 문자열화", () => {
    const [nullRow, numRow] = toEditableItems([
      costItem({ id: 1, basis: "per_unit", batchQty: null }),
      costItem({ id: 2, basis: "per_batch", batchQty: 12 }),
    ]);
    expect(nullRow.batchQty).toBe("");
    expect(numRow.batchQty).toBe("12");
  });

  it("id 는 결과 객체에 남지 않는다", () => {
    const [row] = toEditableItems([costItem({ id: 999 })]);
    expect(row).not.toHaveProperty("id");
  });

  it("여러 항목을 순서대로 매핑한다", () => {
    const rows = toEditableItems([
      costItem({ id: 1, stage: "ph", costKind: "원료" }),
      costItem({ id: 2, stage: "kr", costKind: "포장" }),
    ]);
    expect(rows.map((r) => r.stage)).toEqual(["ph", "kr"]);
    expect(rows.map((r) => r.costKind)).toEqual(["원료", "포장"]);
  });
});

function row(overrides: Partial<EditableCostItem> = {}): EditableCostItem {
  return {
    stage: "ph",
    costKind: "원료",
    amount: "100",
    currency: "PHP",
    basis: "per_unit",
    batchQty: "",
    ...overrides,
  };
}

describe("toUpdateInput", () => {
  it("basis 가 per_unit 이면 batchQty 입력값과 무관하게 null", () => {
    const result = toUpdateInput("시트", [row({ basis: "per_unit", batchQty: "5" })]);
    expect(result.items[0].batchQty).toBeNull();
  });

  it("basis 가 per_batch 이고 batchQty 가 빈 문자열이면 null", () => {
    const result = toUpdateInput("시트", [row({ basis: "per_batch", batchQty: "" })]);
    expect(result.items[0].batchQty).toBeNull();
  });

  it("basis 가 per_batch 이고 batchQty 가 숫자 문자열이면 숫자로 변환한다", () => {
    const result = toUpdateInput("시트", [row({ basis: "per_batch", batchQty: "12" })]);
    expect(result.items[0].batchQty).toBe(12);
  });

  it("costKind·amount 를 trim 한다", () => {
    const result = toUpdateInput("시트", [row({ costKind: "  원료  ", amount: "  100  " })]);
    expect(result.items[0].costKind).toBe("원료");
    expect(result.items[0].amount).toBe("100");
  });

  it("name 을 그대로 담는다", () => {
    const result = toUpdateInput("2026 v1", [row()]);
    expect(result.name).toBe("2026 v1");
  });

  it("검증하지 않는다 — 형식이 이상한 amount 도 그대로 통과시킨다", () => {
    expect(() => toUpdateInput("시트", [row({ amount: "abc" })])).not.toThrow();
    expect(toUpdateInput("시트", [row({ amount: "abc" })]).items[0].amount).toBe("abc");
  });
});

describe("isDirty", () => {
  function sheet(overrides: Partial<CostSheet> = {}): CostSheet {
    return {
      id: 1,
      productId: 10,
      distributionRoute: "ph_local",
      name: "원본",
      effectiveFrom: null,
      status: "draft",
      confirmedAt: null,
      items: [costItem({ id: 1, stage: "ph", costKind: "원료", amount: "1200.0000", batchQty: null })],
      ...overrides,
    };
  }

  it("변경 없이 원본을 그대로 넘기면 false", () => {
    const original = sheet();
    const rows = toEditableItems(original.items);
    expect(isDirty(original, original.name, rows)).toBe(false);
  });

  it("금액이 바뀌면 true", () => {
    const original = sheet();
    const rows = toEditableItems(original.items);
    rows[0].amount = "9999";
    expect(isDirty(original, original.name, rows)).toBe(true);
  });

  it("행이 추가되면 true", () => {
    const original = sheet();
    const rows = [...toEditableItems(original.items), emptyCostItem()];
    expect(isDirty(original, original.name, rows)).toBe(true);
  });

  it("이름이 바뀌면 true", () => {
    const original = sheet();
    const rows = toEditableItems(original.items);
    expect(isDirty(original, "새 이름", rows)).toBe(true);
  });

  it("순서 포함 비교 — 같은 행을 순서만 바꿔도 true", () => {
    const original = sheet({
      items: [
        costItem({ id: 1, stage: "ph", costKind: "A", amount: "100" }),
        costItem({ id: 2, stage: "kr", costKind: "B", amount: "200" }),
      ],
    });
    const [a, b] = toEditableItems(original.items);
    expect(isDirty(original, original.name, [b, a])).toBe(true);
  });
});

describe("describeCostSheetError", () => {
  it("409 → 고정 문구(본문 내용과 무관)", () => {
    expect(describeCostSheetError(409, { error: { message: "다른 문구" } })).toBe(
      "이미 확정된 원가표입니다. 새로고침하세요.",
    );
  });

  it("403 → 고정 문구(본문 내용과 무관)", () => {
    expect(describeCostSheetError(403, {})).toBe("대표만 원가표를 다룰 수 있습니다.");
  });

  it("그 밖의 상태에서 body.error.message 가 문자열이면 그것을 쓴다", () => {
    expect(describeCostSheetError(400, { error: { message: "id 형식이 올바르지 않습니다." } })).toBe(
      "id 형식이 올바르지 않습니다.",
    );
  });

  it("body.error.message 가 없으면 기본 문구", () => {
    expect(describeCostSheetError(500, {})).toBe("요청을 처리하지 못했습니다.");
  });

  it("body 가 null 이어도 기본 문구(throw 하지 않는다)", () => {
    expect(describeCostSheetError(500, null)).toBe("요청을 처리하지 못했습니다.");
  });

  it("body.error.message 가 문자열이 아니면 기본 문구", () => {
    expect(describeCostSheetError(500, { error: { message: 123 } })).toBe("요청을 처리하지 못했습니다.");
  });
});
