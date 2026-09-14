import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createAnthropicClient } from "@/lib/llm/client";
import { TitleRequestSchema } from "@/lib/schemas";
import { generateTitles } from "@/services/content-generation";

/**
 * POST /api/contents/titles — docs/API_SPEC.md 136~140행(FR-004 계약).
 * 인가 없음(누구나). docs/TRD.md §9 시간 예산.
 */
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = TitleRequestSchema.safeParse(body);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await generateTitles(
    { db: getDb(), llm: createAnthropicClient(getEnv()) },
    parsed.data,
  );

  if (result.ok) return ok(result.data, 200);
  return fail(result.error.code, result.error.message, result.error.details);
}
