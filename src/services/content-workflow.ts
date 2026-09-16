import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "@/lib/auth";
import type { Db } from "@/lib/db/client";
import { brandExamples, contentHistory, contents, products, publishPlans, salesChannels, users } from "@/lib/db/schema";
import { toContentDetail, type ContentDetail, type ContentsRow } from "@/lib/content-detail";
import type { ErrorCode } from "@/lib/http";
import { buildUtmLink } from "@/lib/utm";
import { validate, type ValidationResult } from "@/lib/validator";
import { resolveRules } from "@/services/rules";
import { formatForChannel, type ChannelFormat } from "@/lib/channel-format";
import { createUrlChecker, type UrlChecker } from "@/lib/url-check";

/**
 * FR-009 콘텐츠 상태 전이(검수 요청/취소) — 계약(run 20260915-1754-5568).
 * ADR-007: 콘텐츠·발행 계획의 상태 전이는 이 파일 한 곳에서만 일어난다.
 */

// 서비스는 throw 하지 않는다 — content-generation.ts·rules.ts 와 같은 Result 패턴을
// 이 파일에서도 로컬로 쓴다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export type TransitionAction = "submit" | "cancel_review" | "approve" | "reject" | "publish";

export const TRANSITIONS: Record<
  TransitionAction,
  { from: ContentDetail["status"][]; to: ContentDetail["status"]; requireRole?: "editor" | "admin" }
> = {
  submit: { from: ["draft", "rejected"], to: "in_review" },
  cancel_review: { from: ["in_review"], to: "draft", requireRole: "editor" },
  approve: { from: ["in_review"], to: "approved", requireRole: "admin" },
  reject: { from: ["in_review"], to: "rejected", requireRole: "admin" },
  publish: { from: ["approved"], to: "published" },
};

/**
 * FR-008 계약(_workspace/contract_fr-008-direct-edit.md) 「유닛 · bodyUnchangedGuard」.
 * `contents.body` 는 nullable 컬럼이라 `eq(contents.body, null)` 은 SQL `x = NULL`(항상
 * UNKNOWN)이 되어 body 가 아직 없는 행(createContentWithBody 의 isNull(contents.body)
 * 가드가 근거로 삼는 상태)에 대한 정상 요청까지 0행으로 오반환한다. body === null 일 때
 * isNull() 로 분기해야 이 문제가 없다.
 */
export function bodyUnchangedGuard(body: string | null) {
  return body === null ? isNull(contents.body) : eq(contents.body, body);
}

/**
 * FR-008 계약 「유닛 · statusAfterEdit」. rejected → draft, 그 외 4개 상태는 입력 그대로
 * 반환한다. TRANSITIONS 테이블에 넣지 않는다 — "상태 전이"가 아니라 "상태를 참조해
 * 파생시키는 규칙"이라 from/to 쌍 하나로 표현되지 않는다(regenerateContentBody 의
 * row.status !== "draft" && row.status !== "rejected" 독립 가드와 같은 이유).
 */
export function statusAfterEdit(status: ContentDetail["status"]): ContentDetail["status"] {
  return status === "rejected" ? "draft" : status;
}

/**
 * 승인·반려 행위자의 users.id 근사 — listContents 의 mine 필터(155~165행)와 같은 패턴.
 * FR-015(실사용자 식별)가 아직 없어 role 로 첫 행을 근사한다. 유저가 없으면(시드 전)
 * null — 예외를 던지지 않는다(계약 「유닛」).
 */
async function resolveActorUserId(db: Db, actor: Actor): Promise<number | null> {
  const userQuery = db.select({ id: users.id }).from(users);
  userQuery.where(eq(users.role, actor.role));
  userQuery.limit(1);
  const userRows = await userQuery;
  return userRows[0]?.id ?? null;
}

/**
 * 발행 링크 재계산 — GET 상세·transition() 둘 다 재사용하는 헬퍼(계약 「플랜과의 차이」).
 * Result 를 쓰지 않는 순수 조회 헬퍼다 — 채널 FK 가 깨지는 것은 이 라운드가 다루는
 * 실패 모드가 아니라 방어적으로 빈 문자열을 돌려준다.
 */
export async function resolveContentLink(
  deps: { db: Db; productBaseUrl: string },
  row: Pick<ContentsRow, "id" | "productId" | "channelId">,
): Promise<string> {
  const channelQuery = deps.db
    .select({
      id: salesChannels.id,
      utmSource: salesChannels.utmSource,
      utmMedium: salesChannels.utmMedium,
      linkPolicy: salesChannels.linkPolicy,
    })
    .from(salesChannels);
  channelQuery.where(eq(salesChannels.id, row.channelId));
  const channelRows = await channelQuery;
  const channel = channelRows[0];
  if (!channel) return "";

  let productCode: string | null = null;
  if (row.productId !== null) {
    const productQuery = deps.db.select({ productCode: products.productCode }).from(products);
    productQuery.where(eq(products.id, row.productId));
    const productRows = await productQuery;
    productCode = productRows[0]?.productCode ?? null;
  }

  const link = buildUtmLink({
    baseUrl: deps.productBaseUrl,
    productCode,
    utmSource: channel.utmSource,
    utmMedium: channel.utmMedium,
    contentId: row.id,
  });

  return channel.linkPolicy === "none" ? "" : link;
}

/**
 * FR-012 채널 형식 변환 — 계약(run 20260916-*) 「유닛 · resolveChannelFormat」.
 * 호출자가 이미 계산한 link(resolveContentLink() 의 반환값)를 그대로 받는다 — 이 함수
 * 내부에서 링크를 다시 계산하지 않는다. 채널 SELECT 결과가 없으면(FK 깨짐 등 방어적
 * 상황) null 을 반환한다 — throw 하지 않는다(파일 상단 "서비스는 throw 하지 않는다" 불변식).
 * 05-code-review sec Major 수리: deps.db.select() 자체가 던지는 예외(DB 오류 등)도 이
 * 함수 안에서 흡수한다 — 호출부(getContentDetail 의 try/catch, approveContent 의 무보호
 * 호출) 양쪽 모두가 이 불변식에 기대지 않고도 안전하도록 국소적으로 처리한다.
 */
export async function resolveChannelFormat(
  deps: { db: Db },
  row: Pick<ContentsRow, "id" | "channelId" | "body">,
  link: string,
): Promise<ChannelFormat | null> {
  try {
    const channelQuery = deps.db
      .select({ linkPolicy: salesChannels.linkPolicy, writeUrl: salesChannels.writeUrl })
      .from(salesChannels);
    channelQuery.where(eq(salesChannels.id, row.channelId));
    const channelRows = await channelQuery;
    const channel = channelRows[0];
    if (!channel) return null;

    return formatForChannel({ body: row.body ?? "" }, channel, link);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "channel_format_resolve_failed",
        contentId: row.id,
        channelId: row.channelId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/**
 * GET /api/contents/{id} 상세 조회 — CONTRACT_DEFECT 수리(07 code-review): submit·
 * cancel-review 라우트가 이미 transition() 하나만 호출하는 얇은 형태인 것과 달리 이
 * 라우트만 SELECT·resolveContentLink·historyCount 조회·toContentDetail 조립을 라우트
 * 안에서 직접 했다(CLAUDE.md CRITICAL — 서버 로직은 Route Handler 가 받아 services 가
 * 처리한다). transition() 과 같은 try/catch·Result 패턴으로 통일한다.
 */
export async function getContentDetail(
  deps: { db: Db; productBaseUrl: string },
  contentId: number,
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

    const link = await resolveContentLink(deps, row);

    const channelFormat = row.status === "approved" ? await resolveChannelFormat(deps, row, link) : null;

    const historyCountQuery = deps.db.select({ count: sql<number>`count(*)` }).from(contentHistory);
    historyCountQuery.where(eq(contentHistory.contentId, contentId));
    const historyCountRows = await historyCountQuery;
    const historyCount = Number(historyCountRows[0]?.count ?? 0);

    const data = toContentDetail(row, {
      validation: (row.detectedTerms as ValidationResult | null) ?? { blocks: [], warns: [], missing: [] },
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
        event: "content_detail_fetch_failed",
        contentId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "콘텐츠 조회 중 오류가 발생했습니다." } };
  }
}

export interface ContentSummary {
  id: number;
  title: string;
  status: ContentDetail["status"];
  channelId: number;
  lang: "ko" | "en";
  publishPlanId: number | null;
  scheduledDate: string | null;
  authorId: number | null;
  authorName: string | null;
  warnCount: number;
  updatedAt: string;
  submittedAt: string | null;
}

/**
 * GET /api/contents 목록 조회 — CONTRACT_DEFECT 수리(05 arch 리뷰): 원래 app/api/contents/route.ts
 * GET 핸들러 안에 인라인으로 있던 조회·필터링·매핑을 여기로 옮긴다(CLAUDE.md CRITICAL —
 * 서버 로직은 Route Handler 가 받아 services 가 처리한다). 실패할 조건이 없어 Result 를 쓰지
 * 않는다 — DB 예외는 라우트의 try/catch 가 INTERNAL 로 매핑한다.
 */
export async function listContents(
  deps: { db: Db },
  query: { status?: ContentDetail["status"]; mine: boolean },
  actor: Actor,
): Promise<ContentSummary[]> {
  let authorId: number | undefined;
  if (query.mine) {
    const userQuery = deps.db.select({ id: users.id }).from(users);
    userQuery.where(eq(users.role, actor.role));
    userQuery.limit(1);
    const userRows = await userQuery;
    const user = userRows[0];
    // 그 역할의 유저가 아직 없으면(시드 전) 결과 없음 — 실패가 아니다.
    if (!user) return [];
    authorId = user.id;
  }

  const conditions = [
    ...(query.status ? [eq(contents.status, query.status)] : []),
    ...(authorId !== undefined ? [eq(contents.authorId, authorId)] : []),
  ];

  const listQuery = deps.db
    .select({
      id: contents.id,
      title: contents.title,
      status: contents.status,
      channelId: contents.channelId,
      lang: contents.lang,
      publishPlanId: contents.publishPlanId,
      scheduledDate: publishPlans.scheduledDate,
      authorId: contents.authorId,
      authorName: users.name,
      detectedTerms: contents.detectedTerms,
      updatedAt: contents.updatedAt,
      submittedAt: contents.submittedAt,
    })
    .from(contents);
  listQuery.leftJoin(publishPlans, eq(publishPlans.id, contents.publishPlanId));
  listQuery.leftJoin(users, eq(users.id, contents.authorId));
  if (conditions.length > 0) listQuery.where(and(...conditions));
  listQuery.orderBy(desc(contents.updatedAt));

  const rows = await listQuery;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    channelId: row.channelId,
    lang: row.lang,
    publishPlanId: row.publishPlanId,
    scheduledDate: row.scheduledDate,
    authorId: row.authorId,
    authorName: row.authorName,
    warnCount: (row.detectedTerms as ValidationResult | null)?.warns.length ?? 0,
    updatedAt: row.updatedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
  }));
}

export async function transition(
  deps: { db: Db; productBaseUrl: string; urlChecker?: UrlChecker },
  contentId: number,
  action: TransitionAction,
  actor: Actor,
  extra?: { reason?: string; publishedUrl?: string },
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

    const rule = TRANSITIONS[action];

    if (rule.requireRole && actor.role !== rule.requireRole) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN_ROLE",
          message: "이 작업을 수행할 권한이 없습니다.",
          details: { required: rule.requireRole },
        },
      };
    }

    if (!rule.from.includes(row.status)) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "현재 상태에서 허용되지 않는 전이입니다.",
          details: { from: row.status, action },
        },
      };
    }

    let validation: ValidationResult | null = null;

    if (action === "submit") {
      const rulesResult = await resolveRules(deps, {
        channelId: row.channelId,
        lang: row.lang,
        productId: row.productId ?? undefined,
      });
      if (!rulesResult.ok) {
        return { ok: false, error: rulesResult.error };
      }

      validation = validate(row.body ?? "", { must: rulesResult.data.must, ban: rulesResult.data.ban });

      if (validation.blocks.length > 0) {
        // AND status=row.status·bodyUnchangedGuard(row.body) — 이 UPDATE 는 상태를 바꾸지
        // 않지만, 동시에 editContent 가 본문을 차단어 없는 내용으로 고쳐 먼저 커밋하면
        // 이 UPDATE 가 SELECT 시점의(차단된) validation 을 이미 깨끗해진 본문 위에 덮어써
        // GET 상세가 계속 "차단됨"으로 보이는 정합성 결함이 생긴다 — 0행이면 그 경합이
        // 있었다는 뜻이므로 BLOCKED_TERMS_REMAIN 대신 INVALID_TRANSITION 을 반환한다.
        const blockedUpdateQuery = deps.db
          .update(contents)
          .set({ detectedTerms: validation, updatedAt: sql`now()` })
          .where(and(eq(contents.id, contentId), eq(contents.status, row.status), bodyUnchangedGuard(row.body)))
          .returning({ id: contents.id });
        const blockedUpdateRows = await blockedUpdateQuery;

        if (blockedUpdateRows.length === 0) {
          return {
            ok: false,
            error: {
              code: "INVALID_TRANSITION",
              message: "현재 상태에서 허용되지 않는 전이입니다.",
              details: { from: row.status, action: "submit" },
            },
          };
        }

        return {
          ok: false,
          error: {
            code: "BLOCKED_TERMS_REMAIN",
            message: "차단된 표현이 남아 있어 검수 요청을 보낼 수 없습니다.",
            details: { blocks: validation.blocks },
          },
        };
      }
    }

    let urlCheck: "ok" | "unreachable" | "skipped" | null = null;
    if (action === "publish") {
      const checker = deps.urlChecker ?? createUrlChecker();
      urlCheck = await checker.check(extra?.publishedUrl ?? null);
    }

    let reviewerId: number | null = null;
    if (action === "approve" || action === "reject") {
      reviewerId = await resolveActorUserId(deps.db, actor);
    }

    let publisherId: number | null = null;
    if (action === "publish") {
      publisherId = await resolveActorUserId(deps.db, actor);
    }

    // action 별로 .set() 인자 형태가 달라(submit 만 submittedAt·detectedTerms 를 추가,
    // approve/reject 는 reviewerId·reviewedAt·rejectReason 을 추가) 객체 리터럴을 그대로
    // 분기해 넘긴다 — 중간 변수(Record<string, unknown>)를 거치면 drizzle 의 컬럼별 값
    // 타입(SQL 래핑 포함) 추론이 깨진다. submittedAt 은 approve/reject 의 .set() 에 넣지
    // 않는 것 자체가 보존 메커니즘이다(계약 「유닛」).
    // AND status=row.status 가 lost-update 가드다 — content-generation.ts 468~481행의
    // isNull(contents.body) 가드와 같은 역할: 1단계에서 읽은 이후 다른 요청이 먼저 상태를
    // 바꿨다면 이 UPDATE 는 0행을 반환하고, row.status 기준의 결과로 조용히 덮어쓰지 않는다.
    const returningColumns = {
      updatedAt: contents.updatedAt,
      submittedAt: contents.submittedAt,
      reviewerId: contents.reviewerId,
      reviewedAt: contents.reviewedAt,
      rejectReason: contents.rejectReason,
      publishedUrl: contents.publishedUrl,
      urlCheck: contents.urlCheck,
      publishedAt: contents.publishedAt,
      publisherId: contents.publisherId,
    };
    const updateQuery =
      action === "submit"
        ? deps.db
            .update(contents)
            .set({ status: rule.to, updatedAt: sql`now()`, submittedAt: sql`now()`, detectedTerms: validation })
            // regenCount 도 가드에 넣는다(07 code-review 수리) — submit 은 상태를 바꾸지만
            // FR-007 재생성은 상태를 안 바꾸고 body 만 바꾼다. status 가드만 쓰면, 이
            // SELECT(위 279행)로 읽은 row.body 로 계산한 validation 이 그 사이 다른
            // 요청이 regenerateContentBody 로 body 를 바꾼 뒤에도 그대로 커밋돼(status
            // 는 여전히 draft 라 가드를 통과) 실제 본문과 다른 detectedTerms 가
            // in_review 상태에 저장될 수 있었다(차단어가 남은 본문이 검수로 새는 경로).
            .where(
              and(
                eq(contents.id, contentId),
                eq(contents.status, row.status),
                eq(contents.regenCount, row.regenCount),
                bodyUnchangedGuard(row.body),
              ),
            )
            .returning(returningColumns)
        : action === "cancel_review"
          ? deps.db
              .update(contents)
              .set({ status: rule.to, updatedAt: sql`now()`, submittedAt: null })
              .where(and(eq(contents.id, contentId), eq(contents.status, row.status)))
              .returning(returningColumns)
          : action === "approve"
            ? deps.db
                .update(contents)
                .set({
                  status: rule.to,
                  updatedAt: sql`now()`,
                  reviewerId,
                  reviewedAt: sql`now()`,
                  rejectReason: null,
                })
                .where(and(eq(contents.id, contentId), eq(contents.status, row.status)))
                .returning(returningColumns)
            : action === "reject"
              ? deps.db
                  .update(contents)
                  .set({
                    status: rule.to,
                    updatedAt: sql`now()`,
                    reviewerId,
                    reviewedAt: sql`now()`,
                    rejectReason: extra?.reason ?? null,
                  })
                  .where(and(eq(contents.id, contentId), eq(contents.status, row.status)))
                  .returning(returningColumns)
              : deps.db
                  .update(contents)
                  .set({
                    status: rule.to,
                    updatedAt: sql`now()`,
                    publishedUrl: extra?.publishedUrl ?? null,
                    urlCheck,
                    publishedAt: sql`now()`,
                    publisherId,
                  })
                  .where(and(eq(contents.id, contentId), eq(contents.status, row.status)))
                  .returning(returningColumns);
    const updatedRows = await updateQuery;
    const updated = updatedRows[0];

    if (!updated) {
      // 0행 — 1단계 조회 이후 다른 요청이 먼저 상태를 바꿨다. 최신 상태로 다시 읽어
      // 그 값 기준으로 INVALID_TRANSITION 을 반환한다(덮어쓰지 않는다).
      const freshSelectQuery = deps.db.select().from(contents);
      freshSelectQuery.where(eq(contents.id, contentId));
      const freshRows = await freshSelectQuery;
      const freshRow = freshRows[0];

      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "현재 상태에서 허용되지 않는 전이입니다.",
          details: { from: freshRow?.status ?? row.status, action },
        },
      };
    }

    const link = await resolveContentLink(deps, row);

    // ADR-002: 낙관적 잠금 UPDATE 가 성공(위 updated 확인)한 뒤에만 content_history 를
    // 쓴다 — 같은 콘텐츠에 대한 동시 submit 두 건 중 이 UPDATE 를 통과하는 것은 하나뿐이라
    // versionNo 계산(count(*) 후 INSERT)이 레이스에 노출되지 않는다. UPDATE 가 지면
    // 위에서 이미 반환했으므로 여기 도달하는 submit 요청은 항상 하나뿐이다.
    let historyCount: number;
    if (action === "submit") {
      const historyCountQuery = deps.db.select({ count: sql<number>`count(*)` }).from(contentHistory);
      historyCountQuery.where(eq(contentHistory.contentId, contentId));
      const historyCountRows = await historyCountQuery;
      const nextVersionNo = Number(historyCountRows[0]?.count ?? 0) + 1;

      const historyInsertQuery = deps.db.insert(contentHistory).values({
        contentId,
        versionNo: nextVersionNo,
        reason: "submit",
        title: row.title,
        body: row.body,
        sentPrompt: row.sentPrompt,
        detectedTerms: row.detectedTerms,
        changedBy: null,
      });
      await historyInsertQuery;
      historyCount = nextVersionNo;
    } else {
      const historyCountQuery = deps.db.select({ count: sql<number>`count(*)` }).from(contentHistory);
      historyCountQuery.where(eq(contentHistory.contentId, contentId));
      const historyCountRows = await historyCountQuery;
      historyCount = Number(historyCountRows[0]?.count ?? 0);
    }

    const updatedRow: ContentsRow = {
      ...row,
      status: rule.to,
      updatedAt: updated?.updatedAt ?? row.updatedAt,
      submittedAt:
        action === "submit"
          ? (updated?.submittedAt ?? row.submittedAt)
          : action === "cancel_review"
            ? null
            : row.submittedAt,
      detectedTerms: action === "submit" ? validation : row.detectedTerms,
      reviewerId: action === "approve" || action === "reject" ? (updated?.reviewerId ?? null) : row.reviewerId,
      reviewedAt: action === "approve" || action === "reject" ? (updated?.reviewedAt ?? null) : row.reviewedAt,
      rejectReason:
        action === "reject" ? (extra?.reason ?? null) : action === "approve" ? null : row.rejectReason,
      publishedUrl: action === "publish" ? (updated?.publishedUrl ?? null) : row.publishedUrl,
      urlCheck: action === "publish" ? (updated?.urlCheck ?? null) : row.urlCheck,
      publishedAt: action === "publish" ? (updated?.publishedAt ?? null) : row.publishedAt,
      publisherId: action === "publish" ? (updated?.publisherId ?? null) : row.publisherId,
    };

    const data = toContentDetail(updatedRow, {
      validation: action === "submit" ? (validation as ValidationResult) : ((row.detectedTerms as ValidationResult | null) ?? { blocks: [], warns: [], missing: [] }),
      link,
      isExample: false,
      historyCount,
      autoRegenerated: row.regenCount > 0,
      // transition() 자체는 channelFormat 을 계산하지 않는다(계약 범위 밖) — approve
      // 경로는 approveContent() 가 transition() 성공 후 별도로 계산해 덮어쓴다.
      channelFormat: null,
    });

    return { ok: true, data };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "content_transition_failed",
        contentId,
        action,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "상태 전이 중 오류가 발생했습니다." } };
  }
}

export interface ApproveResult extends ContentDetail {
  exampleRegistered: boolean;
  exampleSkippedReason: string | null;
}

/**
 * FR-010 승인 — 계약(run 20260915-2042-728c) 「유닛 · approveContent」.
 * transition() 으로 상태만 바꾸고, 이 함수는 승인 후 브랜드 예시 등록(선택) 만 얹는다.
 * brandExamples insert 실패는 승인 자체를 무효화하지 않는다 — try/catch 로 감싸
 * exampleSkippedReason 으로만 알린다(파일 상단 "서비스는 throw 하지 않는다" 불변식).
 */
export async function approveContent(
  deps: { db: Db; productBaseUrl: string },
  contentId: number,
  actor: Actor,
  registerAsExample: boolean,
): Promise<Result<ApproveResult>> {
  const result = await transition(deps, contentId, "approve", actor);
  if (!result.ok) return result;

  // FR-012: transition() 성공(approved 로 전이) 후 같은 방식(resolveChannelFormat)으로
  // channelFormat 을 계산해 덮어쓴다 — transition() 의 link 는 이미 result.data.link 로
  // 계산돼 있으므로 다시 계산하지 않는다.
  const channelFormat = await resolveChannelFormat(deps, result.data, result.data.link);
  const dataWithChannelFormat = { ...result.data, channelFormat };

  if (!registerAsExample) {
    return { ok: true, data: { ...dataWithChannelFormat, exampleRegistered: false, exampleSkippedReason: null } };
  }

  if (result.data.validation.warns.length > 0) {
    return {
      ok: true,
      data: {
        ...dataWithChannelFormat,
        exampleRegistered: false,
        exampleSkippedReason: "경고 표현이 있어 예시로 등록하지 않았습니다.",
      },
    };
  }

  try {
    await deps.db.insert(brandExamples).values({
      contentId,
      channelId: result.data.channelId,
      lang: result.data.lang,
      summary: (result.data.body ?? "").slice(0, 800),
      reason: "admin_approval",
    });
    return { ok: true, data: { ...dataWithChannelFormat, exampleRegistered: true, exampleSkippedReason: null } };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "brand_example_register_failed",
        contentId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      ok: true,
      data: {
        ...dataWithChannelFormat,
        exampleRegistered: false,
        exampleSkippedReason: "예시 등록 중 오류가 발생했습니다.",
      },
    };
  }
}
