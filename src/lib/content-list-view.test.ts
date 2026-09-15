import { describe, expect, it } from "vitest";
import { parseContentStatusFilter, sortInboxOrder } from "./content-list-view";
import type { ContentSummary } from "@/services/content-workflow";

// 계약: FR-010/011 프론트 연결 + 역할 전환(런 20260916-0038-3305)
// 「유닛 · src/lib/content-list-view.ts · parseContentStatusFilter · sortInboxOrder」

function item(id: number, submittedAt: string | null): ContentSummary {
  return {
    id,
    title: `제목${id}`,
    status: "in_review",
    channelId: 1,
    lang: "ko",
    publishPlanId: null,
    scheduledDate: null,
    authorId: null,
    authorName: null,
    warnCount: 0,
    updatedAt: "2026-09-10T00:00:00.000Z",
    submittedAt,
  };
}

describe("parseContentStatusFilter", () => {
  it.each(["draft", "in_review", "approved", "rejected", "published"] as const)(
    "'%s' 는 유효한 상태라 그대로 돌려준다",
    (status) => {
      expect(parseContentStatusFilter(status)).toBe(status);
    },
  );

  it("undefined 면 undefined 를 돌려준다", () => {
    expect(parseContentStatusFilter(undefined)).toBeUndefined();
  });

  it("빈 문자열이면 undefined 를 돌려준다", () => {
    expect(parseContentStatusFilter("")).toBeUndefined();
  });

  it("닫힌 집합 밖 문자열('foo')이면 undefined 를 돌려준다", () => {
    expect(parseContentStatusFilter("foo")).toBeUndefined();
  });
});

describe("sortInboxOrder", () => {
  it("빈 배열이면 빈 배열을 돌려준다", () => {
    expect(sortInboxOrder([])).toEqual([]);
  });

  it("submittedAt 오름차순으로 정렬한다", () => {
    const items = [
      item(1, "2026-09-12T00:00:00.000Z"),
      item(2, "2026-09-10T00:00:00.000Z"),
      item(3, "2026-09-11T00:00:00.000Z"),
    ];

    expect(sortInboxOrder(items).map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it("submittedAt 이 null 인 항목은 뒤로 간다", () => {
    const items = [
      item(1, null),
      item(2, "2026-09-10T00:00:00.000Z"),
      item(3, null),
      item(4, "2026-09-09T00:00:00.000Z"),
    ];

    expect(sortInboxOrder(items).map((i) => i.id)).toEqual([4, 2, 1, 3]);
  });

  it("이미 정렬된 경우 순서를 그대로 유지한다", () => {
    const items = [
      item(1, "2026-09-09T00:00:00.000Z"),
      item(2, "2026-09-10T00:00:00.000Z"),
      item(3, "2026-09-11T00:00:00.000Z"),
    ];

    expect(sortInboxOrder(items).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("submittedAt 이 같으면 원래 순서를 보존한다(안정 정렬)", () => {
    const same = "2026-09-10T00:00:00.000Z";
    const items = [item(1, same), item(2, same), item(3, same)];

    expect(sortInboxOrder(items).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("submittedAt 이 모두 null 이면 원래 순서를 보존한다", () => {
    const items = [item(3, null), item(1, null), item(2, null)];

    expect(sortInboxOrder(items).map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it("원본 배열을 변형하지 않는다(불변성)", () => {
    const items = [item(2, "2026-09-11T00:00:00.000Z"), item(1, "2026-09-10T00:00:00.000Z")];
    const original = [...items];

    sortInboxOrder(items);

    expect(items).toEqual(original);
  });

  it("반환값은 원본과 다른 배열 참조다", () => {
    const items = [item(1, "2026-09-10T00:00:00.000Z")];

    expect(sortInboxOrder(items)).not.toBe(items);
  });
});
