import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createSheetsClient } from "@/lib/sheets";
import { syncPlansFromSheet } from "@/services/plan-sync";

/**
 * POST /api/plans/sync — docs/API_SPEC.md. 인가 없음(누구나). docs/TRD.md §9 시간 예산: 30초.
 */
export const maxDuration = 30;

export async function POST(): Promise<Response> {
  const result = await syncPlansFromSheet({ sheets: createSheetsClient(getEnv()), db: getDb() }, "manual");

  if (result.ok) return ok(result.data, 200);
  return fail(result.error.code, result.error.message, result.error.details);
}
