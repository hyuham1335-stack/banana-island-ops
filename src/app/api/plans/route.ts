import { getDb } from "@/lib/db/client";
import { fail, ok } from "@/lib/http";
import { MonthQuerySchema } from "@/lib/schemas";
import { listPlans } from "@/services/plans";

/**
 * GET /api/plans?month=YYYY-MM — docs/API_SPEC.md. 인가 없음(누구나, ADR-004).
 * docs/TRD.md §9 시간 예산.
 */
export const maxDuration = 10;

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const parsed = MonthQuerySchema.safeParse({ month: searchParams.get("month") });

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "month 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await listPlans({ db: getDb() }, parsed.data.month);

  if (result.ok) return ok(result.data, 200);
  return fail(result.error.code, result.error.message, result.error.details);
}
