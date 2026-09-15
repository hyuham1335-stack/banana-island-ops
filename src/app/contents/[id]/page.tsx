import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { getContentDetail, listContents } from "@/services/content-workflow";
import { listActiveProducts, listContentChannels } from "@/services/content-options";
import { ContentList } from "@/components/contents/ContentList";
import { Panel } from "@/components/ui/Panel";
import { Notice } from "@/components/ui/Notice";
import { ContentDetailPanel } from "@/components/contents/ContentDetailPanel";

export const dynamic = "force-dynamic";

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  const db = getDb();
  const [channels, products] = await Promise.all([listContentChannels({ db }), listActiveProducts({ db })]);
  const channelNames = Object.fromEntries(channels.map((c) => [c.id, c.name]));

  let items;
  try {
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

  const listPanel = (
    <Panel title="콘텐츠" note={`${items.length}건`}>
      <ContentList items={items} channelNames={channelNames} selectedId={id} />
    </Panel>
  );

  if (!Number.isInteger(id) || id <= 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">콘텐츠</h1>
        </div>
        <div className="grid2 rev">
          {listPanel}
          <Notice variant="bad">id 형식이 올바르지 않습니다.</Notice>
        </div>
      </>
    );
  }

  const env = getEnv();
  const result = await getContentDetail({ db, productBaseUrl: env.PRODUCT_BASE_URL }, id);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">콘텐츠</h1>
      </div>
      <div className="grid2 rev">
        {listPanel}
        {result.ok ? (
          <ContentDetailPanel
            content={result.data}
            channelName={channelNames[result.data.channelId] ?? ""}
            productName={products.find((p) => p.id === result.data.productId)?.name ?? null}
          />
        ) : (
          <Notice variant="bad">{result.error.message}</Notice>
        )}
      </div>
    </>
  );
}
