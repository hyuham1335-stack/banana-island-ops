import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { importLogs, products, publishPlans, salesChannels, users } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import type { ErrorCode } from "@/lib/http";
import { parseSheetRow, type PostTypeLabel, type SheetRowIssue } from "@/lib/schemas";
import type { SheetsClient } from "@/lib/sheets";

/**
 * FR-001 시트 → publish_plans 단방향 동기화 — docs/TRD.md §3 FR-001·§4 「시트 행 계약」.
 * 서비스는 process.env 를 읽지 않는다(getEnv() 만 쓴다) · 외부 클라이언트는 인자로 받는다.
 */

const SHEET_COLUMNS = 8;

// 서비스는 throw 하지 않는다 — Result 로 돌려주고 라우트의 lib/http.ts 가 HTTP 로 매핑한다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export interface SyncResult {
  importId: number;
  totalRows: number;
  upserted: number;
  held: number;
  failed: number;
  errors: SheetRowIssue[];
}

export interface UpsertRow {
  sheetRowKey: string;
  scheduledDate: string;
  channelId: number;
  productId: number | null;
  lang: "ko" | "en";
  postType: "health_info" | "activity_news" | "comparison" | "review";
  topicMemo: string;
  ownerId: number | null;
}

export interface SyncDecision {
  totalRows: number;
  toUpsert: UpsertRow[];
  errors: SheetRowIssue[];
  seenKeys: Set<string>;
}

interface Masters {
  channels: Map<string, number>;
  products: Map<string, number>;
  owners: Map<string, number>;
}

const POST_TYPE_BY_LABEL: Record<PostTypeLabel, UpsertRow["postType"]> = {
  건강정보형: "health_info",
  활동소식형: "activity_news",
  비교큐레이션형: "comparison",
  후기리뷰형: "review",
};

/**
 * 순수 함수 — DB·네트워크 접근 없음. 시트 행을 파싱·조회해 upsert 할 행과 오류를 가른다.
 */
export function decideSyncPlan(rows: string[][], masters: Masters): SyncDecision {
  const errors: SheetRowIssue[] = [];
  const seenKeys = new Set<string>();
  const dedupIds = new Set<string>(); // 형태 통과 행의 planId — 중복 판정용(앞 행 우선)
  const toUpsert: UpsertRow[] = [];
  let totalRows = 0;

  rows.forEach((cells, idx) => {
    const rowNo = idx + 2; // 헤더 = 1, 데이터 첫 행 = 2

    const isBlank = Array.from({ length: SHEET_COLUMNS }, (_, i) => (cells[i] ?? "").trim()).every(
      (v) => v === "",
    );
    if (isBlank) return;
    totalRows += 1;

    // 검증 성공 여부와 무관하게 비어있지 않은 A열은 on_hold 판단을 위해 seenKeys 에 넣는다.
    const planIdRaw = (cells[0] ?? "").trim();
    if (planIdRaw !== "") seenKeys.add(planIdRaw);

    const parsed = parseSheetRow(cells);
    if (!parsed.ok) {
      errors.push({ row: rowNo, column: parsed.column, reason: parsed.error });
      return;
    }
    const row = parsed.row;

    if (dedupIds.has(row.planId)) {
      errors.push({ row: rowNo, column: "A", reason: "DUPLICATE_KEY" });
      return;
    }
    dedupIds.add(row.planId);

    const channelId = masters.channels.get(row.channel);
    if (channelId === undefined) {
      errors.push({ row: rowNo, column: "C", reason: "UNKNOWN_CHANNEL" });
      return;
    }

    let productId: number | null = null;
    if (row.product !== "") {
      const found = masters.products.get(row.product);
      if (found === undefined) {
        errors.push({ row: rowNo, column: "D", reason: "UNKNOWN_PRODUCT" });
        return;
      }
      productId = found;
    }

    const ownerId = row.owner !== "" ? (masters.owners.get(row.owner) ?? null) : null;

    toUpsert.push({
      sheetRowKey: row.planId,
      scheduledDate: row.scheduledDate,
      channelId,
      productId,
      lang: row.lang,
      postType: POST_TYPE_BY_LABEL[row.postTypeLabel],
      topicMemo: row.topic,
      ownerId,
    });
  });

  return { totalRows, toUpsert, errors, seenKeys };
}

function toIdMap(rows: { id: number; name: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.name, r.id);
  return map;
}

/** 얇은 오케스트레이터 — 읽기·마스터 조회·결정·저장을 순서대로 부른다. */
export async function syncPlansFromSheet(
  deps: { sheets: SheetsClient; db: Db },
  trigger: "manual" | "webhook",
): Promise<Result<SyncResult>> {
  let rows: string[][];
  try {
    rows = await deps.sheets.readRows(getEnv().SHEET_RANGE ?? "");
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "external_failed",
        target: "sheets",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    // API_SPEC.md 의 오류 어휘 표: SHEET_FETCH_FAILED 의 details 는 { lastSyncAt } 다.
    const [last] = await deps.db
      .select({ createdAt: importLogs.createdAt })
      .from(importLogs)
      .where(eq(importLogs.target, "publish_plans"))
      .orderBy(desc(importLogs.createdAt))
      .limit(1);
    return {
      ok: false,
      error: {
        code: "SHEET_FETCH_FAILED",
        message: "시트를 읽지 못했습니다.",
        details: { lastSyncAt: last?.createdAt ?? null },
      },
    };
  }

  try {
    const [channelRows, productRows, ownerRows] = await Promise.all([
      deps.db.select({ id: salesChannels.id, name: salesChannels.name }).from(salesChannels),
      deps.db.select({ id: products.id, name: products.name }).from(products),
      deps.db.select({ id: users.id, name: users.name }).from(users),
    ]);

    const masters: Masters = {
      channels: toIdMap(channelRows),
      products: toIdMap(productRows),
      owners: toIdMap(ownerRows),
    };

    const decision = decideSyncPlan(rows, masters);

    if (decision.toUpsert.length > 0) {
      await deps.db
        .insert(publishPlans)
        .values(
          decision.toUpsert.map((r) => ({
            sheetRowKey: r.sheetRowKey,
            scheduledDate: r.scheduledDate,
            channelId: r.channelId,
            productId: r.productId,
            lang: r.lang,
            postType: r.postType,
            topicMemo: r.topicMemo,
            ownerId: r.ownerId,
          })),
        )
        .onConflictDoUpdate({
          target: publishPlans.sheetRowKey,
          set: {
            scheduledDate: sql`excluded.scheduled_date`,
            channelId: sql`excluded.channel_id`,
            productId: sql`excluded.product_id`,
            lang: sql`excluded.lang`,
            postType: sql`excluded.post_type`,
            topicMemo: sql`excluded.topic_memo`,
            ownerId: sql`excluded.owner_id`,
            onHold: false,
            updatedAt: sql`now()`,
          },
        });
    }

    let heldKeys: string[];
    if (decision.seenKeys.size > 0) {
      const held = await deps.db
        .update(publishPlans)
        .set({ onHold: true })
        .where(
          and(eq(publishPlans.onHold, false), notInArray(publishPlans.sheetRowKey, [...decision.seenKeys])),
        )
        .returning({ sheetRowKey: publishPlans.sheetRowKey });
      heldKeys = held.map((h) => h.sheetRowKey);
    } else {
      const held = await deps.db
        .update(publishPlans)
        .set({ onHold: true })
        .where(eq(publishPlans.onHold, false))
        .returning({ sheetRowKey: publishPlans.sheetRowKey });
      heldKeys = held.map((h) => h.sheetRowKey);
    }

    const [log] = await deps.db
      .insert(importLogs)
      .values({
        target: "publish_plans",
        inputSource: "sheet",
        sourceRef: getEnv().SHEET_RANGE ?? null,
        totalRows: decision.totalRows,
        okRows: decision.toUpsert.length,
        failedRows: decision.errors.length,
        errors: decision.errors,
        executedBy: null,
        trigger,
      })
      .returning({ id: importLogs.id });
    const importId = log.id;

    const touchedKeys = [...new Set([...decision.toUpsert.map((r) => r.sheetRowKey), ...heldKeys])];
    if (touchedKeys.length > 0) {
      await deps.db
        .update(publishPlans)
        .set({ importId })
        .where(inArray(publishPlans.sheetRowKey, touchedKeys));
    }

    return {
      ok: true,
      data: {
        importId,
        totalRows: decision.totalRows,
        upserted: decision.toUpsert.length,
        held: heldKeys.length,
        failed: decision.errors.length,
        errors: decision.errors,
      },
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "plan_sync_failed",
        trigger,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      ok: false,
      error: { code: "INTERNAL", message: "동기화 처리 중 오류가 발생했습니다." },
    };
  }
}
