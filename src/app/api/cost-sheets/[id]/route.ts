import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { fail, ok } from "@/lib/http";
import { UpdateCostSheetInputSchema } from "@/lib/schemas";
import { updateCostSheet } from "@/services/cost";

/**
 * PATCH /api/cost-sheets/{id} — FR-020 계약(run 20260920-0107-4265). admin 전용 —
 * params·본문을 보기 전에 역할부터 검사한다.
 */
export const maxDuration = 10;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (getActor(request).role !== "admin") {
    return fail("FORBIDDEN_ROLE", "대표만 원가표를 다룰 수 있습니다.", { required: "admin" });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return fail("VALIDATION_ERROR", "id 형식이 올바르지 않습니다.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "요청 본문이 JSON 형식이 아닙니다.");
  }

  const parsed = UpdateCostSheetInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await updateCostSheet({ db: getDb() }, id, parsed.data);
  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}
