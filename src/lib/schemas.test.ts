import { describe, expect, it } from "vitest";
import {
  ApproveInputSchema,
  ContentListQuerySchema,
  CostItemInputSchema,
  CostSheetListQuerySchema,
  CreateCostSheetInputSchema,
  EditContentInputSchema,
  FrankfurterLatestSchema,
  FxQuerySchema,
  MAX_COST_ITEMS,
  ManualFxInputSchema,
  RejectInputSchema,
  SetRoleInputSchema,
  SheetPlanRowSchema,
  UpdateCostSheetInputSchema,
  parseSheetRow,
} from "./schemas";

// 계약: _workspace/contract_must-fr001-sheet-sync.md 「유닛 · src/lib/schemas.ts」
// docs/API_SPEC.md §POST /api/plans/sync 의 SheetPlanRow 계약과 1:1.
// DB·네트워크 없음 — 순수 파싱만 검증한다.

const VALID: string[] = [
  "PLAN-001", // A planId
  "2026-09-20", // B scheduledDate
  "네이버 스마트스토어", // C channel
  "바나나칩 오리지널", // D product
  "ko", // E lang
  "건강정보형", // F postTypeLabel
  "장 건강에 좋은 이유", // G topic
  "김담당", // H owner
];

function cellsWith(index: number, value: string): string[] {
  const c = [...VALID];
  c[index] = value;
  return c;
}

describe("SheetPlanRowSchema", () => {
  it("8칸 모두 유효하면 safeParse 가 성공한다", () => {
    const result = SheetPlanRowSchema.safeParse({
      planId: VALID[0],
      scheduledDate: VALID[1],
      channel: VALID[2],
      product: VALID[3],
      lang: VALID[4],
      postTypeLabel: VALID[5],
      topic: VALID[6],
      owner: VALID[7],
    });
    expect(result.success).toBe(true);
  });

  it("lang 은 'ko'|'en' 이 아니면 실패한다", () => {
    const result = SheetPlanRowSchema.safeParse({
      planId: "P1",
      scheduledDate: "2026-09-20",
      channel: "채널",
      product: "",
      lang: "jp",
      postTypeLabel: "건강정보형",
      topic: "",
      owner: "",
    });
    expect(result.success).toBe(false);
  });

  it("postTypeLabel 은 정해진 4개 한글 라벨이 아니면 실패한다", () => {
    const result = SheetPlanRowSchema.safeParse({
      planId: "P1",
      scheduledDate: "2026-09-20",
      channel: "채널",
      product: "",
      lang: "ko",
      postTypeLabel: "이벤트형",
      topic: "",
      owner: "",
    });
    expect(result.success).toBe(false);
  });

  it("product·topic·owner 는 빈 문자열을 허용한다", () => {
    const result = SheetPlanRowSchema.safeParse({
      planId: "P1",
      scheduledDate: "2026-09-20",
      channel: "채널",
      product: "",
      lang: "ko",
      postTypeLabel: "건강정보형",
      topic: "",
      owner: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("parseSheetRow 골든 테이블", () => {
  it("8칸 전부 유효하면 ok:true 와 trim 된 row 를 돌려준다", () => {
    expect(parseSheetRow(VALID)).toEqual({
      ok: true,
      row: {
        planId: "PLAN-001",
        scheduledDate: "2026-09-20",
        channel: "네이버 스마트스토어",
        product: "바나나칩 오리지널",
        lang: "ko",
        postTypeLabel: "건강정보형",
        topic: "장 건강에 좋은 이유",
        owner: "김담당",
      },
    });
  });

  it("앞뒤 공백은 trim 되어 통과한다", () => {
    const c = [...VALID];
    c[0] = "  PLAN-001  ";
    c[1] = " 2026-09-20 ";
    const result = parseSheetRow(c);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.planId).toBe("PLAN-001");
      expect(result.row.scheduledDate).toBe("2026-09-20");
    }
  });

  const table: Array<[string, string[], { ok: false; error: string; column?: string }]> = [
    ["A 빈값 → MISSING_REQUIRED(A)", cellsWith(0, ""), { ok: false, error: "MISSING_REQUIRED", column: "A" }],
    ["A 공백만 → MISSING_REQUIRED(A)", cellsWith(0, "   "), { ok: false, error: "MISSING_REQUIRED", column: "A" }],
    ["B 빈값 → MISSING_REQUIRED(B)", cellsWith(1, ""), { ok: false, error: "MISSING_REQUIRED", column: "B" }],
    [
      "B 형식 오류(슬래시 구분) → INVALID_DATE(B)",
      cellsWith(1, "2026/09/20"),
      { ok: false, error: "INVALID_DATE", column: "B" },
    ],
    [
      "B 형식 오류(자릿수 부족) → INVALID_DATE(B)",
      cellsWith(1, "26-9-20"),
      { ok: false, error: "INVALID_DATE", column: "B" },
    ],
    ["C 빈값 → MISSING_REQUIRED(C)", cellsWith(2, ""), { ok: false, error: "MISSING_REQUIRED", column: "C" }],
    ["E 빈값 → MISSING_REQUIRED(E)", cellsWith(4, ""), { ok: false, error: "MISSING_REQUIRED", column: "E" }],
    ["E 라벨 오류 → UNKNOWN_LANG(E)", cellsWith(4, "jp"), { ok: false, error: "UNKNOWN_LANG", column: "E" }],
    ["F 빈값 → MISSING_REQUIRED(F)", cellsWith(5, ""), { ok: false, error: "MISSING_REQUIRED", column: "F" }],
    [
      "F 라벨 오류 → UNKNOWN_POST_TYPE(F)",
      cellsWith(5, "이벤트형"),
      { ok: false, error: "UNKNOWN_POST_TYPE", column: "F" },
    ],
  ];

  it.each(table)("%s", (_label, cells, expected) => {
    expect(parseSheetRow(cells)).toEqual(expected);
  });

  it("D(product) 빈 문자열은 형태 검증을 통과한다", () => {
    expect(parseSheetRow(cellsWith(3, "")).ok).toBe(true);
  });

  it("G(topic)·H(owner) 빈 문자열은 형태 검증을 통과한다", () => {
    const c = [...VALID];
    c[6] = "";
    c[7] = "";
    expect(parseSheetRow(c).ok).toBe(true);
  });

  it("A·B 가 모두 비어도 우선순위(A→B→C→E→F)상 A 가 먼저 보고된다", () => {
    const c = [...VALID];
    c[0] = "";
    c[1] = "";
    expect(parseSheetRow(c)).toEqual({ ok: false, error: "MISSING_REQUIRED", column: "A" });
  });

  it("C·E 가 모두 오류면 C 가 먼저 보고된다 (A→B→C→E→F)", () => {
    const c = [...VALID];
    c[2] = "";
    c[4] = "jp";
    expect(parseSheetRow(c)).toEqual({ ok: false, error: "MISSING_REQUIRED", column: "C" });
  });

  it("E·F 가 모두 오류면 E 가 먼저 보고된다 (A→B→C→E→F)", () => {
    const c = [...VALID];
    c[4] = "jp";
    c[5] = "이벤트형";
    expect(parseSheetRow(c)).toEqual({ ok: false, error: "UNKNOWN_LANG", column: "E" });
  });
});

// 계약: FR-009(런 20260915-1754-5568) 「유닛 · src/lib/schemas.ts · ContentListQuerySchema」
// GET /api/contents?status=&mine=true 의 쿼리 검증. status 는 contentStatusEnum 의 5값
// 중 하나(옵션), mine 은 쿼리 문자열 "true" 일 때만 true 로 coerce 한다(그 밖의 문자열은
// 거부 — z.literal("true").optional() 이 계약이 고정한 형태다).
describe("ContentListQuerySchema", () => {
  it("status·mine 이 모두 없으면(빈 객체) 통과한다", () => {
    expect(ContentListQuerySchema.safeParse({}).success).toBe(true);
  });

  it.each(["draft", "in_review", "approved", "rejected", "published"])(
    "status='%s' 는 유효한 값이라 통과한다",
    (status) => {
      const result = ContentListQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
    },
  );

  it("mine='true' 는 통과한다", () => {
    expect(ContentListQuerySchema.safeParse({ mine: "true" }).success).toBe(true);
  });

  it("status·mine 조합(status='in_review', mine='true')이 모두 유효하면 통과한다", () => {
    const result = ContentListQuerySchema.safeParse({ status: "in_review", mine: "true" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ status: "in_review", mine: "true" });
    }
  });

  it("status 가 닫힌 집합 밖 값이면 거부한다", () => {
    expect(ContentListQuerySchema.safeParse({ status: "unknown_status" }).success).toBe(false);
  });

  it("mine 이 'true' 가 아닌 문자열(예: 'false')이면 거부한다", () => {
    expect(ContentListQuerySchema.safeParse({ mine: "false" }).success).toBe(false);
  });
});

// 계약: FR-010·FR-011(런 20260915-2042-728c) 「데이터 형태 · ApproveInput { registerAsExample: boolean }」
describe("ApproveInputSchema", () => {
  it("registerAsExample: true 는 통과한다", () => {
    const result = ApproveInputSchema.safeParse({ registerAsExample: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ registerAsExample: true });
  });

  it("registerAsExample: false 는 통과한다", () => {
    const result = ApproveInputSchema.safeParse({ registerAsExample: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ registerAsExample: false });
  });

  it("registerAsExample 필드가 없으면 거부한다", () => {
    expect(ApproveInputSchema.safeParse({}).success).toBe(false);
  });

  it("registerAsExample 이 문자열 타입이면 거부한다", () => {
    expect(ApproveInputSchema.safeParse({ registerAsExample: "true" }).success).toBe(false);
  });
});

// 계약: FR-010·FR-011(런 20260915-2042-728c) 「데이터 형태 · RejectInput { reason: string }」
// trim 후 1~1000자.
describe("RejectInputSchema", () => {
  it("정상 사유(1자 이상 1000자 이하)는 통과한다", () => {
    const result = RejectInputSchema.safeParse({ reason: "표현 수정이 필요합니다." });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe("표현 수정이 필요합니다.");
  });

  it("빈 문자열은 거부한다", () => {
    expect(RejectInputSchema.safeParse({ reason: "" }).success).toBe(false);
  });

  it("공백만 있는 문자열은 trim 후 빈 문자열이 되어 거부한다", () => {
    expect(RejectInputSchema.safeParse({ reason: "   " }).success).toBe(false);
  });

  it("1000자는 통과하지만 1001자는 거부한다", () => {
    expect(RejectInputSchema.safeParse({ reason: "가".repeat(1000) }).success).toBe(true);
    expect(RejectInputSchema.safeParse({ reason: "가".repeat(1001) }).success).toBe(false);
  });

  it("앞뒤 공백은 trim 되어 검증·저장된다", () => {
    const result = RejectInputSchema.safeParse({ reason: "  표현 수정 필요  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe("표현 수정 필요");
  });

  it("reason 필드가 없으면 거부한다", () => {
    expect(RejectInputSchema.safeParse({}).success).toBe(false);
  });
});

// 계약: FR-010/011 프론트 연결 + 역할 전환(런 20260916-0038-3305)
// 「데이터 형태 · SetRoleInput { role: "editor" | "admin" }」
describe("SetRoleInputSchema", () => {
  it("role:'editor' 는 통과한다", () => {
    const result = SetRoleInputSchema.safeParse({ role: "editor" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ role: "editor" });
  });

  it("role:'admin' 은 통과한다", () => {
    const result = SetRoleInputSchema.safeParse({ role: "admin" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ role: "admin" });
  });

  it("role 이 유효 집합(editor|admin) 밖의 다른 문자열이면 거부한다", () => {
    expect(SetRoleInputSchema.safeParse({ role: "superuser" }).success).toBe(false);
  });

  it("role 필드가 없으면 거부한다", () => {
    expect(SetRoleInputSchema.safeParse({}).success).toBe(false);
  });
});

// 계약: FR-008(_workspace/contract_fr-008-direct-edit.md) 「데이터 형태 ·
// EditContentInput { title?: string(1~200, trim), body?: string(1~12000, trim) }」
// title·body 둘 다 optional 이지만 최소 하나는 있어야 한다(.refine) — 완전한 no-op PATCH 를 막는다.
describe("EditContentInputSchema", () => {
  it("title 만 있으면 통과한다", () => {
    const result = EditContentInputSchema.safeParse({ title: "새 제목" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ title: "새 제목" });
  });

  it("body 만 있으면 통과한다", () => {
    const result = EditContentInputSchema.safeParse({ body: "새 본문" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ body: "새 본문" });
  });

  it("title·body 둘 다 있으면 통과한다", () => {
    const result = EditContentInputSchema.safeParse({ title: "새 제목", body: "새 본문" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ title: "새 제목", body: "새 본문" });
  });

  it("title·body 둘 다 없으면(빈 객체) 거부한다 — 완전한 no-op PATCH 방지", () => {
    expect(EditContentInputSchema.safeParse({}).success).toBe(false);
  });

  it("title 은 200자는 통과하지만 201자는 거부한다(경계값)", () => {
    expect(EditContentInputSchema.safeParse({ title: "가".repeat(200) }).success).toBe(true);
    expect(EditContentInputSchema.safeParse({ title: "가".repeat(201) }).success).toBe(false);
  });

  it("body 는 12,000자는 통과하지만 12,001자는 거부한다(경계값)", () => {
    expect(EditContentInputSchema.safeParse({ body: "가".repeat(12_000) }).success).toBe(true);
    expect(EditContentInputSchema.safeParse({ body: "가".repeat(12_001) }).success).toBe(false);
  });

  it("title 이 공백만이면 trim 후 빈 문자열이 되어 거부한다", () => {
    expect(EditContentInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("body 가 공백만이면 trim 후 빈 문자열이 되어 거부한다", () => {
    expect(EditContentInputSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("앞뒤 공백은 trim 되어 저장된다", () => {
    const result = EditContentInputSchema.safeParse({ title: "  제목  ", body: "  본문  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ title: "제목", body: "본문" });
  });
});

// 계약: FR-022(런 20260919-2343-1c04) 「데이터 형태 · ManualFxInput」·「유닛 · lib/schemas.ts ·
// ManualFxInputSchema」. usdKrw·phpKrw 는 양의 십진 문자열(^\d+(\.\d{1,8})?$ 이고 값 > 0),
// rateDate 는 형식 + 실존(2026-02-30 같은 값 거부).
describe("ManualFxInputSchema", () => {
  const VALID_INPUT = { rateDate: "2026-09-18", usdKrw: "1380.50000000", phpKrw: "24.60784314" };

  it("유효한 입력은 통과한다", () => {
    const result = ManualFxInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(VALID_INPUT);
  });

  it("실존하지 않는 날짜(2026-02-30)는 거부한다", () => {
    expect(ManualFxInputSchema.safeParse({ ...VALID_INPUT, rateDate: "2026-02-30" }).success).toBe(false);
  });

  it("rateDate 형식이 아니면(슬래시 구분) 거부한다", () => {
    expect(ManualFxInputSchema.safeParse({ ...VALID_INPUT, rateDate: "2026/09/18" }).success).toBe(false);
  });

  it("usdKrw 가 '0' 이면 거부한다", () => {
    expect(ManualFxInputSchema.safeParse({ ...VALID_INPUT, usdKrw: "0" }).success).toBe(false);
  });

  it("phpKrw 가 음수 문자열이면 거부한다", () => {
    expect(ManualFxInputSchema.safeParse({ ...VALID_INPUT, phpKrw: "-1" }).success).toBe(false);
  });

  it("usdKrw 가 숫자가 아닌 문자열이면 거부한다", () => {
    expect(ManualFxInputSchema.safeParse({ ...VALID_INPUT, usdKrw: "abc" }).success).toBe(false);
  });

  it("소수점 9자리(자릿수 초과)는 거부한다", () => {
    expect(ManualFxInputSchema.safeParse({ ...VALID_INPUT, usdKrw: "1380.123456789" }).success).toBe(false);
  });

  it("필드가 하나라도 없으면 거부한다", () => {
    const { phpKrw: _omit, ...rest } = VALID_INPUT;
    expect(ManualFxInputSchema.safeParse(rest).success).toBe(false);
  });
});

// 계약: FR-022 「데이터 형태 · FxQuery { date?: string }」·「유닛 · lib/schemas.ts · FxQuerySchema」
describe("FxQuerySchema", () => {
  it("date 없이(빈 객체) 통과한다", () => {
    const result = FxQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("date 가 실존하는 날짜면 통과한다", () => {
    const result = FxQuerySchema.safeParse({ date: "2026-09-18" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ date: "2026-09-18" });
  });

  it("date 가 실존하지 않는 날짜(2026-02-30)면 거부한다", () => {
    expect(FxQuerySchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });

  it("date 형식이 아니면(자릿수 부족) 거부한다", () => {
    expect(FxQuerySchema.safeParse({ date: "26-9-18" }).success).toBe(false);
  });
});

// 계약: FR-022 「데이터 형태 · FrankfurterLatest」·「유닛 · lib/schemas.ts · FrankfurterLatestSchema」
// base 는 리터럴 "USD", 숫자는 z.number().finite().positive() — 여분 키(다른 통화)는 허용한다.
describe("FrankfurterLatestSchema", () => {
  const VALID = { base: "USD", date: "2026-09-18", rates: { KRW: 1380.5, PHP: 56.1 } };

  it("유효한 응답은 통과한다", () => {
    expect(FrankfurterLatestSchema.safeParse(VALID).success).toBe(true);
  });

  it("rates 에 다른 통화가 섞여도(여분 키) 통과한다", () => {
    const result = FrankfurterLatestSchema.safeParse({ ...VALID, rates: { ...VALID.rates, EUR: 0.9 } });
    expect(result.success).toBe(true);
  });

  it("base 가 'USD' 가 아니면 거부한다", () => {
    expect(FrankfurterLatestSchema.safeParse({ ...VALID, base: "EUR" }).success).toBe(false);
  });

  it("rates.KRW 가 없으면 거부한다", () => {
    const rates: Record<string, number> = { ...VALID.rates };
    delete rates.KRW;
    expect(FrankfurterLatestSchema.safeParse({ ...VALID, rates }).success).toBe(false);
  });

  it("rates.PHP 가 음수면 거부한다", () => {
    expect(FrankfurterLatestSchema.safeParse({ ...VALID, rates: { ...VALID.rates, PHP: -1 } }).success).toBe(
      false,
    );
  });

  it("rates.PHP 가 0 이면 거부한다(양수만 허용)", () => {
    expect(FrankfurterLatestSchema.safeParse({ ...VALID, rates: { ...VALID.rates, PHP: 0 } }).success).toBe(
      false,
    );
  });
});

// -----------------------------------------------------------------------------
// FR-020(런 20260920-0107-4265) 「유닛 · lib/schemas.ts」
// -----------------------------------------------------------------------------

const VALID_COST_ITEM = {
  stage: "ph" as const,
  costKind: "원료",
  amount: "1200.5",
  currency: "PHP" as const,
  basis: "per_unit" as const,
  batchQty: null,
};

describe("CostItemInputSchema", () => {
  it("유효한 per_unit 항목은 통과한다", () => {
    expect(CostItemInputSchema.safeParse(VALID_COST_ITEM).success).toBe(true);
  });

  it("유효한 per_batch 항목(batchQty 양의 정수)은 통과한다", () => {
    expect(
      CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, basis: "per_batch", batchQty: 10 }).success,
    ).toBe(true);
  });

  it("stage 가 enum 밖이면 거부한다", () => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, stage: "cn" }).success).toBe(false);
  });

  it("currency 가 enum 밖이면 거부한다", () => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, currency: "EUR" }).success).toBe(false);
  });

  it("costKind 가 빈 문자열이면 거부한다", () => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, costKind: "" }).success).toBe(false);
  });

  it("costKind 가 공백만 있으면 거부한다(trim 후 빈 문자열)", () => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, costKind: "   " }).success).toBe(false);
  });

  it.each([
    ["음수", "-100"],
    ["숫자가 아님", "abc"],
    ["소수 5자리", "1.12345"],
    ["정수 11자리", "12345678901"],
  ])("amount 형식 위반(%s)이면 거부한다", (_label, amount) => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, amount }).success).toBe(false);
  });

  it("amount 정수 10자리 + 소수 4자리는 통과한다(경계값)", () => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, amount: "1234567890.1234" }).success).toBe(
      true,
    );
  });

  it("basis 가 enum 밖이면 거부한다", () => {
    expect(CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, basis: "per_hour" }).success).toBe(false);
  });

  it("basis 가 per_batch 인데 batchQty 가 null 이면 거부한다", () => {
    expect(
      CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, basis: "per_batch", batchQty: null }).success,
    ).toBe(false);
  });

  it("basis 가 per_unit 인데 batchQty 가 null 이 아니면 거부한다", () => {
    expect(
      CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, basis: "per_unit", batchQty: 1 }).success,
    ).toBe(false);
  });

  it("batchQty 가 정수가 아니면 거부한다", () => {
    expect(
      CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, basis: "per_batch", batchQty: 1.5 }).success,
    ).toBe(false);
  });

  it("batchQty 가 0 이하이면 거부한다", () => {
    expect(
      CostItemInputSchema.safeParse({ ...VALID_COST_ITEM, basis: "per_batch", batchQty: 0 }).success,
    ).toBe(false);
  });
});

const VALID_CREATE_COST_SHEET = {
  productId: 1,
  distributionRoute: "kr_domestic" as const,
  name: "2026 하반기 v1",
};

describe("CreateCostSheetInputSchema", () => {
  it("cloneFromId 없이 유효한 입력은 통과한다", () => {
    expect(CreateCostSheetInputSchema.safeParse(VALID_CREATE_COST_SHEET).success).toBe(true);
  });

  it("cloneFromId 가 있어도(양의 정수) 통과한다", () => {
    expect(
      CreateCostSheetInputSchema.safeParse({ ...VALID_CREATE_COST_SHEET, cloneFromId: 5 }).success,
    ).toBe(true);
  });

  it.each([
    ["0", 0],
    ["음수", -1],
    ["정수가 아님", 1.5],
  ])("productId 가 양의 정수가 아니면(%s) 거부한다", (_label, productId) => {
    expect(CreateCostSheetInputSchema.safeParse({ ...VALID_CREATE_COST_SHEET, productId }).success).toBe(
      false,
    );
  });

  it("distributionRoute 가 enum 밖이면 거부한다", () => {
    expect(
      CreateCostSheetInputSchema.safeParse({ ...VALID_CREATE_COST_SHEET, distributionRoute: "jp_export" })
        .success,
    ).toBe(false);
  });

  it("name 이 빈 문자열이면 거부한다", () => {
    expect(CreateCostSheetInputSchema.safeParse({ ...VALID_CREATE_COST_SHEET, name: "" }).success).toBe(
      false,
    );
  });

  it("name 이 101자면 거부한다", () => {
    expect(
      CreateCostSheetInputSchema.safeParse({ ...VALID_CREATE_COST_SHEET, name: "가".repeat(101) }).success,
    ).toBe(false);
  });

  it("cloneFromId 가 0 이하이면 거부한다", () => {
    expect(
      CreateCostSheetInputSchema.safeParse({ ...VALID_CREATE_COST_SHEET, cloneFromId: 0 }).success,
    ).toBe(false);
  });
});

describe("UpdateCostSheetInputSchema", () => {
  it("items 0개는 통과한다(상한만 있고 하한 없음)", () => {
    expect(UpdateCostSheetInputSchema.safeParse({ items: [] }).success).toBe(true);
  });

  it(`items 가 ${MAX_COST_ITEMS}개면 통과한다(경계값)`, () => {
    const items = Array.from({ length: MAX_COST_ITEMS }, () => VALID_COST_ITEM);
    expect(UpdateCostSheetInputSchema.safeParse({ items }).success).toBe(true);
  });

  it(`items 가 ${MAX_COST_ITEMS + 1}개면 거부한다`, () => {
    const items = Array.from({ length: MAX_COST_ITEMS + 1 }, () => VALID_COST_ITEM);
    expect(UpdateCostSheetInputSchema.safeParse({ items }).success).toBe(false);
  });

  it("name 은 선택값 — 생략해도 통과한다", () => {
    expect(UpdateCostSheetInputSchema.safeParse({ items: [] }).success).toBe(true);
  });

  it("name 이 있으면 1~100자 검증을 받는다(빈 문자열 거부)", () => {
    expect(UpdateCostSheetInputSchema.safeParse({ name: "", items: [] }).success).toBe(false);
  });

  it("items 안의 항목 하나라도 무효면 전체를 거부한다", () => {
    expect(
      UpdateCostSheetInputSchema.safeParse({ items: [{ ...VALID_COST_ITEM, stage: "cn" }] }).success,
    ).toBe(false);
  });
});

describe("CostSheetListQuerySchema", () => {
  it("productId 문자열을 숫자로 coerce 한다", () => {
    const result = CostSheetListQuerySchema.safeParse({ productId: "5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.productId).toBe(5);
  });

  it("productId·distributionRoute 둘 다 생략하면 통과한다", () => {
    expect(CostSheetListQuerySchema.safeParse({}).success).toBe(true);
  });

  it("distributionRoute 가 잘못된 값이면 거부한다", () => {
    expect(CostSheetListQuerySchema.safeParse({ distributionRoute: "jp_export" }).success).toBe(false);
  });

  it("productId 가 양의 정수가 아니면(문자열 '0') 거부한다", () => {
    expect(CostSheetListQuerySchema.safeParse({ productId: "0" }).success).toBe(false);
  });
});
