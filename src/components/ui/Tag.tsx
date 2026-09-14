import type { PlanStatus } from "@/types/index";

/** docs/UI_GUIDE.md 「상태색 매핑」표 그대로 — 라벨·클래스가 계획 상태와 1:1. */
const STATUS_META: Record<PlanStatus, { label: string; tagClass: string }> = {
  scheduled: { label: "예정", tagClass: "hold" },
  generating: { label: "생성중", tagClass: "ripe" },
  in_review: { label: "검수 대기", tagClass: "warn" },
  approved: { label: "승인", tagClass: "good" },
  published: { label: "발행 완료", tagClass: "done" },
  on_hold: { label: "보류", tagClass: "off" },
};

export function Tag({ status }: { status: PlanStatus }) {
  const meta = STATUS_META[status];
  return <span className={`tag ${meta.tagClass}`}>{meta.label}</span>;
}
