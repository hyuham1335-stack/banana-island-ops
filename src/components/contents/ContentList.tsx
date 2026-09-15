import Link from "next/link";
import type { ContentSummary } from "@/services/content-workflow";
import { ContentTag } from "@/components/contents/ContentTag";
import { Empty } from "@/components/ui/Empty";

/** 좌측 콘텐츠 목록 — docs/UI_GUIDE.md 「DetailPanel」 옆에 딸린 목록. 순수 렌더, 상태 없음. */
export function ContentList({
  items,
  channelNames,
  selectedId,
}: {
  items: ContentSummary[];
  channelNames: Record<number, string>;
  selectedId?: number;
}) {
  if (items.length === 0) {
    return <Empty title="콘텐츠가 없습니다" hint="계획 또는 즉석 생성으로 콘텐츠를 먼저 만드세요" />;
  }

  return (
    <div className="content-list">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/contents/${item.id}`}
          className="content-row"
          aria-current={item.id === selectedId ? "page" : undefined}
        >
          <div className="content-row-head">
            <span className="content-row-title">{item.title}</span>
            <ContentTag status={item.status} />
          </div>
          <div className="content-row-meta">
            {channelNames[item.channelId] ?? "채널 미상"} · {item.lang === "ko" ? "국문" : "영문"}
            {item.warnCount > 0 ? ` · 경고 ${item.warnCount}건` : ""}
          </div>
        </Link>
      ))}
    </div>
  );
}
