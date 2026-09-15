import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { SetRoleInputSchema } from "@/lib/schemas";

/**
 * POST /api/role — 계약(run 20260916-0038-3305). 인가 검사 없음(docs/API_SPEC.md "누구나") —
 * 이 프로젝트의 역할 모델 자체가 role 쿠키뿐이라는 이미 합의된 설계다.
 */
export const maxDuration = 10;

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = SetRoleInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "요청 형식이 올바르지 않습니다.", parsed.error.issues);
  }

  const store = await cookies();
  store.set("role", parsed.data.role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: getEnv().NODE_ENV === "production",
  });

  return ok({ role: parsed.data.role });
}
