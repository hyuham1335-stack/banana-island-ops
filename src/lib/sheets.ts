import { google } from "googleapis";
import type { Env } from "@/lib/env";

/**
 * 구글 시트 읽기 클라이언트 — docs/TRD.md §4 「시트 행 계약」·§7 (타임아웃 10초, 재시도 0회).
 * 읽기 전용 스코프만 쓴다. 쓰기는 하지 않는다(ADR-006).
 */

const SHEET_COLUMNS = 8;
const READ_TIMEOUT_MS = 10_000;

export interface SheetsClient {
  readRows(range: string): Promise<string[][]>;
}

type SheetsEnv = Pick<Env, "GOOGLE_SERVICE_ACCOUNT_EMAIL" | "GOOGLE_PRIVATE_KEY" | "SHEET_ID">;

type JwtOptions = ConstructorParameters<typeof google.auth.JWT>[0];

function createJwt(options: JwtOptions) {
  return new google.auth.JWT(options);
}

export function createSheetsClient(env: SheetsEnv): SheetsClient {
  return {
    async readRows(range: string): Promise<string[][]> {
      const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID } = env;
      if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !SHEET_ID) {
        throw new Error(
          "시트 연동 환경변수 누락: GOOGLE_SERVICE_ACCOUNT_EMAIL · GOOGLE_PRIVATE_KEY · SHEET_ID",
        );
      }

      const auth = createJwt({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        // Vercel 환경변수에 개행이 \n 문자열로 저장되는 관례를 되돌린다.
        key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
      const sheets = google.sheets({ version: "v4", auth });

      // 10초 타임아웃 — SDK 호출 자체는 단일 인자로 두고 AbortController 는 레이스로만 쓴다.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
      const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("시트 읽기 타임아웃(10초)")));
      });
      try {
        const res = await Promise.race([
          sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range,
            valueRenderOption: "FORMATTED_VALUE",
          }),
          aborted,
        ]);
        const rows = res.data.values ?? [];
        return rows.map(normalizeRow);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** 모자란 칸·undefined 는 '' 로 채워 항상 8칸을 돌려준다. */
function normalizeRow(row: unknown[]): string[] {
  const cells: string[] = [];
  for (let i = 0; i < SHEET_COLUMNS; i++) {
    const v = row[i];
    cells.push(v === undefined || v === null ? "" : String(v));
  }
  return cells;
}
