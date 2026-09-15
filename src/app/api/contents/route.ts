import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createAnthropicClient } from "@/lib/llm/client";
import { CreateContentInputSchema } from "@/lib/schemas";
import { createContentWithBody } from "@/services/content-generation";

/**
 * POST /api/contents — FR-005 본문 생성. _workspace/contract_fr-005-body-generation.md.
 * 인가 없음(누구나). docs/TRD.md §9 시간 예산.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = CreateContentInputSchema.safeParse(body);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const env = getEnv();
  const result = await createContentWithBody(
    { db: getDb(), llm: createAnthropicClient(env), productBaseUrl: env.PRODUCT_BASE_URL, model: env.LLM_MODEL },
    parsed.data,
  );

  if (result.ok) return ok(result.data, 201);
  return fail(result.error.code, result.error.message, result.error.details);
}
