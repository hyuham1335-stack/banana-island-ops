import { timingSafeEqual } from "node:crypto";
import { createFxClient } from "@/lib/fx-client";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { refreshFx, todayUtc } from "@/services/fx";

/**
 * GET · POST /api/fx/refresh — FR-022 계약(run 20260919-2343-1c04), Vercel Cron.
 * 시크릿 비교는 timingSafeEqual 호출 전에 헤더 없음·CRON_SECRET 미설정·길이 불일치를
 * 403 으로 끊는다(02 F-1) — 이 검사 전에는 getDb·createFxClient 를 포함해 아무것도 부르지 않는다.
 */
export const maxDuration = 30;

async function handle(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET;
  const header = request.headers.get("authorization");

  if (!secret || !header) {
    return fail("FORBIDDEN_ROLE", "크론 인증에 실패했습니다.", { required: "cron" });
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
    return fail("FORBIDDEN_ROLE", "크론 인증에 실패했습니다.", { required: "cron" });
  }

  const result = await refreshFx({ fx: createFxClient(), db: getDb() }, todayUtc());
  if (result.ok) return ok(result.data, 200);
  return fail(result.error.code, result.error.message, result.error.details);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
