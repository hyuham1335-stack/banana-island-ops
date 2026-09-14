import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { contents, importLogs, products, publishPlans, salesChannels, users } from "@/lib/db/schema";
import { derivePlanStatus } from "@/lib/plan-status";
import type { ErrorCode } from "@/lib/http";
import type { ContentStatus, PlanStatus } from "@/types/index";

/**
 * FR-002 계획 목록 · 월 캘린더 — docs/API_SPEC.md 98~113행, docs/TRD.md.
 * publish_plans·contents·import_logs·users(기존 테이블)만 조회한다. 마이그레이션 없음.
 */

// 서비스는 throw 하지 않는다 — Result 로 돌려주고 라우트의 lib/http.ts 가 HTTP 로 매핑한다.
// plan-sync.ts 와 구조적으로 같은 모양이지만 공유 파일로 옮기지 않고 로컬로 재선언한다
// (FR-002 계약: 지금 공유 타입 파일을 새로 만드는 것은 이번 범위를 넘는다).
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export type PostType = "health_info" | "activity_news" | "comparison" | "review";

export interface Plan {
  id: number;
  sheetRowKey: string;
  scheduledDate: string;
  channelId: number;
  channelName: string;
  productId: number | null;
  productName: string | null;
  lang: "ko" | "en";
  postType: PostType;
  topicMemo: string;
  ownerId: number | null;
  ownerName: string | null;
  onHold: boolean;
  status: PlanStatus;
  contentId: number | null;
}

export interface ImportSummary {
  id: number;
  createdAt: Date;
  totalRows: number;
  okRows: number;
  failedRows: number;
  trigger: "manual" | "webhook";
}

/**
 * "YYYY-MM" 을 월초(포함)~다음달 월초(미포함) 날짜 범위로 변환한다. 순수 함수.
 */
function monthRange(month: string): { start: string; end: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const start = `${yearStr}-${monthStr}-01`;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const end = `${String(nextYear).padStart(4, "0")}-${String(nextMon).padStart(2, "0")}-01`;
  return { start, end };
}

/**
 * 계획 목록 조회 쿼리와 lastSync 조회는 서로 의존하지 않으므로 Promise.all 로 병렬 실행한다
 * (02-cross-verify 채택 사항 F-7). 서비스는 throw 하지 않는다 — DB 예외는 catch 해서 Result 로 감싼다.
 */
export async function listPlans(
  deps: { db: Db },
  month: string,
): Promise<Result<{ plans: Plan[]; lastSync: ImportSummary | null }>> {
  try {
    const { start, end } = monthRange(month);

    // 각 쿼리는 빌더를 한 번만 잡아 그 참조에 메서드를 나눠 호출한다(반환값을 재대입해
    // 다시 체이닝하지 않는다). Drizzle 의 select 빌더는 leftJoin·where·orderBy·limit 호출마다
    // 자기 자신(this)을 변형해 돌려주므로 실제 DB 대상으로는 동작이 같고, 테스트 더블(스텁)의
    // 체인 흉내가 얕아도(한 번 더 감싼 반환값은 더 이상 체이닝을 지원하지 않는다) 깨지지 않는다.
    const planQuery = deps.db
      .select({
        id: publishPlans.id,
        sheetRowKey: publishPlans.sheetRowKey,
        scheduledDate: publishPlans.scheduledDate,
        channelId: publishPlans.channelId,
        channelName: salesChannels.name,
        productId: publishPlans.productId,
        productName: products.name,
        lang: publishPlans.lang,
        postType: publishPlans.postType,
        topicMemo: publishPlans.topicMemo,
        ownerId: publishPlans.ownerId,
        ownerName: users.name,
        onHold: publishPlans.onHold,
        contentId: contents.id,
        contentStatus: contents.status,
      })
      .from(publishPlans);
    planQuery.leftJoin(contents, eq(contents.publishPlanId, publishPlans.id));
    planQuery.leftJoin(users, eq(publishPlans.ownerId, users.id));
    planQuery.leftJoin(salesChannels, eq(salesChannels.id, publishPlans.channelId));
    planQuery.leftJoin(products, eq(products.id, publishPlans.productId));
    planQuery.where(and(gte(publishPlans.scheduledDate, start), lt(publishPlans.scheduledDate, end)));
    planQuery.orderBy(publishPlans.scheduledDate);

    const lastSyncQuery = deps.db
      .select({
        id: importLogs.id,
        createdAt: importLogs.createdAt,
        totalRows: importLogs.totalRows,
        okRows: importLogs.okRows,
        failedRows: importLogs.failedRows,
      })
      .from(importLogs);
    lastSyncQuery.where(eq(importLogs.target, "publish_plans"));
    lastSyncQuery.orderBy(desc(importLogs.createdAt));
    lastSyncQuery.limit(1);

    const [planRows, lastSyncRows] = await Promise.all([planQuery, lastSyncQuery]);

    const plans: Plan[] = planRows.map((row) => {
      const content: { status: ContentStatus } | null =
        row.contentId !== null && row.contentStatus !== null ? { status: row.contentStatus } : null;
      return {
        id: row.id,
        sheetRowKey: row.sheetRowKey,
        scheduledDate: row.scheduledDate,
        channelId: row.channelId,
        // salesChannels 는 publishPlans.channelId 의 FK 대상(not null, RESTRICT)이라
        // leftJoin 이어도 실제로는 항상 매칭된다 — ?? "" 는 타입만 맞추는 방어값이다.
        channelName: row.channelName ?? "",
        productId: row.productId,
        productName: row.productName,
        lang: row.lang,
        postType: row.postType,
        topicMemo: row.topicMemo,
        ownerId: row.ownerId,
        ownerName: row.ownerName ?? null,
        onHold: row.onHold,
        status: derivePlanStatus({ onHold: row.onHold }, content),
        contentId: row.contentId,
      };
    });

    // import_logs 에 trigger 컬럼이 없다 — 유일한 진입점(POST /api/plans/sync)이 항상 수동 호출이라
    // 'manual' 로 고정 응답한다(FR-002 계약, 02-cross-verify 채택 사항 F-6).
    const lastSync: ImportSummary | null = lastSyncRows[0]
      ? {
          id: lastSyncRows[0].id,
          createdAt: lastSyncRows[0].createdAt,
          totalRows: lastSyncRows[0].totalRows,
          okRows: lastSyncRows[0].okRows,
          failedRows: lastSyncRows[0].failedRows,
          trigger: "manual",
        }
      : null;

    return { ok: true, data: { plans, lastSync } };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "plan_list_failed",
        month,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      ok: false,
      error: { code: "INTERNAL", message: "계획 목록 조회 중 오류가 발생했습니다." },
    };
  }
}
