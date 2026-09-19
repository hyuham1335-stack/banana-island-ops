import type { Actor } from "@/lib/auth";
import type { FxRailState } from "@/services/fx";
import { RoleSwitch } from "@/components/shell/RoleSwitch";
import { FxRail } from "@/components/shell/FxRail";

/**
 * 상단바 — docs/UI_GUIDE.md 「컴포넌트 · Topbar」. 역할 전환은 계약(run 20260916-0038-3305).
 * 환율 레일은 계약(run 20260919-2343-1c04) — 브랜드와 역할 전환 사이(UI_GUIDE 순서).
 */
export function Topbar({ role, fx }: { role: Actor["role"]; fx: FxRailState }) {
  return (
    <header className="topbar">
      <span className="topbar-brand">
        <span className="topbar-mark" aria-hidden="true">
          BI
        </span>
        바나나아일랜드 운영
      </span>
      <FxRail state={fx} />
      <RoleSwitch role={role} />
    </header>
  );
}
