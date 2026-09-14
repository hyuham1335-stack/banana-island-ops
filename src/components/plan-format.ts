/**
 * 계획 표시용 프레젠테이션 헬퍼 — 순수 UI 매핑이라 lib/(공유 순수 함수 계층)가 아니라
 * components/ 쪽에 둔다. 채널·제품 이름은 src/services/plans.ts 가 salesChannels·products 를
 * leftJoin 해 이미 붙여 준다 — 여기서는 표시 형식만 맞춘다.
 */

export type PostType = "health_info" | "activity_news" | "comparison" | "review";

// src/lib/schemas.ts 의 POST_TYPE_LABELS 와 같은 순서(시트 열 F 값과 1:1).
export const POST_TYPE_LABELS: Record<PostType, string> = {
  health_info: "건강정보형",
  activity_news: "활동소식형",
  comparison: "비교큐레이션형",
  review: "후기리뷰형",
};

export function productLabel(productName: string | null): string {
  return productName ?? "제품 없음";
}
