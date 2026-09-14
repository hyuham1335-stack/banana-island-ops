import { describe, expect, it } from "vitest";
import type { ContentStatus, PlanStatus } from "@/types/index";
import { derivePlanStatus } from "./plan-status";

/**
 * 계약: FR-002 「유닛 · src/lib/plan-status.ts · derivePlanStatus」
 *
 * 고정 우선순위(02-cross-verify 사용자 결정으로 확정, 순서 변경 불가):
 *   1. content?.status === 'published' → 'published' (onHold 값과 무관)
 *   2. plan.onHold === true            → 'on_hold'
 *   3. content 없음(null)              → 'scheduled'
 *   4. content.status === 'draft' | 'rejected' → 'generating'
 *   5. content.status === 'in_review'  → 'in_review'
 *   6. content.status === 'approved'   → 'approved'
 *
 * 예외 없음(모든 입력 조합이 위 여섯 경우 중 하나로 떨어진다) — 골든 테이블로 전수 검증한다.
 */

type Case = {
  label: string;
  content: { status: ContentStatus } | null;
  onHold: boolean;
  expected: PlanStatus;
};

const CASES: Case[] = [
  // 우선순위 1: published 는 onHold 값과 무관하게 항상 'published' 를 이긴다.
  { label: "published + onHold=false → published", content: { status: "published" }, onHold: false, expected: "published" },
  { label: "published + onHold=true → published (onHold 보다 우선)", content: { status: "published" }, onHold: true, expected: "published" },

  // 우선순위 2: onHold=true 는 (published 다음으로) content 유무·상태와 무관하게 'on_hold'.
  { label: "content 없음 + onHold=true → on_hold", content: null, onHold: true, expected: "on_hold" },
  { label: "draft + onHold=true → on_hold", content: { status: "draft" }, onHold: true, expected: "on_hold" },
  { label: "rejected + onHold=true → on_hold", content: { status: "rejected" }, onHold: true, expected: "on_hold" },
  { label: "in_review + onHold=true → on_hold", content: { status: "in_review" }, onHold: true, expected: "on_hold" },
  { label: "approved + onHold=true → on_hold", content: { status: "approved" }, onHold: true, expected: "on_hold" },

  // 우선순위 3: content 없음 + onHold=false → scheduled
  { label: "content 없음 + onHold=false → scheduled", content: null, onHold: false, expected: "scheduled" },

  // 우선순위 4: draft·rejected + onHold=false → generating
  { label: "draft + onHold=false → generating", content: { status: "draft" }, onHold: false, expected: "generating" },
  { label: "rejected + onHold=false → generating", content: { status: "rejected" }, onHold: false, expected: "generating" },

  // 우선순위 5: in_review + onHold=false → in_review
  { label: "in_review + onHold=false → in_review", content: { status: "in_review" }, onHold: false, expected: "in_review" },

  // 우선순위 6: approved + onHold=false → approved
  { label: "approved + onHold=false → approved", content: { status: "approved" }, onHold: false, expected: "approved" },
];

describe("derivePlanStatus", () => {
  it.each(CASES)("$label", ({ content, onHold, expected }) => {
    expect(derivePlanStatus({ onHold }, content)).toBe(expected);
  });

  it("여섯 ContentStatus 값 전부(+ null) 를 최소 한 번씩 다룬다 (골든 테이블 커버리지 자체 점검)", () => {
    const coveredStatuses = new Set(CASES.map((c) => c.content?.status ?? "null"));
    const allStatuses: (ContentStatus | "null")[] = [
      "draft",
      "in_review",
      "approved",
      "rejected",
      "published",
      "null",
    ];
    for (const s of allStatuses) {
      expect(coveredStatuses.has(s)).toBe(true);
    }
  });

  it("순수 함수 — 같은 입력을 여러 번 호출해도 항상 같은 결과 (부수효과 없음)", () => {
    const plan = { onHold: false };
    const content = { status: "in_review" as ContentStatus };
    const first = derivePlanStatus(plan, content);
    const second = derivePlanStatus(plan, content);
    expect(first).toBe(second);
    expect(first).toBe("in_review");
  });
});
