import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createAnthropicClient } from "@/lib/llm/client";
import { ContentListQuerySchema, CreateContentInputSchema } from "@/lib/schemas";
import { createContentWithBody } from "@/services/content-generation";
import { listContents } from "@/services/content-workflow";

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

/**
 * GET /api/contents?status&mine — FR-009 계약(run 20260915-1754-5568). 인가 없음(누구나).
 * CONTRACT_DEFECT 수리(05 arch 리뷰): 조회·필터링·매핑은 services/content-workflow.ts::listContents
 * 로 옮겼다 — 라우트는 파싱과 위임만 한다(CLAUDE.md CRITICAL).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = ContentListQuerySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "쿼리 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  try {
    const data = await listContents(
      { db: getDb() },
      { status: parsed.data.status, mine: parsed.data.mine === "true" },
      getActor(request),
    );
    return ok(data);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "content_list_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return fail("INTERNAL", "목록 조회 중 오류가 발생했습니다.");
  }
}
