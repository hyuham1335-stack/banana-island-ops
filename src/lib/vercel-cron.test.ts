import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 계약: FR-022(런 20260919-2343-1c04) 「진입점 · GET·POST /api/fx/refresh」의 전제 —
// Vercel Cron 이 GET 으로 이 경로를 부른다(D2). vercel.json 은 메인 단독 소유라 이 테스트는
// 그 파일을 읽기만 한다 — 리포 루트 기준으로 __dirname 에서 상대 경로를 잡아 cwd 가정을 피한다.

describe("vercel.json cron 등록", () => {
  it("crons 배열에 { path: '/api/fx/refresh', schedule: '10 0 * * *' } 가 있다", () => {
    const vercelJsonPath = path.join(__dirname, "..", "..", "vercel.json");
    const raw = fs.readFileSync(vercelJsonPath, "utf-8");
    const config = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> };

    expect(config.crons).toContainEqual({ path: "/api/fx/refresh", schedule: "10 0 * * *" });
  });
});
