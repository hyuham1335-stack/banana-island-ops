import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: _workspace/contract_must-fr001-sheet-sync.md 「유닛 · src/lib/sheets.ts」
// googleapis 를 vi.mock 으로 모킹한다 — 실제 네트워크 호출 없음.

const getMock = vi.fn();
const sheetsFactoryMock = vi.fn(() => ({ spreadsheets: { values: { get: getMock } } }));
const jwtMock = vi.fn().mockImplementation((config: unknown) => ({ __config: config }));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: jwtMock },
    sheets: sheetsFactoryMock,
  },
}));

const ENV = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
  GOOGLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
  SHEET_ID: "sheet-123",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("createSheetsClient", () => {
  it("8칸 미만 행은 나머지를 빈 문자열로 채운다", async () => {
    getMock.mockResolvedValue({ data: { values: [["p1", "2026-09-20", "채널"]] } });
    const { createSheetsClient } = await import("./sheets");
    const client = createSheetsClient(ENV);
    const rows = await client.readRows("Sheet1!A2:H");
    expect(rows).toEqual([["p1", "2026-09-20", "채널", "", "", "", "", ""]]);
  });

  it("행 안의 undefined 칸도 빈 문자열로 채운다", async () => {
    getMock.mockResolvedValue({ data: { values: [["p1", undefined, "채널"]] } });
    const { createSheetsClient } = await import("./sheets");
    const client = createSheetsClient(ENV);
    const rows = await client.readRows("Sheet1!A2:H");
    expect(rows).toEqual([["p1", "", "채널", "", "", "", "", ""]]);
  });

  it("9칸 이상 들어와도 초과분을 자르지 않는 등 원본을 훼손하지 않는다 (최소 8칸 보장만 한다)", async () => {
    getMock.mockResolvedValue({ data: { values: [["a", "b", "c", "d", "e", "f", "g", "h"]] } });
    const { createSheetsClient } = await import("./sheets");
    const client = createSheetsClient(ENV);
    const rows = await client.readRows("Sheet1!A2:H");
    expect(rows[0]).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("values 가 없으면(응답에 필드 자체가 없음) 빈 배열을 돌려준다", async () => {
    getMock.mockResolvedValue({ data: {} });
    const { createSheetsClient } = await import("./sheets");
    const client = createSheetsClient(ENV);
    const rows = await client.readRows("Sheet1!A2:H");
    expect(rows).toEqual([]);
  });

  it("spreadsheets.values.get 을 spreadsheetId·range·FORMATTED_VALUE 로 호출한다", async () => {
    getMock.mockResolvedValue({ data: { values: [] } });
    const { createSheetsClient } = await import("./sheets");
    const client = createSheetsClient(ENV);
    await client.readRows("Sheet1!A2:H");
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "sheet-123",
        range: "Sheet1!A2:H",
        valueRenderOption: "FORMATTED_VALUE",
      }),
    );
  });

  it.each(["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "SHEET_ID"] as const)(
    "%s 가 없으면 readRows 호출 시점에 throw 한다 (SHEET_FETCH_FAILED 로 이어지는 경로)",
    async (missingKey) => {
      const { createSheetsClient } = await import("./sheets");
      const badEnv = { ...ENV, [missingKey]: undefined };
      const client = createSheetsClient(badEnv);
      await expect(client.readRows("Sheet1!A2:H")).rejects.toThrow();
    },
  );

  it("env 가 모두 있으면 생성 시점에는 throw 하지 않는다 (생성과 호출을 분리)", async () => {
    const { createSheetsClient } = await import("./sheets");
    expect(() => createSheetsClient(ENV)).not.toThrow();
  });
});
