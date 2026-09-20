import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-020(런 20260920-0107-4265) 「진입점 · GET·POST /api/cost-sheets」
// fx route.test.ts 패턴 재사용 — listCostSheets·createCostSheet 를 모킹해 응답 상태·봉투만
// 확인한다. 쿼리·본문 검증은 실제 schemas.ts 를 그대로 쓴다(외부 경계가 아니다).

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(() => ({ role: "editor" })),
}));

vi.mock("@/services/cost", () => ({
  listCostSheets: vi.fn(),
  createCostSheet: vi.fn(),
}));

import { getActor } from "@/lib/auth";
import { createCostSheet, listCostSheets } from "@/services/cost";
import { GET, POST, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

const SHEET = {
  id: 1,
  productId: 10,
  distributionRoute: "kr_domestic" as const,
  name: "2026 v1",
  effectiveFrom: null,
  status: "draft" as const,
  confirmedAt: null,
  items: [],
};

function reqGet(query: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/cost-sheets");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url);
}

function reqPost(body: unknown, rawBody?: string): Request {
  return new Request("http://localhost/api/cost-sheets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cost-sheets", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("editor(admin 아님)면 403 FORBIDDEN_ROLE 을 쿼리 파싱 전에 돌려주고 listCostSheets 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const res = await GET(reqGet({ productId: "not-a-number" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.details).toEqual({ required: "admin" });
    expect(listCostSheets).not.toHaveBeenCalled();
  });

  it("쿠키가 없어도(editor 기본값) 403 을 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const res = await GET(reqGet());

    expect(res.status).toBe(403);
    expect(listCostSheets).not.toHaveBeenCalled();
  });

  it("admin 이고 필터가 있으면 listCostSheets 에 그대로 전달하고 200 + { data } 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(listCostSheets).mockResolvedValue({ ok: true, data: [SHEET] });

    const res = await GET(reqGet({ productId: "10", distributionRoute: "kr_domestic" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: [SHEET] });
    expect(listCostSheets).toHaveBeenCalledTimes(1);
    expect(listCostSheets).toHaveBeenCalledWith({ db: {} }, { productId: 10, distributionRoute: "kr_domestic" });
  });

  it("admin 이고 productId 가 잘못된 형식(양의 정수 아님)이면 400 VALIDATION_ERROR 를 돌려주고 listCostSheets 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const res = await GET(reqGet({ productId: "0" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(listCostSheets).not.toHaveBeenCalled();
  });

  it("서비스가 Result.err(INTERNAL) 이면 500 + { error } 봉투를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(listCostSheets).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "원가표 조회 중 오류가 발생했습니다." },
    });

    const res = await GET(reqGet());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "원가표 조회 중 오류가 발생했습니다." },
    });
  });
});

describe("POST /api/cost-sheets", () => {
  const VALID_INPUT = { productId: 10, distributionRoute: "kr_domestic" as const, name: "2026 v1" };

  it("editor 면 깨진 JSON 본문이어도 403 FORBIDDEN_ROLE 을 본문 파싱 전에 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "editor" });

    const req = reqPost(undefined, "not-json");
    const jsonSpy = vi.spyOn(req, "json");

    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.details).toEqual({ required: "admin" });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(createCostSheet).not.toHaveBeenCalled();
  });

  it("admin 이고 유효한 본문이면 createCostSheet 를 호출하고 201 + { data } 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(createCostSheet).mockResolvedValue({ ok: true, data: SHEET });

    const res = await POST(reqPost(VALID_INPUT));

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    expect(await res.json()).toEqual({ data: SHEET });
    expect(createCostSheet).toHaveBeenCalledTimes(1);
    expect(createCostSheet).toHaveBeenCalledWith({ db: {} }, VALID_INPUT);
  });

  it("admin 이어도 본문이 JSON 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 createCostSheet 를 호출하지 않는다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const res = await POST(reqPost(undefined, "not-json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createCostSheet).not.toHaveBeenCalled();
  });

  it("admin 이어도 스키마 검증에 실패하면(name 빈 문자열) 400 VALIDATION_ERROR 를 돌려준다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });

    const res = await POST(reqPost({ ...VALID_INPUT, name: "" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createCostSheet).not.toHaveBeenCalled();
  });

  it("서비스가 Result.err(NOT_FOUND) 를 돌려주면 그대로 404 + { error } 로 전달한다", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(createCostSheet).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "제품을 찾을 수 없습니다.", details: { resource: "product", id: 10 } },
    });

    const res = await POST(reqPost(VALID_INPUT));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "제품을 찾을 수 없습니다.", details: { resource: "product", id: 10 } },
    });
  });

  it("서비스가 Result.err(INVALID_TRANSITION) 를 돌려주면 409 + { error } 로 전달한다(복제 원본이 draft)", async () => {
    vi.mocked(getActor).mockReturnValue({ role: "admin" });
    vi.mocked(createCostSheet).mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "작성중인 원가표는 복제할 수 없습니다.",
        details: { from: "draft", action: "clone" },
      },
    });

    const res = await POST(reqPost({ ...VALID_INPUT, cloneFromId: 5 }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TRANSITION");
    expect(body.error.details).toEqual({ from: "draft", action: "clone" });
  });
});
