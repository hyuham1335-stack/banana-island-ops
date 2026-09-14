/**
 * FR-003 브랜드 규칙 병합 — 순수 함수. docs/API_SPEC.md 77~96행, docs/TRD.md §「FR-003」.
 * DB·네트워크 접근 없음. scope 우선순위 product > channel > country > common.
 */

import type { ruleScopeEnum, ruleTypeEnum, severityEnum } from "@/lib/db/schema";

// 손으로 다시 선언하지 않고 스키마의 pgEnum 에서 직접 유도한다 — enum 정의가
// 나중에 바뀌어도(예: rule_type 추가) 이 타입이 자동으로 따라간다.
export type RuleScope = (typeof ruleScopeEnum.enumValues)[number];
export type RuleType = (typeof ruleTypeEnum.enumValues)[number];
export type Severity = (typeof severityEnum.enumValues)[number];

/** brand_rules 행 형태 — resolveRules 가 조회해 넘기는 입력. */
export interface BrandRuleRow {
  id: number;
  scope: RuleScope;
  ruleType: RuleType;
  content: string;
  detectPattern: string | null;
  alternative: string | null;
  reason: string | null;
  legalBasis: string | null;
  severity: Severity | null;
  version: number;
}

export interface BanRule {
  ruleId: number;
  label: string;
  detectPattern: string | null;
  severity: Severity;
  alternative: string | null;
  reason: string | null;
  legalBasis: string | null;
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

// scope 우선순위 — 먼저 매칭되는 쪽이 이긴다.
const SCOPE_PRIORITY: RuleScope[] = ["product", "channel", "country", "common"];

/**
 * 같은 ruleType 의 행 중 scope 우선순위가 가장 높은 것 하나를 고른다.
 * 같은 scope 안에서 여럿이면(규칙이 없으므로) 배열의 첫 매칭 행을 쓴다.
 */
function pickSingle(rows: BrandRuleRow[], ruleType: RuleType): BrandRuleRow | null {
  for (const scope of SCOPE_PRIORITY) {
    const found = rows.find((row) => row.ruleType === ruleType && row.scope === scope);
    if (found) return found;
  }
  return null;
}

/** id 기준 중복 제거 — 배열의 첫 등장 순서를 유지한다. */
function dedupeById(rows: BrandRuleRow[]): BrandRuleRow[] {
  const seen = new Set<number>();
  const result: BrandRuleRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

export function mergeRules(rows: BrandRuleRow[]): ResolvedRules {
  const personaRow = pickSingle(rows, "persona");
  const toneRow = pickSingle(rows, "tone");
  const formatRow = pickSingle(rows, "format");

  const mustRows = dedupeById(rows.filter((row) => row.ruleType === "must"));
  const banRows = dedupeById(rows.filter((row) => row.ruleType === "ban"));

  const appliedRows: BrandRuleRow[] = [];
  for (const row of [personaRow, toneRow, formatRow]) {
    if (row) appliedRows.push(row);
  }
  appliedRows.push(...mustRows, ...banRows);

  const appliedRuleIds = appliedRows.map((row) => row.id);
  const version = appliedRows.length === 0 ? "v0" : `v${Math.max(...appliedRows.map((row) => row.version))}`;

  return {
    version,
    appliedRuleIds,
    persona: personaRow?.content ?? "",
    tone: toneRow?.content ?? "",
    format: formatRow?.content ?? "",
    must: mustRows.map((row) => row.content),
    ban: banRows.map((row) => ({
      ruleId: row.id,
      label: row.content,
      detectPattern: row.detectPattern,
      // severity 는 DB 상 nullable 이지만 ban 규칙은 실질적으로 항상 채워진다.
      // 누락된 경우 더 보수적인 쪽(block)으로 기본값을 둔다 — 계약 밖 방어적 선택.
      severity: row.severity ?? "block",
      alternative: row.alternative,
      reason: row.reason,
      legalBasis: row.legalBasis,
    })),
  };
}
