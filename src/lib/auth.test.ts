import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「유닛 · src/lib/auth.ts · getActor」
// docs/API_SPEC.md 「공통 규약」16행: "역할 쿠키 role = editor|admin. 없으면 editor 로 본다."
// Web 표준 Request.headers.get("cookie") 만 읽는 순수 함수 — DB·네트워크 없음.
//
// 계약: FR-010/011 프론트 연결 + 역할 전환(런 20260916-0038-3305)
// 「유닛 · src/lib/auth.ts · resolveRole · getServerActor」 — next/headers 의 cookies() 를 모킹한다.

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { cookies } from "next/headers";
import { getActor, getServerActor, resolveRole } from "./auth";

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

function mockCookieValue(value: string | undefined): void {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "role" && value !== undefined ? { value } : undefined)),
    set: vi.fn(),
  } as never);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveRole", () => {
  it("'admin' 이면 'admin' 을 돌려준다", () => {
    expect(resolveRole("admin")).toBe("admin");
  });

  it.each([[undefined], ["editor"], ["ADMIN"], ["superuser"], [""], ["null"]])(
    "%s 는 admin 이 아니므로 'editor' 를 돌려준다",
    (value) => {
      expect(resolveRole(value)).toBe("editor");
    },
  );
});

describe("getServerActor", () => {
  it("쿠키가 없으면 {role:'editor'} 를 돌려준다", async () => {
    mockCookieValue(undefined);
    await expect(getServerActor()).resolves.toEqual({ role: "editor" });
  });

  it("role=editor 쿠키면 {role:'editor'} 를 돌려준다", async () => {
    mockCookieValue("editor");
    await expect(getServerActor()).resolves.toEqual({ role: "editor" });
  });

  it("role=admin 쿠키면 {role:'admin'} 를 돌려준다", async () => {
    mockCookieValue("admin");
    await expect(getServerActor()).resolves.toEqual({ role: "admin" });
  });

  it("role 값이 유효 집합(editor|admin) 밖이면 {role:'editor'} 로 본다", async () => {
    mockCookieValue("superuser");
    await expect(getServerActor()).resolves.toEqual({ role: "editor" });
  });

  it("cookies() 를 await 해서 쓴다(Promise 반환 처리)", async () => {
    mockCookieValue("admin");
    const result = await getServerActor();
    expect(cookies).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ role: "admin" });
  });
});
