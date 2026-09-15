import { describe, expect, it } from "vitest";
import {
  ApproveInputSchema,
  ContentListQuerySchema,
  RejectInputSchema,
  SheetPlanRowSchema,
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
