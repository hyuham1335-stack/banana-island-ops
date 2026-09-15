"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Actor } from "@/lib/auth";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";

const ROLE_OPTIONS = [
  { value: "editor", label: "담당자" },
  { value: "admin", label: "대표" },
] as const;

/** Topbar 역할 전환 — 계약(run 20260916-0038-3305). */
export function RoleSwitch({ role }: { role: Actor["role"] }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });

  async function onChange(next: Actor["role"]) {
    if (state.pending) return;
    setState({ pending: true, error: null });
    try {
      const res = await fetch("/api/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setState({ pending: false, error: json?.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      setState({ pending: false, error: null });
      router.refresh();
    } catch {
      setState({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  return (
    <div>
      <Chip options={ROLE_OPTIONS} value={role} onChange={(next) => void onChange(next)} />
      {state.error ? <Notice variant="bad">{state.error}</Notice> : null}
    </div>
  );
}
