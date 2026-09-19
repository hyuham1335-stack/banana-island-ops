import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getServerActor } from "@/lib/auth";
import { loadCostSheetPage } from "@/services/cost";
import { todayUtc } from "@/services/fx";
import { toFxRailView } from "@/lib/fx-rail";
import { COST_ROUTES, formatKrw } from "@/lib/cost-sheet-view";
import { Notice } from "@/components/ui/Notice";
import { Empty } from "@/components/ui/Empty";
import { Panel } from "@/components/ui/Panel";
import { CostSheetEditor } from "@/components/cost/CostSheetEditor";
import { NewCostSheetForm } from "@/components/cost/NewCostSheetForm";

export const dynamic = "force-dynamic";

/** 확정일(ISO) → "MM-DD" — 버전 select 라벨과 헤더용, 계약 「화면」 절 표기 그대로. */
function monthDay(iso: string): string {
  return `${iso.slice(5, 7)}-${iso.slice(8, 10)}`;
}

export default async function CostSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; route?: string; sheetId?: string }>;
}) {
  const params = await searchParams;
  const actor = await getServerActor();

  let state: Awaited<ReturnType<typeof loadCostSheetPage>>;
  try {
    state = await loadCostSheetPage(
      { db: getDb() },
      actor,
      { productId: params.productId, route: params.route, sheetId: params.sheetId },
      todayUtc(),
    );
  } catch {
    state = { kind: "failed" };
  }

  if (state.kind === "forbidden") {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">원가표</h1>
        </div>
        <Notice variant="warn">대표만 볼 수 있는 화면입니다</Notice>
      </>
    );
  }

  if (state.kind === "failed") {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">원가표</h1>
        </div>
        <Notice variant="bad">원가표를 불러오지 못했습니다</Notice>
      </>
    );
  }

  const { products, productId, route, sheets, sheet, fx, summary } = state;

  if (products.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">원가표</h1>
        </div>
        <Empty title="활성 제품이 없습니다" />
      </>
    );
  }

  // loadCostSheetPage 계약: 제품이 1개 이상이면 productId 는 null 이 아니다.
  const pid = productId as number;
  const fxView = toFxRailView(fx);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">원가표</h1>
      </div>

      <form method="GET" className="chip-group" role="group">
        <select name="productId" defaultValue={pid}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input type="hidden" name="route" value={route} />
        <button type="submit" className="btn small ghost">
          제품 보기
        </button>
      </form>

      <div className="chip-group" role="group">
        {COST_ROUTES.map((r) => (
          <Link
            key={r.value}
            href={`/costsheet?productId=${pid}&route=${r.value}`}
            className="chip"
            aria-pressed={r.value === route}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {sheets.length > 0 ? (
        <form method="GET" className="chip-group" role="group">
          <input type="hidden" name="productId" value={pid} />
          <input type="hidden" name="route" value={route} />
          <select name="sheetId" defaultValue={sheet ? sheet.id : undefined}>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ·{" "}
                {s.status === "draft" ? "작성중" : `확정${s.confirmedAt ? ` · ${monthDay(s.confirmedAt)} 확정` : ""}`}
              </option>
            ))}
          </select>
          <button type="submit" className="btn small ghost">
            버전 보기
          </button>
        </form>
      ) : null}

      {sheet ? (
        <Panel title="요약">
          {fxView.failed ? (
            <Notice variant="bad">환율을 불러오지 못해 원화 환산을 표시할 수 없습니다</Notice>
          ) : (
            <div className="sub">
              {fxView.text}
              {fxView.stale ? <span className="fx-rail-stale down"> · {fxView.stale}</span> : null}
            </div>
          )}
          {summary ? (
            <dl className="detail-meta">
              <dt>필리핀 합계</dt>
              <dd>{summary.stages.ph === null ? "—" : formatKrw(summary.stages.ph)}</dd>
              <dt>한국 합계</dt>
              <dd>{summary.stages.kr === null ? "—" : formatKrw(summary.stages.kr)}</dd>
              {route === "us_export" ? (
                <>
                  <dt>미국 합계</dt>
                  <dd>{summary.stages.us === null ? "—" : formatKrw(summary.stages.us)}</dd>
                </>
              ) : null}
              <dt>개당 원가</dt>
              <dd>{formatKrw(summary.unitCostKrw)}</dd>
            </dl>
          ) : null}
        </Panel>
      ) : null}

      {sheet === null ? (
        <>
          <Empty title="이 경로의 원가표가 아직 없습니다" />
          <NewCostSheetForm productId={pid} route={route} />
        </>
      ) : (
        <CostSheetEditor key={sheet.id} sheet={sheet} fx={fx.kind === "ok" ? fx.snapshot.rates : null} />
      )}
    </>
  );
}
