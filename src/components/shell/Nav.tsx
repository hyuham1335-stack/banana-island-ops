"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Actor } from "@/lib/auth";

/**
 * 최소 셸 — 지금 구현된 화면(콘텐츠 만들기·계획·콘텐츠)으로 가는 링크만 둔다. 나머지
 * 6개 메뉴는 백엔드가 없어 스텁도 만들지 않는다(docs/ARCHITECTURE.md 의 9개 화면 중 일부).
 * 검수함은 admin 에게만 노출(계약 20260916-0038-3305) — 승인/반려 자체는 서버가 인가한다.
 */
const NAV_ITEMS = [
  { href: "/write", label: "콘텐츠 만들기", hint: "계획에서 시작 · 즉석 생성" },
  { href: "/plans", label: "계획", hint: "구글 시트 캘린더" },
  { href: "/contents", label: "콘텐츠", hint: "상세 · 이력" },
] as const;

const INBOX_NAV_ITEM = { href: "/contents?status=in_review", label: "검수함", hint: "대표 승인 대기" } as const;

// FR-020 원가표 — admin 전용(계약 run 20260920-0107-4265). 인가는 서버(/api/cost-sheets*
// · loadCostSheetPage)가 하고, 이 숨김은 편의일 뿐이다.
const COST_SHEET_NAV_ITEM = { href: "/costsheet", label: "원가표", hint: "제품×경로 원가 · 확정" } as const;

export function Nav({ role }: { role: Actor["role"] }) {
  const pathname = usePathname();
  const items =
    role === "admin" ? [...NAV_ITEMS, INBOX_NAV_ITEM, COST_SHEET_NAV_ITEM] : NAV_ITEMS;

  return (
    <nav className="nav">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="nav-item"
          aria-current={pathname.startsWith(item.href) ? "page" : undefined}
        >
          {item.label}
          <small>{item.hint}</small>
        </Link>
      ))}
      <div className="nav-sep" />
      <div className="nav-label">기준 자료</div>
      <Link
        href="/rules"
        className="nav-item"
        aria-current={pathname.startsWith("/rules") ? "page" : undefined}
      >
        브랜드 기준
        <small>톤·필수표현·금칙어·타깃</small>
      </Link>
    </nav>
  );
}
