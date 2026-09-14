"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";

interface BanRule {
  ruleId: number;
  label: string;
  detectPattern: string | null;
  severity: "block" | "warn";
  alternative: string | null;
  reason: string | null;
  legalBasis: string | null;
}

interface ResolvedRules {
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

const LANG_OPTIONS = [
  { value: "ko" as const, label: "한국어" },
  { value: "en" as const, label: "영어" },
];

export function AutoBox({
  channelId,
  productId,
  initialLang,
}: {
  channelId: number;
  productId: number | null;
  initialLang: "ko" | "en";
}) {
  const [lang, setLang] = useState<"ko" | "en">(initialLang);
  const [attempt, setAttempt] = useState(0);
  // 요청 키가 바뀌면 아직 그 요청의 결과가 아니므로 loading 으로 간주한다 — effect 안에서
  // 곧바로 setState({phase:"loading"}) 를 부르지 않고 렌더 시점에 키를 비교해 파생한다
  // (react-hooks/set-state-in-effect: effect 는 콜백에서만 setState 해야 한다).
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
        setOutcome({ key: requestKey, result: { phase: "ready", rules: body.data } });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setOutcome({ key: requestKey, result: { phase: "error", message: "기준을 불러오지 못했습니다." } });
      });

    return () => controller.abort();
  }, [channelId, lang, productId, requestKey]);

  const state: State = outcome && outcome.key === requestKey ? outcome.result : { phase: "loading" };

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="field">
          <label>언어</label>
          <Chip options={LANG_OPTIONS} value={lang} onChange={setLang} />
        </div>

        {state.phase === "loading" ? (
          <div className="auto loading">GET /api/rules/resolve … 불러오는 중</div>
        ) : null}

        {state.phase === "error" ? (
          <Notice variant="bad">
            {state.message}
            <div className="notice-actions">
              <Button variant="ghost" small onClick={() => setAttempt((n) => n + 1)}>
                다시 시도
              </Button>
            </div>
          </Notice>
        ) : null}

        {state.phase === "ready" ? <ResolvedRulesView rules={state.rules} /> : null}
      </div>
    </div>
  );
}

function ResolvedRulesView({ rules }: { rules: ResolvedRules }) {
  return (
    <div className="auto">
      <div className="auto-meta">
        기준 자료에서 자동 적용 · v{rules.version} · 규칙 {rules.appliedRuleIds.length}개
      </div>

      <div className="auto-row">
        <div className="auto-row-label">타깃</div>
        <div className="auto-row-value">{rules.persona || "—"}</div>
      </div>
      <div className="auto-row">
        <div className="auto-row-label">톤</div>
        <div className="auto-row-value">{rules.tone || "—"}</div>
      </div>
      <div className="auto-row">
        <div className="auto-row-label">형식</div>
        <div className="auto-row-value">{rules.format || "—"}</div>
      </div>
      <div className="auto-row">
        <div className="auto-row-label">필수 표현</div>
        <div className="auto-row-value">
          {rules.must.length === 0 ? "—" : rules.must.join(" · ")}
        </div>
      </div>
      <div className="auto-row">
        <div className="auto-row-label">금칙어</div>
        {rules.ban.length === 0 ? (
          <div className="auto-row-value">—</div>
        ) : (
          rules.ban.map((rule) => (
            <div key={rule.ruleId} className="ban">
              &ldquo;{rule.label}&rdquo; — {rule.severity === "block" ? "차단" : "경고"}
              {rule.alternative ? <span className="ban-alt"> → 대체: {rule.alternative}</span> : null}
              {rule.reason ? <span className="ban-alt"> · {rule.reason}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
