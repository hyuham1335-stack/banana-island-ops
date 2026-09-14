import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { MonthQuerySchema } from "@/lib/schemas";
import { listPlans } from "@/services/plans";
import { Calendar } from "@/components/plans/Calendar";
import { SyncBar } from "@/components/plans/SyncBar";
import { Notice } from "@/components/ui/Notice";
import { Empty } from "@/components/ui/Empty";

export const dynamic = "force-dynamic";

function currentMonthKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr) - 1 + delta;
  const d = new Date(Date.UTC(year, mon, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatKst(date: Date): string {
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const parsedMonth = MonthQuerySchema.safeParse({ month: params.month });
  const month = parsedMonth.success ? parsedMonth.data.month : currentMonthKst();

  const result = await listPlans({ db: getDb() }, month);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">발행 계획</h1>
      </div>

      {!result.ok ? (
        <>
          <Notice variant="bad">
            계획 목록을 불러오지 못했습니다.
            <div className="notice-actions">
              <Link href={`/plans?month=${month}`} className="btn small ghost">
                다시 시도
              </Link>
            </div>
          </Notice>
        </>
      ) : (
        <>
          <SyncBar
            lastSync={
              result.data.lastSync
                ? {
                    createdAt: formatKst(result.data.lastSync.createdAt),
                    totalRows: result.data.lastSync.totalRows,
                    okRows: result.data.lastSync.okRows,
                    failedRows: result.data.lastSync.failedRows,
                  }
                : null
            }
          />

          <div className="cal-head">
            <h2 className="cal-month">{month}</h2>
            <div>
              <Link href={`/plans?month=${shiftMonth(month, -1)}`} className="btn small ghost">
                이전 달
              </Link>
              <Link href={`/plans?month=${shiftMonth(month, 1)}`} className="btn small ghost">
                다음 달
              </Link>
            </div>
          </div>

          {result.data.plans.length === 0 ? (
            <Empty title="이번 달 계획이 없습니다" />
          ) : (
            <Calendar month={month} plans={result.data.plans} />
          )}
        </>
      )}
    </>
  );
}
