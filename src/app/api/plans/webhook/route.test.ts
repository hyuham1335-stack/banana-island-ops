import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: _workspace/contract_should-fr024-sheet-webhook.md 「진입점 · POST /api/plans/webhook」
// src/app/api/plans/sync/route.test.ts 와 같은 모킹 패턴(getEnv·getDb·createSheetsClient·syncPlansFromSheet).
// getEnv 는 테스트마다 SHEET_WEBHOOK_SECRET 을 바꿀 수 있도록 mockReturnValue 로 제어한다.

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({})),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/sheets", () => ({
  createSheetsClient: vi.fn(() => ({ readRows: vi.fn() })),
}));

vi.mock("@/services/plan-sync", () => ({
  syncPlansFromSheet: vi.fn(),
}));

import { getEnv } from "@/lib/env";
import { syncPlansFromSheet } from "@/services/plan-sync";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/plans/webhook", {
    method: "POST",
    headers,
    body: undefined,
  });
}

function setSecret(secret: string | undefined) {
  vi.mocked(getEnv).mockReturnValue({ SHEET_WEBHOOK_SECRET: secret } as ReturnType<typeof getEnv>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/plans/webhook", () => {
  it("maxDuration 이 30초로 예산화되어 있다 (sync 와 같은 예산, TRD §9)", () => {
    expect(maxDuration).toBe(30);
  });

  describe("거부 경로 — 전부 403 FORBIDDEN_ROLE, details 없음, syncPlansFromSheet 미호출", () => {
    it("헤더 없음", async () => {
      setSecret("secret-value-1234");
      const res = await POST(makeRequest());

      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toBe(JSON_UTF8);
      expect(await res.json()).toEqual({
        error: { code: "FORBIDDEN_ROLE", message: expect.any(String) },
      });
      expect(syncPlansFromSheet).not.toHaveBeenCalled();
    });

    it("같은 길이인데 값이 다름", async () => {
      setSecret("aaaaaaaaaa");
      const res = await POST(makeRequest({ "x-sheet-secret": "bbbbbbbbbb" }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "FORBIDDEN_ROLE", message: expect.any(String) },
      });
      expect(syncPlansFromSheet).not.toHaveBeenCalled();
    });

    it("길이가 다른 값 불일치", async () => {
      setSecret("short");
      const res = await POST(makeRequest({ "x-sheet-secret": "a-much-longer-secret-value" }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "FORBIDDEN_ROLE", message: expect.any(String) },
      });
      expect(syncPlansFromSheet).not.toHaveBeenCalled();
    });

    it("서버 시크릿 미설정 + 헤더 없음", async () => {
      setSecret(undefined);
      const res = await POST(makeRequest());

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "FORBIDDEN_ROLE", message: expect.any(String) },
      });
      expect(syncPlansFromSheet).not.toHaveBeenCalled();
    });

    it("서버 시크릿 미설정 + 헤더 빈 문자열", async () => {
      setSecret(undefined);
      const res = await POST(makeRequest({ "x-sheet-secret": "" }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "FORBIDDEN_ROLE", message: expect.any(String) },
      });
      expect(syncPlansFromSheet).not.toHaveBeenCalled();
    });

    it("서버 시크릿 미설정 + 헤더 아무 값", async () => {
      setSecret(undefined);
      const res = await POST(makeRequest({ "x-sheet-secret": "whatever-value" }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "FORBIDDEN_ROLE", message: expect.any(String) },
      });
      expect(syncPlansFromSheet).not.toHaveBeenCalled();
    });

    it("응답 본문은 details 키를 포함하지 않는다", async () => {
      setSecret("secret-value-1234");
      const res = await POST(makeRequest());
      const body = await res.json();

      expect(Object.keys(body.error)).toEqual(["code", "message"]);
    });
  });

  it("헤더가 서버 시크릿과 일치하면 syncPlansFromSheet 를 trigger 'webhook' 으로 정확히 1회 호출하고 200 { data } 를 돌려준다", async () => {
    setSecret("matching-secret-value");
    const data = { importId: 1, totalRows: 3, upserted: 3, held: 0, failed: 0, errors: [] };
    vi.mocked(syncPlansFromSheet).mockResolvedValue({ ok: true, data });

    const res = await POST(makeRequest({ "x-sheet-secret": "matching-secret-value" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data });
    expect(syncPlansFromSheet).toHaveBeenCalledTimes(1);
    expect(syncPlansFromSheet).toHaveBeenCalledWith(expect.anything(), "webhook");
  });

  it("Result.err(SHEET_FETCH_FAILED) 면 502 + { error } 봉투를 돌려준다 (sync 와 같은 코드)", async () => {
    setSecret("matching-secret-value");
    vi.mocked(syncPlansFromSheet).mockResolvedValue({
      ok: false,
      error: { code: "SHEET_FETCH_FAILED", message: "시트를 읽지 못했습니다." },
    });

    const res = await POST(makeRequest({ "x-sheet-secret": "matching-secret-value" }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "SHEET_FETCH_FAILED", message: "시트를 읽지 못했습니다." },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다 (sync 와 같은 코드)", async () => {
    setSecret("matching-secret-value");
    vi.mocked(syncPlansFromSheet).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });

    const res = await POST(makeRequest({ "x-sheet-secret": "matching-secret-value" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });
  });

  it("본문이 JSON 이 아니어도(혹은 있어도) 결과는 같다 — 요청 본문을 읽지 않는다", async () => {
    setSecret("matching-secret-value");
    const data = { importId: 2, totalRows: 0, upserted: 0, held: 0, failed: 0, errors: [] };
    vi.mocked(syncPlansFromSheet).mockResolvedValue({ ok: true, data });

    const req = new Request("http://localhost/api/plans/webhook", {
      method: "POST",
      headers: { "x-sheet-secret": "matching-secret-value" },
      body: "not-json-at-all {{{",
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data });
  });

  it("본문이 임의의 JSON 필드를 담고 있어도 결과는 같다", async () => {
    setSecret("matching-secret-value");
    const data = { importId: 3, totalRows: 0, upserted: 0, held: 0, failed: 0, errors: [] };
    vi.mocked(syncPlansFromSheet).mockResolvedValue({ ok: true, data });

    const req = new Request("http://localhost/api/plans/webhook", {
      method: "POST",
      headers: { "x-sheet-secret": "matching-secret-value", "content-type": "application/json" },
      body: JSON.stringify({ arbitrary: "field", nested: { x: 1 } }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data });
  });

  it("거부 로그(console.warn)에 시크릿·헤더 값이 실리지 않는다", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setSecret("super-secret-value");
    await POST(makeRequest({ "x-sheet-secret": "attacker-guess-value" }));

    for (const call of warnSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("super-secret-value");
      expect(serialized).not.toContain("attacker-guess-value");
    }

    warnSpy.mockRestore();
  });
});
