import { describe, expect, it } from "vitest";
import { ERROR_CODES, fail, ok, type ErrorCode } from "./http";

const JSON_UTF8 = "application/json; charset=utf-8";

describe("ok", () => {
  it("200 + { data } 봉투로 감싼다", async () => {
    const res = ok({ id: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: { id: 1 } });
  });

  it("생성은 201 을 쓴다", () => {
    expect(ok({ id: 1 }, 201).status).toBe(201);
  });

  it("결과 없음은 실패가 아니다 — 200 + data: [] / null", async () => {
    expect(await ok([]).json()).toEqual({ data: [] });
    expect(await ok(null).json()).toEqual({ data: null });
  });
});

describe("fail", () => {
  it("{ error: { code, message, details } } 봉투와 코드별 HTTP 상태를 쓴다", async () => {
    const res = fail("NOT_FOUND", "콘텐츠가 없습니다.", { resource: "content", id: 7 });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "콘텐츠가 없습니다.",
        details: { resource: "content", id: 7 },
      },
    });
  });

  it("details 가 없으면 키 자체를 내지 않는다", async () => {
    const body = await fail("INTERNAL", "서버 오류").json();
    expect(body).toEqual({ error: { code: "INTERNAL", message: "서버 오류" } });
  });

  // API_SPEC.md 「에러 응답 규약」 — 닫힌 집합. 표와 1:1 이어야 한다.
  const table: Array<[ErrorCode, number]> = [
    ["VALIDATION_ERROR", 400],
    ["FORBIDDEN_ROLE", 403],
    ["NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
    ["BLOCKED_TERMS_REMAIN", 422],
    ["LLM_FAILED", 502],
    ["LLM_TIMEOUT", 504],
    ["SHEET_FETCH_FAILED", 502],
    ["FX_UNAVAILABLE", 503],
    ["INTERNAL", 500],
  ];

  it.each(table)("%s → HTTP %i", (code, status) => {
    expect(fail(code, "x").status).toBe(status);
  });

  it("에러 어휘는 표에 있는 10개뿐이다", () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(table.map(([c]) => c).sort());
  });
});
