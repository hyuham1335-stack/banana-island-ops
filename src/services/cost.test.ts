import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// 계약: FR-020(런 20260920-0107-4265) 「유닛 · services/cost.ts」
//
// DB 는 src/services/fx.test.ts 의 makeChainNode 패턴을 select/insert/update/delete 로
// 넓혀 모킹한다. 인자로 넘어간 실제 drizzle 조건(eq·and·sql 등)은 진짜 객체이므로
// PgDialect.sqlToQuery 로 SQL 텍스트+파라미터를 펼쳐 단언할 수 있다(renderSql).
//
// nextval 조회는 계약이 "select nextval(pg_get_serial_sequence(...))" 라고만 적고 정확한
// drizzle 호출 형태는 고정하지 않았다(계약 밖 — 내부 헬퍼 자율). 이 테스트는
// `db.execute(sql...)` 가 `{ rows: [{ next_id: <새 id> }] }` 를 돌려주는 형태로 가정했다 —
// nextval() 은 별도 FROM 절이 없어 drizzle 의 select().from() 체인으로는 만들 수 없고
// execute(sql`... as next_id`) 가 자연스럽기 때문이다. 별칭이 다르면 이 부분만 조정하면 된다.

vi.mock("@/services/content-options", () => ({
  listActiveProducts: vi.fn(),
}));

vi.mock("@/services/fx", () => ({
  getFxRailState: vi.fn(),
}));

import type { Db } from "@/lib/db/client";
import { costItems, costSheets } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth";
import { listActiveProducts } from "@/services/content-options";
import { getFxRailState } from "@/services/fx";
import {
  confirmCostSheet,
  createCostSheet,
  listCostSheets,
  loadCostSheetPage,
  updateCostSheet,
} from "./cost";

// ---------------------------------------------------------------------------
// DB 모킹 헬퍼
// ---------------------------------------------------------------------------

type CallLog = Record<string, unknown[][]>;
type NodeResult = { value?: unknown; error?: unknown };

/** select/insert/update/delete 체인 어디서 await 하든 같은 결과로 resolve/reject 하는 thenable 노드. */
function makeChainNode(result: NodeResult, calls: CallLog): Record<string, unknown> {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      if (result.error !== undefined) {
        if (reject) reject(result.error);
        else throw result.error;
      } else {
        resolve(result.value);
      }
    },
  };
  for (const method of ["from", "where", "orderBy", "limit", "values", "set", "returning", "select"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return node;
    });
  }
  return node;
}

interface MethodMock {
  fn: ReturnType<typeof vi.fn>;
  argsLog: unknown[][];
  logs: CallLog[];
}

function makeMethod(defaultValue: unknown, results?: NodeResult[]): MethodMock {
  const argsLog: unknown[][] = [];
  const logs: CallLog[] = [];
  let idx = 0;
  const fn = vi.fn((...args: unknown[]) => {
    argsLog.push(args);
    const calls: CallLog = {};
    logs.push(calls);
    const result = results?.[idx] ?? { value: defaultValue };
    idx += 1;
    return makeChainNode(result, calls);
  });
  return { fn, argsLog, logs };
}

interface DbMockOptions {
  selectResults?: NodeResult[];
  insertResults?: NodeResult[];
  updateResults?: NodeResult[];
  deleteResults?: NodeResult[];
  batchResults?: NodeResult[];
  executeResults?: NodeResult[];
}

function createDbMock(opts: DbMockOptions = {}) {
  const select = makeMethod([], opts.selectResults);
  const insert = makeMethod(undefined, opts.insertResults);
  const update = makeMethod(undefined, opts.updateResults);
  const del = makeMethod(undefined, opts.deleteResults);

  const batchCalls: unknown[][] = [];
  let batchIdx = 0;
  const batch = vi.fn(async (queries: unknown[]) => {
    batchCalls.push(queries);
    const result = opts.batchResults?.[batchIdx] ?? { value: [] };
    batchIdx += 1;
    if (result.error !== undefined) throw result.error;
    return result.value;
  });

  const executeCalls: unknown[][] = [];
  let execIdx = 0;
  const execute = vi.fn(async (...args: unknown[]) => {
    executeCalls.push(args);
    const result = opts.executeResults?.[execIdx] ?? { value: { rows: [] } };
    execIdx += 1;
    if (result.error !== undefined) throw result.error;
    return result.value;
  });

  return {
    db: { select: select.fn, insert: insert.fn, update: update.fn, delete: del.fn, batch, execute } as unknown as Db,
    select,
    insert,
    update,
    delete: del,
    batchCalls,
    executeCalls,
  };
}

const dialect = new PgDialect();
function renderSql(node: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(node as SQL);
}
/** SQL 텍스트 + 파라미터를 하나의 문자열로 합쳐 부분 문자열 단언에 쓴다. */
function repr(node: unknown): string {
  const { sql, params } = renderSql(node);
  return `${sql} ${JSON.stringify(params)}`;
}

/**
 * 렌더된 SQL 텍스트에서 `pattern` 이 잡은 자리표시자(`$n`)의 params 인덱스를 돌려준다.
 * `$1` 같은 자리표시자 숫자를 그 자체로 값과 혼동하지 않도록(05 F-2 함정) SQL 문자열의
 * 위치를 정규식으로 특정한 뒤 params 배열에서 실제 값을 찾는다.
 */
function paramIndexAt(sqlText: string, pattern: RegExp): number | undefined {
  const match = sqlText.match(pattern);
  return match ? Number(match[1]) - 1 : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listCostSheets
// ---------------------------------------------------------------------------

describe("listCostSheets", () => {
  it("productId·distributionRoute 둘 다 있으면 where 에 두 조건이 함께 걸린다", async () => {
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    await listCostSheets({ db }, { productId: 10, distributionRoute: "kr_domestic" });

    const where = renderSql(select.logs[0]?.where?.[0]?.[0]);
    expect(where.sql).toContain('"cost_sheets"."product_id" = $1');
    expect(where.sql).toContain('"cost_sheets"."distribution_route" = $2');
    expect(where.params).toEqual([10, "kr_domestic"]);
  });

  it("productId 만 있으면 where 에 그 조건만 걸린다", async () => {
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    await listCostSheets({ db }, { productId: 10 });

    const where = renderSql(select.logs[0]?.where?.[0]?.[0]);
    expect(where.sql).toBe('"cost_sheets"."product_id" = $1');
    expect(where.params).toEqual([10]);
  });

  it("둘 다 없으면 where 를 호출하지 않는다", async () => {
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    await listCostSheets({ db }, {});

    expect(select.logs[0]?.where).toBeUndefined();
  });

  it("orderBy(id desc) 로 정렬한다", async () => {
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    await listCostSheets({ db }, {});

    const orderBy = renderSql(select.logs[0]?.orderBy?.[0]?.[0]);
    expect(orderBy.sql).toBe('"cost_sheets"."id" desc');
  });

  it("시트가 0개면 항목 select 를 호출하지 않고 빈 배열을 돌려준다", async () => {
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    const result = await listCostSheets({ db }, {});

    expect(result).toEqual({ ok: true, data: [] });
    expect(select.fn).toHaveBeenCalledTimes(1);
  });

  it("시트가 있으면 항목을 inArray(cost_sheet_id, ids) 1회로 묶어 조회해 시트별로 붙인다", async () => {
    const sheetRow = {
      id: 1,
      productId: 10,
      distributionRoute: "kr_domestic",
      name: "v1",
      effectiveFrom: null,
      status: "draft",
      confirmedAt: null,
    };
    const itemRow = {
      id: 100,
      costSheetId: 1,
      stage: "ph",
      costKind: "원료",
      amount: "100.0000",
      currency: "PHP",
      basis: "per_unit",
      batchQty: null,
      note: null,
    };
    const { db, select } = createDbMock({ selectResults: [{ value: [sheetRow] }, { value: [itemRow] }] });

    const result = await listCostSheets({ db }, {});

    expect(select.fn).toHaveBeenCalledTimes(2);
    const itemsWhere = renderSql(select.logs[1]?.where?.[0]?.[0]);
    expect(itemsWhere.sql).toBe('"cost_items"."cost_sheet_id" in ($1)');
    expect(itemsWhere.params).toEqual([1]);
    const itemsOrderBy = renderSql(select.logs[1]?.orderBy?.[0]?.[0]);
    expect(itemsOrderBy.sql).toBe('"cost_items"."id" asc');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(1);
      expect(result.data[0].confirmedAt).toBeNull();
      expect(result.data[0].items).toEqual([
        { id: 100, stage: "ph", costKind: "원료", amount: "100.0000", currency: "PHP", basis: "per_unit", batchQty: null },
      ]);
    }
  });

  it("시트가 여러 개면 항목을 costSheetId 로 자신의 시트에만 묶는다(05 F-4)", async () => {
    const sheetRows = [
      { id: 1, productId: 10, distributionRoute: "kr_domestic", name: "v1", effectiveFrom: null, status: "draft", confirmedAt: null },
      { id: 2, productId: 10, distributionRoute: "kr_domestic", name: "v2", effectiveFrom: null, status: "draft", confirmedAt: null },
    ];
    const itemRows = [
      { id: 100, costSheetId: 1, stage: "ph", costKind: "원료A", amount: "100.0000", currency: "PHP", basis: "per_unit", batchQty: null },
      { id: 200, costSheetId: 2, stage: "kr", costKind: "원료B", amount: "200.0000", currency: "KRW", basis: "per_unit", batchQty: null },
    ];
    const { db } = createDbMock({ selectResults: [{ value: sheetRows }, { value: itemRows }] });

    const result = await listCostSheets({ db }, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sheet1 = result.data.find((s) => s.id === 1);
    const sheet2 = result.data.find((s) => s.id === 2);
    // itemRows.filter((item) => item.costSheetId === sheet.id) 를 지우고 모든 항목을
    // 모든 시트에 붙이면 sheet1.items 에 item200(costSheetId 2)이 섞여 들어와 이 단언이 깨진다.
    expect(sheet1?.items).toEqual([
      { id: 100, stage: "ph", costKind: "원료A", amount: "100.0000", currency: "PHP", basis: "per_unit", batchQty: null },
    ]);
    expect(sheet2?.items).toEqual([
      { id: 200, stage: "kr", costKind: "원료B", amount: "200.0000", currency: "KRW", basis: "per_unit", batchQty: null },
    ]);
  });

  it("confirmedAt 이 Date 이면 toISOString() 으로 직렬화한다", async () => {
    const confirmedDate = new Date("2026-09-20T00:00:00.000Z");
    const sheetRow = {
      id: 2,
      productId: 10,
      distributionRoute: "kr_domestic",
      name: "v1",
      effectiveFrom: null,
      status: "confirmed",
      confirmedAt: confirmedDate,
    };
    const { db } = createDbMock({ selectResults: [{ value: [sheetRow] }, { value: [] }] });

    const result = await listCostSheets({ db }, {});

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].confirmedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("DB 가 동기적으로 throw 하면 INTERNAL 을 돌려준다", async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error("sync boom");
      }),
    } as unknown as Db;

    const result = await listCostSheets({ db }, {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  it("DB 가 await 시점에 reject 하면 INTERNAL 을 돌려준다", async () => {
    const { db } = createDbMock({ selectResults: [{ error: new Error("async boom") }] });

    const result = await listCostSheets({ db }, {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// createCostSheet
// ---------------------------------------------------------------------------

describe("createCostSheet", () => {
  const INPUT = { productId: 10, distributionRoute: "kr_domestic" as const, name: "새 원가표" };

  it("제품이 없으면 NOT_FOUND(product) 를 돌려주고 insert 를 호출하지 않는다", async () => {
    const { db, insert } = createDbMock({ selectResults: [{ value: [] }] });

    const result = await createCostSheet({ db }, INPUT);

    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.any(String), details: { resource: "product", id: 10 } },
    });
    expect(insert.fn).not.toHaveBeenCalled();
  });

  it("cloneFromId 없이 생성하면 insert(costSheets).values() 로 한 번 만들고 items: [] 를 돌려준다", async () => {
    const insertedRow = {
      id: 5,
      productId: 10,
      distributionRoute: "kr_domestic",
      name: "새 원가표",
      effectiveFrom: null,
      status: "draft",
      confirmedAt: null,
    };
    const { db, insert } = createDbMock({
      selectResults: [{ value: [{ id: 10 }] }],
      insertResults: [{ value: [insertedRow] }],
    });

    const result = await createCostSheet({ db }, INPUT);

    expect(insert.fn).toHaveBeenCalledTimes(1);
    expect(insert.argsLog[0]?.[0]).toBe(costSheets);
    expect(insert.logs[0]?.values?.[0]?.[0]).toEqual({
      productId: 10,
      distributionRoute: "kr_domestic",
      name: "새 원가표",
    });
    expect(result).toEqual({ ok: true, data: { ...insertedRow, items: [] } });
  });

  describe("clone", () => {
    const CLONE_INPUT = { ...INPUT, cloneFromId: 3 };

    it("원본이 없으면 NOT_FOUND(cost_sheet) 를 돌려주고 batch 를 호출하지 않는다", async () => {
      const { db, batchCalls } = createDbMock({ selectResults: [{ value: [{ id: 10 }] }, { value: [] }] });

      const result = await createCostSheet({ db }, CLONE_INPUT);

      expect(result).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: expect.any(String), details: { resource: "cost_sheet", id: 3 } },
      });
      expect(batchCalls).toHaveLength(0);
    });

    it("원본이 draft 이면 INVALID_TRANSITION{from:draft,action:clone} 을 돌려주고 batch 를 호출하지 않는다", async () => {
      const originRow = { id: 3, productId: 10, distributionRoute: "kr_domestic", status: "draft" };
      const { db, batchCalls } = createDbMock({
        selectResults: [{ value: [{ id: 10 }] }, { value: [originRow] }],
      });

      const result = await createCostSheet({ db }, CLONE_INPUT);

      expect(result).toEqual({
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: expect.any(String),
          details: { from: "draft", action: "clone" },
        },
      });
      expect(batchCalls).toHaveLength(0);
    });

    it("원본의 productId·distributionRoute 가 요청과 다르면 VALIDATION_ERROR 를 돌려주고 batch 를 호출하지 않는다", async () => {
      const originRow = { id: 3, productId: 999, distributionRoute: "us_export", status: "confirmed" };
      const { db, batchCalls } = createDbMock({
        selectResults: [{ value: [{ id: 10 }] }, { value: [originRow] }],
      });

      const result = await createCostSheet({ db }, CLONE_INPUT);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(batchCalls).toHaveLength(0);
    });

    it("확정본 복제 — nextval 로 새 id 를 받고 batch 에 2문장(시트 insert · cost_items insert-select)을 실행해 새 시트를 반환한다", async () => {
      const originRow = { id: 3, productId: 10, distributionRoute: "kr_domestic", status: "confirmed" };
      const rereadSheetRow = {
        id: 501,
        productId: 10,
        distributionRoute: "kr_domestic",
        name: "새 원가표",
        effectiveFrom: null,
        status: "draft",
        confirmedAt: null,
      };
      const rereadItemRow = {
        id: 900,
        stage: "ph",
        costKind: "원료",
        amount: "100.0000",
        currency: "PHP",
        basis: "per_unit",
        batchQty: null,
      };
      const { db, batchCalls, insert } = createDbMock({
        selectResults: [
          { value: [{ id: 10 }] }, // 1) 제품 존재
          { value: [originRow] }, // 2) 원본 시트
          { value: [rereadSheetRow] }, // 3) 재조회 — 시트
          { value: [rereadItemRow] }, // 4) 재조회 — 항목
        ],
        executeResults: [{ value: { rows: [{ next_id: 501 }] } }],
      });

      const result = await createCostSheet({ db }, CLONE_INPUT);

      expect(batchCalls).toHaveLength(1);
      expect(batchCalls[0]).toHaveLength(2);
      expect(insert.fn).toHaveBeenCalledTimes(2);

      // 첫 번째 문장 — 새 id(501) 를 명시적으로 지정해 시트를 만든다.
      const firstStatement = batchCalls[0]?.[0] as Record<string, unknown>;
      const insertValuesArg = (firstStatement.values as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(insertValuesArg).toMatchObject({
        id: 501,
        productId: 10,
        distributionRoute: "kr_domestic",
        name: "새 원가표",
      });

      // 두 번째 문장 — 원본 id(3)로 cost_items 를 select 해 새 id(501)로 insert 한다.
      // "501" · "3" 부분문자열만 보면 두 값이 뒤바뀌어도(select 3 from ... where cost_sheet_id = 501)
      // 초록불이 된다(05 F-5) — select 목록의 새 id 자리와 where 의 원본 id 자리를 위치로 구분해 잠근다.
      const secondStatement = batchCalls[0]?.[1] as Record<string, unknown>;
      const insertSelectArg = (secondStatement.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      const { sql: selectSql, params: selectParams } = renderSql(insertSelectArg);
      expect(selectSql.toLowerCase()).toContain("cost_items");
      expect(selectSql.toLowerCase()).toContain("cost_sheet_id");

      // select 목록의 새 id — 계약이 명시한 "select <새 id>, stage, ..." 형태를 찾는다.
      const newIdIdx = paramIndexAt(selectSql, /\$(\d+),\s*stage/);
      expect(newIdIdx).toBeDefined();
      expect(selectParams[newIdIdx as number]).toBe(501);

      // where 절의 원본 id — "... from cost_items where cost_sheet_id = <원본>".
      const originIdIdx = paramIndexAt(selectSql, /cost_sheet_id\s*=\s*\$(\d+)/);
      expect(originIdIdx).toBeDefined();
      expect(selectParams[originIdIdx as number]).toBe(3);

      expect(result).toEqual({
        ok: true,
        data: {
          ...rereadSheetRow,
          items: [
            {
              id: 900,
              stage: "ph",
              costKind: "원료",
              amount: "100.0000",
              currency: "PHP",
              basis: "per_unit",
              batchQty: null,
            },
          ],
        },
      });
    });

    it("원본은 쓰지 않는다 — update·delete 를 호출하지 않는다", async () => {
      const originRow = { id: 3, productId: 10, distributionRoute: "kr_domestic", status: "confirmed" };
      const { db, update, delete: del } = createDbMock({
        selectResults: [
          { value: [{ id: 10 }] },
          { value: [originRow] },
          {
            value: [
              {
                id: 501,
                productId: 10,
                distributionRoute: "kr_domestic",
                name: "새 원가표",
                effectiveFrom: null,
                status: "draft",
                confirmedAt: null,
              },
            ],
          },
          { value: [] },
        ],
        executeResults: [{ value: { rows: [{ next_id: 501 }] } }],
      });

      await createCostSheet({ db }, CLONE_INPUT);

      expect(update.fn).not.toHaveBeenCalled();
      expect(del.fn).not.toHaveBeenCalled();
    });
  });

  it("DB 가 동기적으로 throw 하면 INTERNAL 을 돌려준다", async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error("sync boom");
      }),
    } as unknown as Db;

    const result = await createCostSheet({ db }, INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  it("DB 가 await 시점에 reject 하면 INTERNAL 을 돌려준다", async () => {
    const { db } = createDbMock({ selectResults: [{ error: new Error("async boom") }] });

    const result = await createCostSheet({ db }, INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// updateCostSheet
// ---------------------------------------------------------------------------

describe("updateCostSheet", () => {
  const INPUT_WITH_ITEMS = {
    name: "수정됨",
    items: [
      {
        stage: "ph" as const,
        costKind: "원료",
        amount: "120.5",
        currency: "PHP" as const,
        basis: "per_unit" as const,
        batchQty: null,
      },
    ],
  };
  const INPUT_EMPTY = { name: "수정됨", items: [] };

  it("시트가 없으면 NOT_FOUND 를 돌려주고 batch 를 호출하지 않는다", async () => {
    const { db, batchCalls } = createDbMock({ selectResults: [{ value: [] }] });

    const result = await updateCostSheet({ db }, 1, INPUT_EMPTY);

    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.any(String), details: { resource: "cost_sheet", id: 1 } },
    });
    expect(batchCalls).toHaveLength(0);
  });

  it("시트가 이미 확정본이면 INVALID_TRANSITION{from:confirmed,action:update} 을 돌려주고 batch 를 호출하지 않는다", async () => {
    const { db, batchCalls } = createDbMock({
      selectResults: [{ value: [{ id: 1, name: "기존", status: "confirmed" }] }],
    });

    const result = await updateCostSheet({ db }, 1, INPUT_EMPTY);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: expect.any(String),
        details: { from: "confirmed", action: "update" },
      },
    });
    expect(batchCalls).toHaveLength(0);
  });

  it("draft 시트를 수정하면 batch 1회에 UPDATE·DELETE·INSERT 세 문장을 담고, 셋 다 status='draft' 조건을 SQL 에 건다(01 F-3)", async () => {
    const { db, batchCalls, update, delete: del, insert } = createDbMock({
      selectResults: [
        { value: [{ id: 1, name: "기존", status: "draft" }] }, // 시트 존재 확인
        {
          value: [
            {
              id: 1,
              productId: 10,
              distributionRoute: "kr_domestic",
              name: "수정됨",
              effectiveFrom: null,
              status: "draft",
              confirmedAt: null,
            },
          ],
        }, // 재조회 — 시트
        {
          value: [
            { id: 900, stage: "ph", costKind: "원료", amount: "120.5", currency: "PHP", basis: "per_unit", batchQty: null },
          ],
        }, // 재조회 — 항목
      ],
      batchResults: [{ value: [[{ id: 1 }], undefined, undefined] }],
    });

    const result = await updateCostSheet({ db }, 1, INPUT_WITH_ITEMS);

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(3);
    expect(update.argsLog[0]?.[0]).toBe(costSheets);
    expect(del.argsLog[0]?.[0]).toBe(costItems);
    expect(insert.argsLog[0]?.[0]).toBe(costItems);

    // ① UPDATE — status='draft' 조건이 있고, 그 조건이 이 시트(id=1)에 결속돼 있다.
    // id 조건을 지우면(모든 draft 시트가 대상이 되어도) 아래 id 단언이 빨간불이 된다(05 F-1).
    const updateStatement = batchCalls[0]?.[0] as Record<string, unknown>;
    const updateWhereArg = (updateStatement.where as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const { sql: updateWhereSql, params: updateWhereParams } = renderSql(updateWhereArg);
    expect(updateWhereSql).toContain('"cost_sheets"."status"');
    const updateStatusIdx = paramIndexAt(updateWhereSql, /"cost_sheets"\."status" = \$(\d+)/);
    expect(updateStatusIdx).toBeDefined();
    expect(updateWhereParams[updateStatusIdx as number]).toBe("draft");
    const updateIdIdx = paramIndexAt(updateWhereSql, /"cost_sheets"\."id" = \$(\d+)/);
    expect(updateIdIdx).toBeDefined();
    expect(updateWhereParams[updateIdIdx as number]).toBe(1);
    const setArg = (updateStatement.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(setArg).toMatchObject({ name: "수정됨" });

    // ② DELETE — cost_items.cost_sheet_id 조건과 draft 가드 안의 id 조건이 둘 다 이 시트(1)에
    // 결속돼 있다. cost_sheet_id 조건을 지우면(모든 시트의 항목이 대상이 되어도) 또는 가드의
    // id 를 지우면(DB 어딘가에 draft 가 있기만 하면 항상 참) 아래 단언이 빨간불이 된다(05 F-1).
    const deleteStatement = batchCalls[0]?.[1] as Record<string, unknown>;
    const deleteWhereArg = (deleteStatement.where as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const { sql: deleteWhereSql, params: deleteWhereParams } = renderSql(deleteWhereArg);
    expect(deleteWhereSql).toContain("status = 'draft'");
    const deleteCostSheetIdIdx = paramIndexAt(deleteWhereSql, /"cost_items"\."cost_sheet_id" = \$(\d+)/);
    expect(deleteCostSheetIdIdx).toBeDefined();
    expect(deleteWhereParams[deleteCostSheetIdIdx as number]).toBe(1);
    const deleteGuardIdIdx = paramIndexAt(deleteWhereSql, /id = \$(\d+) and status = 'draft'/);
    expect(deleteGuardIdIdx).toBeDefined();
    expect(deleteWhereParams[deleteGuardIdIdx as number]).toBe(1);

    // ③ INSERT — status='draft' 조건이 있고 새 항목 값을 담는다. draft 가드의 id 도 이 시트(1)에
    // 결속돼 있어야 한다(가드에서 id 를 지우면 아래 단언이 빨간불이 된다, 05 F-1).
    const insertStatement = batchCalls[0]?.[2] as Record<string, unknown>;
    const insertSelectArg = (insertStatement.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(repr(insertSelectArg)).toContain("draft");
    expect(repr(insertSelectArg)).toContain("원료");
    const { sql: insertSelectSql, params: insertSelectParams } = renderSql(insertSelectArg);
    const insertGuardIdIdx = paramIndexAt(insertSelectSql, /id = \$(\d+) and status = 'draft'/);
    expect(insertGuardIdIdx).toBeDefined();
    expect(insertSelectParams[insertGuardIdIdx as number]).toBe(1);
    // batch_qty::integer 캐스트 — gen critical 수리 대상. 지우면 이 assertion 이 빨간불이 된다.
    expect(insertSelectSql).toContain("batch_qty::integer");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("수정됨");
  });

  it("name 을 생략하면 기존 이름을 유지해 UPDATE 의 set 에 담는다", async () => {
    const { db, batchCalls } = createDbMock({
      selectResults: [
        { value: [{ id: 1, name: "기존이름", status: "draft" }] },
        {
          value: [
            {
              id: 1,
              productId: 10,
              distributionRoute: "kr_domestic",
              name: "기존이름",
              effectiveFrom: null,
              status: "draft",
              confirmedAt: null,
            },
          ],
        },
        { value: [] },
      ],
      batchResults: [{ value: [[{ id: 1 }], undefined] }],
    });

    await updateCostSheet({ db }, 1, { items: [] });

    const updateStatement = batchCalls[0]?.[0] as Record<string, unknown>;
    const setArg = (updateStatement.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(setArg).toMatchObject({ name: "기존이름" });
  });

  it("items 가 빈 배열이면 batch 에 INSERT 문장이 없다(2문장만)", async () => {
    const { db, batchCalls } = createDbMock({
      selectResults: [
        { value: [{ id: 1, name: "기존", status: "draft" }] },
        {
          value: [
            {
              id: 1,
              productId: 10,
              distributionRoute: "kr_domestic",
              name: "수정됨",
              effectiveFrom: null,
              status: "draft",
              confirmedAt: null,
            },
          ],
        },
        { value: [] },
      ],
      batchResults: [{ value: [[{ id: 1 }], undefined] }],
    });

    await updateCostSheet({ db }, 1, INPUT_EMPTY);

    expect(batchCalls[0]).toHaveLength(2);
  });

  it("batch 후 ① 이 0행이고 재조회 결과 그 사이 확정됐으면 409 INVALID_TRANSITION 을 돌려준다", async () => {
    const { db } = createDbMock({
      selectResults: [
        { value: [{ id: 1, name: "기존", status: "draft" }] },
        { value: [{ id: 1, name: "기존", status: "confirmed" }] }, // 재조회 — 확정됨
      ],
      batchResults: [{ value: [[], undefined, undefined] }],
    });

    const result = await updateCostSheet({ db }, 1, INPUT_WITH_ITEMS);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: expect.any(String),
        details: { from: "confirmed", action: "update" },
      },
    });
  });

  it("batch 후 ① 이 0행이고 재조회 결과가 없으면(그 사이 삭제됨) 404 NOT_FOUND 를 돌려준다", async () => {
    const { db } = createDbMock({
      selectResults: [
        { value: [{ id: 1, name: "기존", status: "draft" }] },
        { value: [] }, // 재조회 — 없음
      ],
      batchResults: [{ value: [[], undefined, undefined] }],
    });

    const result = await updateCostSheet({ db }, 1, INPUT_WITH_ITEMS);

    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.any(String), details: { resource: "cost_sheet", id: 1 } },
    });
  });

  it("DB 가 동기적으로 throw 하면 INTERNAL 을 돌려준다", async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error("sync boom");
      }),
    } as unknown as Db;

    const result = await updateCostSheet({ db }, 1, INPUT_EMPTY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  it("DB 가 await 시점에 reject 하면 INTERNAL 을 돌려준다", async () => {
    const { db } = createDbMock({ selectResults: [{ error: new Error("async boom") }] });

    const result = await updateCostSheet({ db }, 1, INPUT_EMPTY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// confirmCostSheet
// ---------------------------------------------------------------------------

describe("confirmCostSheet", () => {
  it("성공 — set 에 status·confirmed_at, where 에 id 와 status='draft' 조건이 있고 항목 포함 시트를 (재조회해) 반환한다", async () => {
    // update(...).returning() 은 1행 이상인지(성공 여부)만 판단에 쓰이고, 반환값 자체는
    // fetchCostSheetById 로 다시 읽는다 — 그래서 재조회용 select 결과를 별도로 큐에 둔다.
    const rereadSheetRow = {
      id: 1,
      productId: 10,
      distributionRoute: "kr_domestic",
      name: "v1",
      effectiveFrom: null,
      status: "confirmed",
      confirmedAt: new Date("2026-09-20T00:00:00.000Z"),
    };
    const itemRow = {
      id: 900,
      stage: "ph",
      costKind: "원료",
      amount: "100.0000",
      currency: "PHP",
      basis: "per_unit",
      batchQty: null,
    };
    const { db, update, select } = createDbMock({
      updateResults: [{ value: [{ id: 1 }] }],
      selectResults: [{ value: [rereadSheetRow] }, { value: [itemRow] }],
    });

    const result = await confirmCostSheet({ db }, 1);

    expect(update.fn).toHaveBeenCalledTimes(1);
    expect(update.argsLog[0]?.[0]).toBe(costSheets);
    const setArg = update.logs[0]?.set?.[0]?.[0] as Record<string, unknown>;
    expect(setArg.status).toBe("confirmed");
    expect(setArg).toHaveProperty("confirmedAt");

    // `expect(whereRendered).toContain("1")` 은 렌더된 SQL 의 `$1` 자리표시자에 항상 걸려
    // eq(costSheets.id, id) 를 지워도(모든 draft 시트를 한 번에 확정해도) 초록불이었다(05 F-2).
    // sql 텍스트와 params 를 나눠 위치로 값을 대조한다.
    const { sql: whereSql, params: whereParams } = renderSql(update.logs[0]?.where?.[0]?.[0]);
    expect(whereSql).toContain('"cost_sheets"."status"');
    const statusIdx = paramIndexAt(whereSql, /"cost_sheets"\."status" = \$(\d+)/);
    expect(statusIdx).toBeDefined();
    expect(whereParams[statusIdx as number]).toBe("draft");
    const idIdx = paramIndexAt(whereSql, /"cost_sheets"\."id" = \$(\d+)/);
    expect(idIdx).toBeDefined();
    expect(whereParams[idIdx as number]).toBe(1);

    expect(select.fn).toHaveBeenCalledTimes(2);

    expect(result).toEqual({
      ok: true,
      data: {
        ...rereadSheetRow,
        confirmedAt: "2026-09-20T00:00:00.000Z",
        items: [
          { id: 900, stage: "ph", costKind: "원료", amount: "100.0000", currency: "PHP", basis: "per_unit", batchQty: null },
        ],
      },
    });
  });

  it("0행이고 재조회 결과가 확정본이면 409 INVALID_TRANSITION{from:confirmed,action:confirm} 을 돌려준다", async () => {
    const { db } = createDbMock({
      updateResults: [{ value: [] }],
      selectResults: [{ value: [{ id: 1, status: "confirmed" }] }],
    });

    const result = await confirmCostSheet({ db }, 1);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: expect.any(String),
        details: { from: "confirmed", action: "confirm" },
      },
    });
  });

  it("0행이고 재조회 결과가 없으면 404 NOT_FOUND 를 돌려준다", async () => {
    const { db } = createDbMock({
      updateResults: [{ value: [] }],
      selectResults: [{ value: [] }],
    });

    const result = await confirmCostSheet({ db }, 1);

    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.any(String), details: { resource: "cost_sheet", id: 1 } },
    });
  });

  it("DB 가 동기적으로 throw 하면 INTERNAL 을 돌려준다", async () => {
    const db = {
      update: vi.fn(() => {
        throw new Error("sync boom");
      }),
    } as unknown as Db;

    const result = await confirmCostSheet({ db }, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  it("DB 가 await 시점에 reject 하면 INTERNAL 을 돌려준다", async () => {
    const { db } = createDbMock({ updateResults: [{ error: new Error("async boom") }] });

    const result = await confirmCostSheet({ db }, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// loadCostSheetPage
// ---------------------------------------------------------------------------

describe("loadCostSheetPage", () => {
  const ADMIN: Actor = { role: "admin" };
  const EDITOR: Actor = { role: "editor" };

  it("editor 면 forbidden 이고 DB·다른 서비스를 한 번도 부르지 않는다", async () => {
    const { db, select, insert, update, delete: del } = createDbMock();

    const state = await loadCostSheetPage({ db }, EDITOR, {}, "2026-09-20");

    expect(state).toEqual({ kind: "forbidden" });
    expect(select.fn).not.toHaveBeenCalled();
    expect(insert.fn).not.toHaveBeenCalled();
    expect(update.fn).not.toHaveBeenCalled();
    expect(del.fn).not.toHaveBeenCalled();
    expect(listActiveProducts).not.toHaveBeenCalled();
    expect(getFxRailState).not.toHaveBeenCalled();
  });

  it("listActiveProducts 가 throw 하면 failed 를 돌려준다", async () => {
    vi.mocked(listActiveProducts).mockRejectedValue(new Error("boom"));
    const { db } = createDbMock();

    const state = await loadCostSheetPage({ db }, ADMIN, {}, "2026-09-20");

    expect(state).toEqual({ kind: "failed" });
  });

  it("원가표 조회가 실패(DB)하면 failed 를 돌려준다 — 결과 없음과는 다른 상태다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "제품A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const db = {
      select: vi.fn(() => {
        throw new Error("boom");
      }),
    } as unknown as Db;

    const state = await loadCostSheetPage({ db }, ADMIN, {}, "2026-09-20");

    expect(state).toEqual({ kind: "failed" });
  });

  it("원가표가 0개면 ok + sheet null 을 돌려준다(failed 와 다르다)", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "제품A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const { db } = createDbMock({ selectResults: [{ value: [] }] });

    const state = await loadCostSheetPage({ db }, ADMIN, {}, "2026-09-20");

    expect(state).toEqual({
      kind: "ok",
      products: [{ id: 1, name: "제품A" }],
      productId: 1,
      route: "kr_domestic",
      sheets: [],
      sheet: null,
      fx: { kind: "unavailable" },
      summary: null,
    });
  });

  it("쿼리 productId 가 제품 목록 밖이면 첫 제품을 쓴다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    const state = await loadCostSheetPage({ db }, ADMIN, { productId: "999" }, "2026-09-20");

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") expect(state.productId).toBe(1);
    // `repr(...).toContain("1")` 는 `$1` 자리표시자에 항상 걸려, listCostSheets 에 넘기는
    // productId·distributionRoute 가 잘못돼도(예: 쿼리 원문 999 를 그대로 조회) 초록불이었다(05 F-3).
    // where 의 params 를 정확히 대조한다 — productId 는 폴백된 1, route 는 기본값 kr_domestic.
    const { sql: sheetsWhereSql, params: sheetsWhereParams } = renderSql(select.logs[0]?.where?.[0]?.[0]);
    expect(sheetsWhereSql).toContain('"cost_sheets"."product_id" = $1 and "cost_sheets"."distribution_route" = $2');
    expect(sheetsWhereParams).toEqual([1, "kr_domestic"]);
  });

  it("쿼리 productId 가 목록에 있고 route 가 유효한 값(kr_domestic 이 아님)이면 그 값들을 그대로 listCostSheets 에 넘긴다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const { db, select } = createDbMock({ selectResults: [{ value: [] }] });

    const state = await loadCostSheetPage(
      { db },
      ADMIN,
      { productId: "2", route: "us_export" },
      "2026-09-20",
    );

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") {
      // route 를 "kr_domestic" 으로 고정하거나 productId 를 항상 첫 제품(1)으로 고정하면
      // 이 단언들이 빨간불이 된다.
      expect(state.productId).toBe(2);
      expect(state.route).toBe("us_export");
    }
    const { sql: sheetsWhereSql, params: sheetsWhereParams } = renderSql(select.logs[0]?.where?.[0]?.[0]);
    expect(sheetsWhereSql).toContain('"cost_sheets"."product_id" = $1 and "cost_sheets"."distribution_route" = $2');
    // listCostSheets 에 route 를 "kr_domestic" 으로 고정해 넘기면 여기서 빨간불이 된다.
    expect(sheetsWhereParams).toEqual([2, "us_export"]);
  });

  it("제품이 0개면 productId 는 null 이고 sheets 는 [](시트 조회 자체를 하지 않는다)", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const { db, select } = createDbMock();

    const state = await loadCostSheetPage({ db }, ADMIN, {}, "2026-09-20");

    expect(state).toEqual({
      kind: "ok",
      products: [],
      productId: null,
      route: "kr_domestic",
      sheets: [],
      sheet: null,
      fx: { kind: "unavailable" },
      summary: null,
    });
    expect(select.fn).not.toHaveBeenCalled();
  });

  it("잘못된 route 쿼리는 kr_domestic 으로 대체한다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const { db } = createDbMock({ selectResults: [{ value: [] }] });

    const state = await loadCostSheetPage({ db }, ADMIN, { route: "jp_export" }, "2026-09-20");

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") expect(state.route).toBe("kr_domestic");
  });

  it("sheetId 가 목록에 있으면 그 시트를 고른다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const sheetRows = [
      { id: 20, productId: 1, distributionRoute: "kr_domestic", name: "v2", effectiveFrom: null, status: "draft", confirmedAt: null },
      { id: 10, productId: 1, distributionRoute: "kr_domestic", name: "v1", effectiveFrom: null, status: "confirmed", confirmedAt: null },
    ];
    const { db } = createDbMock({ selectResults: [{ value: sheetRows }, { value: [] }] });

    const state = await loadCostSheetPage({ db }, ADMIN, { sheetId: "10" }, "2026-09-20");

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") expect(state.sheet?.id).toBe(10);
  });

  it("sheetId 가 목록에 없으면 최신(id desc 첫 번째) 시트를 고른다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const sheetRows = [
      { id: 20, productId: 1, distributionRoute: "kr_domestic", name: "v2", effectiveFrom: null, status: "draft", confirmedAt: null },
      { id: 10, productId: 1, distributionRoute: "kr_domestic", name: "v1", effectiveFrom: null, status: "confirmed", confirmedAt: null },
    ];
    const { db } = createDbMock({ selectResults: [{ value: sheetRows }, { value: [] }] });

    const state = await loadCostSheetPage({ db }, ADMIN, { sheetId: "999" }, "2026-09-20");

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") expect(state.sheet?.id).toBe(20);
  });

  it("fx 가 unavailable 이면 summary 는 null 이지만 sheet 는 그대로 있다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({ kind: "unavailable" });
    const sheetRows = [
      { id: 10, productId: 1, distributionRoute: "kr_domestic", name: "v1", effectiveFrom: null, status: "draft", confirmedAt: null },
    ];
    const itemRows = [{ id: 1, costSheetId: 10, stage: "ph", costKind: "원료", amount: "100", currency: "PHP", basis: "per_unit", batchQty: null }];
    const { db } = createDbMock({ selectResults: [{ value: sheetRows }, { value: itemRows }] });

    const state = await loadCostSheetPage({ db }, ADMIN, {}, "2026-09-20");

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") {
      expect(state.summary).toBeNull();
      expect(state.sheet?.id).toBe(10);
    }
  });

  it("fx 가 ok 면 summarizeCostSheet 로 계산한 summary 를 담는다", async () => {
    vi.mocked(listActiveProducts).mockResolvedValue([{ id: 1, name: "A" }]);
    vi.mocked(getFxRailState).mockResolvedValue({
      kind: "ok",
      snapshot: { asOf: "2026-09-20", staleDays: 0, rates: { usdKrw: "1380", phpKrw: "24.5" }, source: "api" },
    });
    const sheetRows = [
      { id: 10, productId: 1, distributionRoute: "kr_domestic", name: "v1", effectiveFrom: null, status: "draft", confirmedAt: null },
    ];
    const itemRows = [{ id: 1, costSheetId: 10, stage: "ph", costKind: "원료", amount: "56", currency: "PHP", basis: "per_unit", batchQty: null }];
    const { db } = createDbMock({ selectResults: [{ value: sheetRows }, { value: itemRows }] });

    const state = await loadCostSheetPage({ db }, ADMIN, {}, "2026-09-20");

    expect(state.kind).toBe("ok");
    if (state.kind === "ok") {
      expect(state.summary).toEqual({ stages: { ph: 1372, kr: null, us: null }, unitCostKrw: 1372 });
    }
  });
});
