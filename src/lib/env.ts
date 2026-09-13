import { z } from "zod";

/**
 * 환경변수 — docs/TRD.md §9 「비밀값·환경변수」.
 * 이 파일만 process.env 를 읽는다. 필수 키가 없거나 비어 있으면 부팅 실패(throw).
 * 모듈 최상위에서는 읽지 않는다 — getEnv() 가 첫 호출 시점에 파싱하고 캐시한다.
 */

const nonEmpty = z.string().trim().min(1);
const optional = z.string().trim().min(1).optional();

const EnvSchema = z.object({
  // Must
  DATABASE_URL: z.string().trim().url(),
  ANTHROPIC_API_KEY: nonEmpty,
  LLM_MODEL: nonEmpty,
  PRODUCT_BASE_URL: z.string().trim().url(),
  // Must — 없으면 시트 동기화만 SHEET_FETCH_FAILED, 나머지는 동작
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optional,
  GOOGLE_PRIVATE_KEY: optional,
  SHEET_ID: optional,
  SHEET_RANGE: optional,
  // Should
  CRON_SECRET: optional,
  SHEET_WEBHOOK_SECRET: optional,
});

export type Env = z.infer<typeof EnvSchema>;

/** 순수 함수 — 인자로 받은 객체만 본다. 테스트는 이것을 직접 부른다. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const picked: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const v = raw[key];
    // 빈 문자열·공백은 누락과 같다 — Vercel 에서 값 없이 키만 만든 경우를 숨기지 않는다
    picked[key] = v === undefined || v.trim() === "" ? undefined : v;
  }
  const result = EnvSchema.safeParse(picked);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`환경변수 누락 또는 형식 오류: ${keys.join(", ")}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** 요청 처리 함수 안에서만 부른다. 첫 호출에 process.env 를 파싱하고 이후 캐시를 돌려준다. */
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
