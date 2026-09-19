import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Actor } from "@/lib/auth";
import type { Db } from "@/lib/db/client";
import { costItems, costSheets, products } from "@/lib/db/schema";
import type { ErrorCode } from "@/lib/http";
import type { CreateCostSheetInput, CostSheetListQuery, UpdateCostSheetInput } from "@/lib/schemas";
import { summarizeCostSheet, type CostFx, type CostSheetSummary } from "@/lib/cost-calc";
import { listActiveProducts, type ProductOption } from "@/services/content-options";
import { getFxRailState, type FxRailState } from "@/services/fx";
import type { CostCurrency, CostItem, CostRoute, CostSheet } from "@/types";

/**
 * FR-020 원가표 CRUD·확정·복제 — 계약(run 20260920-0107-4265).
 * 서비스는 throw 하지 않는다 — 다른 서비스와 같은 로컬 Result 패턴.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export type CostSheetPageState =
  | { kind: "forbidden" }
  | { kind: "failed" }
  | {
      kind: "ok";
      products: ProductOption[];
      productId: number | null;
      route: CostRoute;
      sheets: CostSheet[];
      sheet: CostSheet | null;
      fx: FxRailState;
      summary: CostSheetSummary | null;
    };

const ROUTES: CostRoute[] = ["kr_domestic", "us_export", "ph_local"];

type CostItemRow = {
  id: number;
  costSheetId: number;
  stage: CostItem["stage"];
  costKind: string;
  amount: string;
  currency: string;
  basis: CostItem["basis"];
  batchQty: number | null;
};

function toCostItem(row: CostItemRow): CostItem {
  return {
    id: row.id,
    stage: row.stage,
    costKind: row.costKind,
    amount: row.amount,
    currency: row.currency as CostCurrency,
    basis: row.basis,
    batchQty: row.batchQty,
  };
}

type CostSheetRow = {
  id: number;
  productId: number;
  distributionRoute: CostRoute;
  name: string;
  effectiveFrom: string | null;
  status: "draft" | "confirmed";
  confirmedAt: Date | null;
};

function toCostSheet(row: CostSheetRow, items: CostItem[]): CostSheet {
  return {
    id: row.id,
    productId: row.productId,
    distributionRoute: row.distributionRoute,
    name: row.name,
    effectiveFrom: row.effectiveFrom,
    status: row.status,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    items,
  };
}

/** id 하나의 원가표를 항목까지 포함해 다시 읽는다. 없으면 null. throw 하지 않는다(호출부가 try/catch). */
async function fetchCostSheetById(db: Db, id: number): Promise<CostSheet | null> {
  const sheetQuery = db.select().from(costSheets);
  sheetQuery.where(eq(costSheets.id, id));
  const sheetRows = await sheetQuery;
  const sheet = sheetRows[0] as CostSheetRow | undefined;
  if (!sheet) return null;

  const itemQuery = db.select().from(costItems);
  itemQuery.where(eq(costItems.costSheetId, id));
  itemQuery.orderBy(asc(costItems.id));
  const itemRows = (await itemQuery) as CostItemRow[];

  return toCostSheet(sheet, itemRows.map(toCostItem));
}

export async function listCostSheets(deps: { db: Db }, query: CostSheetListQuery): Promise<Result<CostSheet[]>> {
  try {
    const conditions = [];
    if (query.productId !== undefined) conditions.push(eq(costSheets.productId, query.productId));
    if (query.distributionRoute !== undefined) {
      conditions.push(eq(costSheets.distributionRoute, query.distributionRoute));
    }

    const sheetQuery = deps.db.select().from(costSheets);
    if (conditions.length === 1) sheetQuery.where(conditions[0]);
    else if (conditions.length > 1) sheetQuery.where(and(...conditions));
    sheetQuery.orderBy(desc(costSheets.id));
    const sheetRows = (await sheetQuery) as CostSheetRow[];

    if (sheetRows.length === 0) return { ok: true, data: [] };

    const ids = sheetRows.map((row) => row.id);
    const itemQuery = deps.db.select().from(costItems);
    itemQuery.where(inArray(costItems.costSheetId, ids));
    itemQuery.orderBy(asc(costItems.id));
    const itemRows = (await itemQuery) as CostItemRow[];

    const data = sheetRows.map((sheet) =>
      toCostSheet(
        sheet,
        itemRows.filter((item) => item.costSheetId === sheet.id).map(toCostItem),
      ),
    );

    return { ok: true, data };
  } catch (err) {
    console.error(JSON.stringify({ event: "cost_list_failed", message: err instanceof Error ? err.message : String(err) }));
    return { ok: false, error: { code: "INTERNAL", message: "원가표 조회 중 오류가 발생했습니다." } };
  }
}

export async function createCostSheet(deps: { db: Db }, input: CreateCostSheetInput): Promise<Result<CostSheet>> {
  try {
    const productQuery = deps.db.select({ id: products.id }).from(products);
    productQuery.where(eq(products.id, input.productId));
    const productRows = await productQuery;
    if (!productRows[0]) {
      return { ok: false, error: { code: "NOT_FOUND", message: "제품을 찾을 수 없습니다.", details: { resource: "product", id: input.productId } } };
    }

    if (input.cloneFromId === undefined) {
      const [inserted] = (await deps.db
        .insert(costSheets)
        .values({ productId: input.productId, distributionRoute: input.distributionRoute, name: input.name })
        .returning()) as CostSheetRow[];
      return { ok: true, data: toCostSheet(inserted, []) };
    }

    const originQuery = deps.db.select().from(costSheets);
    originQuery.where(eq(costSheets.id, input.cloneFromId));
    const originRows = (await originQuery) as CostSheetRow[];
    const origin = originRows[0];
    if (!origin) {
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "복제할 원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id: input.cloneFromId } },
      };
    }
    if (origin.status === "draft") {
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", message: "작성중인 원가표는 복제할 수 없습니다.", details: { from: "draft", action: "clone" } },
      };
    }
    if (origin.productId !== input.productId || origin.distributionRoute !== input.distributionRoute) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "복제 원본과 제품·유통경로가 다릅니다." } };
    }

    const nextIdResult = await deps.db.execute<{ next_id: string | number }>(
      sql`select nextval(pg_get_serial_sequence('cost_sheets', 'id')) as next_id`,
    );
    const newId = Number((nextIdResult as unknown as { rows: { next_id: string | number }[] }).rows[0].next_id);

    const insertSheetStmt = deps.db
      .insert(costSheets)
      .values({ id: newId, productId: input.productId, distributionRoute: input.distributionRoute, name: input.name });

    const insertItemsStmt = deps.db.insert(costItems).select(
      sql`select nextval(pg_get_serial_sequence('cost_items', 'id')), ${newId}, stage, cost_kind, amount, currency, basis, batch_qty, note, now()
          from cost_items where cost_sheet_id = ${origin.id}`,
    );

    await deps.db.batch([insertSheetStmt, insertItemsStmt]);

    const created = await fetchCostSheetById(deps.db, newId);
    return { ok: true, data: created ?? toCostSheet({ ...origin, id: newId }, []) };
  } catch (err) {
    console.error(JSON.stringify({ event: "cost_create_failed", message: err instanceof Error ? err.message : String(err) }));
    return { ok: false, error: { code: "INTERNAL", message: "원가표 생성 중 오류가 발생했습니다." } };
  }
}

export async function updateCostSheet(
  deps: { db: Db },
  id: number,
  input: UpdateCostSheetInput,
): Promise<Result<CostSheet>> {
  try {
    const existingQuery = deps.db.select().from(costSheets);
    existingQuery.where(eq(costSheets.id, id));
    const existingRows = (await existingQuery) as CostSheetRow[];
    const existing = existingRows[0];
    if (!existing) {
      return { ok: false, error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id } } };
    }
    if (existing.status === "confirmed") {
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", message: "확정된 원가표는 수정할 수 없습니다.", details: { from: "confirmed", action: "update" } },
      };
    }

    const updateStmt = deps.db
      .update(costSheets)
      .set({ name: input.name ?? existing.name })
      .where(and(eq(costSheets.id, id), eq(costSheets.status, "draft")))
      .returning({ id: costSheets.id });

    const draftGuard = sql`exists (select 1 from cost_sheets where id = ${id} and status = 'draft')`;

    const deleteStmt = deps.db.delete(costItems).where(and(eq(costItems.costSheetId, id), draftGuard));

    const statements: unknown[] = [updateStmt, deleteStmt];
    if (input.items.length > 0) {
      const rowsSql = input.items.map(
        (item) =>
          sql`(${id}::bigint, ${item.stage}, ${item.costKind}, ${item.amount}, ${item.currency}, ${item.basis}, ${item.batchQty})`,
      );
      const insertStmt = deps.db.insert(costItems).select(
        sql`select nextval(pg_get_serial_sequence('cost_items', 'id')), v.cost_sheet_id, v.stage::cost_stage, v.cost_kind, v.amount::numeric, v.currency, v.basis::cost_basis, v.batch_qty::integer, null::text, now()
            from (values ${sql.join(rowsSql, sql`, `)}) as v(cost_sheet_id, stage, cost_kind, amount, currency, basis, batch_qty)
            where ${sql`exists (select 1 from cost_sheets where id = ${id} and status = 'draft')`}`,
      );
      statements.push(insertStmt);
    }

    const batchResults = (await deps.db.batch(
      statements as unknown as readonly [never, ...never[]],
    )) as unknown as { id: number }[][];
    const [updateResult] = batchResults;

    if (updateResult.length === 0) {
      const reread = await fetchCostSheetById(deps.db, id);
      if (!reread) {
        return { ok: false, error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id } } };
      }
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", message: "확정된 원가표는 수정할 수 없습니다.", details: { from: "confirmed", action: "update" } },
      };
    }

    const updated = await fetchCostSheetById(deps.db, id);
    return { ok: true, data: updated as CostSheet };
  } catch (err) {
    console.error(JSON.stringify({ event: "cost_update_failed", message: err instanceof Error ? err.message : String(err) }));
    return { ok: false, error: { code: "INTERNAL", message: "원가표 수정 중 오류가 발생했습니다." } };
  }
}

export async function confirmCostSheet(deps: { db: Db }, id: number): Promise<Result<CostSheet>> {
  try {
    const rows = (await deps.db
      .update(costSheets)
      .set({ status: "confirmed", confirmedAt: sql`now()` })
      .where(and(eq(costSheets.id, id), eq(costSheets.status, "draft")))
      .returning()) as CostSheetRow[];

    if (rows.length === 0) {
      const existing = await fetchCostSheetById(deps.db, id);
      if (!existing) {
        return { ok: false, error: { code: "NOT_FOUND", message: "원가표를 찾을 수 없습니다.", details: { resource: "cost_sheet", id } } };
      }
      return {
        ok: false,
        error: { code: "INVALID_TRANSITION", message: "이미 확정된 원가표입니다.", details: { from: "confirmed", action: "confirm" } },
      };
    }

    const confirmed = await fetchCostSheetById(deps.db, id);
    return { ok: true, data: confirmed as CostSheet };
  } catch (err) {
    console.error(JSON.stringify({ event: "cost_confirm_failed", message: err instanceof Error ? err.message : String(err) }));
    return { ok: false, error: { code: "INTERNAL", message: "원가표 확정 중 오류가 발생했습니다." } };
  }
}

export async function loadCostSheetPage(
  deps: { db: Db },
  actor: Actor,
  query: { productId?: string; route?: string; sheetId?: string },
  today: string,
): Promise<CostSheetPageState> {
  if (actor.role !== "admin") return { kind: "forbidden" };

  let productOptions: ProductOption[];
  try {
    productOptions = await listActiveProducts(deps);
  } catch {
    return { kind: "failed" };
  }

  const queriedProductId = query.productId !== undefined ? Number(query.productId) : NaN;
  const productId = productOptions.some((p) => p.id === queriedProductId) ? queriedProductId : (productOptions[0]?.id ?? null);

  const route: CostRoute = ROUTES.includes(query.route as CostRoute) ? (query.route as CostRoute) : "kr_domestic";

  let sheets: CostSheet[] = [];
  if (productId !== null) {
    const result = await listCostSheets(deps, { productId, distributionRoute: route });
    if (!result.ok) return { kind: "failed" };
    sheets = result.data;
  }

  const querySheetId = query.sheetId !== undefined ? Number(query.sheetId) : NaN;
  const sheet = sheets.find((s) => s.id === querySheetId) ?? sheets[0] ?? null;

  const fx = await getFxRailState(deps, today);
  const summary =
    sheet !== null && fx.kind === "ok" ? summarizeCostSheet(sheet.items, fx.snapshot.rates as CostFx) : null;

  return { kind: "ok", products: productOptions, productId, route, sheets, sheet, fx, summary };
}
