/**
 * FR-009 액터 식별 — 계약(run 20260915-1754-5568) 「유닛 · lib/auth.ts::getActor」.
 * 순수 함수, DB·외부 I/O 없음. `role` 쿠키 하나만 본다. 역할별 실사용자 식별(FR-015)은
 * 아직 없으므로 "누구인지"가 아니라 "무슨 역할인지"만 서버에서 검사한다
 * (CLAUDE.md — 화면에서 버튼을 숨기는 것은 인가가 아니다, 인가는 서버에서 한다).
 */

export interface Actor {
  role: "editor" | "admin";
}

const ROLE_COOKIE_PATTERN = /(?:^|;\s*)role=([^;]+)/;

export function getActor(request: Request): Actor {
  const cookie = request.headers.get("cookie");
  const match = cookie ? ROLE_COOKIE_PATTERN.exec(cookie) : null;
  // 값이 없거나 "admin" 이 아닌 그 무엇(다른 문자열·"editor" 포함)이면 editor 로 본다
  // (API_SPEC.md 공통 규약: "없으면 editor로 본다").
  return match && match[1] === "admin" ? { role: "admin" } : { role: "editor" };
}
