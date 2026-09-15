"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Checks } from "@/components/write/Checks";
import { UtmBox } from "@/components/write/UtmBox";
import type { GenState } from "@/components/write/ContentComposer";

/**
 * 우측 생성 패널 — docs/UI_GUIDE.md 「Steps」·「Option」·「Checks」·「UtmBox」. 목업의
 * `#genPanel`(steps 는 항상 보이고, 그 아래 `#genBody` 만 단계별로 바뀐다) 그대로다.
 * 상태·API 호출은 ContentComposer 가 갖고, 이 컴포넌트는 순수하게 그 상태를 그린다.
 */
export function GenPanel({
  gen,
  contextLabel,
  onPickTitle,
  onEditTitle,
  onGenerateBody,
  onRetitle,
  onBackToTitles,
  onEditBodyDraft,
  reviewAction,
  onSubmitReview,
  onCancelReview,
}: {
  gen: GenState;
  contextLabel: string;
  onPickTitle: (index: number) => void;
  onEditTitle: (value: string) => void;
  onGenerateBody: () => void;
  onRetitle: () => void;
  onBackToTitles: () => void;
  onEditBodyDraft: (patch: Partial<{ title: string; body: string }>) => void;
  reviewAction: { pending: boolean; error: string | null };
  onSubmitReview: () => void;
  onCancelReview: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const step1On =
    gen.phase === "idle" || gen.phase === "titles-loading" || gen.phase === "titles-error" || gen.phase === "titles";
  const step2On = gen.phase === "body-loading" || gen.phase === "body-error" || gen.phase === "body";
  const step3On = gen.phase === "body" && gen.content.status === "in_review";

  return (
    <div className="panel">
      <div className="steps">
        <div className={`step${step1On ? " on" : step2On ? " done" : ""}`}>
          <i>1</i>제목 3안
        </div>
        <div className={`step${step2On && !step3On ? " on" : step3On ? " done" : ""}`}>
          <i>2</i>본문 초안
        </div>
        <div className={`step${step3On ? " on" : ""}`}>
          <i>3</i>검수 요청
        </div>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {gen.phase === "idle" ? (
          <div className="empty" style={{ border: 0 }}>
            <strong>왼쪽에서 조건을 고르고 제목 추천을 받으세요</strong>
            제목과 앵글 3안을 먼저 고른 뒤, 그 방향으로 본문을 만듭니다.
          </div>
        ) : null}

        {gen.phase === "titles-loading" ? (
          <div className="empty" style={{ border: 0 }}>
            <strong>제목 3안을 만드는 중</strong>
            규칙 재조회 → 프롬프트 조립 → 1차 LLM 호출 (제목 + 앵글)
          </div>
        ) : null}

        {gen.phase === "titles-error" ? (
          <div style={{ padding: "22px 18px" }}>
            <Notice variant="bad">
              {gen.message}
              <div className="notice-actions">
                <Button variant="ghost" small onClick={onRetitle}>
                  다시 시도
                </Button>
              </div>
            </Notice>
          </div>
        ) : null}

        {gen.phase === "titles" ? (
          <>
            <div className="gen-status">
              {contextLabel}
              {gen.regeneratedIdx.length > 0
                ? ` · 금칙어로 ${gen.regeneratedIdx.length}개 항목 자동 재생성`
                : " · 제목 금칙어 검사 통과"}
            </div>
            <p style={{ padding: "13px 18px 5px", fontSize: 12, color: "var(--muted)" }}>
              제목과 앵글 3안 — 고른 방향으로 본문을 씁니다
            </p>
            {gen.items.map((item, i) => (
              <button
                key={i}
                type="button"
                className="opt"
                aria-pressed={i === gen.chosenIndex}
                onClick={() => onPickTitle(i)}
              >
                <span className="opt-n">{i + 1}</span>
                <span>
                  <span className="opt-t">{item.title}</span>
                  <div className="opt-m">{item.angle}</div>
                </span>
              </button>
            ))}
            <div style={{ padding: 16 }}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="fTitle">
                  선택한 제목 <span className="hint">필요하면 직접 고치세요</span>
                </label>
                <input id="fTitle" type="text" value={gen.chosenTitle} onChange={(e) => onEditTitle(e.target.value)} />
              </div>
              <div className="btn-row">
                <Button onClick={onGenerateBody} disabled={gen.chosenTitle.trim().length === 0}>
                  이 제목으로 본문 만들기
                </Button>
                <Button variant="ghost" small onClick={onRetitle}>
                  제목 다시 추천
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {gen.phase === "body-loading" ? (
          <div className="empty" style={{ border: 0 }}>
            <strong>본문을 만드는 중</strong>
            UTM 링크 생성 → 2차 LLM 호출 (선택 제목·앵글 반영) → 금칙어·필수표현 검증
          </div>
        ) : null}

        {gen.phase === "body-error" ? (
          <div style={{ padding: "22px 18px" }}>
            <Notice variant="bad">
              {gen.message}
              <div className="notice-actions">
                <Button variant="ghost" small onClick={onGenerateBody}>
                  다시 시도
                </Button>
                <Button variant="ghost" small onClick={onBackToTitles}>
                  제목으로 돌아가기
                </Button>
              </div>
            </Notice>
          </div>
        ) : null}

        {gen.phase === "body" ? (
          <>
            <div className="gen-status">
              {contextLabel}
              {gen.content.autoRegenerated
                ? " · 1차 생성에서 차단 표현 감지 → 대체표현 피드백으로 자동 재생성 1회"
                : ""}
            </div>
            <div style={{ padding: "14px 18px 4px" }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label htmlFor="fTitle2">제목</label>
                <input
                  id="fTitle2"
                  type="text"
                  value={gen.draftTitle}
                  onChange={(e) => onEditBodyDraft({ title: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 6 }}>
                <label htmlFor="genText">
                  본문 초안{" "}
                  <span className="hint">
                    고치고 싶은 부분은 바로 수정하세요{gen.edited ? " · 검수 요청 시 다시 검증됩니다" : ""}
                  </span>
                </label>
                <textarea
                  id="genText"
                  rows={11}
                  value={gen.draftBody}
                  onChange={(e) => onEditBodyDraft({ body: e.target.value })}
                />
              </div>
            </div>
            <Checks validation={gen.content.validation} />
            <div className="utm">
              <UtmBox link={gen.content.link} />

              {gen.content.status === "in_review" ? (
                <Notice variant="warn">검수 대기 중입니다. 담당자가 처리하기 전까지 취소할 수 있습니다.</Notice>
              ) : null}

              {reviewAction.error ? <Notice variant="bad">{reviewAction.error}</Notice> : null}

              <div className="btn-row" style={{ marginBottom: 10 }}>
                {gen.content.status === "in_review" ? (
                  <Button variant="ghost" small onClick={onCancelReview} disabled={reviewAction.pending}>
                    검수 요청 취소
                  </Button>
                ) : (
                  <Button
                    small
                    onClick={onSubmitReview}
                    disabled={reviewAction.pending || gen.content.validation.blocks.length > 0}
                    disabledReason={
                      gen.content.validation.blocks.length > 0 ? "차단 표현이 남아 있어 검수 요청을 보낼 수 없습니다" : undefined
                    }
                  >
                    검수 요청
                  </Button>
                )}
                <Button variant="ghost" small disabled disabledReason="다음 단계에서 연결됩니다">
                  다시 만들기
                </Button>
              </div>
              <div className="btn-row">
                {gen.content.link ? (
                  <Button
                    variant="ghost"
                    small
                    onClick={() => {
                      void navigator.clipboard?.writeText(gen.content.link ?? "");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                  >
                    {copied ? "복사됨" : "링크 복사"}
                  </Button>
                ) : null}
                <Button variant="ghost" small onClick={onBackToTitles}>
                  제목으로 돌아가기
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
