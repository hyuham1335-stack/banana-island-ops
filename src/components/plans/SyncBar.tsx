"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

export interface LastSyncSummary {
  createdAt: string;
  totalRows: number;
  okRows: number;
  failedRows: number;
}

interface SyncResult {
  upserted: number;
  held: number;
  failed: number;
}

type State =
  | { phase: "idle" }
  | { phase: "syncing" }
  | { phase: "done"; result: SyncResult }
  | { phase: "error"; message: string };

export function SyncBar({ lastSync }: { lastSync: LastSyncSummary | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "idle" });

  async function handleSync() {
    setState({ phase: "syncing" });
    try {
      const res = await fetch("/api/plans/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setState({ phase: "error", message: body.error?.message ?? "동기화에 실패했습니다." });
        return;
      }
      setState({
        phase: "done",
        result: { upserted: body.data.upserted, held: body.data.held, failed: body.data.failed },
      });
      router.refresh();
    } catch {
      setState({ phase: "error", message: "동기화 요청을 보내지 못했습니다." });
    }
  }

  const syncing = state.phase === "syncing";

  return (
    <div className="panel">
      <div className="panel-body">
        <p className="panel-note" style={{ marginBottom: 10 }}>
          <span className="src sheet" aria-hidden="true" />
          {lastSync
            ? `마지막 동기화: ${lastSync.createdAt} · 총 ${lastSync.totalRows}행 · 성공 ${lastSync.okRows} · 실패 ${lastSync.failedRows}`
            : "동기화 이력 없음"}
        </p>
        <Button onClick={handleSync} disabled={syncing}>
          {syncing ? "Sheets API 로 다시 읽는 중…" : "지금 동기화"}
        </Button>
        {state.phase === "done" ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="ok">
              반영 {state.result.upserted}건 · 보류 {state.result.held}건 · 실패 {state.result.failed}건
            </Notice>
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div style={{ marginTop: 12 }}>
            <Notice variant="bad">{state.message}</Notice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
