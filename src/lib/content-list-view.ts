import type { ContentDetail } from "@/lib/content-detail";
import type { ContentSummary } from "@/services/content-workflow";
import { ContentListQuerySchema } from "@/lib/schemas";

/**
 * /contents 페이지의 상태 필터·검수함 정렬 — 계약(run 20260916-0038-3305).
 * 새 상태값 목록을 두지 않고 기존 ContentListQuerySchema(src/lib/schemas.ts)를 재사용한다.
 */

export function parseContentStatusFilter(raw: string | undefined): ContentDetail["status"] | undefined {
  const result = ContentListQuerySchema.shape.status.safeParse(raw);
  return result.success ? result.data : undefined;
}

/** 원본 배열을 변형하지 않는다. submittedAt 오름차순, null 은 뒤로, 같으면 순서 보존. */
export function sortInboxOrder(items: ContentSummary[]): ContentSummary[] {
  return [...items].sort((a, b) => {
    if (a.submittedAt === b.submittedAt) return 0;
    if (a.submittedAt === null) return 1;
    if (b.submittedAt === null) return -1;
    return a.submittedAt < b.submittedAt ? -1 : 1;
  });
}
