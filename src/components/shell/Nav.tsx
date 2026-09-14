"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 최소 셸 — 지금 구현된 화면(계획)으로 가는 링크만 둔다. 나머지 8개 메뉴는
 * 백엔드가 없어 스텁도 만들지 않는다(docs/ARCHITECTURE.md 의 9개 화면 중 일부).
 */
const NAV_ITEMS = [{ href: "/plans", label: "계획" }] as const;

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
        </Link>
      ))}
    </nav>
  );
}
