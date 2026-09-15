import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { getContentDetail } from "@/services/content-workflow";

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

  const env = getEnv();
  const result = await getContentDetail({ db: getDb(), productBaseUrl: env.PRODUCT_BASE_URL }, id);

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
