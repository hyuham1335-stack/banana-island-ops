import type { ContentStatus, PlanStatus } from "@/types/index";

/**
 * 계획 상태 파생 — docs/API_SPEC.md 「공통 규약」PlanStatus. 저장하지 않고 항상 파생한다(ADR-007).
 * 순수 함수 — DB·네트워크 접근 없음. 우선순위(고정 순서, 02-cross-verify 사용자 결정):
 *   1. content.status === 'published' → 'published' (onHold 값과 무관)
 *   2. plan.onHold === true → 'on_hold'
 *   3. content 없음 → 'scheduled'
 *   4. content.status === 'draft' | 'rejected' → 'generating'
 *   5. content.status === 'in_review' → 'in_review'
 *   6. content.status === 'approved' → 'approved'
 */
export function derivePlanStatus(
  plan: { onHold: boolean },
  content: { status: ContentStatus } | null,
): PlanStatus {
  if (content?.status === "published") return "published";
  if (plan.onHold) return "on_hold";
  if (content === null) return "scheduled";
  if (content.status === "draft" || content.status === "rejected") return "generating";
  if (content.status === "in_review") return "in_review";
  return "approved";
}
