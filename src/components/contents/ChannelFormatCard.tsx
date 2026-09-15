"use client";

import { useState } from "react";
import type { ChannelFormat } from "@/lib/channel-format";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

/**
 * FR-012 채널 형식 변환 카드 — 계약 밖(UI 세부사항, 에이전트 자율).
 * ContentActions.tsx 와 같은 서버/클라이언트 경계 패턴: 표시용 데이터(channelFormat·link)는
 * 서버 컴포넌트 트리에서 그대로 props 로 내려받고, 클립보드 접근(복사 동작)만 이
 * 클라이언트 컴포넌트가 담당한다. "자동 발행" 버튼은 범위 밖이라 아예 렌더하지 않는다
 * (disabled 처리도 하지 않는다).
 */
export function ChannelFormatCard({ channelFormat, link }: { channelFormat: ChannelFormat; link: string }) {
  const [error, setError] = useState<string | null>(null);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
    } catch {
      setError(`${label}를 복사하지 못했습니다.`);
    }
  }

  return (
    <div className="detail-sec">
      <h3>채널용 형식</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{channelFormat.body}</p>

      {channelFormat.hashtags.length > 0 ? (
        <ul className="hashtag-list">
          {channelFormat.hashtags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}

      <div className="btn-row">
        <Button small variant="ghost" onClick={() => void copy(channelFormat.body, "본문")}>
          본문 복사
        </Button>
        <Button small variant="ghost" onClick={() => void copy(link, "링크")}>
          링크 복사
        </Button>
        {channelFormat.writeUrl ? (
          <a className="btn small ghost" href={channelFormat.writeUrl} target="_blank" rel="noopener noreferrer">
            채널 글쓰기 열기
          </a>
        ) : (
          <Button small variant="ghost" disabled disabledReason="이 채널은 글쓰기 링크가 없습니다">
            채널 글쓰기 열기
          </Button>
        )}
      </div>

      {error ? <Notice variant="bad">{error}</Notice> : null}
    </div>
  );
}
