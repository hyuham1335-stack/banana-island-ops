import { POST_TYPE_LABELS, productLabel, type PostType } from "@/components/plan-format";

export interface PlanBannerData {
  planId: number;
  scheduledDate: string;
  channelId: number;
  channelName: string;
  lang: "ko" | "en";
  productId: number | null;
  productName: string | null;
  postType: PostType;
  ownerName: string | null;
  sheetRowKey: string;
}

/**
 * 시트에서 온 값 — 화면에서 못 고친다(docs/UI_GUIDE.md 「생성 텍스트 블록」). 목업처럼 굵은
 * 계획ID + 평문 나열을 한 줄에 놓고, 현재 선택값이 계획과 다르면 `diff` 로 "계획과 다름" 태그를
 * 보인다(US-003 AC), 끝에는 `.src.sheet` 로 시트 출처를 표시한다.
 */
export function PlanBanner({ plan, diff }: { plan: PlanBannerData; diff: boolean }) {
  return (
    <div className="plan-banner">
      <b>계획 #{plan.planId}</b>
      <span>{plan.scheduledDate} 발행 예정</span>
      <span>
        {plan.channelName} · {plan.lang === "ko" ? "국문" : "영문"}
      </span>
      <span>{POST_TYPE_LABELS[plan.postType]}</span>
      <span>제품 {productLabel(plan.productName)}</span>
      <span>담당 {plan.ownerName ?? "담당자 미배정"}</span>
      {diff ? <span className="tag ripe">계획과 다름 — 계획은 시트에서만 수정</span> : null}
      <span className="src sheet">시트 행 {plan.sheetRowKey}</span>
    </div>
  );
}
