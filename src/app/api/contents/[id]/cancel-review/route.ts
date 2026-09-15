import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { transition } from "@/services/content-workflow";

/**
 * POST /api/contents/{id}/cancel-review — FR-009 계약(run 20260915-1754-5568).
 * editor 만 허용 — transition() 내부의 FORBIDDEN_ROLE 판정이 유일한 인가 지점이다
 * (CLAUDE.md — 화면에서 버튼을 숨기는 것은 인가가 아니다, 서버에서 검사한다).
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
    "cancel_review",
    getActor(request),
  );

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
