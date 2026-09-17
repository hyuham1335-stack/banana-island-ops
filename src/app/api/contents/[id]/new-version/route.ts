import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createNewVersion } from "@/services/content-workflow";

/**
 * POST /api/contents/{id}/new-version — FR-014 계약
 * (_workspace/contract_fr-014-new-version.md). `publish` 라우트와 같은 얇은 패턴.
 * 요청 본문을 파싱하지 않는다(API_SPEC 에 요청 스키마 없음). 인가 없음 — 나머지는
 * 두 역할 모두(docs/API_SPEC.md).
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
  const result = await createNewVersion({ db: getDb(), productBaseUrl: env.PRODUCT_BASE_URL }, id);
  if (result.ok) return ok(result.data, 201);
  return fail(result.error.code, result.error.message, result.error.details);
}
