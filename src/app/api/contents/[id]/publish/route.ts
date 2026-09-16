import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { PublishInputSchema } from "@/lib/schemas";
import { transition } from "@/services/content-workflow";

/**
 * POST /api/contents/{id}/publish — FR-013 계약(_workspace/contract_fr-013-publish.md).
 * 인가 없음 — TRANSITIONS.publish 에 requireRole 이 없는 것이 유일한 근거
 * (docs/API_SPEC.md 「나머지는 두 역할 모두」).
 */
export const maxDuration = 15;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  // publishedUrl 이 선택값이라 본문 자체가 없어도 유효해야 한다 — 다른 라우트의
  // `.catch(() => null)` 과 다르게 `.catch(() => ({}))` 를 쓴다(계약 「진입점」).
  const body: unknown = await request.json().catch(() => ({}));
  const parsed = PublishInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const env = getEnv();
  const result = await transition(
    { db: getDb(), productBaseUrl: env.PRODUCT_BASE_URL },
    id,
    "publish",
    getActor(request),
    { publishedUrl: parsed.data.publishedUrl },
  );

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
