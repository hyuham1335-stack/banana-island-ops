import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Actor } from "@/lib/auth";
import type { Db } from "@/lib/db/client";
import { adPerformance, contents, salesChannels } from "@/lib/db/schema";
import type { ErrorCode } from "@/lib/http";
import { listContents, type ContentSummary } from "@/services/content-workflow";
import { listContentChannels } from "@/services/content-options";

/**
 * FR-016 홈 대시보드 — 계약(run 20260916-*) 「유닛 · getHomeDashboard」.
 * contents · ad_performance · sales_channels 만 읽는다. 마이그레이션 없음.
 */

// 서비스는 throw 하지 않는다 — plans.ts · content-workflow.ts 와 같은 Result 패턴을
// 이 파일에서도 로컬로 쓴다(계약 「데이터 형태」— 공유 파일로 옮기지 않는다).
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export interface AdChannelSummary {
  channelId: number;
  channelName: string;
  spend: { amount: string; currency: string };
  revenue: { amount: string; currency: string } | null;
}

export interface HomeDashboard {
  publishedThisMonth: number;
  inReview: ContentSummary[];
  approved: ContentSummary[];
  channelNames: Record<number, string>;
  adSummary: AdChannelSummary[] | null;
}

/**
 * 이번 달(로컬) 월초(포함)~다음달 월초(미포함) — plans.ts 의 monthRange 와 같은 방식,
 * `new Date()` 기준. 공유 파일로 옮기지 않고 이 파일 안에 비-export 헬퍼로 둔다.
 */
function currentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

export async function getHomeDashboard(deps: { db: Db }, actor: Actor): Promise<Result<HomeDashboard>> {
  try {
    const { start, end } = currentMonthRange();

    const publishedCountQuery = deps.db.select({ count: sql<number>`count(*)` }).from(contents);
    publishedCountQuery.where(
      and(eq(contents.status, "published"), gte(contents.publishedAt, start), lt(contents.publishedAt, end)),
    );

    // admin 이 아니면 광고 조인 쿼리 자체를 실행하지 않는다(계약 「인가」 — 화면에서
    // 섹션을 숨기는 방식이 아니라 서버에서 강제한다).
    const adSummaryPromise: Promise<AdChannelSummary[] | null> =
      actor.role === "admin"
        ? (async () => {
            const adQuery = deps.db
              .select({
                channelId: adPerformance.channelId,
                channelName: salesChannels.name,
                spendAmount: sql<string>`sum(${adPerformance.spend})`,
                revenueAmount: sql<string | null>`sum(${adPerformance.revenue})`,
                currency: sql<string>`min(${adPerformance.currency})`,
              })
              .from(adPerformance);
            adQuery.leftJoin(salesChannels, eq(salesChannels.id, adPerformance.channelId));
            adQuery.groupBy(adPerformance.channelId, salesChannels.name);
            const adRows = await adQuery;
            return adRows.map((row) => ({
              channelId: row.channelId,
              channelName: row.channelName ?? "",
              spend: { amount: row.spendAmount, currency: row.currency },
              revenue: row.revenueAmount !== null ? { amount: row.revenueAmount, currency: row.currency } : null,
            }));
          })()
        : Promise.resolve(null);

    const [publishedCountRows, inReview, approved, channelRows, adSummary] = await Promise.all([
      publishedCountQuery,
      listContents({ db: deps.db }, { status: "in_review", mine: false }, { role: "editor" }),
      listContents({ db: deps.db }, { status: "approved", mine: false }, { role: "editor" }),
      listContentChannels({ db: deps.db }),
      adSummaryPromise,
    ]);

    const publishedThisMonth = Number(publishedCountRows[0]?.count ?? 0);
    const channelNames = Object.fromEntries(channelRows.map((c) => [c.id, c.name]));

    return { ok: true, data: { publishedThisMonth, inReview, approved, channelNames, adSummary } };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "home_dashboard_fetch_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "홈 데이터 조회 중 오류가 발생했습니다." } };
  }
}
