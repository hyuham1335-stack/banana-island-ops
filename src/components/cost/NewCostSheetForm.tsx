"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CostRoute } from "@/types";
import { describeCostSheetError } from "@/lib/cost-sheet-view";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

/** 새 원가표 생성 — 계약(run 20260920-0107-4265) 「화면 · NewCostSheetForm」. */
export function NewCostSheetForm({ productId, route }: { productId: number; route: CostRoute }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/cost-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, distributionRoute: route, name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(describeCostSheetError(res.status, json));
        setPending(false);
        return;
      }
      router.push(`/costsheet?productId=${productId}&route=${route}&sheetId=${json.data.id}`);
    } catch {
      setError("요청을 보내지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <div className="field">
      <label>새 원가표 이름</label>
      <input
        placeholder="예: 2026 하반기 v1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={pending}
      />
      <Button small disabled={pending || name.trim().length === 0} onClick={() => void create()}>
        {pending ? "만드는 중…" : "새 원가표 만들기"}
      </Button>
      {error ? <Notice variant="bad">{error}</Notice> : null}
    </div>
  );
}
