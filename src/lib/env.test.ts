import { afterEach, describe, expect, it, vi } from "vitest";

// docs/TRD.md §6 「보안」·§9 「비밀값·환경변수」 — env.ts 하나가 zod 로 읽고 없으면 부팅 실패.

const REQUIRED = {
  DATABASE_URL: "postgresql://user:pw@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  ANTHROPIC_API_KEY: "sk-ant-test",
  LLM_MODEL: "claude-sonnet-5",
  PRODUCT_BASE_URL: "https://bisland.kr",
};

const OPTIONAL_KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "SHEET_ID",
  "SHEET_RANGE",
  "CRON_SECRET",
  "SHEET_WEBHOOK_SECRET",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("parseEnv", () => {
  it("(a) 필수 4 가 전부 있으면 통과하고 선택 키는 undefined 를 허용한다", async () => {
    const { parseEnv } = await import("./env");
    const env = parseEnv({ ...REQUIRED });
    expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
    expect(env.LLM_MODEL).toBe("claude-sonnet-5");
    for (const k of OPTIONAL_KEYS) expect(env[k]).toBeUndefined();
  });

  it.each(Object.keys(REQUIRED))("(b) 필수 %s 가 없으면 throw 하고 메시지에 그 키 이름이 있다", async (key) => {
    const { parseEnv } = await import("./env");
    const raw: Record<string, string | undefined> = { ...REQUIRED };
    delete raw[key];
    expect(() => parseEnv(raw)).toThrow(key);
  });

  it.each(["", "   "])("(b) 필수 값이 빈 문자열·공백(%j)이면 누락과 같이 throw 한다", async (blank) => {
    const { parseEnv } = await import("./env");
    expect(() => parseEnv({ ...REQUIRED, ANTHROPIC_API_KEY: blank })).toThrow("ANTHROPIC_API_KEY");
    expect(() => parseEnv({ ...REQUIRED, LLM_MODEL: blank })).toThrow("LLM_MODEL");
  });

  it.each(["DATABASE_URL", "PRODUCT_BASE_URL"])("(c) %s 가 URL 형식이 아니면 throw 한다", async (key) => {
    const { parseEnv } = await import("./env");
    expect(() => parseEnv({ ...REQUIRED, [key]: "not a url" })).toThrow(key);
  });

  it("(d) 인자로 받은 객체만 보고 process.env 를 읽거나 바꾸지 않는다", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { parseEnv } = await import("./env");
    const before = { ...process.env };
    expect(() => parseEnv({ ...REQUIRED })).not.toThrow();
    expect(process.env).toEqual(before);
  });

  it("(g) Neon 형 postgresql://…?sslmode=require 를 통과시킨다", async () => {
    const { parseEnv } = await import("./env");
    const env = parseEnv({ ...REQUIRED, DATABASE_URL: "postgresql://u:p@localhost:5432/db?sslmode=require" });
    expect(env.DATABASE_URL).toContain("sslmode=require");
  });
});

describe("getEnv", () => {
  it("(e) 모듈을 import 하는 것만으로는 필수 키가 없어도 throw 하지 않는다 (지연 평가)", async () => {
    for (const k of Object.keys(REQUIRED)) vi.stubEnv(k, "");
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("(f) NEXT_PHASE=phase-production-build 여도 필수 키가 없으면 getEnv() 는 throw 한다 (우회 분기 없음)", async () => {
    for (const k of Object.keys(REQUIRED)) vi.stubEnv(k, "");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { getEnv } = await import("./env");
    expect(() => getEnv()).toThrow("DATABASE_URL");
  });

  it("필수 키가 있으면 getEnv() 가 같은 객체를 캐시해 돌려준다", async () => {
    for (const [k, v] of Object.entries(REQUIRED)) vi.stubEnv(k, v);
    const { getEnv } = await import("./env");
    expect(getEnv()).toBe(getEnv());
    expect(getEnv().PRODUCT_BASE_URL).toBe("https://bisland.kr");
  });
});
