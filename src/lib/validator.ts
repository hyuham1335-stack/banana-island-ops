import type { BanRule, Severity } from "@/lib/rules-merge";

/**
 * FR-006 하드 룰 검증 — docs/API_SPEC.md 163~167행, docs/TRD.md §3 FR-006.
 * 순수 함수. 규칙마다 detectPattern 정규식으로 전 매치를 찾고, must[] 는 소문자 포함 검사만 한다.
 * 톤·형식 등 정성 판단은 사람이 본다(ADR-008) — 여기서는 하드 룰(ban·must)만 다룬다.
 */

export interface Finding {
  ruleId: number;
  label: string;
  matched: string;
  index: number;
  severity: Severity;
  alternative: string | null;
  reason: string | null;
}

export interface ValidationResult {
  blocks: Finding[];
  warns: Finding[];
  missing: string[];
}

export function validate(text: string, rules: { must: string[]; ban: BanRule[] }): ValidationResult {
  const blocks: Finding[] = [];
  const warns: Finding[] = [];

  for (const rule of rules.ban) {
    if (!rule.detectPattern) continue;

    const pattern = new RegExp(rule.detectPattern, "giu");
    for (const match of text.matchAll(pattern)) {
      const finding: Finding = {
        ruleId: rule.ruleId,
        label: rule.label,
        matched: match[0],
        index: match.index ?? 0,
        severity: rule.severity,
        alternative: rule.alternative,
        reason: rule.reason,
      };
      if (rule.severity === "block") {
        blocks.push(finding);
      } else {
        warns.push(finding);
      }
    }
  }

  const lowerText = text.toLowerCase();
  const missing = rules.must.filter((phrase) => !lowerText.includes(phrase.toLowerCase()));

  return { blocks, warns, missing };
}
