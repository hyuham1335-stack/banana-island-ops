"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 최소 셸 — 지금 구현된 화면(콘텐츠 만들기·계획·콘텐츠)으로 가는 링크만 둔다. 나머지
 * 6개 메뉴는 백엔드가 없어 스텁도 만들지 않는다(docs/ARCHITECTURE.md 의 9개 화면 중 일부).
 */
const NAV_ITEMS = [
  { href: "/write", label: "콘텐츠 만들기", hint: "계획에서 시작 · 즉석 생성" },
  { href: "/plans", label: "계획", hint: "구글 시트 캘린더" },
  { href: "/contents", label: "콘텐츠", hint: "상세 · 이력" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {NAV_ITEMS.map((item) => (
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
    </nav>
  );
}
