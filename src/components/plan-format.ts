/**
 * 계획 표시용 프레젠테이션 헬퍼 — 순수 UI 매핑이라 lib/(공유 순수 함수 계층)가 아니라
 * components/ 쪽에 둔다. GET /api/channels·/api/products 가 아직 없어 이름을 못 붙이므로
 * 채널·제품은 ID 로만 표시한다(이번 스코프의 제약, docs/ARCHITECTURE.md 참고).
 */

export type PostType = "health_info" | "activity_news" | "comparison" | "review";

// src/lib/schemas.ts 의 POST_TYPE_LABELS 와 같은 순서(시트 열 F 값과 1:1).
export const POST_TYPE_LABELS: Record<PostType, string> = {
  health_info: "건강정보형",
  activity_news: "활동소식형",
  comparison: "비교큐레이션형",
  review: "후기리뷰형",
};

export function channelLabel(channelId: number): string {
  return `채널 #${channelId}`;
}

export function productLabel(productId: number | null): string {
  return productId === null ? "제품 없음" : `제품 #${productId}`;
}
