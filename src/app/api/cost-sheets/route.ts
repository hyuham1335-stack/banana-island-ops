import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { fail, ok } from "@/lib/http";
import { CostSheetListQuerySchema, CreateCostSheetInputSchema } from "@/lib/schemas";
import { createCostSheet, listCostSheets } from "@/services/cost";

/**
 * GET · POST /api/cost-sheets — FR-020 계약(run 20260920-0107-4265). 둘 다 admin 전용 —
 * 쿼리·본문을 보기 전에 역할부터 검사한다.
 */
export const maxDuration = 10;

export async function GET(request: Request): Promise<Response> {
  if (getActor(request).role !== "admin") {
    return fail("FORBIDDEN_ROLE", "대표만 원가표를 다룰 수 있습니다.", { required: "admin" });
  }

  const { searchParams } = new URL(request.url);
  const parsed = CostSheetListQuerySchema.safeParse({
    productId: searchParams.get("productId") ?? undefined,
    distributionRoute: searchParams.get("distributionRoute") ?? undefined,
  });
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "쿼리 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await listCostSheets({ db: getDb() }, parsed.data);
  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}

export async function POST(request: Request): Promise<Response> {
  if (getActor(request).role !== "admin") {
    return fail("FORBIDDEN_ROLE", "대표만 원가표를 다룰 수 있습니다.", { required: "admin" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "요청 본문이 JSON 형식이 아닙니다.");
  }

  const parsed = CreateCostSheetInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await createCostSheet({ db: getDb() }, parsed.data);
  if (result.ok) return ok(result.data, 201);
  return fail(result.error.code, result.error.message, result.error.details);
}
