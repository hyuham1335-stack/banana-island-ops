"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";

export interface BanRule {
  ruleId: number;
  label: string;
  detectPattern: string | null;
  severity: "block" | "warn";
  alternative: string | null;
  reason: string | null;
}

export interface ResolvedRules {
  version: string;
  appliedRuleIds: number[];
  persona: string;
  tone: string;
  format: string;
  must: string[];
  ban: BanRule[];
}

type Outcome = { phase: "error"; message: string } | { phase: "ready"; rules: ResolvedRules };
type State = { phase: "loading" } | Outcome;

/**
 * 기준 자료 자동 적용 박스 — docs/UI_GUIDE.md 「AutoBox」. 목업처럼 부모(ContentComposer) 폼에
 * 바로 놓이는 단일 박스다(자체 `.panel`·언어 선택은 없음 — 언어는 상위 폼의 칩이 담당한다).
 * 해석된 규칙(특히 persona)은 `onResolved` 로 부모에 올려 타깃 필드 자동 채움에 쓴다.
 */
export function AutoBox({
  channelId,
  productId,
  lang,
  onResolved,
}: {
  channelId: number;
  productId: number | null;
  lang: "ko" | "en";
  onResolved?: (rules: ResolvedRules) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${channelId}|${lang}|${productId}|${attempt}`;
  const [outcome, setOutcome] = useState<{ key: string; result: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ channelId: String(channelId), lang });
    if (productId !== null) params.set("productId", String(productId));

    fetch(`/api/rules/resolve?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setOutcome({
            key: requestKey,
            result: { phase: "error", message: body.error?.message ?? "기준을 불러오지 못했습니다." },
          });
          return;
        }
        const rules = body.data as ResolvedRules;
        setOutcome({ key: requestKey, result: { phase: "ready", rules } });
        onResolved?.(rules);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setOutcome({ key: requestKey, result: { phase: "error", message: "기준을 불러오지 못했습니다." } });
      });

    return () => controller.abort();
    // onResolved 는 부모가 매 렌더 새로 만들어 넘길 수 있다 — 그 자체는 재요청을 일으킬 필요가
    // 없는 콜백이라 deps 에서 뺀다(요청은 channelId·lang·productId·attempt 로만 트리거).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, lang, productId, requestKey]);

  const state: State = outcome && outcome.key === requestKey ? outcome.result : { phase: "loading" };

  if (state.phase === "loading") {
    return <div className="auto loading">GET /api/rules/resolve … 불러오는 중</div>;
  }

  if (state.phase === "error") {
    return (
      <Notice variant="bad">
        {state.message}
        <div className="notice-actions">
          <Button variant="ghost" small onClick={() => setAttempt((n) => n + 1)}>
            다시 시도
          </Button>
        </div>
      </Notice>
    );
  }

  const { rules } = state;
  const banLine = rules.ban.length
    ? rules.ban.map((rule) => rule.label + (rule.severity === "warn" ? " (경고)" : "")).join(" · ")
    : "—";

  return (
    <div className="auto">
      <div className="auto-head">
        기준 자료에서 자동 적용
        <span>
          {rules.version} · 규칙 {rules.appliedRuleIds.length}개 적용
        </span>
      </div>
      <div className="auto-row">
        <span className="auto-key">브랜드 톤</span>
        <span className="auto-val">{rules.tone || "—"}</span>
      </div>
      <div className="auto-row">
        <span className="auto-key">형식</span>
        <span className="auto-val">{rules.format || "—"}</span>
      </div>
      <div className="auto-row">
        <span className="auto-key">필수 표현</span>
        <span className="auto-val">{rules.must.length ? rules.must.join(", ") : "—"}</span>
      </div>
      <div className="auto-row">
        <span className="auto-key">금칙어</span>
        <span className="auto-val ban">{banLine}</span>
      </div>
    </div>
  );
}
