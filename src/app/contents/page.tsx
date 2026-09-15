import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { listContents } from "@/services/content-workflow";
import { listContentChannels } from "@/services/content-options";
import { ContentList } from "@/components/contents/ContentList";
import { Panel } from "@/components/ui/Panel";
import { Empty } from "@/components/ui/Empty";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";

export default async function ContentsPage() {
  const db = getDb();
  const channels = await listContentChannels({ db });
  const channelNames = Object.fromEntries(channels.map((c) => [c.id, c.name]));

  let items;
  try {
    // mine:false 라 actor 는 실제로 쓰이지 않는다(listContents 시그니처만 맞춘 더미).
    items = await listContents({ db }, { mine: false }, { role: "editor" });
  } catch {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">콘텐츠</h1>
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

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">콘텐츠</h1>
      </div>

      <div className="grid2 rev">
        <Panel title="콘텐츠" note={`${items.length}건`}>
          <ContentList items={items} channelNames={channelNames} />
        </Panel>

        <Panel title="상세">
          <Empty title="왼쪽에서 콘텐츠를 고르세요" />
        </Panel>
      </div>
    </>
  );
}
