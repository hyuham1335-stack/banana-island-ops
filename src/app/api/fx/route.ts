import { getActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { fail, ok } from "@/lib/http";
import { FxQuerySchema, ManualFxInputSchema } from "@/lib/schemas";
import { getFx, saveManualFx, todayUtc } from "@/services/fx";

/**
 * GET · POST /api/fx — FR-022 계약(run 20260919-2343-1c04).
 * GET 은 인가 없음(누구나). POST 는 admin 만 — 본문 파싱 전에 검사한다.
 */
export const maxDuration = 10;

export async function GET(request: Request): Promise<Response> {
  const dateParam = new URL(request.url).searchParams.get("date");
  const parsed = FxQuerySchema.safeParse({ date: dateParam ?? undefined });
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "date 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await getFx({ db: getDb() }, parsed.data.date ?? todayUtc());
  if (result.ok) return ok(result.data);
  return fail(result.error.code, result.error.message, result.error.details);
}

export async function POST(request: Request): Promise<Response> {
  if (getActor(request).role !== "admin") {
    return fail("FORBIDDEN_ROLE", "대표만 환율을 입력할 수 있습니다.", { required: "admin" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "요청 본문이 JSON 형식이 아닙니다.");
  }

  const parsed = ManualFxInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const result = await saveManualFx({ db: getDb() }, parsed.data, todayUtc());
  if (result.ok) return ok(result.data, 201);
  return fail(result.error.code, result.error.message, result.error.details);
}
