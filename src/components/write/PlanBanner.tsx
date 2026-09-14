import { POST_TYPE_LABELS, productLabel, type PostType } from "@/components/plan-format";

export interface PlanBannerData {
  planId: number;
  scheduledDate: string;
  channelId: number;
  channelName: string;
  productId: number | null;
  productName: string | null;
  postType: PostType;
  ownerName: string | null;
  sheetRowKey: string;
}

/** 시트에서 온 값 — 화면에서 못 고친다(docs/UI_GUIDE.md 「생성 텍스트 블록」). */
export function PlanBanner({ plan }: { plan: PlanBannerData }) {
  return (
    <dl className="plan-banner">
      <span className="src sheet" aria-hidden="true" />
      <div>
        <dt>계획 ID</dt>
        <dd>#{plan.planId}</dd>
      </div>
      <div>
        <dt>예정일</dt>
        <dd>{plan.scheduledDate}</dd>
      </div>
      <div>
        <dt>채널</dt>
        <dd>{plan.channelName}</dd>
      </div>
      <div>
        <dt>제품</dt>
        <dd>{productLabel(plan.productName)}</dd>
      </div>
      <div>
        <dt>글 유형</dt>
        <dd>{POST_TYPE_LABELS[plan.postType]}</dd>
      </div>
      <div>
        <dt>담당자</dt>
        <dd>{plan.ownerName ?? "담당자 미배정"}</dd>
      </div>
      <div>
        <dt>시트 행</dt>
        <dd>{plan.sheetRowKey}</dd>
      </div>
    </dl>
  );
}
