/**
 * API 응답 봉투 — docs/API_SPEC.md 「공통 규약」·「에러 응답 규약」.
 * 성공: { data } · 실패: { error: { code, message, details? } }.
 * 결과 없음은 실패가 아니다 — ok([]) / ok(null) 로 200 을 낸다.
 */

// 닫힌 집합. API_SPEC.md 의 표와 1:1 — 여기 없는 코드를 만들지 않는다.
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  BLOCKED_TERMS_REMAIN: 422,
  LLM_FAILED: 502,
  LLM_TIMEOUT: 504,
  SHEET_FETCH_FAILED: 502,
  FX_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function ok<T>(data: T, status: 200 | 201 = 200): Response {
  return json({ data }, status);
}

export function fail(code: ErrorCode, message: string, details?: unknown): Response {
  const error = details === undefined ? { code, message } : { code, message, details };
  return json({ error }, ERROR_CODES[code]);
}
