"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { AutoBox, type ResolvedRules } from "@/components/write/AutoBox";
import { PlanBanner, type PlanBannerData } from "@/components/write/PlanBanner";
import { GenPanel } from "@/components/write/GenPanel";
import { POST_TYPE_LABELS, productLabel, type PostType } from "@/components/plan-format";
import type { ChannelOption, ProductOption } from "@/services/content-options";
import type { ContentDetail } from "@/lib/content-detail";

interface TitleItem {
  title: string;
  angle: string;
}

export type GenState =
  | { phase: "idle" }
  | { phase: "titles-loading" }
  | { phase: "titles-error"; message: string }
  | { phase: "titles"; items: TitleItem[]; chosenIndex: number; chosenTitle: string; regeneratedIdx: number[] }
  | { phase: "body-loading"; items: TitleItem[]; chosenIndex: number; chosenTitle: string }
  | { phase: "body-error"; message: string; items: TitleItem[]; chosenIndex: number; chosenTitle: string }
  | {
      phase: "body";
      items: TitleItem[];
      chosenIndex: number;
      content: ContentDetail;
      draftTitle: string;
      draftBody: string;
      edited: boolean;
    };

interface TargetState {
  value: string;
  dirty: boolean;
  auto: string;
  confirmVisible: boolean;
}

const LANG_OPTIONS = [
  { value: "ko" as const, label: "국문" },
  { value: "en" as const, label: "영문" },
];

const POST_TYPE_OPTIONS: { value: PostType; label: string }[] = (
  Object.keys(POST_TYPE_LABELS) as PostType[]
).map((value) => ({ value, label: POST_TYPE_LABELS[value] }));

/**
 * 콘텐츠 만들기 좌우 2단 구조 — docs/UI_GUIDE.md 「레이아웃」 grid2(1.15fr .85fr), 목업
 * `page-write` 전체를 이 컴포넌트가 관리한다. 좌측 폼 상태(목업의 전역 `W`)를 여기서
 * useState 로 들고, 우측 생성 흐름(제목 3안 → 본문 초안)은 GenPanel 에 상태+콜백으로 내린다.
 */
export function ContentComposer({
  channels,
  products,
  plan,
  initialChannelId,
  initialLang,
  initialProductId,
  initialPostType,
  initialTopicMemo,
  initialContent,
}: {
  channels: ChannelOption[];
  products: ProductOption[];
  plan: PlanBannerData | null;
  initialChannelId: number;
  initialLang: "ko" | "en";
  initialProductId: number | null;
  initialPostType: PostType;
  initialTopicMemo: string;
  initialContent: ContentDetail | null;
}) {
  const [channelId, setChannelId] = useState(initialChannelId);
  const [lang, setLang] = useState<"ko" | "en">(initialLang);
  const [productId, setProductId] = useState<number | null>(initialProductId);
  const [postType, setPostType] = useState<PostType>(initialPostType);
  const [topicMemo, setTopicMemo] = useState(initialTopicMemo);
  const [target, setTarget] = useState<TargetState>({ value: "", dirty: false, auto: "", confirmVisible: false });
  const [gen, setGen] = useState<GenState>(
    initialContent
      ? {
          phase: "body",
          items: [],
          chosenIndex: 0,
          content: initialContent,
          draftTitle: initialContent.title,
          draftBody: initialContent.body ?? "",
          edited: false,
        }
      : { phase: "idle" },
  );
  const [reviewAction, setReviewAction] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  const [regenerateInstruction, setRegenerateInstruction] = useState("");

  function handleChannelChange(id: number) {
    setChannelId(id);
    const channel = channels.find((c) => c.id === id);
    if (channel) setLang(channel.lang);
  }

  function handleResolved(rules: ResolvedRules) {
    setTarget((prev) => {
      if (prev.dirty && prev.value !== rules.persona) {
        return { ...prev, auto: rules.persona, confirmVisible: true };
      }
      return { value: rules.persona, dirty: false, auto: rules.persona, confirmVisible: false };
    });
  }

  function handleTargetInput(value: string) {
    setTarget((prev) => ({ ...prev, value, dirty: value !== prev.auto }));
  }

  function handleConfirmYes() {
    setTarget((prev) => ({ value: prev.auto, dirty: false, auto: prev.auto, confirmVisible: false }));
  }

  function handleConfirmNo() {
    setTarget((prev) => ({ ...prev, confirmVisible: false }));
  }

  async function requestTitles() {
    setGen({ phase: "titles-loading" });
    try {
      const res = await fetch("/api/contents/titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, channelId, lang, postType, topicMemo, targetPersona: target.value }),
      });
      const json = await res.json();
      if (!res.ok) {
        setGen({ phase: "titles-error", message: json.error?.message ?? "제목을 만들지 못했습니다." });
        return;
      }
      const items: TitleItem[] = json.data.items;
      setGen({
        phase: "titles",
        items,
        chosenIndex: 0,
        chosenTitle: items[0].title,
        regeneratedIdx: json.data.regeneratedIdx ?? [],
      });
    } catch {
      setGen({ phase: "titles-error", message: "제목 생성 요청을 보내지 못했습니다." });
    }
  }

  function pickTitle(index: number) {
    setGen((prev) => (prev.phase === "titles" ? { ...prev, chosenIndex: index, chosenTitle: prev.items[index].title } : prev));
  }

  function editTitle(value: string) {
    setGen((prev) => (prev.phase === "titles" ? { ...prev, chosenTitle: value } : prev));
  }

  async function generateBody() {
    if (gen.phase !== "titles") return;
    const { items, chosenIndex, chosenTitle } = gen;
    setGen({ phase: "body-loading", items, chosenIndex, chosenTitle });
    try {
      // initialContent 가 있으면(=콘텐츠 상세 "다시 만들기"로 들어온 경우) 새 콘텐츠를
      // 만들지 않고 같은 콘텐츠를 제목·앵글 기반으로 다시 만든다(FR-007 title-분기) —
      // POST /api/contents 로 만들면 계획-콘텐츠 1:1(ADR-007)이 깨진다.
      const res = await (initialContent !== null
        ? fetch(`/api/contents/${initialContent.id}/regenerate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: chosenTitle, angle: items[chosenIndex].angle, titleCandidates: items }),
          })
        : fetch("/api/contents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              publishPlanId: plan?.planId ?? null,
              productId,
              channelId,
              lang,
              postType,
              topicMemo,
              targetPersona: target.value,
              title: chosenTitle,
              angle: items[chosenIndex].angle,
              titleCandidates: items,
            }),
          }));
      const json = await res.json();
      if (!res.ok) {
        setGen({ phase: "body-error", message: json.error?.message ?? "본문을 만들지 못했습니다.", items, chosenIndex, chosenTitle });
        return;
      }
      const content: ContentDetail = json.data;
      setGen({ phase: "body", items, chosenIndex, content, draftTitle: content.title, draftBody: content.body ?? "", edited: false });
    } catch {
      setGen({ phase: "body-error", message: "본문 생성 요청을 보내지 못했습니다.", items, chosenIndex, chosenTitle });
    }
  }

  function backToTitles() {
    setGen((prev) => {
      if (prev.phase === "body") {
        return { phase: "titles", items: prev.items, chosenIndex: prev.chosenIndex, chosenTitle: prev.draftTitle, regeneratedIdx: [] };
      }
      if (prev.phase === "body-error") {
        return { phase: "titles", items: prev.items, chosenIndex: prev.chosenIndex, chosenTitle: prev.chosenTitle, regeneratedIdx: [] };
      }
      return prev;
    });
  }

  // "다시 만들기"(initialContent)로 들어와 아직 제목 후보가 없는 경우(gen.items 가 비어
  // 있음) "제목으로 돌아가기"는 되돌아갈 후보 자체가 없으므로 새로 받는다(requestTitles,
  // LLM 호출 있음). 후보가 이미 있으면 지금처럼 로컬 전환만 한다(LLM 호출 없음).
  function backToTitlesOrRetitle() {
    if (gen.phase === "body" && gen.items.length === 0) {
      void requestTitles();
      return;
    }
    backToTitles();
  }

  function editBodyDraft(patch: Partial<{ title: string; body: string }>) {
    setGen((prev) => (prev.phase === "body" ? { ...prev, ...patch, edited: true } : prev));
  }

  async function runReviewAction(action: "submit" | "cancel-review") {
    if (gen.phase !== "body") return;
    setReviewAction({ pending: true, error: null });
    try {
      const res = await fetch(`/api/contents/${gen.content.id}/${action}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setReviewAction({ pending: false, error: json.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      const content: ContentDetail = json.data;
      setGen((prev) =>
        prev.phase === "body" ? { ...prev, content, draftTitle: content.title, draftBody: content.body ?? "", edited: false } : prev,
      );
      setReviewAction({ pending: false, error: null });
    } catch {
      setReviewAction({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  function submitForReview() {
    void runReviewAction("submit");
  }

  function cancelReview() {
    void runReviewAction("cancel-review");
  }

  // FR-007 — ContentActions.tsx 의 runRegenerate 와 같은 요청이지만, 이미 /write 에
  // 있으므로 성공 후 router.push 대신 gen state 를 그 자리에서 갱신한다.
  async function regenerateBody() {
    if (gen.phase !== "body") return;
    setReviewAction({ pending: true, error: null });
    try {
      const trimmed = regenerateInstruction.trim();
      const res = await fetch(`/api/contents/${gen.content.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed ? { instruction: trimmed } : {}),
      });
      const json = await res.json();
      if (!res.ok) {
        setReviewAction({ pending: false, error: json.error?.message ?? "요청을 처리하지 못했습니다." });
        return;
      }
      const content: ContentDetail = json.data;
      setGen((prev) =>
        prev.phase === "body"
          ? { ...prev, content, draftTitle: content.title, draftBody: content.body ?? "", edited: false }
          : prev,
      );
      setRegenerateInstruction("");
      setReviewAction({ pending: false, error: null });
    } catch {
      setReviewAction({ pending: false, error: "요청을 보내지 못했습니다." });
    }
  }

  const diff = plan !== null && (plan.channelId !== channelId || plan.lang !== lang || plan.productId !== productId);
  const channelName = channels.find((c) => c.id === channelId)?.name ?? "";
  const contextLabel = `${productLabel(products.find((p) => p.id === productId)?.name ?? null)} · ${channelName} · ${
    lang === "ko" ? "국문" : "영문"
  } · ${POST_TYPE_LABELS[postType]}`;

  return (
    <>
      {plan ? <PlanBanner plan={plan} diff={diff} /> : null}

      <div className="grid2">
        <Panel title="무엇을 만들까요" note={plan ? "계획에서 시작" : "즉석 생성"}>
          <div className="field">
            <label htmlFor="fProduct">제품</label>
            <select
              id="fProduct"
              value={productId ?? ""}
              onChange={(e) => setProductId(e.target.value === "" ? null : Number(e.target.value))}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="">(제품 없음 · 브랜드 소식)</option>
            </select>
          </div>

          <div className="field">
            <label>
              채널 <span className="hint">바꾸면 언어와 기준을 다시 불러옵니다</span>
            </label>
            <Chip
              options={channels.map((c) => ({ value: String(c.id), label: c.name }))}
              value={String(channelId)}
              onChange={(v) => handleChannelChange(Number(v))}
            />
          </div>

          <div className="field">
            <label>언어</label>
            <Chip options={LANG_OPTIONS} value={lang} onChange={setLang} />
          </div>

          <div className="field">
            <label>글 유형</label>
            <Chip options={POST_TYPE_OPTIONS} value={postType} onChange={setPostType} />
          </div>

          <div className="field">
            <label htmlFor="fMemo">
              주제 · 메모 <span className="hint">시트의 주제 열이 들어옵니다</span>
            </label>
            <input
              id="fMemo"
              type="text"
              value={topicMemo}
              onChange={(e) => setTopicMemo(e.target.value)}
              placeholder="예: 저GI 베이킹 기초"
            />
          </div>

          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="fTarget">
              읽을 사람 <span className="hint">채널 타깃이 자동으로 채워지고, 고칠 수 있습니다</span>
            </label>
            <input id="fTarget" type="text" value={target.value} onChange={(e) => handleTargetInput(e.target.value)} />
            {target.confirmVisible ? (
              <div className="confirm">
                직접 고친 타깃이 있습니다. 채널 기본값으로 바꿀까요?
                <button type="button" className="btn ghost small" onClick={handleConfirmYes}>
                  바꾸기
                </button>
                <button type="button" className="btn ghost small" onClick={handleConfirmNo}>
                  유지
                </button>
              </div>
            ) : null}
          </div>

          <AutoBox channelId={channelId} productId={productId} lang={lang} onResolved={handleResolved} />

          {initialContent === null ? (
            <div className="btn-row">
              <Button onClick={requestTitles} disabled={gen.phase === "titles-loading"}>
                제목 추천 받기
              </Button>
            </div>
          ) : null}
        </Panel>

        <GenPanel
          gen={gen}
          contextLabel={contextLabel}
          onPickTitle={pickTitle}
          onEditTitle={editTitle}
          onGenerateBody={generateBody}
          onRetitle={requestTitles}
          onBackToTitles={backToTitlesOrRetitle}
          onEditBodyDraft={editBodyDraft}
          reviewAction={reviewAction}
          onSubmitReview={submitForReview}
          onCancelReview={cancelReview}
          regenerateInstruction={regenerateInstruction}
          onRegenerateInstructionChange={setRegenerateInstruction}
          onRegenerate={regenerateBody}
        />
      </div>
    </>
  );
}
