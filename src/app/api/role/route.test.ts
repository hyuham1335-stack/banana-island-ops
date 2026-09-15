import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-010/011 프론트 연결 + 역할 전환(런 20260916-0038-3305) 「진입점 · POST /api/role」
// approve/route.test.ts 패턴 재사용 — next/headers 의 cookies() 를 모킹해 set 호출 인자를 검증한다.
// getEnv 도 모킹해 secure 플래그가 process.env 가 아니라 getEnv().NODE_ENV 를 거치는지 확인한다
// (01 리뷰 F-1 보정 회귀 방지).

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(),
}));

import { getEnv } from "@/lib/env";
import { cookies } from "next/headers";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

function reqFor(body: unknown): Request {
  return new Request("http://localhost/api/role", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockCookieStore() {
  const set = vi.fn();
  const get = vi.fn();
  vi.mocked(cookies).mockResolvedValue({ get, set } as never);
  return { get, set };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/role", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("role 값이 유효 집합(editor|admin) 밖이면 400 VALIDATION_ERROR 를 돌려주고 쿠키를 설정하지 않는다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "test" } as never);
    const { set } = mockCookieStore();

    const res = await POST(reqFor({ role: "superuser" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(set).not.toHaveBeenCalled();
  });

  it("role 필드가 없으면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "test" } as never);
    const { set } = mockCookieStore();

    const res = await POST(reqFor({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(set).not.toHaveBeenCalled();
  });

  it("바디 파싱이 실패하면(JSON 아님) 400 VALIDATION_ERROR 를 돌려주고 쿠키를 설정하지 않는다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "test" } as never);
    const { set } = mockCookieStore();
    const request = new Request("http://localhost/api/role", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    const res = await POST(request);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(set).not.toHaveBeenCalled();
  });

  it("role='admin' 이고 NODE_ENV!='production' 이면 200 + {data:{role:'admin'}} 와 secure:false 쿠키를 돌려준다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "development" } as never);
    const { set } = mockCookieStore();

    const res = await POST(reqFor({ role: "admin" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: { role: "admin" } });
    expect(set).toHaveBeenCalledWith("role", "admin", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
  });

  it("role='editor' 이면 200 + {data:{role:'editor'}} 를 돌려준다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "development" } as never);
    const { set } = mockCookieStore();

    const res = await POST(reqFor({ role: "editor" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { role: "editor" } });
    expect(set).toHaveBeenCalledWith(
      "role",
      "editor",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", secure: false }),
    );
  });

  it("NODE_ENV==='production' 이면 secure:true 로 쿠키를 설정한다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "production" } as never);
    const { set } = mockCookieStore();

    await POST(reqFor({ role: "admin" }));

    expect(set).toHaveBeenCalledWith("role", "admin", expect.objectContaining({ secure: true }));
  });

  it("process.env 를 직접 읽지 않고 getEnv() 를 거친다 — getEnv 가 호출된다", async () => {
    vi.mocked(getEnv).mockReturnValue({ NODE_ENV: "development" } as never);
    mockCookieStore();

    await POST(reqFor({ role: "admin" }));

    expect(getEnv).toHaveBeenCalled();
  });
});
