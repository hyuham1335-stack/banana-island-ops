"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentDetail } from "@/lib/content-detail";
import type { Actor } from "@/lib/auth";
import type { ApproveResult } from "@/services/content-workflow";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

/**
 * 콘텐츠 상세의 상태 전이 액션 — FR-009 submit/cancel-review + FR-010/011 승인·반려
 * (계약 run 20260916-0038-3305). actorRole 에 따른 렌더 분기는 UX 편의일 뿐이며 인가를
 * 대체하지 않는다 — 서버(content-workflow.ts 의 TRANSITIONS[action].requireRole)가
 * 유일한 인가 지점이다(CLAUDE.md — 화면에서 버튼을 숨기는 것은 인가가 아니다).
 */
export function ContentActions({
  contentId,
  status,
  actorRole,
  hasWarnings,
}: {
  contentId: number;
  status: ContentDetail["status"];
  actorRole: Actor["role"];
  hasWarnings: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [registerAsExample, setRegisterAsExample] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [publishUrl, setPublishUrl] = useState("");
  const [publishResult, setPublishResult] = useState<{ urlCheck: "ok" | "unreachable" | "skipped" | null } | null>(
    null,
  );

  async function run(action: "submit" | "cancel-review") {
    setState({ pending: true, error: null });
    try {
      const res = await fetch(`/api/contents/${contentId}/${action}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setState({ pending: false, error: json.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      setState({ pending: false, error: null });
      router.refresh();
    } catch {
      setState({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  async function runApprove() {
    setState({ pending: true, error: null });
    try {
      const res = await fetch(`/api/contents/${contentId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registerAsExample }),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ pending: false, error: json.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      setState({ pending: false, error: null });
      setApproveResult(json.data as ApproveResult);
      router.refresh();
    } catch {
      setState({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  async function runReject() {
    setState({ pending: true, error: null });
    try {
      const res = await fetch(`/api/contents/${contentId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ pending: false, error: json.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      setState({ pending: false, error: null });
      setRejecting(false);
      setReason("");
      router.refresh();
    } catch {
      setState({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  async function runPublish() {
    setState({ pending: true, error: null });
    try {
      const res = await fetch(`/api/contents/${contentId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishUrl.trim() ? { publishedUrl: publishUrl.trim() } : {}),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ pending: false, error: json.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      setState({ pending: false, error: null });
      setPublishResult({ urlCheck: json.data.urlCheck });
      router.refresh();
    } catch {
      setState({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  if (
    status !== "draft" &&
    status !== "rejected" &&
    status !== "in_review" &&
    status !== "approved" &&
    !approveResult &&
    !publishResult
  ) {
    return null;
  }

  return (
    <div className="btn-row">
      {status === "in_review" && actorRole === "editor" ? (
        <Button variant="ghost" small disabled={state.pending} onClick={() => void run("cancel-review")}>
          검수 요청 취소
        </Button>
      ) : null}

      {status === "in_review" && actorRole === "admin" ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={registerAsExample}
              disabled={hasWarnings || state.pending}
              onChange={(e) => setRegisterAsExample(e.target.checked)}
            />
            브랜드 예시로 등록
            {hasWarnings ? <span>경고 표현이 있어 등록할 수 없습니다</span> : null}
          </label>
          <Button small disabled={state.pending} onClick={() => void runApprove()}>
            승인
          </Button>
          <Button variant="danger" small disabled={state.pending} onClick={() => setRejecting((v) => !v)}>
            반려
          </Button>
          {rejecting ? (
            <div id="rejectBox">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button
                variant="danger"
                small
                disabled={reason.trim().length === 0 || state.pending}
                disabledReason={reason.trim().length === 0 ? "사유를 입력하세요" : undefined}
                onClick={() => void runReject()}
              >
                반려 확정
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {status === "approved" && approveResult ? (
        <>
          {approveResult.exampleRegistered ? <Notice variant="ok">브랜드 예시로 등록되었습니다.</Notice> : null}
          {approveResult.exampleSkippedReason ? (
            <Notice variant="warn">{approveResult.exampleSkippedReason}</Notice>
          ) : null}
        </>
      ) : null}

      {status === "approved" ? (
        <div id="publishBox">
          <input
            type="text"
            placeholder="발행된 URL(선택)"
            value={publishUrl}
            onChange={(e) => setPublishUrl(e.target.value)}
            disabled={state.pending}
          />
          <Button small disabled={state.pending} onClick={() => void runPublish()}>
            발행 완료
          </Button>
        </div>
      ) : null}

      {publishResult ? (
        <>
          {publishResult.urlCheck === "ok" ? <Notice variant="ok">URL 접속을 확인했습니다.</Notice> : null}
          {publishResult.urlCheck === "unreachable" ? (
            <Notice variant="warn">URL 에 접속할 수 없습니다. 링크를 다시 확인하세요.</Notice>
          ) : null}
        </>
      ) : null}

      {status === "draft" || status === "rejected" ? (
        <Button small disabled={state.pending} onClick={() => void run("submit")}>
          검수 요청
        </Button>
      ) : null}

      {state.error ? <Notice variant="bad">{state.error}</Notice> : null}
    </div>
  );
}
