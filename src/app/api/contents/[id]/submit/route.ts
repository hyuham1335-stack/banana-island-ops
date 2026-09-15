import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { transition } from "@/services/content-workflow";

/**
 * POST /api/contents/{id}/submit — FR-009 계약(run 20260915-1754-5568).
 * 인가 없음(누구나) — 상태 조건만으로 통제.
 */
export const maxDuration = 10;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  const env = getEnv();
  const result = await transition(
    { db: getDb(), productBaseUrl: env.PRODUCT_BASE_URL },
    id,
    "submit",
    getActor(request),
  );

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
