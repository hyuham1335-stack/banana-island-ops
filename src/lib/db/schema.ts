import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * 스키마 — docs/TRD.md §4 「테이블 매핑 (17개)」. 원본은 Miro ERD v7.
 * - id 는 bigserial(number), 시각은 timestamptz, 금액은 numeric(14,4) + currency char(3), 환율은 numeric(18,8).
 * - numeric 컬럼은 TS 에서 string 으로 온다 (Drizzle 기본). 소수 연산은 받는 쪽이 문자열을 처리한다.
 * - 환산 원화 컬럼은 없다 (ADR-005). publish_plans 에 상태 컬럼은 없다 (ADR-007).
 * - 선언 순서는 피참조 테이블이 먼저다.
 */

// ---- 공통 컬럼 ---------------------------------------------------------------

const id = () => bigserial("id", { mode: "number" }).primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const ref = (name: string) => bigint(name, { mode: "number" });
const money = (name: string) => numeric(name, { precision: 14, scale: 4 });
const fx = (name: string) => numeric(name, { precision: 18, scale: 8 });
const currency = () => char("currency", { length: 3 }).notNull();

// ---- enum --------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["admin", "editor", "viewer"]);
export const langEnum = pgEnum("lang", ["ko", "en"]);
export const distributionRouteEnum = pgEnum("distribution_route", ["kr_domestic", "us_export", "ph_local"]);
export const publishMethodEnum = pgEnum("publish_method", ["manual", "api"]);
export const trackingMethodEnum = pgEnum("tracking_method", [
  "utm_ga4",
  "nt_smartstore",
  "amazon_attribution",
  "redirect",
]);
export const channelKindEnum = pgEnum("channel_kind", ["sales", "content"]);
export const linkPolicyEnum = pgEnum("link_policy", ["inline", "bio", "none"]);
export const ruleScopeEnum = pgEnum("rule_scope", ["common", "country", "channel", "product"]);
export const ruleTypeEnum = pgEnum("rule_type", ["ban", "must", "tone", "format", "persona"]);
export const severityEnum = pgEnum("severity", ["block", "warn"]);
export const ruleStatusEnum = pgEnum("rule_status", ["draft", "active", "retired"]);
export const exampleReasonEnum = pgEnum("example_reason", ["admin_approval", "high_conversion", "repeated_edit"]);
export const postTypeEnum = pgEnum("post_type", ["health_info", "activity_news", "comparison", "review"]);
export const contentStatusEnum = pgEnum("content_status", ["draft", "in_review", "approved", "rejected", "published"]);
export const urlCheckEnum = pgEnum("url_check", ["ok", "unreachable", "skipped"]);
export const historyReasonEnum = pgEnum("history_reason", ["regenerate", "rejected_edit", "manual_edit", "submit"]);
// content_performance.source — TRD 미지정(Could, 스키마만). 추적 방식과 같은 값 집합을 쓴다.
export const performanceSourceEnum = pgEnum("performance_source", [
  "utm_ga4",
  "nt_smartstore",
  "amazon_attribution",
  "redirect",
]);
export const fxSourceEnum = pgEnum("fx_source", ["api", "manual"]);
export const costSheetStatusEnum = pgEnum("cost_sheet_status", ["draft", "confirmed"]);
export const costStageEnum = pgEnum("cost_stage", ["ph", "kr", "us"]);
export const costBasisEnum = pgEnum("cost_basis", ["per_unit", "per_batch"]);
export const calcKindEnum = pgEnum("calc_kind", ["actual", "simulation"]);
export const inputSourceEnum = pgEnum("input_source", ["csv", "manual", "sheet", "api"]);
export const importTargetEnum = pgEnum("import_target", [
  "ad_performance",
  "content_performance",
  "cost_items",
  "publish_plans",
]);

// ---- 뿌리 테이블 ---------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull(),
  createdAt: createdAt(),
});

export const products = pgTable("products", {
  id: id(),
  productCode: text("product_code").notNull().unique(),
  name: text("name").notNull(),
  weightG: integer("weight_g"),
  priceKrw: money("price_krw"), // 원화 정가 — 원본값이지 환산값이 아니다
  priceUsd: money("price_usd"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const salesChannels = pgTable("sales_channels", {
  id: id(),
  channelCode: text("channel_code").notNull().unique(),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  currency: currency(),
  lang: langEnum("lang").notNull(),
  distributionRoute: distributionRouteEnum("distribution_route").notNull(),
  feeRate: money("fee_rate"),
  publishMethod: publishMethodEnum("publish_method").notNull().default("manual"),
  trackingMethod: trackingMethodEnum("tracking_method"),
  kind: channelKindEnum("kind").notNull(), // ADR-011: 판매 채널과 발행 채널을 한 테이블에
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  linkPolicy: linkPolicyEnum("link_policy").notNull().default("inline"),
  writeUrl: text("write_url"),
  persona: text("persona"),
  tone: text("tone"),
  format: text("format"),
  createdAt: createdAt(),
});

export const importLogs = pgTable(
  "import_logs",
  {
    id: id(),
    executedBy: ref("executed_by").references(() => users.id),
    target: importTargetEnum("target").notNull(),
    inputSource: inputSourceEnum("input_source").notNull(),
    sourceRef: text("source_ref"),
    totalRows: integer("total_rows").notNull().default(0),
    okRows: integer("ok_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    errors: jsonb("errors"),
    createdAt: createdAt(),
  },
  (t) => [index("import_logs_target_created_idx").on(t.target, t.createdAt.desc())],
);

// ---- 브랜드 규칙 · 템플릿 ------------------------------------------------------

export const brandRules = pgTable(
  "brand_rules",
  {
    id: id(),
    scope: ruleScopeEnum("scope").notNull(),
    country: char("country", { length: 2 }),
    channelId: ref("channel_id").references(() => salesChannels.id),
    productId: ref("product_id").references(() => products.id),
    ruleType: ruleTypeEnum("rule_type").notNull(),
    lang: langEnum("lang").notNull(),
    content: text("content").notNull(),
    detectPattern: text("detect_pattern"),
    alternative: text("alternative"),
    reason: text("reason"),
    legalBasis: text("legal_basis"),
    severity: severityEnum("severity"),
    status: ruleStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    effectiveFrom: date("effective_from"),
    createdAt: createdAt(),
  },
  (t) => [index("brand_rules_status_scope_lang_idx").on(t.status, t.scope, t.lang)],
);

export const brandRuleHistory = pgTable("brand_rule_history", {
  id: id(),
  ruleId: ref("rule_id")
    .notNull()
    .references(() => brandRules.id),
  changedBy: ref("changed_by").references(() => users.id),
  changeType: text("change_type").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: id(),
    channelId: ref("channel_id").references(() => salesChannels.id),
    name: text("name").notNull(),
    lang: langEnum("lang").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("prompt_templates_channel_lang_active_idx").on(t.channelId, t.lang, t.isActive)],
);

// ---- 발행 계획 · 콘텐츠 --------------------------------------------------------

export const publishPlans = pgTable(
  "publish_plans",
  {
    id: id(),
    importId: ref("import_id").references(() => importLogs.id),
    sheetRowKey: text("sheet_row_key").notNull().unique(),
    scheduledDate: date("scheduled_date").notNull(),
    channelId: ref("channel_id")
      .notNull()
      .references(() => salesChannels.id),
    productId: ref("product_id").references(() => products.id),
    lang: langEnum("lang").notNull(),
    postType: postTypeEnum("post_type").notNull(),
    topicMemo: text("topic_memo").notNull().default(""),
    ownerId: ref("owner_id").references(() => users.id),
    onHold: boolean("on_hold").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("publish_plans_scheduled_date_idx").on(t.scheduledDate)],
);

export const contents = pgTable(
  "contents",
  {
    id: id(),
    publishPlanId: ref("publish_plan_id")
      .unique()
      .references(() => publishPlans.id),
    sourceContentId: ref("source_content_id").references((): AnyPgColumn => contents.id),
    productId: ref("product_id").references(() => products.id),
    channelId: ref("channel_id")
      .notNull()
      .references(() => salesChannels.id),
    templateId: ref("template_id").references(() => promptTemplates.id),
    authorId: ref("author_id").references(() => users.id),
    reviewerId: ref("reviewer_id").references(() => users.id),
    publisherId: ref("publisher_id").references(() => users.id),
    lang: langEnum("lang").notNull(),
    postType: postTypeEnum("post_type").notNull(),
    targetPersona: text("target_persona"),
    status: contentStatusEnum("status").notNull().default("draft"),
    title: text("title").notNull(),
    titleCandidates: jsonb("title_candidates"),
    body: text("body"),
    regenCount: integer("regen_count").notNull().default(0),
    ruleSnapshot: jsonb("rule_snapshot"),
    detectedTerms: jsonb("detected_terms"),
    sentPrompt: text("sent_prompt"),
    model: text("model"),
    rejectReason: text("reject_reason"),
    publishedUrl: text("published_url"),
    urlCheck: urlCheckEnum("url_check"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("contents_status_updated_idx").on(t.status, t.updatedAt.desc()),
    index("contents_author_idx").on(t.authorId),
  ],
);

export const contentHistory = pgTable(
  "content_history",
  {
    id: id(),
    contentId: ref("content_id")
      .notNull()
      .references(() => contents.id),
    versionNo: integer("version_no").notNull(),
    reason: historyReasonEnum("reason").notNull(),
    title: text("title"),
    body: text("body"),
    sentPrompt: text("sent_prompt"),
    detectedTerms: jsonb("detected_terms"),
    changedBy: ref("changed_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("content_history_content_version_idx").on(t.contentId, t.versionNo)],
);

export const brandExamples = pgTable(
  "brand_examples",
  {
    id: id(),
    contentId: ref("content_id").references(() => contents.id),
    channelId: ref("channel_id")
      .notNull()
      .references(() => salesChannels.id),
    lang: langEnum("lang").notNull(),
    summary: text("summary").notNull(), // 본문 앞 800자
    reason: exampleReasonEnum("reason").notNull(),
    evidence: jsonb("evidence"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("brand_examples_channel_lang_active_idx").on(t.channelId, t.lang, t.isActive)],
);

export const contentPerformance = pgTable(
  "content_performance",
  {
    id: id(),
    contentId: ref("content_id")
      .notNull()
      .references(() => contents.id),
    importId: ref("import_id").references(() => importLogs.id),
    source: performanceSourceEnum("source").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    clicks: integer("clicks").notNull().default(0),
    orders: integer("orders"),
    revenue: money("revenue"),
    currency: currency(),
    createdAt: createdAt(),
  },
  (t) => [unique("content_performance_uk").on(t.contentId, t.source, t.periodStart, t.periodEnd)],
);

// ---- 환율 · 원가 · 광고 --------------------------------------------------------

export const fxRates = pgTable(
  "fx_rates",
  {
    id: id(),
    rateDate: date("rate_date").notNull(),
    base: char("base", { length: 3 }).notNull(),
    quote: char("quote", { length: 3 }).notNull(),
    rate: fx("rate").notNull(),
    source: fxSourceEnum("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("fx_rates_uk").on(t.rateDate, t.base, t.quote)],
);

export const costSheets = pgTable(
  "cost_sheets",
  {
    id: id(),
    productId: ref("product_id")
      .notNull()
      .references(() => products.id),
    distributionRoute: distributionRouteEnum("distribution_route").notNull(),
    name: text("name").notNull(),
    effectiveFrom: date("effective_from"),
    status: costSheetStatusEnum("status").notNull().default("draft"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("cost_sheets_product_route_status_idx").on(t.productId, t.distributionRoute, t.status)],
);

export const costItems = pgTable("cost_items", {
  id: id(),
  costSheetId: ref("cost_sheet_id")
    .notNull()
    .references(() => costSheets.id),
  stage: costStageEnum("stage").notNull(),
  costKind: text("cost_kind").notNull(),
  amount: money("amount").notNull(),
  currency: currency(),
  basis: costBasisEnum("basis").notNull().default("per_unit"),
  batchQty: integer("batch_qty"),
  note: text("note"),
  createdAt: createdAt(),
});

// ADR-005 의 명시적 예외 — 결과 스냅샷은 적용 환율(fx_php · fx_usd)과 같은 행에 저장한다.
export const costCalcResults = pgTable("cost_calc_results", {
  id: id(),
  costSheetId: ref("cost_sheet_id")
    .notNull()
    .references(() => costSheets.id),
  channelId: ref("channel_id")
    .notNull()
    .references(() => salesChannels.id),
  fxPhp: fx("fx_php").notNull(),
  fxUsd: fx("fx_usd").notNull(),
  unitCostKrw: money("unit_cost_krw").notNull(),
  priceKrw: money("price_krw").notNull(),
  marginRate: money("margin_rate"),
  fixedCostKrw: money("fixed_cost_krw"),
  bepQty: integer("bep_qty"),
  kind: calcKindEnum("kind").notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
});

export const adPerformance = pgTable(
  "ad_performance",
  {
    id: id(),
    channelId: ref("channel_id")
      .notNull()
      .references(() => salesChannels.id),
    productId: ref("product_id").references(() => products.id),
    contentId: ref("content_id").references(() => contents.id),
    importId: ref("import_id").references(() => importLogs.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    spend: money("spend").notNull(),
    revenue: money("revenue"),
    orders: integer("orders"),
    currency: currency(),
    inputSource: inputSourceEnum("input_source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("ad_performance_uk").on(t.channelId, t.periodStart, t.periodEnd)],
);
