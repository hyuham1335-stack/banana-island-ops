import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-022(런 20260919-2343-1c04) 「진입점 · GET·POST /api/fx」
// contents/[id]/approve/route.test.ts 패턴 재사용 — getFx·saveManualFx 를 모킹해
// 응답 상태·봉투만 확인한다. getDb·getActor·todayUtc 는 route.ts 가 deps 구성을 위해
// 호출하는 값이라 함께 모킹한다. 쿼리·본문 검증은 실제 schemas.ts 를 그대로 쓴다
// (외부 경계가 아니므로 모킹 대상이 아니다).

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "editor" })),
}));

vi.mock("@/services/fx", () => ({
  getFx: vi.fn(),
  saveManualFx: vi.fn(),
  todayUtc: vi.fn(() => "2026-09-20"),
}));

import { getActor } from "@/lib/auth";
import { getFx, saveManualFx } from "@/services/fx";
import { GET, POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const SNAPSHOT = {
  asOf: "2026-09-20",
  staleDays: 0,
  rates: { usdKrw: "1380.50000000", phpKrw: "24.60784314" },
  source: "api" as const,
};

function reqGet(dateParam: string | null): Request {
  const url = new URL("http://localhost/api/fx");
  if (dateParam !== null) url.searchParams.set("date", dateParam);
  return new Request(url);
}

function reqPost(body: unknown, rawBody?: string): Request {
  return new Request("http://localhost/api/fx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/fx", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("date 쿼리 없이 호출하면 todayUtc() 값을 getFx 에 넘기고 Result.ok 를 200 + { data } 로 돌려준다", async () => {
    vi.mocked(getFx).mockResolvedValue({ ok: true, data: SNAPSHOT });

    const res = await GET(reqGet(null));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: SNAPSHOT });
    expect(getFx).toHaveBeenCalledTimes(1);
    expect(getFx).toHaveBeenCalledWith({ db: {} }, "2026-09-20");
  });

  it("date 쿼리가 유효하면 그 값을 getFx 에 그대로 넘긴다", async () => {
    vi.mocked(getFx).mockResolvedValue({ ok: true, data: SNAPSHOT });

    await GET(reqGet("2026-09-18"));

    expect(getFx).toHaveBeenCalledWith({ db: {} }, "2026-09-18");
  });

  it("date 형식이 올바르지 않으면(실존하지 않는 날짜) 400 VALIDATION_ERROR 를 돌려주고 getFx 를 호출하지 않는다", async () => {
    const res = await GET(reqGet("2026-02-30"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(getFx).not.toHaveBeenCalled();
  });

  it("Result.err(FX_UNAVAILABLE) 면 503 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getFx).mockResolvedValue({
      ok: false,
      error: { code: "FX_UNAVAILABLE", message: "환율 데이터가 없습니다.", details: { lastRateDate: null } },
    });

    const res = await GET(reqGet(null));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "FX_UNAVAILABLE", message: "환율 데이터가 없습니다.", details: { lastRateDate: null } },
    });
  });
});

describe("POST /api/fx", () => {
  const VALID_INPUT = { rateDate: "2026-09-18", usdKrw: "1380.50000000", phpKrw: "24.60784314" };

  it("admin 이 아니면(editor) 403 FORBIDDEN_ROLE 을 본문 파싱 전에 돌려준다 — JSON 이 아닌 본문이어도 400 이 아니라 403이고 request.json·saveManualFx 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const req = reqPost(undefined, "not-json");
    const jsonSpy = vi.spyOn(req, "json");

    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.details).toEqual({ required: "admin" });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(saveManualFx).not.toHaveBeenCalled();
  });

  it("admin 이고 본문이 유효하면 saveManualFx 를 호출하고 Result.ok 를 201 + { data } 로 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(saveManualFx).mockResolvedValue({ ok: true, data: { ...SNAPSHOT, source: "manual" } });

    const res = await POST(reqPost(VALID_INPUT));

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: { ...SNAPSHOT, source: "manual" } });
    expect(saveManualFx).toHaveBeenCalledTimes(1);
    expect(saveManualFx).toHaveBeenCalledWith({ db: {} }, VALID_INPUT, "2026-09-20");
  });

  it("admin 이어도 본문이 JSON 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 saveManualFx 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const res = await POST(reqPost(undefined, "not-json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(saveManualFx).not.toHaveBeenCalled();
  });

  it("admin 이어도 본문 검증에 실패하면(usdKrw '0') 400 VALIDATION_ERROR 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const res = await POST(reqPost({ ...VALID_INPUT, usdKrw: "0" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(saveManualFx).not.toHaveBeenCalled();
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(saveManualFx).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "환율 저장 중 오류가 발생했습니다." },
    });

    const res = await POST(reqPost(VALID_INPUT));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "환율 저장 중 오류가 발생했습니다." },
    });
  });
});
