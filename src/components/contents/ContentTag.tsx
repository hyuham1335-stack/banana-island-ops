import type { ContentDetail } from "@/lib/content-detail";

/**
 * 콘텐츠 상태 태그 — docs/UI_GUIDE.md 「상태색 매핑」표 그대로. `Tag`(PlanStatus 전용, 6종)와
 * 값 집합이 달라(콘텐츠는 5종) 별도 컴포넌트로 둔다.
 */
const STATUS_META: Record<ContentDetail["status"], { label: string; tagClass: string; subtitle?: string }> = {
  draft: { label: "초안", tagClass: "ripe" },
  in_review: { label: "검수 대기", tagClass: "warn" },
  approved: { label: "승인", tagClass: "good" },
  published: { label: "발행 완료", tagClass: "done" },
  rejected: { label: "반려", tagClass: "warn", subtitle: "콘텐츠 반려됨" },
};

export function ContentTag({ status }: { status: ContentDetail["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span>
      <span className={`tag ${meta.tagClass}`}>{meta.label}</span>
      {meta.subtitle ? <span className="tag-subtitle">{meta.subtitle}</span> : null}
    </span>
  );
}
