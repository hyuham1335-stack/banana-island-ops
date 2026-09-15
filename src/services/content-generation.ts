import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { brandExamples, contents, products, promptTemplates, publishPlans, salesChannels } from "@/lib/db/schema";
import { toContentDetail, type ContentDetail, type ContentsRow } from "@/lib/content-detail";
import type { ErrorCode } from "@/lib/http";
import type { LlmClient } from "@/lib/llm/client";
import { LlmTimeoutError } from "@/lib/llm/client";
import {
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
  type LlmTitleItem,
  type TitleRequest,
} from "@/lib/schemas";
import { buildUtmLink } from "@/lib/utm";
import { validate, type ValidationResult } from "@/lib/validator";
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

    // 9~10. 프롬프트 템플릿 조회 — channelId+lang 우선, 없으면 공통(channelId IS NULL)+lang.
    const specificTemplateQuery = deps.db
      .select({ id: promptTemplates.id, body: promptTemplates.body })
      .from(promptTemplates);
    specificTemplateQuery.where(
      and(eq(promptTemplates.channelId, input.channelId), eq(promptTemplates.lang, input.lang), eq(promptTemplates.isActive, true)),
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
        and(isNull(promptTemplates.channelId), eq(promptTemplates.lang, input.lang), eq(promptTemplates.isActive, true)),
      );
      commonTemplateQuery.orderBy(desc(promptTemplates.createdAt));
      commonTemplateQuery.limit(1);
      templateRows = await commonTemplateQuery;
      template = templateRows[0];
    }

    if (!template) {
      console.error(
        JSON.stringify({ event: "prompt_template_not_found", channelId: input.channelId, lang: input.lang }),
      );
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "프롬프트 템플릿을 찾을 수 없습니다.",
          details: { resource: "prompt_template", id: 0 },
        },
      };
    }

    // 11. 템플릿 렌더링.
    const renderedTemplate = renderPromptTemplate(template.body, {
      productName: product?.name ?? "브랜드 소식",
      channelName: channel.name,
      targetPersona: input.targetPersona,
      link: channel.linkPolicy === "none" ? "" : link,
    });

    // 12. 브랜드 예시.
    const examplesQuery = deps.db
      .select({ id: brandExamples.id, summary: brandExamples.summary })
      .from(brandExamples);
    examplesQuery.where(
      and(eq(brandExamples.channelId, input.channelId), eq(brandExamples.lang, input.lang), eq(brandExamples.isActive, true)),
    );
    examplesQuery.orderBy(desc(brandExamples.createdAt));
    examplesQuery.limit(3);
    const examples = await examplesQuery;

    // 13. 프롬프트 조립.
    const system = buildBodySystemPrompt(rules, examples.map((e) => ({ summary: e.summary })));
    const user = buildBodyUserPrompt(renderedTemplate, input);

    // 14. 1차 LLM 호출 예산.
    const remainingForInitial = LLM_BUDGET_MS - (Date.now() - startedAt);
    if (remainingForInitial <= 0) {
      return {
        ok: false,
        error: { code: "LLM_TIMEOUT", message: "본문 생성이 시간 초과되었습니다.", details: { contentId } },
      };
    }

    // 15. 1차 LLM 호출.
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

    // 16. 하드 룰 검증.
    let validation = validate(draft.body, { must: rules.must, ban: rules.ban });
    let finalBody = draft.body;
    let finalUser = user;
    let autoRegenerated = false;

    // 17. 차단 항목이 있으면 예산이 허락하는 한 1회 재생성.
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

    // 18. 전송 프롬프트 원문 스냅샷.
    const sentPrompt = combineSentPrompt(system, finalUser);

    // 19. 최종 UPDATE — 동시 재시도 경합의 유일한 직렬화 지점.
    const exampleIds = examples.map((e) => e.id);
    const ruleSnapshot = { ruleIds: rules.appliedRuleIds, version: rules.version, exampleIds };
    const regenCount = autoRegenerated ? 1 : 0;

    const finalUpdatedRows = await deps.db
      .update(contents)
      .set({
        body: finalBody,
        templateId: template.id,
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
      templateId: template.id,
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
