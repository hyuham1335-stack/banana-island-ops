import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { fxRates } from "@/lib/db/schema";
import type { ErrorCode } from "@/lib/http";
import { FrankfurterLatestSchema, type ManualFxInput } from "@/lib/schemas";
import type { FxClient } from "@/lib/fx-client";
import type { FxRailState } from "@/lib/fx-rail";

// 재수출: 계약상 FxRailState 의 출처는 lib/fx-rail.ts 다. 화면 쪽 일부 파일이
// @/services/fx 에서 이 타입을 가져오므로(ui 소유 tsx, impl 이 고칠 수 없음)
// 여기서도 같은 타입을 재수출해 깨지지 않게 한다.
export type { FxRailState };

/**
 * FR-022 환율 적재 — 계약(run 20260919-2343-1c04).
 * 서비스는 throw 하지 않는다 — 다른 서비스와 같은 로컬 Result 패턴.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export interface FxSnapshot {
  asOf: string;
  staleDays: number;
  rates: { usdKrw: string; phpKrw: string };
  source: "api" | "manual";
}

export function todayUtc(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

function toUtcMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function computeStaleDays(asOf: string, today: string): number {
  const diffDays = Math.round((toUtcMidnight(today) - toUtcMidnight(asOf)) / 86_400_000);
  return Math.max(0, diffDays);
}

async function fetchLastRateDate(db: Db): Promise<string | null> {
  try {
    const [row] = await db
      .select({ maxDate: sql<string | null>`max(${fxRates.rateDate})` })
      .from(fxRates);
    return row?.maxDate ?? null;
  } catch {
    return null;
  }
}

async function upsertRates(
  db: Db,
  rows: { rateDate: string; base: "USD" | "PHP"; rate: string; source: "api" | "manual" }[],
): Promise<void> {
  await db
    .insert(fxRates)
    .values(rows.map((r) => ({ rateDate: r.rateDate, base: r.base, quote: "KRW", rate: r.rate, source: r.source })))
    .onConflictDoUpdate({
      target: [fxRates.rateDate, fxRates.base, fxRates.quote],
      set: { rate: sql`excluded.rate`, source: sql`excluded.source` },
    });
}

export async function refreshFx(deps: { fx: FxClient; db: Db }, today: string): Promise<Result<FxSnapshot>> {
  let raw: unknown;
  try {
    raw = await deps.fx.fetchLatest();
  } catch (err) {
    console.error(
      JSON.stringify({ event: "fx_refresh_failed", message: err instanceof Error ? err.message : String(err) }),
    );
    const lastRateDate = await fetchLastRateDate(deps.db);
    return {
      ok: false,
      error: {
        code: "FX_UNAVAILABLE",
        message: "환율을 불러오지 못했습니다. 마지막 값을 유지합니다.",
        details: { lastRateDate },
      },
    };
  }

  const parsed = FrankfurterLatestSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "fx_refresh_invalid_response", raw, issues: parsed.error.issues }));
    const lastRateDate = await fetchLastRateDate(deps.db);
    return {
      ok: false,
      error: {
        code: "FX_UNAVAILABLE",
        message: "환율을 불러오지 못했습니다. 마지막 값을 유지합니다.",
        details: { lastRateDate },
      },
    };
  }

  const { KRW, PHP } = parsed.data.rates;
  const usdKrw = KRW.toFixed(8);
  const phpKrw = (KRW / PHP).toFixed(8);

  try {
    await upsertRates(deps.db, [
      { rateDate: today, base: "USD", rate: usdKrw, source: "api" },
      { rateDate: today, base: "PHP", rate: phpKrw, source: "api" },
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "fx_refresh_db_failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "환율 저장 중 오류가 발생했습니다." } };
  }

  return { ok: true, data: { asOf: today, staleDays: 0, rates: { usdKrw, phpKrw }, source: "api" } };
}

export async function saveManualFx(
  deps: { db: Db },
  input: ManualFxInput,
  today: string,
): Promise<Result<FxSnapshot>> {
  try {
    await upsertRates(deps.db, [
      { rateDate: input.rateDate, base: "USD", rate: input.usdKrw, source: "manual" },
      { rateDate: input.rateDate, base: "PHP", rate: input.phpKrw, source: "manual" },
    ]);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "fx_manual_db_failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return { ok: false, error: { code: "INTERNAL", message: "환율 저장 중 오류가 발생했습니다." } };
  }

  return {
    ok: true,
    data: {
      asOf: input.rateDate,
      staleDays: computeStaleDays(input.rateDate, today),
      rates: { usdKrw: input.usdKrw, phpKrw: input.phpKrw },
      source: "manual",
    },
  };
}

export async function getFx(deps: { db: Db }, date: string): Promise<Result<FxSnapshot>> {
  try {
    const [row] = await deps.db
      .select({ rateDate: fxRates.rateDate })
      .from(fxRates)
      .where(and(sql`${fxRates.rateDate} <= ${date}`, eq(fxRates.quote, "KRW"), inArray(fxRates.base, ["USD", "PHP"])))
      .groupBy(fxRates.rateDate)
      .having(sql`count(distinct ${fxRates.base}) = 2`)
      .orderBy(desc(fxRates.rateDate))
      .limit(1);

    if (!row) {
      return {
        ok: false,
        error: { code: "FX_UNAVAILABLE", message: "환율 데이터가 없습니다.", details: { lastRateDate: null } },
      };
    }

    const asOf = row.rateDate;
    const rows = await deps.db
      .select({ base: fxRates.base, rate: fxRates.rate, source: fxRates.source })
      .from(fxRates)
      .where(and(eq(fxRates.rateDate, asOf), eq(fxRates.quote, "KRW"), inArray(fxRates.base, ["USD", "PHP"])));

    const usd = rows.find((r) => r.base === "USD");
    const php = rows.find((r) => r.base === "PHP");
    const source = rows.some((r) => r.source === "manual") ? "manual" : "api";

    return {
      ok: true,
      data: {
        asOf,
        staleDays: computeStaleDays(asOf, date),
        rates: { usdKrw: usd?.rate ?? "0", phpKrw: php?.rate ?? "0" },
        source,
      },
    };
  } catch (err) {
    console.error(JSON.stringify({ event: "fx_get_failed", message: err instanceof Error ? err.message : String(err) }));
    return { ok: false, error: { code: "INTERNAL", message: "환율 조회 중 오류가 발생했습니다." } };
  }
}

export async function getFxRailState(deps: { db: Db }, today: string): Promise<FxRailState> {
  try {
    const result = await getFx(deps, today);
    if (result.ok) return { kind: "ok", snapshot: result.data };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
