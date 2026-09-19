import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// 계약: FR-022(런 20260919-2343-1c04) 「유닛 · services/fx.ts」
//
// DB 는 src/services/plan-sync.test.ts 패턴처럼 vi.fn() 체인으로 모킹해 "올바른 인자로
// 불렸는가 / 몇 번 불렸는가"만 본다. FxClient 는 { fetchLatest } 를 직접 vi.fn() 으로 만든다.

import type { Db } from "@/lib/db/client";
import { fxRates } from "@/lib/db/schema";
import type { FxClient } from "@/lib/fx-client";
import {
  computeStaleDays,
  getFx,
  getFxRailState,
  refreshFx,
  saveManualFx,
  todayUtc,
} from "./fx";

// ---------------------------------------------------------------------------
// DB 모킹 헬퍼 — plan-sync.test.ts 의 makeChainNode 패턴을 select/insert 양쪽에 맞게 확장.
// ---------------------------------------------------------------------------

type CallLog = Record<string, unknown[][]>;
type NodeResult = { value?: unknown; error?: unknown };

/** select/insert 체인 어디서 await 하든 같은 결과로 resolve/reject 하는 thenable 노드. */
function makeChainNode(result: NodeResult, calls: CallLog) {
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
  for (const method of ["from", "where", "groupBy", "having", "orderBy", "limit", "values", "onConflictDoUpdate"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return node;
    });
  }
  return node;
}

interface DbMockOptions {
  /** db.select(...) 가 순서대로 소비할 결과 큐. 부족하면 빈 배열로 resolve. */
  selectResults?: NodeResult[];
  insertResult?: NodeResult;
}

function createDbMock(opts: DbMockOptions = {}) {
  const selectArgs: unknown[][] = [];
  const selectLogs: CallLog[] = [];
  let selectIndex = 0;

  const select = vi.fn((...args: unknown[]) => {
    selectArgs.push(args);
    const calls: CallLog = {};
    selectLogs.push(calls);
    const result = opts.selectResults?.[selectIndex] ?? { value: [] };
    selectIndex += 1;
    return makeChainNode(result, calls);
  });

  const insertArgs: unknown[][] = [];
  const insertLogs: CallLog[] = [];

  const insert = vi.fn((...args: unknown[]) => {
    insertArgs.push(args);
    const calls: CallLog = {};
    insertLogs.push(calls);
    return makeChainNode(opts.insertResult ?? { value: undefined }, calls);
  });

  return {
    db: { select, insert } as unknown as Db,
    selectArgs,
    selectLogs,
    insertArgs,
    insertLogs,
  };
}

const VALID_FRANKFURTER = { base: "USD", date: "2026-09-20", rates: { KRW: 1380.5, PHP: 56.1 } };

function fxClient(impl: () => Promise<unknown>): FxClient {
  return { fetchLatest: vi.fn(impl) };
}

// where/onConflictDoUpdate 로 넘어간 drizzle SQL 조건(조건 객체 자체는 컬럼·테이블을
// 순환 참조로 물고 있어 직접 비교할 수 없다)을 공개 API(PgDialect.sqlToQuery)로
// 텍스트 + 바인드 파라미터로 펼쳐 "어떤 값이 조건에 실제로 쓰였는가"만 관측한다.
const dialect = new PgDialect();
function renderSql(node: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(node as SQL);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// refreshFx
// ---------------------------------------------------------------------------

describe("refreshFx", () => {
  it("성공: insert 1회 · 두 행(rateDate=인자 today, D1) · phpKrw 8자리 계산 · onConflictDoUpdate target 3컬럼 · staleDays 0 · source api", async () => {
    const { db, insertArgs, insertLogs } = createDbMock();
    const fx = fxClient(async () => VALID_FRANKFURTER);

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result).toEqual({
      ok: true,
      data: {
        asOf: "2026-09-20",
        staleDays: 0,
        rates: { usdKrw: "1380.50000000", phpKrw: "24.60784314" },
        source: "api",
      },
    });

    expect(insertArgs).toHaveLength(1);
    expect(insertArgs[0]?.[0]).toBe(fxRates);

    const values = insertLogs[0]?.values?.[0]?.[0] as unknown[];
    expect(values).toEqual([
      { rateDate: "2026-09-20", base: "USD", quote: "KRW", rate: "1380.50000000", source: "api" },
      { rateDate: "2026-09-20", base: "PHP", quote: "KRW", rate: "24.60784314", source: "api" },
    ]);

    const onConflictArg = insertLogs[0]?.onConflictDoUpdate?.[0]?.[0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(onConflictArg.target).toEqual([fxRates.rateDate, fxRates.base, fxRates.quote]);
    expect(Object.keys(onConflictArg.set).sort()).toEqual(["rate", "source"]);
    expect(renderSql(onConflictArg.set.rate).sql).toBe("excluded.rate");
    expect(renderSql(onConflictArg.set.source).sql).toBe("excluded.source");
  });

  it("응답 date 가 아니라 인자로 받은 today 를 rateDate 로 저장한다(D1) — 응답 date 는 다른 날짜여도 무시", async () => {
    const { db, insertLogs } = createDbMock();
    const fx = fxClient(async () => ({ ...VALID_FRANKFURTER, date: "2026-09-18" }));

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.asOf).toBe("2026-09-20");
    const values = insertLogs[0]?.values?.[0]?.[0] as { rateDate: string }[];
    expect(values.every((v) => v.rateDate === "2026-09-20")).toBe(true);
  });

  it("fetchLatest 가 throw 하면 FX_UNAVAILABLE + insert 0회 + lastRateDate 값을 전달한다", async () => {
    const { db, insertArgs } = createDbMock({ selectResults: [{ value: [{ maxDate: "2026-09-19" }] }] });
    const fx = fxClient(async () => {
      throw new Error("network down");
    });

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "FX_UNAVAILABLE",
        message: "환율을 불러오지 못했습니다. 마지막 값을 유지합니다.",
        details: { lastRateDate: "2026-09-19" },
      },
    });
    expect(insertArgs).toHaveLength(0);
  });

  it.each([
    ["rates.KRW 누락", { ...VALID_FRANKFURTER, rates: { PHP: 56.1 } }],
    ["rates.KRW 음수", { ...VALID_FRANKFURTER, rates: { KRW: -1, PHP: 56.1 } }],
    ["rates.PHP 0", { ...VALID_FRANKFURTER, rates: { KRW: 1380.5, PHP: 0 } }],
    ["base가 EUR", { ...VALID_FRANKFURTER, base: "EUR" }],
  ])("스키마 위반(%s) → FX_UNAVAILABLE + insert 0회", async (_label, raw) => {
    const { db, insertArgs } = createDbMock({ selectResults: [{ value: [] }] });
    const fx = fxClient(async () => raw);

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FX_UNAVAILABLE");
    expect(insertArgs).toHaveLength(0);
  });

  it("lastRateDate 조회 결과가 없으면 null 을 details 에 담는다", async () => {
    const { db } = createDbMock({ selectResults: [{ value: [] }] });
    const fx = fxClient(async () => {
      throw new Error("down");
    });

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toEqual({ lastRateDate: null });
  });

  it("lastRateDate 조회가 throw 해도 null 로 두고 여전히 FX_UNAVAILABLE 이다(02 F-4)", async () => {
    const { db } = createDbMock({ selectResults: [{ error: new Error("select boom") }] });
    const fx = fxClient(async () => {
      throw new Error("down");
    });

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FX_UNAVAILABLE");
      expect(result.error.details).toEqual({ lastRateDate: null });
    }
  });

  it("upsert 가 throw 하면 INTERNAL 을 돌려주고 서비스 자체는 throw 하지 않는다", async () => {
    const { db } = createDbMock({ insertResult: { error: new Error("insert failed") } });
    const fx = fxClient(async () => VALID_FRANKFURTER);

    const result = await refreshFx({ fx, db }, "2026-09-20");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// saveManualFx
// ---------------------------------------------------------------------------

describe("saveManualFx", () => {
  const INPUT = { rateDate: "2026-09-15", usdKrw: "1400.00000000", phpKrw: "25.00000000" };

  it("정상: source manual · rateDate 반영 · 같은 upsert 형태(덮어쓰기) · staleDays 계산", async () => {
    const { db, insertArgs, insertLogs } = createDbMock();

    const result = await saveManualFx({ db }, INPUT, "2026-09-17");

    expect(result).toEqual({
      ok: true,
      data: {
        asOf: "2026-09-15",
        staleDays: 2,
        rates: { usdKrw: "1400.00000000", phpKrw: "25.00000000" },
        source: "manual",
      },
    });

    expect(insertArgs).toHaveLength(1);
    expect(insertArgs[0]?.[0]).toBe(fxRates);
    const values = insertLogs[0]?.values?.[0]?.[0] as {
      rateDate: string;
      base: string;
      quote: string;
      rate: string;
      source: string;
    }[];
    // 각 행의 rate 가 받은 문자열 그대로인지(usdKrw→USD, phpKrw→PHP) 잠근다 — 뒤바뀌면 사고.
    expect(values).toEqual([
      { rateDate: "2026-09-15", base: "USD", quote: "KRW", rate: INPUT.usdKrw, source: "manual" },
      { rateDate: "2026-09-15", base: "PHP", quote: "KRW", rate: INPUT.phpKrw, source: "manual" },
    ]);

    const onConflictArg = insertLogs[0]?.onConflictDoUpdate?.[0]?.[0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(onConflictArg.target).toEqual([fxRates.rateDate, fxRates.base, fxRates.quote]);
    expect(Object.keys(onConflictArg.set).sort()).toEqual(["rate", "source"]);
    expect(renderSql(onConflictArg.set.rate).sql).toBe("excluded.rate");
    expect(renderSql(onConflictArg.set.source).sql).toBe("excluded.source");
  });

  it("DB throw → INTERNAL", async () => {
    const { db } = createDbMock({ insertResult: { error: new Error("db down") } });

    const result = await saveManualFx({ db }, INPUT, "2026-09-17");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// getFx
// ---------------------------------------------------------------------------

describe("getFx", () => {
  it("staleDays 0: 조회한 날과 today 가 같으면 0 — ① 의 조회 조건에 전달된 date 가 쓰인다", async () => {
    const { db, selectLogs } = createDbMock({
      selectResults: [
        { value: [{ rateDate: "2026-09-18" }] },
        {
          value: [
            { base: "USD", rate: "1380.50000000", source: "api" },
            { base: "PHP", rate: "24.60784314", source: "api" },
          ],
        },
      ],
    });

    const result = await getFx({ db }, "2026-09-18");

    expect(result).toEqual({
      ok: true,
      data: {
        asOf: "2026-09-18",
        staleDays: 0,
        rates: { usdKrw: "1380.50000000", phpKrw: "24.60784314" },
        source: "api",
      },
    });

    // ① 기준일 탐색 — rate_date <= date · quote='KRW' · base in ('USD','PHP') · limit 1.
    const firstWhere = renderSql(selectLogs[0]?.where?.[0]?.[0]);
    expect(firstWhere.params).toEqual(["2026-09-18", "KRW", "USD", "PHP"]);
    expect(selectLogs[0]?.limit?.[0]?.[0]).toBe(1);
  });

  it("staleDays 2: 조회한 날이 today 보다 이틀 전 — ① 은 전달된 date 로, ② 는 ① 이 찾은 asOf 로 조회한다", async () => {
    const { db, selectLogs } = createDbMock({
      selectResults: [
        { value: [{ rateDate: "2026-09-18" }] },
        {
          value: [
            { base: "USD", rate: "1380.50000000", source: "api" },
            { base: "PHP", rate: "24.60784314", source: "api" },
          ],
        },
      ],
    });

    const result = await getFx({ db }, "2026-09-20");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.staleDays).toBe(2);

    // ① 은 전달된 date("2026-09-20")로 기준일을 찾고, ② 는 그 결과인 asOf("2026-09-18")로 조회한다 —
    // 둘이 같은 값으로 뭉뚱그려지지 않는지 잠근다.
    const firstWhere = renderSql(selectLogs[0]?.where?.[0]?.[0]);
    expect(firstWhere.params).toEqual(["2026-09-20", "KRW", "USD", "PHP"]);

    const secondWhere = renderSql(selectLogs[1]?.where?.[0]?.[0]);
    expect(secondWhere.params).toEqual(["2026-09-18", "KRW", "USD", "PHP"]);
  });

  it("① 조회 조건 잠금: where 가 상한 비교(rate_date <= date)·quote='KRW'·base in('USD','PHP') 이고 groupBy(rate_date)·having(count(distinct base)=2)·orderBy(rate_date desc)·limit(1) 이 호출된다(05 에스컬레이션 계약 델타 — F-3)", async () => {
    const { db, selectLogs } = createDbMock({
      selectResults: [
        { value: [{ rateDate: "2026-09-18" }] },
        {
          value: [
            { base: "USD", rate: "1380.50000000", source: "api" },
            { base: "PHP", rate: "24.60784314", source: "api" },
          ],
        },
      ],
    });

    await getFx({ db }, "2026-09-18");

    // where: rate_date <= date(상한 비교 — 등호 단독이 아님) · quote='KRW' · base in ('USD','PHP').
    // `<=` 를 `=` 로 바꾸면 아래 sql 문자열이 달라져 빨간불이 된다.
    const firstWhere = renderSql(selectLogs[0]?.where?.[0]?.[0]);
    expect(firstWhere.sql).toBe(
      '("fx_rates"."rate_date" <= $1 and "fx_rates"."quote" = $2 and "fx_rates"."base" in ($3, $4))',
    );
    expect(firstWhere.params).toEqual(["2026-09-18", "KRW", "USD", "PHP"]);

    // groupBy(rate_date) — 호출을 지우면 groupBy 콜 로그가 비어 아래 단언이 실패한다.
    expect(selectLogs[0]?.groupBy).toHaveLength(1);
    expect(selectLogs[0]?.groupBy?.[0]?.[0]).toBe(fxRates.rateDate);

    // having count(distinct base) = 2 — 지우거나 다른 값으로 바꾸면 sql 텍스트가 달라진다.
    expect(selectLogs[0]?.having).toHaveLength(1);
    const having = renderSql(selectLogs[0]?.having?.[0]?.[0]);
    expect(having.sql).toBe('count(distinct "fx_rates"."base") = 2');

    // orderBy(rate_date desc) — asc 로 바꾸거나 지우면 빨간불.
    expect(selectLogs[0]?.orderBy).toHaveLength(1);
    const orderBy = renderSql(selectLogs[0]?.orderBy?.[0]?.[0]);
    expect(orderBy.sql).toBe('"fx_rates"."rate_date" desc');

    // limit(1) — 값을 바꾸거나 지우면 빨간불.
    expect(selectLogs[0]?.limit).toHaveLength(1);
    expect(selectLogs[0]?.limit?.[0]?.[0]).toBe(1);
  });

  it("행이 없으면 FX_UNAVAILABLE(lastRateDate: null) 을 돌려준다", async () => {
    const { db } = createDbMock({ selectResults: [{ value: [] }] });

    const result = await getFx({ db }, "2026-09-18");

    expect(result).toEqual({
      ok: false,
      error: { code: "FX_UNAVAILABLE", message: "환율 데이터가 없습니다.", details: { lastRateDate: null } },
    });
  });

  it("두 행 중 하나라도 manual 이면 source 는 manual", async () => {
    const { db } = createDbMock({
      selectResults: [
        { value: [{ rateDate: "2026-09-18" }] },
        {
          value: [
            { base: "USD", rate: "1380.50000000", source: "manual" },
            { base: "PHP", rate: "24.60784314", source: "api" },
          ],
        },
      ],
    });

    const result = await getFx({ db }, "2026-09-18");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.source).toBe("manual");
  });

  it("DB throw → INTERNAL", async () => {
    const { db } = createDbMock({ selectResults: [{ error: new Error("db down") }] });

    const result = await getFx({ db }, "2026-09-18");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });
});

// ---------------------------------------------------------------------------
// computeStaleDays
// ---------------------------------------------------------------------------

describe("computeStaleDays", () => {
  it("같은 날이면 0", () => {
    expect(computeStaleDays("2026-09-18", "2026-09-18")).toBe(0);
  });

  it("이틀 차이면 2", () => {
    expect(computeStaleDays("2026-09-16", "2026-09-18")).toBe(2);
  });

  it("월 경계를 넘어가도 정확히 계산한다", () => {
    expect(computeStaleDays("2026-08-31", "2026-09-01")).toBe(1);
  });

  it("미래 asOf 는 음수 대신 0 을 돌려준다(02 F-2)", () => {
    expect(computeStaleDays("2026-09-20", "2026-09-18")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// todayUtc
// ---------------------------------------------------------------------------

describe("todayUtc", () => {
  it("Date 인자를 UTC YYYY-MM-DD 로 자른다", () => {
    expect(todayUtc(new Date("2026-09-18T23:59:00Z"))).toBe("2026-09-18");
  });
});

// ---------------------------------------------------------------------------
// getFxRailState
// ---------------------------------------------------------------------------

describe("getFxRailState", () => {
  it("getFx 가 ok 면 { kind: 'ok', snapshot }", async () => {
    const { db } = createDbMock({
      selectResults: [
        { value: [{ rateDate: "2026-09-18" }] },
        {
          value: [
            { base: "USD", rate: "1380.50000000", source: "api" },
            { base: "PHP", rate: "24.60784314", source: "api" },
          ],
        },
      ],
    });

    const state = await getFxRailState({ db }, "2026-09-18");

    expect(state).toEqual({
      kind: "ok",
      snapshot: {
        asOf: "2026-09-18",
        staleDays: 0,
        rates: { usdKrw: "1380.50000000", phpKrw: "24.60784314" },
        source: "api",
      },
    });
  });

  it("getFx 가 실패(결과 없음)하면 { kind: 'unavailable' }", async () => {
    const { db } = createDbMock({ selectResults: [{ value: [] }] });

    const state = await getFxRailState({ db }, "2026-09-18");

    expect(state).toEqual({ kind: "unavailable" });
  });

  it("DB 가 throw 해도 절대 throw 하지 않고 { kind: 'unavailable' } 을 돌려준다", async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error("sync failure");
      }),
    } as unknown as Db;

    await expect(getFxRailState({ db }, "2026-09-18")).resolves.toEqual({ kind: "unavailable" });
  });
});
