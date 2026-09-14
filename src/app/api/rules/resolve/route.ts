import { getDb } from "@/lib/db/client";
import { fail, ok } from "@/lib/http";
import { RulesResolveQuerySchema } from "@/lib/schemas";
import { resolveRules } from "@/services/rules";

/**
 * GET /api/rules/resolve?channelId&lang&productId? — docs/API_SPEC.md 77~96행.
 * 인가 없음(누구나, ADR-004). docs/TRD.md §9 시간 예산.
 */
export const maxDuration = 10;

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const parsed = RulesResolveQuerySchema.safeParse({
    channelId: searchParams.get("channelId"),
    lang: searchParams.get("lang"),
    productId: searchParams.get("productId") ?? undefined,
  });

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "쿼리 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await resolveRules({ db: getDb() }, parsed.data);

  if (result.ok) return ok(result.data, 200);
  return fail(result.error.code, result.error.message, result.error.details);
}
