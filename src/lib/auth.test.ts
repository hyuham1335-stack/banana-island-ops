import { describe, expect, it } from "vitest";
import { getActor } from "./auth";

// 계약: FR-009(런 20260915-1754-5568) 「유닛 · src/lib/auth.ts · getActor」
// docs/API_SPEC.md 「공통 규약」16행: "역할 쿠키 role = editor|admin. 없으면 editor 로 본다."
// Web 표준 Request.headers.get("cookie") 만 읽는 순수 함수 — DB·네트워크 없음.

function reqWithCookie(cookie: string | null): Request {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = cookie;
  return new Request("http://localhost/api/contents/1/submit", { headers });
}

describe("getActor", () => {
  it("role=admin 쿠키면 {role:'admin'} 을 돌려준다", () => {
    expect(getActor(reqWithCookie("role=admin"))).toEqual({ role: "admin" });
  });

  it("role=editor 쿠키면 {role:'editor'} 을 돌려준다", () => {
    expect(getActor(reqWithCookie("role=editor"))).toEqual({ role: "editor" });
  });

  it("쿠키가 아예 없으면 기본값 {role:'editor'} 를 돌려준다", () => {
    expect(getActor(reqWithCookie(null))).toEqual({ role: "editor" });
  });

  it("cookie 헤더는 있지만 role 키가 없으면 기본값 {role:'editor'} 를 돌려준다", () => {
    expect(getActor(reqWithCookie("foo=bar; baz=qux"))).toEqual({ role: "editor" });
  });

  it.each([["role=admin2"], ["role="], ["role=ADMIN"], ["role=superuser"], ["role=null"]])(
    "role 값이 '%s' 처럼 유효 집합(editor|admin) 밖이면 기본값 {role:'editor'} 로 본다",
    (cookie) => {
      expect(getActor(reqWithCookie(cookie))).toEqual({ role: "editor" });
    },
  );

  it("다른 쿠키와 섞여 있어도 role 값을 정확히 파싱한다(뒤쪽)", () => {
    expect(getActor(reqWithCookie("foo=bar; role=admin; baz=qux"))).toEqual({ role: "admin" });
  });

  it("다른 쿠키와 섞여 있어도 role 값을 정확히 파싱한다(맨 앞)", () => {
    expect(getActor(reqWithCookie("role=editor; foo=bar; baz=qux"))).toEqual({ role: "editor" });
  });

  it("세미콜론 뒤 공백을 포함한 쿠키 구분자도 정확히 파싱한다", () => {
    expect(getActor(reqWithCookie("foo=bar;  role=admin;baz=qux"))).toEqual({ role: "admin" });
  });
});
