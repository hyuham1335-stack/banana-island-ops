import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { brandRules, salesChannels } from "@/lib/db/schema";
import type { ErrorCode } from "@/lib/http";
import { mergeRules, type BrandRuleRow, type ResolvedRules } from "@/lib/rules-merge";

/**
 * FR-003 브랜드 규칙 병합 조회 — docs/API_SPEC.md 77~96행, docs/TRD.md §「FR-003」.
 * brand_rules·sales_channels(기존 테이블)만 읽는다. 마이그레이션 없음.
 */

// 서비스는 throw 하지 않는다 — Result 로 돌려주고 라우트의 lib/http.ts 가 HTTP 로 매핑한다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

/**
 * 채널 조회와 규칙 조회는 순차 실행한다 — 두 번째 쿼리(brand_rules 의 country 조건)가
 * 첫 번째 쿼리 결과(채널의 country)에 의존하므로 Promise.all 로 병렬화할 수 없다.
 */
export async function resolveRules(
  deps: { db: Db },
  params: { channelId: number; lang: "ko" | "en"; productId?: number },
): Promise<Result<ResolvedRules>> {
  try {
    const channelQuery = deps.db
      .select({ id: salesChannels.id, country: salesChannels.country })
      .from(salesChannels);
    channelQuery.where(eq(salesChannels.id, params.channelId));
    const channelRows = await channelQuery;
    const channel = channelRows[0];

    if (!channel) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "채널을 찾을 수 없습니다.",
          details: { resource: "channel", id: params.channelId },
        },
      };
    }

    const scopeConditions = [
      eq(brandRules.scope, "common"),
      and(eq(brandRules.scope, "country"), eq(brandRules.country, channel.country)),
      and(eq(brandRules.scope, "channel"), eq(brandRules.channelId, params.channelId)),
    ];
    if (params.productId !== undefined) {
      scopeConditions.push(and(eq(brandRules.scope, "product"), eq(brandRules.productId, params.productId)));
    }

    const rulesQuery = deps.db
      .select({
        id: brandRules.id,
        scope: brandRules.scope,
        ruleType: brandRules.ruleType,
        content: brandRules.content,
        detectPattern: brandRules.detectPattern,
        alternative: brandRules.alternative,
        reason: brandRules.reason,
        legalBasis: brandRules.legalBasis,
        severity: brandRules.severity,
        version: brandRules.version,
      })
      .from(brandRules);
    rulesQuery.where(
      and(eq(brandRules.status, "active"), eq(brandRules.lang, params.lang), or(...scopeConditions)),
    );

    const rows = await rulesQuery;
    // scope/ruleType/severity 는 rules-merge.ts 가 schema.ts 의 pgEnum(ruleScopeEnum·
    // ruleTypeEnum·severityEnum)에서 직접 타입을 유도하므로, 이 select 결과의 drizzle
    // 추론 타입과 BrandRuleRow 는 같은 소스에서 나온 동일한 리터럴 유니온이다 — 이 캐스팅은
    // 값을 좁히지 않는 항등 캐스팅이다(select 목록이 BrandRuleRow 의 필드와 정확히 일치).
    const data = mergeRules(rows as BrandRuleRow[]);

    return { ok: true, data };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "rules_resolve_failed",
        channelId: params.channelId,
        lang: params.lang,
        productId: params.productId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      ok: false,
      error: { code: "INTERNAL", message: "규칙 조회 중 오류가 발생했습니다." },
    };
  }
}
