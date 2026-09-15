import type { Actor } from "@/lib/auth";
import { RoleSwitch } from "@/components/shell/RoleSwitch";

/** 상단바 — docs/UI_GUIDE.md 「컴포넌트 · Topbar」. 역할 전환은 계약(run 20260916-0038-3305). */
export function Topbar({ role }: { role: Actor["role"] }) {
  return (
    <header className="topbar">
      <span className="topbar-brand">
        <span className="topbar-mark" aria-hidden="true">
          BI
        </span>
        바나나아일랜드 운영
      </span>
      <RoleSwitch role={role} />
    </header>
  );
}
