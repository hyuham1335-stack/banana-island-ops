import { getServerActor } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { getHomeDashboard, type AdChannelSummary } from "@/services/dashboard";
import type { ContentSummary } from "@/services/content-workflow";
import { Panel } from "@/components/ui/Panel";
import { Notice } from "@/components/ui/Notice";
import { Empty } from "@/components/ui/Empty";
import { KpiBand } from "@/components/ui/KpiBand";
import { Table } from "@/components/ui/Table";
import { ContentTag } from "@/components/contents/ContentTag";

/**
 * 홈 대시보드(FR-016) — 계약(run 20260916-*) 「유닛 · page.tsx::Home」.
 * 쓰기가 아니라 읽기이므로 새 /api 라우트를 만들지 않고 서비스를 직접 호출한다
 * (docs/ARCHITECTURE.md "Pages(읽기전용) → Services").
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getServerActor();
  const result = await getHomeDashboard({ db: getDb() }, actor);

  if (!result.ok) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">홈</h1>
        </div>
        <Notice variant="bad">홈 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Notice>
      </>
    );
  }

  const { publishedThisMonth, inReview, approved, channelNames, adSummary } = result.data;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">홈</h1>
      </div>

      <KpiBand label="이번 달 발행 수" now={publishedThisMonth} />

      <Panel title="검수 대기">
        <Table<ContentSummary>
          headers={["제목", "채널", "상태"]}
          rows={inReview}
          renderRow={(item) => [
            item.title,
            channelNames[item.channelId] ?? "채널 미상",
            <ContentTag key="tag" status={item.status} />,
          ]}
          emptyLabel="검수 대기 중인 콘텐츠가 없습니다"
        />
      </Panel>

      <Panel title="승인됨 · 발행 대기">
        <Table<ContentSummary>
          headers={["제목", "채널", "상태"]}
          rows={approved}
          renderRow={(item) => [
            item.title,
            channelNames[item.channelId] ?? "채널 미상",
            <ContentTag key="tag" status={item.status} />,
          ]}
          emptyLabel="승인된 콘텐츠가 없습니다"
        />
      </Panel>

      <Panel title="채널별 광고 성과">
        {adSummary === null ? (
          <Empty title="대표만 볼 수 있습니다" hint="대표로 전환하면 채널별 광고 성과가 보입니다" />
        ) : (
          <Table<AdChannelSummary>
            headers={["채널", "광고비", "매출"]}
            rows={adSummary}
            renderRow={(row) => [
              row.channelName,
              `${row.spend.amount} ${row.spend.currency}`,
              row.revenue ? `${row.revenue.amount} ${row.revenue.currency}` : "—",
            ]}
            emptyLabel="데이터 없음 · Should"
          />
        )}
      </Panel>
    </>
  );
}
