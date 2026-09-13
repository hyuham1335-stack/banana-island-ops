import { defineConfig } from "drizzle-kit";

// drizzle-kit 은 앱 런타임 밖의 CLI 라 src/lib/env.ts 를 거치지 않는 유일한 예외다.
// .env.local → .env 순으로 읽는다 (Next.js 와 같은 우선순위). 둘 다 없으면 셸 환경변수만 쓴다.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
    break;
  } catch {
    // 파일이 없으면 다음 후보
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // generate 는 연결하지 않는다. migrate 는 이 자리표시 호스트에서 명확히 실패한다 —
    // 조용히 다른 DB 에 붙을 수 없다.
    url: process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost:5432/unset",
  },
});
