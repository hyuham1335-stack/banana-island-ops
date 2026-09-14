import Link from "next/link";
import { Tag } from "@/components/ui/Tag";
import { channelLabel, POST_TYPE_LABELS, productLabel, type PostType } from "@/components/plan-format";
import type { PlanStatus } from "@/types/index";

/** Calendar 가 필요로 하는 필드만 — src/services/plans.ts 의 Plan 을 그대로 import 하지 않는다
 * (components → services 직접 import 금지, docs/ARCHITECTURE.md 「레이어 의존 관계」). */
export interface PlanEvent {
  id: number;
  sheetRowKey: string;
  scheduledDate: string;
  channelId: number;
  productId: number | null;
  lang: "ko" | "en";
  postType: PostType;
  topicMemo: string;
  ownerName: string | null;
  status: PlanStatus;
  contentId: number | null;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

interface CalCell {
  dateKey: string;
  day: number;
  inMonth: boolean;
}

function buildWeeks(month: string): CalCell[][] {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);

  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const startWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const prevMonthDays = new Date(Date.UTC(year, mon - 1, 0)).getUTCDate();
  const prevMon = mon === 1 ? 12 : mon - 1;
  const prevYear = mon === 1 ? year - 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;

  const cells: CalCell[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ dateKey: dateKey(prevYear, prevMon, prevMonthDays - i), day: prevMonthDays - i, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateKey: dateKey(year, mon, d), day: d, inMonth: true });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ dateKey: dateKey(nextYear, nextMon, nextDay), day: nextDay, inMonth: false });
    nextDay += 1;
  }

  const weeks: CalCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function todayKeyKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return dateKey(kst.getUTCFullYear(), kst.getUTCMonth() + 1, kst.getUTCDate());
}

export function Calendar({ month, plans }: { month: string; plans: PlanEvent[] }) {
  const weeks = buildWeeks(month);
  const today = todayKeyKst();

  const byDate = new Map<string, PlanEvent[]>();
  for (const plan of plans) {
    const list = byDate.get(plan.scheduledDate) ?? [];
    list.push(plan);
    byDate.set(plan.scheduledDate, list);
  }

  return (
    <div className="cal" role="table" aria-label={`${month} 발행 계획 캘린더`}>
      {DOW.map((label) => (
        <div key={label} className="cal-dow">
          {label}
        </div>
      ))}
      {weeks.flat().map((cell) => (
        <div
          key={cell.dateKey}
          className={`cal-day${cell.inMonth ? "" : " outside"}${cell.dateKey === today ? " today" : ""}`}
        >
          <span className="cal-daynum">{cell.day}</span>
          {(byDate.get(cell.dateKey) ?? []).map((plan) => (
            <CalendarEvent key={plan.id} plan={plan} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarEvent({ plan }: { plan: PlanEvent }) {
  const content = (
    <>
      <div>{POST_TYPE_LABELS[plan.postType]}</div>
      <div className="ev-channel">
        {channelLabel(plan.channelId)} · {productLabel(plan.productId)}
      </div>
      <Tag status={plan.status} />
    </>
  );

  if (plan.contentId !== null) {
    // 이미 콘텐츠가 있는 계획 — /contents/[id] 가 아직 없어 링크 없이 표시만 한다.
    return <div className={`ev s-${plan.status}`}>{content}</div>;
  }

  const params = new URLSearchParams({
    planId: String(plan.id),
    sheetRowKey: plan.sheetRowKey,
    channelId: String(plan.channelId),
    lang: plan.lang,
    postType: plan.postType,
    topicMemo: plan.topicMemo,
    scheduledDate: plan.scheduledDate,
  });
  if (plan.productId !== null) params.set("productId", String(plan.productId));
  if (plan.ownerName !== null) params.set("ownerName", plan.ownerName);

  return (
    <Link href={`/write?${params.toString()}`} className={`ev s-${plan.status}`}>
      {content}
    </Link>
  );
}
