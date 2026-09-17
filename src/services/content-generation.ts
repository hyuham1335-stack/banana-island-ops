import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  brandExamples,
  contentHistory,
  contents,
  products,
  promptTemplates,
  publishPlans,
  salesChannels,
} from "@/lib/db/schema";
import { toContentDetail, type ContentDetail, type ContentsRow } from "@/lib/content-detail";
import type { ErrorCode } from "@/lib/http";
import type { LlmClient } from "@/lib/llm/client";
import { LlmTimeoutError } from "@/lib/llm/client";
import type { ResolvedRules } from "@/lib/rules-merge";
import {
  buildBodyInstructionRegenPrompt,
  buildBodyRegenPrompt,
  buildBodySystemPrompt,
  buildBodyUserPrompt,
  buildTitleRegenPrompt,
  buildTitlesSystemPrompt,
  buildTitlesUserPrompt,
  combineSentPrompt,
  renderPromptTemplate,
} from "@/lib/llm/prompts";
import {
  LlmBodyDraftSchema,
  LlmTitleCandidatesSchema,
  LlmTitleItemSchema,
  type CreateContentInput,
  type EditContentInput,
  type LlmTitleItem,
  type RegenerateInput,
  type TitleRequest,
} from "@/lib/schemas";
import { buildUtmLink } from "@/lib/utm";
import { validate, type ValidationResult } from "@/lib/validator";
import {
  bodyUnchangedGuard,
  resolveChannelFormat,
  resolveContentLink,
  statusAfterEdit,
  TRANSITIONS,
} from "@/services/content-workflow";
import { resolveRules } from "@/services/rules";

// 기존 소비자(src/app/api/contents/route.test.ts)가 ContentDetail 을 이 모듈 경로로도
// import 하므로, lib/content-detail.ts 로 옮긴 뒤에도 재노출해 하위 호환을 유지한다.
export type { ContentDetail } from "@/lib/content-detail";

/**
 * FR-004 제목+앵글 3안 생성 — docs/API_SPEC.md 136~140행, docs/TRD.md §3 FR-004.
 * 01_plan.md(run 20260914-2058-0053) §2.5 의 5단계·시간 예산 산식을 그대로 구현한다.
 * 저장 없음(contents 등 기존 스키마 변경 없음).
 *
 * FR-005 본문 생성 — _workspace/contract_fr-005-body-generation.md. createContentWithBody
 * 는 contents 행을 만들고(INSERT 또는 미완성 행 재시도 UPDATE) 본문을 생성·저장한다.
 */

// 서비스는 throw 하지 않는다 — rules.ts·plans.ts 와 같은 Result 패턴을 이 파일에서도 로컬로 쓴다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export interface TitleCandidates {
  items: LlmTitleItem[];
  regeneratedIdx: number[];
}

const INITIAL_TIMEOUT_MS = 20_000;
// 합산 재생성 예산 상한 — route 의 maxDuration=30_000ms 보다 2초 여유(01_plan.md §2.5).
export const TITLE_TOTAL_BUDGET_MS = 28_000;
// 이 미만 남으면 재생성 시도 안 함.
export const MIN_REGEN_BUDGET_MS = 3_000;
const REGEN_MAX_TIMEOUT_MS = 8_000;
const REGEN_SAFETY_MARGIN_MS = 1_000;

export async function generateTitles(
  deps: { db: Db; llm: LlmClient },
  input: TitleRequest,
): Promise<Result<TitleCandidates>> {
  // 경과시간 측정은 resolveRules 호출 전부터 시작한다 — DB 조회도 TITLE_TOTAL_BUDGET_MS 예산을
  // 갉아먹으므로, 1차 LLM 호출의 timeoutMs 계산에 그 시간이 반영돼야 한다.
  const startedAt = Date.now();

  // 1. 규칙 병합 조회 — 실패(NOT_FOUND 등)는 그대로 전파한다.
  const rulesResult = await resolveRules(
    { db: deps.db },
    { channelId: input.channelId, lang: input.lang, productId: input.productId ?? undefined },
  );
  if (!rulesResult.ok) {
    return { ok: false, error: rulesResult.error };
  }
  const rules = rulesResult.data;

  const system = buildTitlesSystemPrompt(rules);
  const user = buildTitlesUserPrompt(input);

  // 2. 1차 LLM 호출 — resolveRules 로 이미 소진된 시간을 뺀 나머지만 이 호출의 예산으로 쓴다.
  // 남은 예산이 없으면 호출 자체를 생략하고 타임아웃으로 즉시 반환한다.
  const remainingForInitial = TITLE_TOTAL_BUDGET_MS - (Date.now() - startedAt);
  if (remainingForInitial <= 0) {
    return { ok: false, error: { code: "LLM_TIMEOUT", message: "제목 생성이 시간 초과되었습니다." } };
  }

  let candidates: { items: LlmTitleItem[] };
  try {
    candidates = await deps.llm.generateJson(
      system,
      user,
      LlmTitleCandidatesSchema,
      Math.min(INITIAL_TIMEOUT_MS, remainingForInitial),
      "titles",
    );
  } catch (err) {
    if (err instanceof LlmTimeoutError) {
      return { ok: false, error: { code: "LLM_TIMEOUT", message: "제목 생성이 시간 초과되었습니다." } };
    }
    return { ok: false, error: { code: "LLM_FAILED", message: "제목 생성에 실패했습니다." } };
  }

  const items: LlmTitleItem[] = candidates.items.map((item) => ({ ...item }));
  const regeneratedIdx: number[] = [];
  let elapsedMs = Date.now() - startedAt;

  // 3. 차단 항목만 순서대로 순회하며 합산 예산 안에서 1회 재요청한다.
  for (let i = 0; i < items.length; i++) {
    const validation = validate(items[i].title, { must: rules.must, ban: rules.ban });
    if (validation.blocks.length === 0) continue;

    const remaining = TITLE_TOTAL_BUDGET_MS - elapsedMs;
    if (remaining < MIN_REGEN_BUDGET_MS) {
      // 예산 소진 — 재생성을 건너뛰고 원래(차단된) 값을 그대로 둔다.
      continue;
    }

    const regenTimeoutMs = Math.min(REGEN_MAX_TIMEOUT_MS, remaining - REGEN_SAFETY_MARGIN_MS);
    const regenPrompt = buildTitleRegenPrompt(items[i], validation.blocks[0]);

    const regenStartedAt = Date.now();
    try {
      const regenerated = await deps.llm.generateJson(
        system,
        regenPrompt,
        LlmTitleItemSchema,
        regenTimeoutMs,
        "titles_regenerate",
      );
      items[i] = regenerated;
      regeneratedIdx.push(i);
    } catch {
      // 재생성 호출 자체의 실패/타임아웃은 항목 단위로 흡수한다 — 원래 값 유지, 전체 요청은
      // 계속 성공으로 진행한다(4번의 LLM_FAILED/LLM_TIMEOUT 매핑은 2번의 실패에만 적용).
    } finally {
      elapsedMs += Date.now() - regenStartedAt;
    }
  }

  // 5. 성공 — 저장 없음.
  return { ok: true, data: { items, regeneratedIdx } };
}

// ---------------------------------------------------------------------------
// FR-005 본문 생성 — createContentWithBody
// ---------------------------------------------------------------------------

const INITIAL_BODY_TIMEOUT_MS = 45_000; // TRD 본문 타임아웃
// route 의 maxDuration(60_000ms) 보다 5초 외부 여유.
export const BODY_TOTAL_BUDGET_MS = 55_000;
// BODY_TOTAL_BUDGET_MS 안의 예약 — 최종 UPDATE·응답 조립용.
const FINAL_WRITE_RESERVE_MS = 3_000;
// 모든 remaining 계산의 기준(= 52_000).
const LLM_BUDGET_MS = BODY_TOTAL_BUDGET_MS - FINAL_WRITE_RESERVE_MS;
// 이 미만 남으면 자동 재생성을 시도하지 않는다.
export const MIN_BODY_REGEN_BUDGET_MS = 5_000;
const BODY_REGEN_MAX_TIMEOUT_MS = 45_000;
const BODY_REGEN_SAFETY_MARGIN_MS = 1_000;

// Neon HTTP 드라이버가 던지는 에러 객체의 code 필드로 unique_violation(23505) 을 식별한다
// (표준 Postgres 에러코드, 드라이버 비특정적).
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

const PLAN_ALREADY_LINKED_ERROR = {
  code: "INVALID_TRANSITION" as ErrorCode,
  message: "이미 콘텐츠가 연결된 발행 계획입니다.",
  details: { from: "plan_already_linked", action: "create" },
};

interface BodyDraftCtx {
  contentId: number;
  channelId: number;
  productId: number | null;
  lang: CreateContentInput["lang"];
  postType: CreateContentInput["postType"];
  topicMemo: string;
  targetPersona: string;
  title: string;
  angle: string;
  channel: { name: string; linkPolicy: "inline" | "bio" | "none" };
  product: { name: string } | null;
  link: string;
  rules: ResolvedRules;
  startedAt: number;
}

interface BodyDraftResult {
  finalBody: string;
  validation: ValidationResult;
  autoRegenerated: boolean;
  sentPrompt: string;
  ruleSnapshot: { ruleIds: number[]; version: string; exampleIds: number[] };
  templateId: number;
}

/**
 * createContentWithBody(FR-005 초안 생성)와 regenerateContentBody 의 title-분기(FR-007,
 * "다시 만들기"에서 제목을 새로 골라 본문까지 다시 만드는 경우)가 공유하는 본문 생성 로직 —
 * 템플릿 조회·렌더링 → 브랜드 예시 조회 → 프롬프트 조립 → 1차 LLM 호출(예산) → 하드룰 검증 →
 * 차단 시 1회 자동 재생성(FR-006) → sentPrompt 스냅샷. DB 저장(INSERT/UPDATE)은 호출부
 * 책임이다 — 두 호출부의 저장 방식·낙관적 잠금 조건이 다르기 때문이다.
 */
async function buildBodyDraft(
  deps: { db: Db; llm: LlmClient },
  ctx: BodyDraftCtx,
): Promise<Result<BodyDraftResult>> {
  const {
    contentId,
    channelId,
    productId,
    lang,
    postType,
    topicMemo,
    targetPersona,
    title,
    angle,
    channel,
    product,
    link,
    rules,
    startedAt,
  } = ctx;

  // 프롬프트 템플릿 조회 — channelId+lang 우선, 없으면 공통(channelId IS NULL)+lang.
  const specificTemplateQuery = deps.db
    .select({ id: promptTemplates.id, body: promptTemplates.body })
    .from(promptTemplates);
  specificTemplateQuery.where(
    and(eq(promptTemplates.channelId, channelId), eq(promptTemplates.lang, lang), eq(promptTemplates.isActive, true)),
  );
  specificTemplateQuery.orderBy(desc(promptTemplates.createdAt));
  specificTemplateQuery.limit(1);
  let templateRows = await specificTemplateQuery;
  let template = templateRows[0];

  if (!template) {
    const commonTemplateQuery = deps.db
      .select({ id: promptTemplates.id, body: promptTemplates.body })
      .from(promptTemplates);
    commonTemplateQuery.where(
      and(isNull(promptTemplates.channelId), eq(promptTemplates.lang, lang), eq(promptTemplates.isActive, true)),
    );
    commonTemplateQuery.orderBy(desc(promptTemplates.createdAt));
    commonTemplateQuery.limit(1);
    templateRows = await commonTemplateQuery;
    template = templateRows[0];
  }

  if (!template) {
    console.error(JSON.stringify({ event: "prompt_template_not_found", channelId, lang }));
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "프롬프트 템플릿을 찾을 수 없습니다.",
        details: { resource: "prompt_template", id: 0 },
      },
    };
  }

  // 템플릿 렌더링.
  const renderedTemplate = renderPromptTemplate(template.body, {
    productName: product?.name ?? "브랜드 소식",
    channelName: channel.name,
    targetPersona,
    link: channel.linkPolicy === "none" ? "" : link,
  });

  // 브랜드 예시.
  const examplesQuery = deps.db
    .select({ id: brandExamples.id, summary: brandExamples.summary })
    .from(brandExamples);
  examplesQuery.where(
    and(eq(brandExamples.channelId, channelId), eq(brandExamples.lang, lang), eq(brandExamples.isActive, true)),
  );
  examplesQuery.orderBy(desc(brandExamples.createdAt));
  examplesQuery.limit(3);
  const examples = await examplesQuery;

  // 프롬프트 조립.
  const system = buildBodySystemPrompt(rules, examples.map((e) => ({ summary: e.summary })));
  const user = buildBodyUserPrompt(renderedTemplate, { productId, channelId, lang, postType, topicMemo, title, angle });

  // 1차 LLM 호출 예산.
  const remainingForInitial = LLM_BUDGET_MS - (Date.now() - startedAt);
  if (remainingForInitial <= 0) {
    return {
      ok: false,
      error: { code: "LLM_TIMEOUT", message: "본문 생성이 시간 초과되었습니다.", details: { contentId } },
    };
  }

  // 1차 LLM 호출.
  let draft: { body: string };
  try {
    draft = await deps.llm.generateJson(
      system,
      user,
      LlmBodyDraftSchema,
      Math.min(INITIAL_BODY_TIMEOUT_MS, remainingForInitial),
      "body",
    );
  } catch (err) {
    if (err instanceof LlmTimeoutError) {
      return {
        ok: false,
        error: { code: "LLM_TIMEOUT", message: "본문 생성이 시간 초과되었습니다.", details: { contentId } },
      };
    }
    return {
      ok: false,
      error: { code: "LLM_FAILED", message: "본문 생성에 실패했습니다.", details: { contentId, attempt: 1 } },
    };
  }

  // 하드 룰 검증.
  let validation = validate(draft.body, { must: rules.must, ban: rules.ban });
  let finalBody = draft.body;
  let finalUser = user;
  let autoRegenerated = false;

  // 차단 항목이 있으면 예산이 허락하는 한 1회 재생성.
  if (validation.blocks.length > 0) {
    const elapsedMs = Date.now() - startedAt;
    const remaining = LLM_BUDGET_MS - elapsedMs;
    if (remaining >= MIN_BODY_REGEN_BUDGET_MS) {
      const regenTimeoutMs = Math.min(BODY_REGEN_MAX_TIMEOUT_MS, remaining - BODY_REGEN_SAFETY_MARGIN_MS);
      const regenUser = buildBodyRegenPrompt(finalBody, validation.blocks);
      try {
        const regenerated = await deps.llm.generateJson(
          system,
          regenUser,
          LlmBodyDraftSchema,
          regenTimeoutMs,
          "body_regenerate",
        );
        finalBody = regenerated.body;
        finalUser = regenUser;
        autoRegenerated = true;
        validation = validate(finalBody, { must: rules.must, ban: rules.ban });
      } catch {
        // 재생성 실패는 항목 단위로 흡수한다 — 원래 finalBody·validation 유지,
        // 전체 요청은 계속 성공으로 진행한다.
      }
    }
  }

  // 전송 프롬프트 원문 스냅샷.
  const sentPrompt = combineSentPrompt(system, finalUser);
  const ruleSnapshot = {
    ruleIds: rules.appliedRuleIds,
    version: rules.version,
    exampleIds: examples.map((e) => e.id),
  };

  return {
    ok: true,
    data: { finalBody, validation, autoRegenerated, sentPrompt, ruleSnapshot, templateId: template.id },
  };
}

export async function createContentWithBody(
  deps: { db: Db; llm: LlmClient; productBaseUrl: string; model: string },
  input: CreateContentInput,
): Promise<Result<ContentDetail>> {
  const startedAt = Date.now();

  try {
    // 2. publishPlanId 가 있으면 LEFT JOIN 으로 plan·연결된 contents 행을 한 쿼리로 확인.
    let existingId: number | null = null;
    let isRetry = false;

    if (input.publishPlanId !== null) {
      const planQuery = deps.db
        .select({ planId: publishPlans.id, contentId: contents.id, contentBody: contents.body })
        .from(publishPlans);
      planQuery.leftJoin(contents, eq(contents.publishPlanId, publishPlans.id));
      planQuery.where(eq(publishPlans.id, input.publishPlanId));
      const planRows = await planQuery;
      const planRow = planRows[0];

      if (!planRow) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "발행 계획을 찾을 수 없습니다.",
            details: { resource: "plan", id: input.publishPlanId },
          },
        };
      }

      if (planRow.contentId !== null) {
        if (planRow.contentBody !== null) {
          return { ok: false, error: PLAN_ALREADY_LINKED_ERROR };
        }
        isRetry = true;
        existingId = planRow.contentId;
      }
    }

    // 3. 채널 조회.
    const channelQuery = deps.db
      .select({
        id: salesChannels.id,
        name: salesChannels.name,
        country: salesChannels.country,
        utmSource: salesChannels.utmSource,
        utmMedium: salesChannels.utmMedium,
        linkPolicy: salesChannels.linkPolicy,
      })
      .from(salesChannels);
    channelQuery.where(eq(salesChannels.id, input.channelId));
    const channelRows = await channelQuery;
    const channel = channelRows[0];
    if (!channel) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "채널을 찾을 수 없습니다.",
          details: { resource: "channel", id: input.channelId },
        },
      };
    }

    // 4. productId 있으면 제품 조회.
    let product: { productCode: string; name: string } | null = null;
    if (input.productId !== null) {
      const productQuery = deps.db.select({ productCode: products.productCode, name: products.name }).from(products);
      productQuery.where(eq(products.id, input.productId));
      const productRows = await productQuery;
      const found = productRows[0];
      if (!found) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "제품을 찾을 수 없습니다.",
            details: { resource: "product", id: input.productId },
          },
        };
      }
      product = found;
    }

    // 5. 규칙 병합 조회.
    const rulesResult = await resolveRules(
      { db: deps.db },
      { channelId: input.channelId, lang: input.lang, productId: input.productId ?? undefined },
    );
    if (!rulesResult.ok) {
      return { ok: false, error: rulesResult.error };
    }
    const rules = rulesResult.data;

    // 6/7. 신규 INSERT 또는 미완성 행 재시도 UPDATE.
    let contentId: number;
    let createdAtVal: Date;

    if (isRetry && existingId !== null) {
      const updatedRows = await deps.db
        .update(contents)
        .set({
          productId: input.productId,
          channelId: input.channelId,
          lang: input.lang,
          postType: input.postType,
          targetPersona: input.targetPersona,
          title: input.title,
          titleCandidates: input.titleCandidates,
        })
        .where(and(eq(contents.id, existingId), isNull(contents.body)))
        .returning({
          id: contents.id,
          createdAt: contents.createdAt,
        });
      const row = updatedRows[0];
      if (!row) {
        // 그 사이 다른 요청이 먼저 채웠다.
        return { ok: false, error: PLAN_ALREADY_LINKED_ERROR };
      }
      contentId = row.id;
      createdAtVal = row.createdAt;
    } else {
      try {
        const insertQuery = deps.db
          .insert(contents)
          .values({
            publishPlanId: input.publishPlanId,
            productId: input.productId,
            channelId: input.channelId,
            lang: input.lang,
            postType: input.postType,
            targetPersona: input.targetPersona,
            status: "draft",
            title: input.title,
            titleCandidates: input.titleCandidates,
          })
          .returning({ id: contents.id, createdAt: contents.createdAt });
        const insertedRows = await insertQuery;
        const row = insertedRows[0];
        contentId = row.id;
        createdAtVal = row.createdAt;
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { ok: false, error: PLAN_ALREADY_LINKED_ERROR };
        }
        throw err;
      }
    }

    // 8. 발행 링크.
    const link = buildUtmLink({
      baseUrl: deps.productBaseUrl,
      productCode: product?.productCode ?? null,
      utmSource: channel.utmSource,
      utmMedium: channel.utmMedium,
      contentId,
    });

    // 9~18. 템플릿 조회·렌더링 → 브랜드 예시 조회 → 프롬프트 조립 → 1차 LLM 호출(예산) →
    // 하드룰 검증 → 차단 시 1회 자동 재생성(FR-006) → sentPrompt 스냅샷 — buildBodyDraft 로
    // 위임한다(regenerateContentBody 의 title-분기와 공유).
    const draftResult = await buildBodyDraft(deps, {
      contentId,
      channelId: input.channelId,
      productId: input.productId,
      lang: input.lang,
      postType: input.postType,
      topicMemo: input.topicMemo,
      targetPersona: input.targetPersona,
      title: input.title,
      angle: input.angle,
      channel: { name: channel.name, linkPolicy: channel.linkPolicy },
      product: product ? { name: product.name } : null,
      link,
      rules,
      startedAt,
    });
    if (!draftResult.ok) return draftResult;
    const { finalBody, validation, autoRegenerated, sentPrompt, ruleSnapshot, templateId } = draftResult.data;

    // 19. 최종 UPDATE — 동시 재시도 경합의 유일한 직렬화 지점.
    const regenCount = autoRegenerated ? 1 : 0;

    const finalUpdatedRows = await deps.db
      .update(contents)
      .set({
        body: finalBody,
        templateId,
        sentPrompt,
        model: deps.model,
        ruleSnapshot,
        detectedTerms: validation,
        regenCount,
        updatedAt: sql`now()`,
      })
      .where(and(eq(contents.id, contentId), isNull(contents.body)))
      .returning({ updatedAt: contents.updatedAt });

    let resultBody = finalBody;
    let resultRegenCount = regenCount;
    let resultValidation: ValidationResult = validation;
    let resultRuleSnapshot = ruleSnapshot;
    let resultSentPrompt = sentPrompt;
    let resultModel = deps.model;
    let resultUpdatedAt: Date;
    let resultSourceContentId: number | null = null;
    let resultAutoRegenerated = autoRegenerated;

    if (finalUpdatedRows[0]) {
      resultUpdatedAt = finalUpdatedRows[0].updatedAt;
    } else {
      // 0행 — 늦게 도착한 요청. 덮어쓰지 않고 다시 읽어 그 데이터로 성공 응답을 조립한다
      // (멱등 성공 — 늦게 도착한 요청의 LLM 호출 낭비를 사용자에게 노출하지 않는다).
      const reSelectQuery = deps.db
        .select({
          body: contents.body,
          regenCount: contents.regenCount,
          detectedTerms: contents.detectedTerms,
          ruleSnapshot: contents.ruleSnapshot,
          sentPrompt: contents.sentPrompt,
          model: contents.model,
          updatedAt: contents.updatedAt,
          sourceContentId: contents.sourceContentId,
        })
        .from(contents);
      reSelectQuery.where(eq(contents.id, contentId));
      const reRows = await reSelectQuery;
      const reRow = reRows[0];

      resultBody = reRow?.body ?? finalBody;
      resultRegenCount = reRow?.regenCount ?? regenCount;
      resultValidation = (reRow?.detectedTerms as ValidationResult | null) ?? validation;
      resultRuleSnapshot =
        (reRow?.ruleSnapshot as { ruleIds: number[]; version: string; exampleIds: number[] } | null) ??
        ruleSnapshot;
      resultSentPrompt = reRow?.sentPrompt ?? sentPrompt;
      resultModel = reRow?.model ?? deps.model;
      resultUpdatedAt = reRow?.updatedAt ?? new Date();
      resultSourceContentId = reRow?.sourceContentId ?? null;
      resultAutoRegenerated = resultRegenCount > 0;
    }

    // 20. 응답 조립 — contents 전체 컬럼을 채운 row 를 만든 뒤 toContentDetail 로 위임한다.
    const row: ContentsRow = {
      id: contentId,
      publishPlanId: input.publishPlanId,
      sourceContentId: resultSourceContentId,
      productId: input.productId,
      channelId: input.channelId,
      templateId,
      authorId: null,
      reviewerId: null,
      publisherId: null,
      lang: input.lang,
      postType: input.postType,
      targetPersona: input.targetPersona,
      status: "draft",
      title: input.title,
      titleCandidates: input.titleCandidates,
      body: resultBody,
      regenCount: resultRegenCount,
      ruleSnapshot: resultRuleSnapshot,
      detectedTerms: resultValidation,
      sentPrompt: resultSentPrompt,
      model: resultModel,
      rejectReason: null,
      publishedUrl: null,
      urlCheck: null,
      submittedAt: null,
      reviewedAt: null,
      publishedAt: null,
      updatedAt: resultUpdatedAt,
      createdAt: createdAtVal,
    };

    const data: ContentDetail = toContentDetail(row, {
      validation: resultValidation,
      link,
      isExample: false,
      historyCount: 0,
      autoRegenerated: resultAutoRegenerated,
      // FR-012: 이 경로는 방금 생성된 draft 콘텐츠 전용이라 status 가 항상 draft 다 —
      // channelFormat 은 approved 상태에서만 계산된다(content-workflow.ts::getContentDetail
      // 과 같은 규칙).
      channelFormat: null,
    });

    return { ok: true, data };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "content_body_generation_failed",
        publishPlanId: input.publishPlanId,
        channelId: input.channelId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "본문 생성 중 오류가 발생했습니다." } };
  }
}

// ---------------------------------------------------------------------------
// FR-007 재생성(지시문 포함) — regenerateContentBody
// ---------------------------------------------------------------------------

/**
 * FR-007 지시문 기반 재생성 — 계약(_workspace/runs/20260916-1614-ad59/01_plan.md).
 * draft/rejected 상태의 콘텐츠 본문을 사용자 지시문(선택) 기반으로 다시 생성한다.
 * BODY_TOTAL_BUDGET_MS 등 시간 예산 상수는 createContentWithBody 와 공유한다(라우트
 * 예산이 둘 다 60초로 같다).
 *
 * 저장 순서(ADR-002, 반드시 이 순서): 낙관적 잠금 UPDATE(status·regenCount 둘 다 토큰)를
 * 먼저 실행하고, 그것이 성공한 뒤에만 content_history 에 UPDATE 전 값을 insert한다.
 * UPDATE 가 0행이면 이력을 쓰지 않고 INVALID_TRANSITION 을 반환한다 — 완전한 미변경 보장.
 */
export async function regenerateContentBody(
  deps: { db: Db; llm: LlmClient; model: string; productBaseUrl: string },
  contentId: number,
  input: RegenerateInput,
): Promise<Result<ContentDetail>> {
  const startedAt = Date.now();

  try {
    const selectQuery = deps.db.select().from(contents);
    selectQuery.where(eq(contents.id, contentId));
    const rows = await selectQuery;
    const row = rows[0];

    if (!row) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "콘텐츠를 찾을 수 없습니다.",
          details: { resource: "content", id: contentId },
        },
      };
    }

    if (!TRANSITIONS.submit.from.includes(row.status)) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "현재 상태에서는 다시 만들 수 없습니다.",
          details: { from: row.status },
        },
      };
    }

    // 규칙 병합 조회 — 실패는 그대로 전파한다.
    const rulesResult = await resolveRules(
      { db: deps.db },
      { channelId: row.channelId, lang: row.lang, productId: row.productId ?? undefined },
    );
    if (!rulesResult.ok) {
      return { ok: false, error: rulesResult.error };
    }
    const rules = rulesResult.data;

    // title-분기(다시 만들기에서 제목을 새로 골라 본문까지 다시 만드는 경우) — 지시문 경로
    // 대신 createContentWithBody 의 초안 생성과 같은 제목·앵글 기반 프롬프트로 본문을 새로
    // 만든다. RegenerateInputSchema 의 refine 이 title·angle·titleCandidates 를 항상 함께
    // 오도록 강제하므로 여기서는 title 유무만 본다.
    if (input.title !== undefined && input.angle !== undefined && input.titleCandidates !== undefined) {
      const channelQuery = deps.db
        .select({ name: salesChannels.name, linkPolicy: salesChannels.linkPolicy })
        .from(salesChannels);
      channelQuery.where(eq(salesChannels.id, row.channelId));
      const channelRows = await channelQuery;
      const channel = channelRows[0];
      if (!channel) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "채널을 찾을 수 없습니다.",
            details: { resource: "channel", id: row.channelId },
          },
        };
      }

      let product: { name: string } | null = null;
      if (row.productId !== null) {
        const productQuery = deps.db.select({ name: products.name }).from(products);
        productQuery.where(eq(products.id, row.productId));
        const productRows = await productQuery;
        const found = productRows[0];
        if (!found) {
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "제품을 찾을 수 없습니다.",
              details: { resource: "product", id: row.productId },
            },
          };
        }
        product = found;
      }

      // resolveContentLink 를 UPDATE 보다 먼저 호출하는 이유는 아래 지시문 경로와 같다
      // (832행 주석 참고).
      const link = await resolveContentLink(deps, row);

      const draftResult = await buildBodyDraft(deps, {
        contentId,
        channelId: row.channelId,
        productId: row.productId,
        lang: row.lang,
        postType: row.postType,
        // 콘텐츠 행에는 topicMemo 가 저장되지 않는다(계획의 topic_memo 와 별개) — 다시
        // 만들기 화면에서 이 값을 다시 물어보지 않으므로 빈 문자열로 둔다.
        topicMemo: "",
        targetPersona: row.targetPersona ?? "",
        title: input.title,
        angle: input.angle,
        channel,
        product,
        link,
        rules,
        startedAt,
      });
      if (!draftResult.ok) return draftResult;
      const { finalBody, validation, autoRegenerated, sentPrompt, ruleSnapshot, templateId } = draftResult.data;

      const lockedUpdateRows = await deps.db
        .update(contents)
        .set({
          title: input.title,
          titleCandidates: input.titleCandidates,
          templateId,
          body: finalBody,
          sentPrompt,
          model: deps.model,
          ruleSnapshot,
          detectedTerms: validation,
          regenCount: sql`${contents.regenCount} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(contents.id, contentId),
            eq(contents.status, row.status),
            eq(contents.regenCount, row.regenCount),
            bodyUnchangedGuard(row.body),
          ),
        )
        .returning({ updatedAt: contents.updatedAt, regenCount: contents.regenCount });

      const updated = lockedUpdateRows[0];
      if (!updated) {
        return {
          ok: false,
          error: {
            code: "INVALID_TRANSITION",
            message: "다른 요청이 먼저 이 콘텐츠를 변경했습니다.",
            details: { from: row.status },
          },
        };
      }

      const historyInsertRows = await deps.db
        .insert(contentHistory)
        .values({
          contentId,
          versionNo: sql<number>`(select coalesce(max(version_no), 0) + 1 from content_history where content_id = ${contentId})`,
          reason: "regenerate",
          title: row.title,
          body: row.body,
          sentPrompt: row.sentPrompt,
          detectedTerms: row.detectedTerms,
          changedBy: null,
        })
        .returning({ versionNo: contentHistory.versionNo });
      const historyCount = historyInsertRows[0]?.versionNo ?? 0;

      const updatedRow: ContentsRow = {
        ...row,
        title: input.title,
        titleCandidates: input.titleCandidates,
        templateId,
        body: finalBody,
        sentPrompt,
        model: deps.model,
        ruleSnapshot,
        detectedTerms: validation,
        regenCount: updated.regenCount,
        updatedAt: updated.updatedAt,
      };

      const data = toContentDetail(updatedRow, {
        validation,
        link,
        isExample: false,
        historyCount,
        autoRegenerated,
        channelFormat: null,
      });

      return { ok: true, data };
    }

    // 활성 브랜드 예시 최대 3개 — createContentWithBody 와 같은 조건.
    const examplesQuery = deps.db
      .select({ id: brandExamples.id, summary: brandExamples.summary })
      .from(brandExamples);
    examplesQuery.where(
      and(
        eq(brandExamples.channelId, row.channelId),
        eq(brandExamples.lang, row.lang),
        eq(brandExamples.isActive, true),
      ),
    );
    examplesQuery.orderBy(desc(brandExamples.createdAt));
    examplesQuery.limit(3);
    const examples = await examplesQuery;

    const system = buildBodySystemPrompt(rules, examples.map((e) => ({ summary: e.summary })));
    const user = buildBodyInstructionRegenPrompt(row.body ?? "", input.instruction);

    // 1차 LLM 호출 예산.
    const remainingForInitial = LLM_BUDGET_MS - (Date.now() - startedAt);
    if (remainingForInitial <= 0) {
      return {
        ok: false,
        error: { code: "LLM_TIMEOUT", message: "본문 재생성이 시간 초과되었습니다.", details: { contentId } },
      };
    }

    // 1차 LLM 호출 — 실패/타임아웃은 DB 에 아무것도 쓰지 않고 그대로 반환한다(이전 본문 유지).
    let draft: { body: string };
    try {
      draft = await deps.llm.generateJson(
        system,
        user,
        LlmBodyDraftSchema,
        Math.min(INITIAL_BODY_TIMEOUT_MS, remainingForInitial),
        "body_regenerate_instruction",
      );
    } catch (err) {
      if (err instanceof LlmTimeoutError) {
        return {
          ok: false,
          error: { code: "LLM_TIMEOUT", message: "본문 재생성이 시간 초과되었습니다.", details: { contentId } },
        };
      }
      return {
        ok: false,
        error: { code: "LLM_FAILED", message: "본문 재생성에 실패했습니다.", details: { contentId } },
      };
    }

    // 하드 룰 검증 + FR-006 자동 재생성 1회(위반 목록 기반 buildBodyRegenPrompt 재사용 —
    // 지시문 기반 프롬프트가 아니다). 재시도 자체의 실패/타임아웃은 흡수한다.
    let validation = validate(draft.body, { must: rules.must, ban: rules.ban });
    let finalBody = draft.body;
    let finalUser = user;
    let autoRegenerated = false;

    if (validation.blocks.length > 0) {
      const elapsedMs = Date.now() - startedAt;
      const remaining = LLM_BUDGET_MS - elapsedMs;
      if (remaining >= MIN_BODY_REGEN_BUDGET_MS) {
        const regenTimeoutMs = Math.min(BODY_REGEN_MAX_TIMEOUT_MS, remaining - BODY_REGEN_SAFETY_MARGIN_MS);
        const regenUser = buildBodyRegenPrompt(finalBody, validation.blocks);
        try {
          const regenerated = await deps.llm.generateJson(
            system,
            regenUser,
            LlmBodyDraftSchema,
            regenTimeoutMs,
            "body_regenerate_auto",
          );
          finalBody = regenerated.body;
          finalUser = regenUser;
          autoRegenerated = true;
          validation = validate(finalBody, { must: rules.must, ban: rules.ban });
        } catch {
          // 재생성 실패는 흡수한다 — 원래 finalBody·validation 유지, 요청은 계속 성공.
        }
      }
    }

    const sentPrompt = combineSentPrompt(system, finalUser);
    const exampleIds = examples.map((e) => e.id);
    const ruleSnapshot = { ruleIds: rules.appliedRuleIds, version: rules.version, exampleIds };

    // resolveContentLink 는 UPDATE 전 row(id·channelId·productId)만 참조하므로 UPDATE 보다
    // 먼저 호출한다(05 code-review 수리 F-1 CONTRACT_MISMATCH/TX_BOUNDARY) — UPDATE·이력
    // INSERT 가 둘 다 성공한 뒤에 호출하면, 이 호출이 던질 때 이미 커밋된 쓰기가 있는데도
    // INTERNAL 을 반환해 "이전 본문 유지" 보장이 깨진다.
    const link = await resolveContentLink(deps, row);

    // 낙관적 잠금 UPDATE — status·regenCount 둘 다 토큰(계약: status 만으로는 동시 요청을
    // 못 막는다). 0행이면 이력을 쓰지 않고 즉시 반환한다.
    const lockedUpdateRows = await deps.db
      .update(contents)
      .set({
        body: finalBody,
        sentPrompt,
        model: deps.model,
        ruleSnapshot,
        detectedTerms: validation,
        regenCount: sql`${contents.regenCount} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(contents.id, contentId),
          eq(contents.status, row.status),
          eq(contents.regenCount, row.regenCount),
          bodyUnchangedGuard(row.body),
        ),
      )
      .returning({ updatedAt: contents.updatedAt, regenCount: contents.regenCount });

    const updated = lockedUpdateRows[0];
    if (!updated) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "다른 요청이 먼저 이 콘텐츠를 변경했습니다.",
          details: { from: row.status },
        },
      };
    }

    // UPDATE 성공 확인 뒤에만 이력을 쓴다 — UPDATE 전 값(row.*)을 저장한다. versionNo 는
    // TOCTOU 방지를 위해 INSERT 문 안의 서브쿼리로 계산한다(별도 SELECT count(*) 아님).
    const historyInsertRows = await deps.db
      .insert(contentHistory)
      .values({
        contentId,
        versionNo: sql<number>`(select coalesce(max(version_no), 0) + 1 from content_history where content_id = ${contentId})`,
        reason: "regenerate",
        title: row.title,
        body: row.body,
        sentPrompt: row.sentPrompt,
        detectedTerms: row.detectedTerms,
        changedBy: null,
      })
      .returning({ versionNo: contentHistory.versionNo });
    const historyCount = historyInsertRows[0]?.versionNo ?? 0;

    const updatedRow: ContentsRow = {
      ...row,
      body: finalBody,
      sentPrompt,
      model: deps.model,
      ruleSnapshot,
      detectedTerms: validation,
      regenCount: updated.regenCount,
      updatedAt: updated.updatedAt,
    };

    // channelFormat 은 항상 null — 재생성은 draft/rejected 에서만 허용되고 channelFormat 은
    // approved 상태에서만 계산되는 기존 규칙 그대로다.
    const data = toContentDetail(updatedRow, {
      validation,
      link,
      isExample: false,
      historyCount,
      autoRegenerated,
      channelFormat: null,
    });

    return { ok: true, data };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "content_regenerate_failed",
        contentId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "본문 재생성 중 오류가 발생했습니다." } };
  }
}

// ---------------------------------------------------------------------------
// FR-008 제목·본문 직접 편집 — editContent
// ---------------------------------------------------------------------------

/**
 * FR-008 직접 편집 — 계약(_workspace/contract_fr-008-direct-edit.md) 「유닛 · editContent」.
 * 외부 호출 없음(LLM 재시도는 하지 않는다) — 사람이 직접 쓴 값을 검증만 하고 그대로
 * 저장한다. 낙관적 잠금 UPDATE(status·title·bodyUnchangedGuard 셋 다 토큰)가 성공한
 * 뒤에만 content_history 에 UPDATE 전 값을 insert한다(ADR-002, regenerateContentBody 와
 * 같은 순서).
 */
export async function editContent(
  deps: { db: Db; productBaseUrl: string },
  contentId: number,
  input: EditContentInput,
): Promise<Result<ContentDetail>> {
  try {
    const selectQuery = deps.db.select().from(contents);
    selectQuery.where(eq(contents.id, contentId));
    const rows = await selectQuery;
    const row = rows[0];

    if (!row) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "콘텐츠를 찾을 수 없습니다.",
          details: { resource: "content", id: contentId },
        },
      };
    }

    if (row.status === "published") {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "현재 상태에서는 편집할 수 없습니다.",
          details: { from: row.status },
        },
      };
    }

    if (row.body === null) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "현재 상태에서는 편집할 수 없습니다.",
          details: { from: row.status },
        },
      };
    }

    const nextTitle = input.title ?? row.title;
    const nextBody = input.body ?? row.body;
    const nextStatus = statusAfterEdit(row.status);

    const rulesResult = await resolveRules(
      { db: deps.db },
      { channelId: row.channelId, lang: row.lang, productId: row.productId ?? undefined },
    );
    if (!rulesResult.ok) {
      return { ok: false, error: rulesResult.error };
    }
    const rules = rulesResult.data;

    const validation = validate(nextBody, { must: rules.must, ban: rules.ban });

    // resolveContentLink·resolveChannelFormat 은 UPDATE 보다 먼저 호출한다(05 code-review
    // data round 2 CONTRACT_DEFECT 수리 — regenerateContentBody 의 F-1 TX_BOUNDARY 수리와
    // 같은 패턴). UPDATE·이력 INSERT 가 둘 다 성공한 뒤에 호출하면, 이 호출이 던질 때
    // 이미 커밋된 쓰기가 있는데도 INTERNAL 을 반환해 "실패하면 아무것도 안 바뀐다"는
    // 보장이 깨진다. resolveContentLink 는 row(channelId/productId, 편집으로 안 바뀜)
    // 그대로 넘긴다. resolveChannelFormat 은 nextStatus 가 approved 일 때만 계산하고,
    // body 는 편집 후 값(nextBody)을 반영한 임시 객체로 넘긴다(link 는 이미 계산된 값을
    // 그대로 재사용 — 재계산하지 않는다).
    const link = await resolveContentLink(deps, row);
    const channelFormat =
      nextStatus === "approved" ? await resolveChannelFormat(deps, { ...row, body: nextBody }, link) : null;

    // 낙관적 잠금 UPDATE — WHERE 의 status 는 row.status(전이 전 조건), SET 의 status 는
    // nextStatus(전이 결과). title 가드는 "title-only 편집"과 "body-only 편집"이 거의
    // 동시에 들어올 때 서로의 변경을 지우는 lost-update 를 막기 위한 것이다(body 만
    // 가드하면 이 교차 경합을 못 막는다). regenCount 가드는 05 code-review major 수리(data)
    // — editContent 는 regenCount 를 SET 하지 않지만(값은 그대로 두지만) WHERE 에는
    // 넣는다. 이게 없으면 editContent(title 만 가드, body 안 건드림)와
    // regenerateContentBody(regenCount 만 가드, title 안 건드림)가 서로 다른 축을 봐서
    // 같은 draft 행에 동시에 성공할 수 있고, 그러면 두 content_history INSERT 의
    // version_no MAX+1 서브쿼리가 경합해 같은 version_no 가 중복 삽입될 위험이 있다
    // (content_history 는 (content_id, version_no) 유니크 제약이 없다). regenCount 를
    // 공통 가드 축으로 추가하면 editContent·regenerateContentBody·transition()::submit
    // 셋 다 서로의 body/regenCount 변경을 감지하게 되어 이 경합이 막힌다.
    const lockedUpdateRows = await deps.db
      .update(contents)
      .set({
        title: nextTitle,
        body: nextBody,
        status: nextStatus,
        detectedTerms: validation,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(contents.id, contentId),
          eq(contents.status, row.status),
          eq(contents.title, row.title),
          eq(contents.regenCount, row.regenCount),
          bodyUnchangedGuard(row.body),
        ),
      )
      .returning({ updatedAt: contents.updatedAt });

    const updated = lockedUpdateRows[0];
    if (!updated) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "다른 요청이 먼저 이 콘텐츠를 변경했습니다.",
          details: { from: row.status },
        },
      };
    }

    // UPDATE 성공 확인 뒤에만 이력을 쓴다 — UPDATE 전 값(row.*)을 저장한다. versionNo 는
    // TOCTOU 방지를 위해 INSERT 문 안의 서브쿼리로 계산한다(regenerateContentBody 와 동일).
    const historyInsertRows = await deps.db
      .insert(contentHistory)
      .values({
        contentId,
        versionNo: sql<number>`(select coalesce(max(version_no), 0) + 1 from content_history where content_id = ${contentId})`,
        reason: row.status === "rejected" ? "rejected_edit" : "manual_edit",
        title: row.title,
        body: row.body,
        sentPrompt: row.sentPrompt,
        detectedTerms: row.detectedTerms,
        changedBy: null,
      })
      .returning({ versionNo: contentHistory.versionNo });
    const historyCount = historyInsertRows[0]?.versionNo ?? 0;

    const updatedRow: ContentsRow = {
      ...row,
      title: nextTitle,
      body: nextBody,
      status: nextStatus,
      detectedTerms: validation,
      updatedAt: updated.updatedAt,
    };

    const data = toContentDetail(updatedRow, {
      validation,
      link,
      isExample: false,
      historyCount,
      autoRegenerated: row.regenCount > 0,
      channelFormat,
    });

    return { ok: true, data };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "content_edit_failed",
        contentId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "콘텐츠 편집 중 오류가 발생했습니다." } };
  }
}
