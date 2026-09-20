import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-020(런 20260920-0107-4265) 「진입점 · PATCH /api/cost-sheets/[id]」
// contents/[id]/route.test.ts · fx route.test.ts 패턴 재사용.

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "editor" })),
}));

vi.mock("@/services/cost", () => ({
  updateCostSheet: vi.fn(),
}));

import { getActor } from "@/lib/auth";
import { updateCostSheet } from "@/services/cost";
import { PATCH, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const SHEET = {
  id: 1,
  productId: 10,
  distributionRoute: "kr_domestic" as const,
  name: "수정됨",
  effectiveFrom: null,
  status: "draft" as const,
  confirmedAt: null,
  items: [],
};

const VALID_BODY = { name: "수정됨", items: [] };

function reqFor(id: string, body: unknown, rawBody?: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/cost-sheets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: rawBody ?? JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/cost-sheets/[id]", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("editor 면 id·본문이 잘못되어도 403 FORBIDDEN_ROLE 을 돌려주고 updateCostSheet 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const { request, ctx } = reqFor("abc", undefined, "not-json");
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.details).toEqual({ required: "admin" });
    expect(updateCostSheet).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1"])("admin 이어도 id '%s' 는 400 VALIDATION_ERROR 를 돌려주고 updateCostSheet 를 호출하지 않는다", async (id) => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const { request, ctx } = reqFor(id, VALID_BODY);
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(updateCostSheet).not.toHaveBeenCalled();
  });

  it("admin 이고 본문이 JSON 형식이 아니면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const { request, ctx } = reqFor("1", undefined, "not-json");
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(updateCostSheet).not.toHaveBeenCalled();
  });

  it("admin 이어도 items 가 101개면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    const items = Array.from({ length: 101 }, () => ({
      stage: "ph" as const,
      costKind: "원료",
      amount: "100",
      currency: "PHP" as const,
      basis: "per_unit" as const,
      batchQty: null,
    }));

    const { request, ctx } = reqFor("1", { items });
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(400);
    expect(updateCostSheet).not.toHaveBeenCalled();
  });

  it("admin 이고 id·본문이 유효하면 updateCostSheet 를 호출하고 200 + { data } 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(updateCostSheet).mockResolvedValue({ ok: true, data: SHEET });

    const { request, ctx } = reqFor("1", VALID_BODY);
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: SHEET });
    expect(updateCostSheet).toHaveBeenCalledTimes(1);
    expect(updateCostSheet).toHaveBeenCalledWith({ db: {} }, 1, VALID_BODY);
  });

  it("서비스가 Result.err(INVALID_TRANSITION) 를 돌려주면 409 + { error } 로 전달한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(updateCostSheet).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "이미 확정된 원가표입니다.",
        details: { from: "confirmed", action: "update" },
      },
    });

    const { request, ctx } = reqFor("1", VALID_BODY);
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TRANSITION");
    expect(body.error.details).toEqual({ from: "confirmed", action: "update" });
  });

  it("서비스가 Result.err(NOT_FOUND) 를 돌려주면 404 + { error } 로 전달한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(updateCostSheet).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id: 1 } },
    });

    const { request, ctx } = reqFor("1", VALID_BODY);
    const res = await PATCH(request, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id: 1 } },
    });
  });
});
