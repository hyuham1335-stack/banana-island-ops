import type { ContentDetail } from "@/lib/content-detail";
import type { Actor } from "@/lib/auth";
import { POST_TYPE_LABELS, productLabel } from "@/components/plan-format";
import { ContentTag } from "@/components/contents/ContentTag";
import { ContentActions } from "@/components/contents/ContentActions";
import { Checks } from "@/components/write/Checks";
import { Notice } from "@/components/ui/Notice";

function formatKst(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 콘텐츠 상세 — docs/UI_GUIDE.md 「DetailPanel」: .detail-meta(dl) · 본문 · 검증결과 · 전송 프롬프트 · 액션. */
export function ContentDetailPanel({
  content,
  channelName,
  productName,
  actorRole,
}: {
  content: ContentDetail;
  channelName: string;
  productName: string | null;
  actorRole: Actor["role"];
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{content.title}</span>
        <ContentTag status={content.status} />
      </div>
      <div className="panel-body">
        <dl className="detail-meta">
          <dt>채널</dt>
          <dd>{channelName || "채널 미상"}</dd>
          <dt>언어</dt>
          <dd>{content.lang === "ko" ? "국문" : "영문"}</dd>
          <dt>글 유형</dt>
          <dd>{POST_TYPE_LABELS[content.postType]}</dd>
          <dt>제품</dt>
          <dd>{productLabel(productName)}</dd>
          <dt>등록일</dt>
          <dd>{formatKst(content.createdAt)}</dd>
          <dt>제출일</dt>
          <dd>{formatKst(content.submittedAt)}</dd>
          <dt>검수일</dt>
          <dd>{formatKst(content.reviewedAt)}</dd>
        </dl>

        {content.rejectReason ? <Notice variant="bad">반려 사유: {content.rejectReason}</Notice> : null}

        <div className="detail-sec">
          <h3>본문</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{content.body ?? "(본문 없음)"}</p>
        </div>

        <Checks validation={content.validation} />

        {content.sentPrompt ? (
          <details>
            <summary>전송 프롬프트 원문</summary>
            <pre>{content.sentPrompt}</pre>
          </details>
        ) : null}

        <ContentActions
          key={content.id}
          contentId={content.id}
          status={content.status}
          actorRole={actorRole}
          hasWarnings={content.validation.warns.length > 0}
        />
      </div>
    </div>
  );
}
