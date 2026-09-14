import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: _workspace/contract_must-fr001-sheet-sync.md 「유닛 · src/app/api/plans/sync/route.ts」
// plan-sync.ts 를 모킹해 Result.ok/Result.err 각각에서 응답 상태·봉투만 확인한다.
// getEnv·getDb·createSheetsClient 는 route.ts 가 deps 생성을 위해 호출하는 값이라 함께 모킹한다.

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

import { syncPlansFromSheet } from "@/services/plan-sync";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/plans/sync", () => {
  it("maxDuration 이 30초로 예산화되어 있다 (TRD §9 — LLM 아닌 라우트는 별도지만 계약이 30 을 못박음)", () => {
    expect(maxDuration).toBe(30);
  });

  it("Result.ok 면 200 + { data: SyncResult } 봉투를 돌려준다", async () => {
    const data = {
      importId: 1,
      totalRows: 2,
      upserted: 2,
      held: 0,
      failed: 0,
      errors: [],
    };
    vi.mocked(syncPlansFromSheet).mockResolvedValue({ ok: true, data });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data });
  });

  it("Result.err(SHEET_FETCH_FAILED) 면 502 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(syncPlansFromSheet).mockResolvedValue({
      ok: false,
      error: { code: "SHEET_FETCH_FAILED", message: "시트를 읽지 못했습니다." },
    });

    const res = await POST();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "SHEET_FETCH_FAILED", message: "시트를 읽지 못했습니다." },
    });
  });

  it("Result.err(INTERNAL) 면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(syncPlansFromSheet).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });

    const res = await POST();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "알 수 없는 오류" },
    });
  });

  it("details 가 있는 Result.err 는 봉투에 details 를 포함한다", async () => {
    vi.mocked(syncPlansFromSheet).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "알 수 없는 오류", details: { cause: "x" } },
    });

    const res = await POST();

    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "알 수 없는 오류", details: { cause: "x" } },
    });
  });

  it("syncPlansFromSheet 를 trigger 'manual' 로 정확히 1회 호출한다", async () => {
    vi.mocked(syncPlansFromSheet).mockResolvedValue({
      ok: true,
      data: { importId: 1, totalRows: 0, upserted: 0, held: 0, failed: 0, errors: [] },
    });

    await POST();

    expect(syncPlansFromSheet).toHaveBeenCalledTimes(1);
    expect(syncPlansFromSheet).toHaveBeenCalledWith(expect.anything(), "manual");
  });
});
