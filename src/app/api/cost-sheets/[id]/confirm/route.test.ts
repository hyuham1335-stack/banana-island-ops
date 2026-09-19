import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-020(런 20260920-0107-4265) 「진입점 · POST /api/cost-sheets/[id]/confirm」

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "editor" })),
}));

vi.mock("@/services/cost", () => ({
  confirmCostSheet: vi.fn(),
}));

import { getActor } from "@/lib/auth";
import { confirmCostSheet } from "@/services/cost";
import { POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const CONFIRMED_SHEET = {
  id: 1,
  productId: 10,
  distributionRoute: "kr_domestic" as const,
  name: "2026 v1",
  effectiveFrom: null,
  status: "confirmed" as const,
  confirmedAt: "2026-09-20T00:00:00.000Z",
  items: [],
};

function reqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/cost-sheets/${id}/confirm`, { method: "POST" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cost-sheets/[id]/confirm", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("editor 면 id 가 잘못되어도 403 FORBIDDEN_ROLE 을 돌려주고 confirmCostSheet 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const { request, ctx } = reqFor("abc");
    const res = await POST(request, ctx);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.details).toEqual({ required: "admin" });
    expect(confirmCostSheet).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1"])("admin 이어도 id '%s' 는 400 VALIDATION_ERROR 를 돌려주고 confirmCostSheet 를 호출하지 않는다", async (id) => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const { request, ctx } = reqFor(id);
    const res = await POST(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(confirmCostSheet).not.toHaveBeenCalled();
  });

  it("admin 이고 id 가 유효하면 confirmCostSheet 를 호출하고 200 + { data } 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(confirmCostSheet).mockResolvedValue({ ok: true, data: CONFIRMED_SHEET });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: CONFIRMED_SHEET });
    expect(confirmCostSheet).toHaveBeenCalledTimes(1);
    expect(confirmCostSheet).toHaveBeenCalledWith({ db: {} }, 1);
  });

  it("서비스가 Result.err(INVALID_TRANSITION) 를 돌려주면 409 + { error } 로 전달한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(confirmCostSheet).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "이미 확정된 원가표입니다.",
        details: { from: "confirmed", action: "confirm" },
      },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TRANSITION");
    expect(body.error.details).toEqual({ from: "confirmed", action: "confirm" });
  });

  it("서비스가 Result.err(NOT_FOUND) 를 돌려주면 404 + { error } 로 전달한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(confirmCostSheet).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id: 1 } },
    });

    const { request, ctx } = reqFor("1");
    const res = await POST(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id: 1 } },
    });
  });
});
