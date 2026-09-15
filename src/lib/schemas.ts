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

/**
 * GET /api/rules/resolve 쿼리 검증 — docs/API_SPEC.md 「GET /api/rules/resolve」(FR-003 계약).
 * URLSearchParams 는 문자열만 주므로 channelId·productId 는 coerce 로 숫자화한다.
 * productId 는 선택값 — 라우트가 없으면 undefined 를 넣어 optional() 을 타게 한다.
 */
export const RulesResolveQuerySchema = z.object({
  channelId: z.coerce.number().int().positive(),
  lang: z.enum(["ko", "en"]),
  productId: z.coerce.number().int().positive().optional(),
});

/**
 * POST /api/contents/titles 요청·LLM 출력 검증 — docs/API_SPEC.md 136~140행(FR-004 계약).
 * `TitleRequest` 는 요청 본문(신뢰 경계), `LlmTitleItemSchema`·`LlmTitleCandidatesSchema` 는
 * LLM 이 낸 JSON 출력(마찬가지로 신뢰 경계) — 둘 다 이 zod 를 통과한 뒤에만 쓴다.
 */
export const TitleRequestSchema = z.object({
  productId: z.number().int().positive().nullable(),
  channelId: z.number().int().positive(),
  lang: z.enum(["ko", "en"]),
  postType: z.enum(["health_info", "activity_news", "comparison", "review"]),
  // 상한 500자 — 사람이 쓰는 주제 메모·타깃 서술로 넉넉한 값. 역할 검사가 없는 라우트라
  // 여기서 길이를 막지 않으면 매 호출 유료 Anthropic 호출(최대 20초+28초)의 입력이 무한정 커진다.
  topicMemo: z.string().trim().max(500),
  targetPersona: z.string().trim().max(500),
});

export type TitleRequest = z.infer<typeof TitleRequestSchema>;

// title/angle 상한 — 프롬프트 인젝션으로 시스템 프롬프트 전문(브랜드 규칙)이 그대로
// 반환되는 경로를 좁힌다. 실제 제목·앵글 길이에 맞춘 여유값이다.
export const LlmTitleItemSchema = z.object({
  title: z.string().trim().min(1).max(100),
  angle: z.string().trim().min(1).max(200),
});

export type LlmTitleItem = z.infer<typeof LlmTitleItemSchema>;

// 항상 3안 — API_SPEC.md 「TitleCandidates」의 items[3] 을 튜플로 강제한다.
export const LlmTitleCandidatesSchema = z.object({
  items: z.tuple([LlmTitleItemSchema, LlmTitleItemSchema, LlmTitleItemSchema]),
});

export type LlmTitleCandidates = z.infer<typeof LlmTitleCandidatesSchema>;

/**
 * POST /api/contents 요청·LLM 출력 검증 — FR-005 계약(_workspace/contract_fr-005-body-generation.md).
 * `title`·`angle` 상한은 `LlmTitleItemSchema`(100·200)보다 여유를 둔다 — 화면에서 사용자가
 * 3안 중 하나를 고르거나 직접 편집해 넘어올 수 있기 때문이다.
 */
export const CreateContentInputSchema = z.object({
  publishPlanId: z.number().int().positive().nullable(),
  productId: z.number().int().positive().nullable(),
  channelId: z.number().int().positive(),
  lang: z.enum(["ko", "en"]),
  postType: z.enum(["health_info", "activity_news", "comparison", "review"]),
  topicMemo: z.string().trim().max(500),
  targetPersona: z.string().trim().max(500),
  title: z.string().trim().min(1).max(200),
  angle: z.string().trim().min(1).max(300),
  titleCandidates: z.tuple([LlmTitleItemSchema, LlmTitleItemSchema, LlmTitleItemSchema]),
});

export type CreateContentInput = z.infer<typeof CreateContentInputSchema>;

// LLM 이 낸 본문 JSON 출력 — 신뢰 경계. 상한 12,000자는 TRD 의 본문 길이 가드레일.
export const LlmBodyDraftSchema = z.object({
  body: z.string().trim().min(1).max(12_000),
});

export type LlmBodyDraft = z.infer<typeof LlmBodyDraftSchema>;

/**
 * GET /api/contents 쿼리 검증 — FR-009 계약(run 20260915-1754-5568).
 * `mine` 은 쿼리 문자열 "true" 일 때만 라우트가 boolean 화해서 서비스 쪽에 넘긴다.
 */
export const ContentListQuerySchema = z.object({
  status: z.enum(["draft", "in_review", "approved", "rejected", "published"]).optional(),
  mine: z.literal("true").optional(),
});

export type ContentListQuery = z.infer<typeof ContentListQuerySchema>;

/**
 * POST /api/role 요청 검증 — 계약(run 20260916-0038-3305).
 */
export const SetRoleInputSchema = z.object({
  role: z.enum(["editor", "admin"]),
});

export type SetRoleInput = z.infer<typeof SetRoleInputSchema>;

/**
 * POST /api/contents/{id}/approve 요청 검증 — FR-010 계약(run 20260915-2042-728c).
 */
export const ApproveInputSchema = z.object({
  registerAsExample: z.boolean(),
});

export type ApproveInput = z.infer<typeof ApproveInputSchema>;

/**
 * POST /api/contents/{id}/reject 요청 검증 — FR-011 계약(run 20260915-2042-728c).
 */
export const RejectInputSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export type RejectInput = z.infer<typeof RejectInputSchema>;
