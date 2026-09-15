import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { contentHistory, contents } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { toContentDetail } from "@/lib/content-detail";
import type { ValidationResult } from "@/lib/validator";
import { resolveContentLink } from "@/services/content-workflow";

/**
 * GET /api/contents/{id} — FR-009 계약(run 20260915-1754-5568). 인가 없음(누구나).
 */
export const maxDuration = 10;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  const db = getDb();

  const selectQuery = db.select().from(contents);
  selectQuery.where(eq(contents.id, id));
  const rows = await selectQuery;
  const row = rows[0];

  if (!row) {
    return fail("NOT_FOUND", "콘텐츠를 찾을 수 없습니다.", { resource: "content", id });
  }

  const env = getEnv();
  const link = await resolveContentLink({ db, productBaseUrl: env.PRODUCT_BASE_URL }, row);

  const historyCountQuery = db.select({ count: sql<number>`count(*)` }).from(contentHistory);
  historyCountQuery.where(eq(contentHistory.contentId, id));
  const historyCountRows = await historyCountQuery;
  const historyCount = Number(historyCountRows[0]?.count ?? 0);

  const data = toContentDetail(row, {
    validation: (row.detectedTerms as ValidationResult | null) ?? { blocks: [], warns: [], missing: [] },
    link,
    isExample: false,
    historyCount,
    autoRegenerated: row.regenCount > 0,
  });

  return ok(data);
}
