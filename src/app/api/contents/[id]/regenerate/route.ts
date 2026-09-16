import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createAnthropicClient } from "@/lib/llm/client";
import { RegenerateInputSchema } from "@/lib/schemas";
import { regenerateContentBody } from "@/services/content-generation";

/**
 * POST /api/contents/{id}/regenerate — FR-007 계약(_workspace/runs/20260916-1614-ad59/01_plan.md).
 * 인가 없음 — API_SPEC.md 표에 "누구나"로 명시된 라우트다.
 */
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  // instruction 이 선택값이라 본문 자체가 없어도 유효해야 한다 — publish 라우트와 같은
  // `.catch(() => ({}))` 선택, `.catch(() => null)` 이 아니다.
  const body: unknown = await request.json().catch(() => ({}));
  const parsed = RegenerateInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const env = getEnv();
  const result = await regenerateContentBody(
    { db: getDb(), llm: createAnthropicClient(env), model: env.LLM_MODEL, productBaseUrl: env.PRODUCT_BASE_URL },
    id,
    parsed.data,
  );

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
