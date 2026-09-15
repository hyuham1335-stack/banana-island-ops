import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listContents } from "@/services/content-workflow";
import { listContentChannels } from "@/services/content-options";
import { parseContentStatusFilter, sortInboxOrder } from "@/lib/content-list-view";
import { ContentList } from "@/components/contents/ContentList";
import { Panel } from "@/components/ui/Panel";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";

export default async function ContentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = parseContentStatusFilter(params.status);
  const isInbox = status === "in_review";
  const title = isInbox ? "검수함" : "콘텐츠";

  const db = getDb();
  const channels = await listContentChannels({ db });
  const channelNames = Object.fromEntries(channels.map((c) => [c.id, c.name]));

  let items;
  try {
    // mine:false 라 actor 는 실제로 쓰이지 않는다(listContents 시그니처만 맞춘 더미).
    items = await listContents({ db }, { status, mine: false }, { role: "editor" });
  } catch {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">{title}</h1>
        </div>
        <Notice variant="bad">
          콘텐츠 목록을 불러오지 못했습니다.
          <div className="notice-actions">
            <Link href="/contents" className="btn small ghost">
              다시 시도
            </Link>
          </div>
        </Notice>
      </>
    );
  }

  const displayItems = isInbox ? sortInboxOrder(items) : items;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
      </div>

      <div className="chip-group" role="group">
        <Link href="/contents" className="chip" aria-current={status === undefined ? "true" : undefined}>
          전체
        </Link>
        <Link href="/contents?status=in_review" className="chip" aria-current={isInbox ? "true" : undefined}>
          검수 대기
        </Link>
      </div>

      <div className="grid2 rev">
        <Panel title={title} note={`${displayItems.length}건`}>
          <ContentList items={displayItems} channelNames={channelNames} />
        </Panel>

        <Panel title="상세">
          <Empty title="왼쪽에서 콘텐츠를 고르세요" />
        </Panel>
      </div>
    </>
  );
}
