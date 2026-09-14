import { z } from "zod";

/**
 * 외부 응답(시트 행)을 신뢰 경계에서 거르는 zod 스키마 — docs/TRD.md §4 「시트 행 계약」.
 * 여기는 **형태**만 본다. 이름→id 조회(채널·제품·담당자)는 services/plan-sync.ts 가 한다.
 */

// SyncResult / import_logs.errors 에 쓰는 행 단위 오류 어휘. API_SPEC.md 와 같은 닫힌 집합.
export type SheetRowError =
  | "MISSING_REQUIRED"
  | "INVALID_DATE"
  | "UNKNOWN_CHANNEL"
  | "UNKNOWN_PRODUCT"
  | "UNKNOWN_LANG"
  | "UNKNOWN_POST_TYPE"
  | "DUPLICATE_KEY";

export type SheetRowColumn = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface SheetRowIssue {
  row: number; // 시트 행 번호. 헤더 = 1, 데이터 첫 행 = 2
  column?: SheetRowColumn;
  reason: SheetRowError;
}

export const POST_TYPE_LABELS = ["건강정보형", "활동소식형", "비교큐레이션형", "후기리뷰형"] as const;
export type PostTypeLabel = (typeof POST_TYPE_LABELS)[number];

// 필수 텍스트: trim 뒤 비어 있으면 MISSING_REQUIRED. .min() 의 메시지 문자열이 곧 오류 코드다.
const requiredText = () => z.string().trim().min(1, "MISSING_REQUIRED");
// 선택 텍스트: trim 만, 빈 문자열 허용 — 형태 검증 실패가 없다.
const optionalText = () => z.string().trim();

const scheduledDateField = requiredText().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "INVALID_DATE");

const langField = requiredText().refine(
  (v): v is "ko" | "en" => v === "ko" || v === "en",
  "UNKNOWN_LANG",
);

const postTypeLabelField = requiredText().refine(
  (v): v is PostTypeLabel => (POST_TYPE_LABELS as readonly string[]).includes(v),
  "UNKNOWN_POST_TYPE",
);

/**
 * 시트 한 행의 형태 — 8칸(A~H) 고정. `.refine` 의 커스텀 메시지가 그대로 SheetRowError 값이라
 * safeParse 실패 시 `issues[0].message` 를 그대로 오류 코드로 쓸 수 있다.
 * 필드 선언 순서 = 열 순서(A→B→C→D→E→F→G→H) — zod 가 이 순서로 이슈를 쌓으므로
 * 우선순위(A→B→C→E→F, 첫 실패만)가 issues[0] 을 고르는 것만으로 성립한다.
 */
export const SheetPlanRowSchema = z.object({
  planId: requiredText(),
  scheduledDate: scheduledDateField,
  channel: requiredText(),
  product: optionalText(),
  lang: langField,
  postTypeLabel: postTypeLabelField,
  topic: optionalText(),
  owner: optionalText(),
});

export type SheetPlanRow = z.infer<typeof SheetPlanRowSchema>;

// 실패 시 어느 열 탓인지 — 형태 검증이 실패할 수 있는 필드만 있다(D·G·H 는 없음).
const FIELD_COLUMN: Partial<Record<keyof SheetPlanRow, SheetRowColumn>> = {
  planId: "A",
  scheduledDate: "B",
  channel: "C",
  lang: "E",
  postTypeLabel: "F",
};

/**
 * 8칸으로 정규화된 cells 를 SheetPlanRowSchema 로 검증한다. 실패를 필드 우선순위
 * (A→B→C→E→F, 첫 실패만)로 접어 하나의 { error, column? } 로 돌려준다.
 */
export function parseSheetRow(
  cells: string[],
): { ok: true; row: SheetPlanRow } | { ok: false; error: SheetRowError; column?: SheetRowColumn } {
  const raw = {
    planId: cells[0] ?? "",
    scheduledDate: cells[1] ?? "",
    channel: cells[2] ?? "",
    product: cells[3] ?? "",
    lang: cells[4] ?? "",
    postTypeLabel: cells[5] ?? "",
    topic: cells[6] ?? "",
    owner: cells[7] ?? "",
  };

  const result = SheetPlanRowSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path[0] as keyof SheetPlanRow;
    return {
      ok: false,
      error: issue.message as SheetRowError,
      column: FIELD_COLUMN[field],
    };
  }
  return { ok: true, row: result.data };
}

/**
 * GET /api/plans 쿼리 검증 — docs/API_SPEC.md 「GET /api/plans?month=YYYY-MM」(FR-002 계약).
 */
export const MonthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
