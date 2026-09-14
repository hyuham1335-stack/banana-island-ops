import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-002 「유닛 · src/app/api/plans/route.ts」
// src/app/api/plans/sync/route.test.ts 의 패턴을 재사용 — listPlans 를 모킹해
// Result.ok/err 각각에서 응답 상태·봉투만 확인한다. getDb 는 route.ts 가 deps 생성을 위해
// 호출하는 값이라 함께 모킹한다. 역할 검사는 계약상 없다(인가 없음).

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/services/plans", () => ({
  listPlans: vi.fn(),
}));

import { listPlans } from "@/services/plans";
import { GET, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

function reqWithMonth(month: string | null): Request {
  const url = new URL("http://localhost/api/plans");
  if (month !== null) url.searchParams.set("month", month);
  return new Request(url);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/plans", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("month 가 정상 형식이면 listPlans 를 호출하고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    const data = { plans: [], lastSync: null };
    vi.mocked(listPlans).mockResolvedValue({ ok: true, data });

    const res = await GET(reqWithMonth("2026-09"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data });
    expect(listPlans).toHaveBeenCalledTimes(1);
    // getDb() 는 모킹되어 매 호출마다 {} 를 돌려준다 — deps.db 자리에 그 값이 그대로 전달됐는지만 본다.
    expect(listPlans).toHaveBeenCalledWith({ db: {} }, "2026-09");
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(listPlans).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });

    const res = await GET(reqWithMonth("2026-09"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "알 수 없는 오류" } });
  });

  it.each([
    ["형식 오류(하이픈 없음)", "202609"],
    ["형식 오류(일까지 포함)", "2026-09-01"],
    ["형식 오류(월 두 자리 아님)", "2026-9"],
    ["형식 오류(월 00)", "2026-00"],
    ["형식 오류(월 13)", "2026-13"],
    ["형식 오류(빈 문자열)", ""],
    ["형식 오류(숫자 아님)", "abcd-ef"],
  ])("month 가 %s('%s') 이면 400 VALIDATION_ERROR 를 돌려주고 listPlans 를 호출하지 않는다", async (_label, month) => {
    const res = await GET(reqWithMonth(month));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(listPlans).not.toHaveBeenCalled();
  });

  it("month 쿼리 자체가 없으면 400 VALIDATION_ERROR 를 돌려주고 listPlans 를 호출하지 않는다", async () => {
    const res = await GET(reqWithMonth(null));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(listPlans).not.toHaveBeenCalled();
  });

  it("month 형식 오류 응답은 details 에 zod 이슈를 담는다 (fail('VALIDATION_ERROR', …, zodError.issues))", async () => {
    const res = await GET(reqWithMonth("bad-month"));

    const body = await res.json();
    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("month=2026-01 처럼 유효한 경계값도 통과한다", async () => {
    vi.mocked(listPlans).mockResolvedValue({ ok: true, data: { plans: [], lastSync: null } });

    const res = await GET(reqWithMonth("2026-01"));

    expect(res.status).toBe(200);
    expect(listPlans).toHaveBeenCalledWith(expect.anything(), "2026-01");
  });

  it("month=2026-12 처럼 유효한 경계값도 통과한다", async () => {
    vi.mocked(listPlans).mockResolvedValue({ ok: true, data: { plans: [], lastSync: null } });

    const res = await GET(reqWithMonth("2026-12"));

    expect(res.status).toBe(200);
    expect(listPlans).toHaveBeenCalledWith(expect.anything(), "2026-12");
  });
});
