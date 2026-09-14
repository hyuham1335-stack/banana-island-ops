import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약: _workspace/contract_must-fr001-sheet-sync.md 「유닛 · src/services/plan-sync.ts」
//
// (a) decideSyncPlan 은 순수 함수 — DB·네트워크 모킹 없이 rows·masters 만 바꿔가며
//     AC1~4·7·9 의 행 분류 로직을 전수 검증한다.
// (b) syncPlansFromSheet 오케스트레이터는 deps.db 를 가벼운 vi.fn() 체인으로 모킹해
//     "올바른 인자로 정확히 불렸는가"만 스모크 테스트한다 (AC10 호출 횟수, AC11 백필 대상 포함).

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ SHEET_RANGE: "Sheet1!A2:H" }),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    notInArray: vi.fn(actual.notInArray),
    inArray: vi.fn(actual.inArray),
  };
});

import { inArray, notInArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { SheetsClient } from "@/lib/sheets";
import { decideSyncPlan, syncPlansFromSheet } from "./plan-sync";

// ---------------------------------------------------------------------------
// (a) decideSyncPlan — 순수 함수
// ---------------------------------------------------------------------------

type RowOverrides = Partial<{
  planId: string;
  scheduledDate: string;
  channel: string;
  product: string;
  lang: string;
  postTypeLabel: string;
  topic: string;
  owner: string;
}>;

function row(overrides: RowOverrides = {}): string[] {
  return [
    overrides.planId ?? "PLAN-1",
    overrides.scheduledDate ?? "2026-09-20",
    overrides.channel ?? "네이버 스마트스토어",
    overrides.product ?? "바나나칩 오리지널",
    overrides.lang ?? "ko",
    overrides.postTypeLabel ?? "건강정보형",
    overrides.topic ?? "토픽",
    overrides.owner ?? "김담당",
  ];
}

const masters = {
  channels: new Map<string, number>([["네이버 스마트스토어", 1]]),
  products: new Map<string, number>([["바나나칩 오리지널", 10]]),
  owners: new Map<string, number>([["김담당", 100]]),
};

describe("decideSyncPlan", () => {
  it("유효 행 1개 → totalRows 1 · toUpsert 1 · errors 없음 · seenKeys 에 planId", () => {
    const result = decideSyncPlan([row()], masters);
    expect(result.totalRows).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.seenKeys).toEqual(new Set(["PLAN-1"]));
    expect(result.toUpsert).toEqual([
      {
        sheetRowKey: "PLAN-1",
        scheduledDate: "2026-09-20",
        channelId: 1,
        productId: 10,
        lang: "ko",
        postType: "health_info",
        topicMemo: "토픽",
        ownerId: 100,
      },
    ]);
  });

  it.each([
    ["건강정보형", "health_info"],
    ["활동소식형", "activity_news"],
    ["비교큐레이션형", "comparison"],
    ["후기리뷰형", "review"],
  ])("postTypeLabel '%s' → postType '%s'", (label, postType) => {
    const result = decideSyncPlan([row({ postTypeLabel: label })], masters);
    expect(result.toUpsert[0]?.postType).toBe(postType);
  });

  it("(AC7) 8칸 전부 공백인 행은 totalRows·seenKeys·errors·toUpsert 어디에도 안 잡힌다", () => {
    const blank = ["", "", "", "", "", "", "", ""];
    const result = decideSyncPlan([blank], masters);
    expect(result.totalRows).toBe(0);
    expect(result.seenKeys.size).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.toUpsert).toEqual([]);
  });

  it("8칸이 전부 공백 '문자'(스페이스)뿐이어도 빈 행으로 취급한다", () => {
    const blank = ["  ", " ", "", "  ", "", "", " ", ""];
    const result = decideSyncPlan([blank], masters);
    expect(result.totalRows).toBe(0);
  });

  it("column A 만 비어도 totalRows 에는 잡히지만 seenKeys 에는 안 잡힌다", () => {
    const result = decideSyncPlan([row({ planId: "" })], masters);
    expect(result.totalRows).toBe(1);
    expect(result.seenKeys.size).toBe(0);
    expect(result.errors).toEqual([{ row: 2, column: "A", reason: "MISSING_REQUIRED" }]);
    expect(result.toUpsert).toEqual([]);
  });

  it("B 형식 오류 행도 column A 가 있으면 seenKeys 에는 잡힌다 (on_hold 전이 방지)", () => {
    const result = decideSyncPlan([row({ scheduledDate: "2026/09/20" })], masters);
    expect(result.seenKeys).toEqual(new Set(["PLAN-1"]));
    expect(result.errors).toEqual([{ row: 2, column: "B", reason: "INVALID_DATE" }]);
    expect(result.toUpsert).toEqual([]);
  });

  it("(AC3) 채널명이 마스터에 없으면 UNKNOWN_CHANNEL 로 빠지고 나머지 유효 행은 반영된다", () => {
    const rows = [row({ planId: "PLAN-1", channel: "존재하지않는채널" }), row({ planId: "PLAN-2" })];
    const result = decideSyncPlan(rows, masters);
    expect(result.errors).toEqual([{ row: 2, column: expect.anything(), reason: "UNKNOWN_CHANNEL" }]);
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0]?.sheetRowKey).toBe("PLAN-2");
  });

  it("채널명은 정확 일치만 통과한다 (부분·변형 일치는 UNKNOWN_CHANNEL)", () => {
    const result = decideSyncPlan([row({ channel: "네이버스마트스토어" })], masters);
    expect(result.errors[0]?.reason).toBe("UNKNOWN_CHANNEL");
    expect(result.toUpsert).toEqual([]);
  });

  it("product 가 빈 문자열이면 productId null·에러 없음", () => {
    const result = decideSyncPlan([row({ product: "" })], masters);
    expect(result.errors).toEqual([]);
    expect(result.toUpsert[0]?.productId).toBeNull();
  });

  it("product 가 비어있지 않은데 마스터에 없으면 UNKNOWN_PRODUCT", () => {
    const result = decideSyncPlan([row({ product: "존재하지않는제품" })], masters);
    expect(result.errors).toEqual([{ row: 2, column: expect.anything(), reason: "UNKNOWN_PRODUCT" }]);
    expect(result.toUpsert).toEqual([]);
  });

  it.each(["", "존재하지않는담당자"])(
    "owner 가 '%s' 이면 에러 없이 ownerId null 로 반영된다 (담당자 없음은 에러가 아니다)",
    (owner) => {
      const result = decideSyncPlan([row({ owner })], masters);
      expect(result.errors).toEqual([]);
      expect(result.toUpsert[0]?.ownerId).toBeNull();
    },
  );

  it("(AC4) 같은 planId 가 두 행이면 앞 행만 반영되고 뒤 행은 DUPLICATE_KEY", () => {
    const rows = [row({ planId: "PLAN-1", topic: "첫번째" }), row({ planId: "PLAN-1", topic: "두번째" })];
    const result = decideSyncPlan(rows, masters);
    expect(result.totalRows).toBe(2);
    expect(result.toUpsert).toHaveLength(1);
    expect(result.toUpsert[0]?.topicMemo).toBe("첫번째");
    expect(result.errors).toEqual([{ row: 3, column: expect.anything(), reason: "DUPLICATE_KEY" }]);
  });

  it("planId 앞뒤 공백이 달라도 trim 값으로 같은 키로 취급해 중복 처리한다", () => {
    const rows = [row({ planId: "PLAN-1" }), row({ planId: " PLAN-1 " })];
    const result = decideSyncPlan(rows, masters);
    expect(result.toUpsert).toHaveLength(1);
    expect(result.errors[0]?.reason).toBe("DUPLICATE_KEY");
  });

  it("중복 행이면서 채널도 unknown 이면 DUPLICATE_KEY 만 보고한다 (채널 오류는 보지 않음)", () => {
    const rows = [row({ planId: "PLAN-1" }), row({ planId: "PLAN-1", channel: "존재하지않는채널" })];
    const result = decideSyncPlan(rows, masters);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toBe("DUPLICATE_KEY");
  });

  it("시트 행 번호는 헤더=1 기준으로 데이터 첫 행부터 2 로 매긴다", () => {
    const rows = [row({ planId: "OK-1" }), row({ planId: "" }), row({ planId: "OK-2" })];
    const result = decideSyncPlan(rows, masters);
    expect(result.errors).toEqual([{ row: 3, column: "A", reason: "MISSING_REQUIRED" }]);
  });

  it("(AC9 지지) 시트가 완전히 비어 있으면 totalRows 0 · seenKeys 빈 집합", () => {
    const result = decideSyncPlan([], masters);
    expect(result.totalRows).toBe(0);
    expect(result.seenKeys.size).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.toUpsert).toEqual([]);
  });

  it("(AC9 지지) 모든 행이 column A 공백으로 형태 검증에 실패하면 totalRows>0 이어도 seenKeys 는 빈 집합", () => {
    const rows = [row({ planId: "" }), row({ planId: "" })];
    const result = decideSyncPlan(rows, masters);
    expect(result.totalRows).toBe(2);
    expect(result.seenKeys.size).toBe(0);
    expect(result.errors).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// (b) syncPlansFromSheet — 얇은 오케스트레이터, deps.db 를 vi.fn() 체인으로 스모크 테스트
// ---------------------------------------------------------------------------

type CallLog = Record<string, unknown[][]>;

/** 어느 지점에서 await 하든(then), 얼마나 더 체이닝하든 항상 resolvedValue 로 끝나는 노드. */
function makeChainNode(resolvedValue: unknown, calls: CallLog) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue),
    catch: () => node,
  };
  for (const method of ["from", "where", "set", "values", "onConflictDoUpdate", "returning"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return node;
    });
  }
  return node;
}

interface DbMockOptions {
  channelsRows: { id: number; name: string }[];
  productsRows: { id: number; name: string }[];
  usersRows: { id: number; name: string }[];
  heldRows: { sheetRowKey: string }[];
  importLogId: number;
  /** readRows 실패 경로에서 SHEET_FETCH_FAILED 의 details.lastSyncAt 조회용. 기본값 없음(null). */
  lastSyncRows?: { createdAt: Date }[];
}

function createDbMock(opts: DbMockOptions) {
  const selectCalls: unknown[][] = [];
  const insertCalls: { table: unknown; calls: CallLog }[] = [];
  const updateCalls: { table: unknown; calls: CallLog }[] = [];

  const select = vi.fn((...args: unknown[]) => {
    selectCalls.push(args);
    return {
      from: vi.fn((table: unknown) => {
        if (table === schema.salesChannels) return Promise.resolve(opts.channelsRows);
        if (table === schema.products) return Promise.resolve(opts.productsRows);
        if (table === schema.users) return Promise.resolve(opts.usersRows);
        if (table === schema.importLogs) {
          // .where().orderBy().limit(1) 로 체이닝 — 최근 import_logs 1행 조회(읽기 전용).
          const node = {
            where: vi.fn(() => node),
            orderBy: vi.fn(() => node),
            limit: vi.fn(() => Promise.resolve(opts.lastSyncRows ?? [])),
          };
          return node;
        }
        throw new Error("unexpected select().from() table in test mock");
      }),
    };
  });

  const insert = vi.fn((table: unknown) => {
    const calls: CallLog = {};
    insertCalls.push({ table, calls });
    if (table === schema.importLogs) return makeChainNode([{ id: opts.importLogId }], calls);
    return makeChainNode(undefined, calls);
  });

  let updateCallCount = 0;
  const update = vi.fn((table: unknown) => {
    const calls: CallLog = {};
    updateCalls.push({ table, calls });
    updateCallCount += 1;
    // 계약 순서상 1번째 update 는 on_hold 처리(RETURNING sheetRowKey), 이후는 import_id 백필.
    const resolved = updateCallCount === 1 ? opts.heldRows : undefined;
    return makeChainNode(resolved, calls);
  });

  return {
    db: { select, insert, update } as unknown as Db,
    selectCalls,
    insertCalls,
    updateCalls,
  };
}

function createSheetsMock(rows: string[][] | (() => Promise<string[][]>)): SheetsClient {
  return {
    readRows: vi.fn(async () => (typeof rows === "function" ? rows() : rows)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncPlansFromSheet", () => {
  it("정상 경로: 마스터 조회는 각 1회, Result.ok 로 SyncResult 를 돌려주고 이번 배치 importId 를 신규 on_hold 행에도 백필한다 (AC11)", async () => {
    const sheets = createSheetsMock([
      ["PLAN-1", "2026-09-20", "채널A", "", "ko", "건강정보형", "주제", "김담당"],
    ]);
    const { db, selectCalls, updateCalls } = createDbMock({
      channelsRows: [{ id: 1, name: "채널A" }],
      productsRows: [],
      usersRows: [{ id: 100, name: "김담당" }],
      heldRows: [{ sheetRowKey: "OLD-1" }],
      importLogId: 777,
    });

    const result = await syncPlansFromSheet({ sheets, db }, "manual");

    expect(result).toEqual({
      ok: true,
      data: {
        importId: 777,
        totalRows: 1,
        upserted: 1,
        held: 1,
        failed: 0,
        errors: [],
      },
    });

    expect(selectCalls).toHaveLength(3);

    expect(notInArray).toHaveBeenCalledTimes(1);
    expect(notInArray).toHaveBeenCalledWith(schema.publishPlans.sheetRowKey, ["PLAN-1"]);

    // AC11: 백필 대상은 toUpsert 키(PLAN-1) + 이번에 held 로 전환된 키(OLD-1) 둘 다.
    expect(inArray).toHaveBeenCalledTimes(1);
    const inArrayCall = vi.mocked(inArray).mock.calls[0];
    expect(inArrayCall?.[0]).toBe(schema.publishPlans.sheetRowKey);
    expect(inArrayCall?.[1]).toEqual(expect.arrayContaining(["PLAN-1", "OLD-1"]));
    expect((inArrayCall?.[1] as unknown[]).length).toBe(2);

    expect(updateCalls).toHaveLength(2);
  });

  it("(AC5) readRows 가 실패하면 publish_plans·import_logs 를 전혀 쓰지 않고 SHEET_FETCH_FAILED(+lastSyncAt) 를 돌려준다", async () => {
    const sheets: SheetsClient = { readRows: vi.fn().mockRejectedValue(new Error("network down")) };
    const lastSyncAt = new Date("2026-09-12T09:12:00Z");
    const { db, selectCalls, insertCalls, updateCalls } = createDbMock({
      channelsRows: [],
      productsRows: [],
      usersRows: [],
      heldRows: [],
      importLogId: 1,
      lastSyncRows: [{ createdAt: lastSyncAt }],
    });

    const result = await syncPlansFromSheet({ sheets, db }, "manual");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SHEET_FETCH_FAILED");
      // API_SPEC.md 오류 어휘 표: SHEET_FETCH_FAILED 의 details 는 { lastSyncAt } 다.
      expect(result.error.details).toEqual({ lastSyncAt });
    }
    // 마지막 동기화 시각 조회(읽기)만 하고, publish_plans·import_logs 는 전혀 쓰지 않는다.
    expect(selectCalls).toHaveLength(1);
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("(AC5 지지) 이전 동기화 기록이 없으면 lastSyncAt 은 null", async () => {
    const sheets: SheetsClient = { readRows: vi.fn().mockRejectedValue(new Error("network down")) };
    const { db } = createDbMock({
      channelsRows: [],
      productsRows: [],
      usersRows: [],
      heldRows: [],
      importLogId: 1,
      lastSyncRows: [],
    });

    const result = await syncPlansFromSheet({ sheets, db }, "manual");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toEqual({ lastSyncAt: null });
  });

  it("(AC6) 시트에 데이터 행이 0개면 totalRows 0 · errors 빈 배열로 Result.ok 를 돌려준다", async () => {
    const sheets = createSheetsMock([]);
    const { db } = createDbMock({
      channelsRows: [],
      productsRows: [],
      usersRows: [],
      heldRows: [{ sheetRowKey: "OLD-A" }, { sheetRowKey: "OLD-B" }],
      importLogId: 42,
    });

    const result = await syncPlansFromSheet({ sheets, db }, "manual");

    expect(result).toEqual({
      ok: true,
      data: {
        importId: 42,
        totalRows: 0,
        upserted: 0,
        held: 2,
        failed: 0,
        errors: [],
      },
    });
    // seenKeys 가 빈 집합이므로 notInArray 없는 전체 UPDATE 분기여야 한다.
    expect(notInArray).not.toHaveBeenCalled();
  });

  it("(AC9) 모든 행이 형태 검증에 실패해 seenKeys 가 빈 집합이 되어도 notInArray 없이 SQL 오류 없이 끝난다", async () => {
    const sheets = createSheetsMock([["", "2026-09-20", "채널A", "", "ko", "건강정보형", "", ""]]);
    const { db } = createDbMock({
      channelsRows: [{ id: 1, name: "채널A" }],
      productsRows: [],
      usersRows: [],
      heldRows: [{ sheetRowKey: "OLD-1" }],
      importLogId: 5,
    });

    const result = await syncPlansFromSheet({ sheets, db }, "manual");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalRows).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors[0]?.reason).toBe("MISSING_REQUIRED");
    }
    expect(notInArray).not.toHaveBeenCalled();
  });

  it("(AC10) 500행 규모 시트를 동기화해도 마스터 조회(select)는 정확히 3회만 발생한다", async () => {
    const rows: string[][] = [];
    for (let i = 0; i < 500; i += 1) {
      rows.push([`PLAN-${i}`, "2026-09-20", "채널A", "", "ko", "건강정보형", "주제", ""]);
    }
    const sheets = createSheetsMock(rows);
    const { db, selectCalls } = createDbMock({
      channelsRows: [{ id: 1, name: "채널A" }],
      productsRows: [],
      usersRows: [],
      heldRows: [],
      importLogId: 9,
    });

    const result = await syncPlansFromSheet({ sheets, db }, "manual");

    expect(selectCalls).toHaveLength(3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalRows).toBe(500);
      expect(result.data.upserted).toBe(500);
    }
  });

  it("trigger 인자('manual'|'webhook')를 그대로 받아 처리하며, sheets.readRows 는 SHEET_RANGE 로 호출된다", async () => {
    const sheets = createSheetsMock([]);
    const { db } = createDbMock({
      channelsRows: [],
      productsRows: [],
      usersRows: [],
      heldRows: [],
      importLogId: 1,
    });

    await syncPlansFromSheet({ sheets, db }, "webhook");

    expect(sheets.readRows).toHaveBeenCalledWith("Sheet1!A2:H");
  });
});
