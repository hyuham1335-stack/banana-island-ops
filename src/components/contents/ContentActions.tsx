"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentDetail } from "@/lib/content-detail";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

/**
 * 콘텐츠 상세의 상태 전이 액션 — FR-009 submit/cancel-review. 지금 백엔드에 있는 두 전이만
 * 다룬다(승인·반려·발행은 아직 API가 없어 버튼을 만들지 않는다).
 */
export function ContentActions({ contentId, status }: { contentId: number; status: ContentDetail["status"] }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });

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

  if (status !== "draft" && status !== "rejected" && status !== "in_review") {
    return null;
  }

  return (
    <div className="btn-row">
      {status === "in_review" ? (
        <Button variant="ghost" small disabled={state.pending} onClick={() => void run("cancel-review")}>
          검수 요청 취소
        </Button>
      ) : (
        <Button small disabled={state.pending} onClick={() => void run("submit")}>
          검수 요청
        </Button>
      )}
      {state.error ? <Notice variant="bad">{state.error}</Notice> : null}
    </div>
  );
}
