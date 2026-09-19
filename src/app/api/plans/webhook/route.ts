import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { createSheetsClient } from "@/lib/sheets";
import { syncPlansFromSheet } from "@/services/plan-sync";

/**
 * POST /api/plans/webhook — docs/API_SPEC.md. Apps Script 가 공유 시크릿으로 부른다.
 * 역할 쿠키가 아니라 헤더 `X-Sheet-Secret` 을 검사한다(02 F-4·F-6 채택). docs/TRD.md §9 시간 예산: 30초.
 */
export const maxDuration = 30;

type RejectReason = "secret_unset" | "header_missing" | "mismatch";

function reject(reason: RejectReason): Response {
  console.warn(JSON.stringify({ event: "webhook_rejected", reason }));
  return fail("FORBIDDEN_ROLE", "웹훅 시크릿이 올바르지 않습니다.");
}

function digestsEqual(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a).digest();
  const bufB = createHash("sha256").update(b).digest();
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request): Promise<Response> {
  const secret = getEnv().SHEET_WEBHOOK_SECRET;
  if (!secret) return reject("secret_unset");

  const header = request.headers.get("x-sheet-secret");
  if (header === null) return reject("header_missing");

  if (!digestsEqual(header, secret)) return reject("mismatch");

  const result = await syncPlansFromSheet({ sheets: createSheetsClient(getEnv()), db: getDb() }, "webhook");

  if (result.ok) return ok(result.data, 200);
  return fail(result.error.code, result.error.message, result.error.details);
}
