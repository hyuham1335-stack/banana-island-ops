import { afterEach, describe, expect, it, vi } from "vitest";

// ADR-002 — Neon HTTP 드라이버 + Drizzle. 여기서는 연결하지 않는다: getEnv 를 모킹한다.

function mockEnvMissingDatabaseUrl() {
  vi.doMock("@/lib/env", () => ({
    getEnv: () => {
      throw new Error("환경변수 누락: DATABASE_URL");
    },
  }));
}

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.resetModules();
});

describe("db/client", () => {
  it("(a) 모듈을 import 하는 것만으로는 throw 하지 않는다 (지연 생성)", async () => {
    mockEnvMissingDatabaseUrl();
    await expect(import("./client")).resolves.toHaveProperty("getDb");
  });

  it("(b) DATABASE_URL 이 없는 env 로 getDb() 를 부르면 그때 throw 하고 메시지에 DATABASE_URL 이 있다", async () => {
    mockEnvMissingDatabaseUrl();
    const { getDb } = await import("./client");
    expect(() => getDb()).toThrow("DATABASE_URL");
  });
});
