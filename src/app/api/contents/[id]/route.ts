import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { EditContentInputSchema } from "@/lib/schemas";
import { editContent } from "@/services/content-generation";
import { deleteContent, getContentDetail } from "@/services/content-workflow";

/**
 * GET /api/contents/{id} — FR-009 계약(run 20260915-1754-5568). 인가 없음(누구나).
 * PATCH /api/contents/{id} — FR-008 계약(_workspace/contract_fr-008-direct-edit.md). 인가
 * 없음(누구나) — API_SPEC.md 표에 명시.
 * DELETE /api/contents/{id} — 콘텐츠 삭제(하드 삭제). draft·in_review·rejected 는 누구나,
 * approved 는 admin만, published 는 삭제 불가 — 인가는 deleteContent() 안에서 검사한다.
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  // title·body 중 최소 하나가 필수라 빈 객체도 zod refine 에서 거부되므로 regenerate(전부
  // 선택값, `.catch(() => ({}))`)와 다르게 `null`로 통일한다.
  const body: unknown = await request.json().catch(() => null);
  const parsed = EditContentInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const env = getEnv();
  const result = await editContent({ db: getDb(), productBaseUrl: env.PRODUCT_BASE_URL }, id, parsed.data);

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idParam } = await params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  const result = await deleteContent({ db: getDb() }, id, getActor(request));

  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
