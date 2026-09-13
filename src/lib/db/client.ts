import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Drizzle + Neon HTTP 드라이버 (ADR-002). 서버리스라 연결 풀이 없고, HTTP 모드는
 * 다중 문 트랜잭션이 없다 — 상태 전이는 단일 UPDATE 로 설계한다.
 * 모듈 최상위에서 만들지 않는다 — getDb() 가 첫 호출에 만들고 캐시한다.
 */

export type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | undefined;

export function getDb(): Db {
  if (!cached) cached = drizzle(neon(getEnv().DATABASE_URL), { schema });
  return cached;
}
