import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-022(런 20260919-2343-1c04) 「진입점 · GET·POST /api/fx/refresh」
// 시크릿 비교는 헤더 없음·CRON_SECRET 미설정·길이 불일치를 timingSafeEqual 호출 전에
// 403 으로 끊는다(02 F-1) — 이 검사 전에는 getDb·createFxClient·refreshFx 를 포함해
// 아무것도 부르지 않는다.

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/fx-client", () => ({
  createFxClient: vi.fn(() => ({})),
}));

vi.mock("@/services/fx", () => ({
  refreshFx: vi.fn(),
  todayUtc: vi.fn(() => "2026-09-20"),
}));

import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/db/client";
import { createFxClient } from "@/lib/fx-client";
import { refreshFx } from "@/services/fx";
import { GET, POST, maxDuration } from "./route";

const SNAPSHOT = {
  asOf: "2026-09-20",
  staleDays: 0,
  rates: { usdKrw: "1380.50000000", phpKrw: "24.60784314" },
  source: "api" as const,
};

function req(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/fx/refresh", { headers });
}

function mockSecret(secret: string | undefined): void {
  vi.mocked(getEnv).mockReturnValue({ CRON_SECRET: secret } as unknown as ReturnType<typeof getEnv>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET·POST /api/fx/refresh", () => {
  it("maxDuration 이 30초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(30);
  });

  it("헤더가 없으면 403 FORBIDDEN_ROLE 이고 getDb·createFxClient·refreshFx 를 호출하지 않는다", async () => {
    mockSecret("s3cret");

    const res = await GET(req());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.details).toEqual({ required: "cron" });
    expect(getDb).not.toHaveBeenCalled();
    expect(createFxClient).not.toHaveBeenCalled();
    expect(refreshFx).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 이 설정돼 있지 않으면(헤더가 있어도) 403 FORBIDDEN_ROLE 이고 refreshFx 를 호출하지 않는다", async () => {
    mockSecret(undefined);

    const res = await GET(req({ authorization: "Bearer anything" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(refreshFx).not.toHaveBeenCalled();
  });

  it("토큰 길이는 같지만 값이 틀리면 403 FORBIDDEN_ROLE 이고 refreshFx 를 호출하지 않는다", async () => {
    mockSecret("s3cret");

    const res = await POST(req({ authorization: "Bearer x3cret" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(refreshFx).not.toHaveBeenCalled();
  });

  it("(02 F-1) 토큰 길이가 다르면 403 FORBIDDEN_ROLE 이고 refreshFx 를 호출하지 않는다", async () => {
    mockSecret("s3cret");

    const res = await POST(req({ authorization: "Bearer short" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(refreshFx).not.toHaveBeenCalled();
  });

  it("올바른 토큰으로 GET 하면 200 + { data } 를 돌려준다", async () => {
    mockSecret("s3cret");
    vi.mocked(refreshFx).mockResolvedValue({ ok: true, data: SNAPSHOT });

    const res = await GET(req({ authorization: "Bearer s3cret" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SNAPSHOT });
    expect(refreshFx).toHaveBeenCalledTimes(1);
  });

  it("올바른 토큰으로 POST 하면 200 + { data } 를 돌려준다", async () => {
    mockSecret("s3cret");
    vi.mocked(refreshFx).mockResolvedValue({ ok: true, data: SNAPSHOT });

    const res = await POST(req({ authorization: "Bearer s3cret" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SNAPSHOT });
    expect(refreshFx).toHaveBeenCalledTimes(1);
  });

  it("서비스가 FX_UNAVAILABLE 을 돌려주면 503 + { error } 를 돌려준다", async () => {
    mockSecret("s3cret");
    vi.mocked(refreshFx).mockResolvedValue({
      ok: false,
      error: {
        code: "FX_UNAVAILABLE",
        message: "환율을 불러오지 못했습니다. 마지막 값을 유지합니다.",
        details: { lastRateDate: "2026-09-19" },
      },
    });

    const res = await POST(req({ authorization: "Bearer s3cret" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: "FX_UNAVAILABLE",
        message: "환율을 불러오지 못했습니다. 마지막 값을 유지합니다.",
        details: { lastRateDate: "2026-09-19" },
      },
    });
  });
});
