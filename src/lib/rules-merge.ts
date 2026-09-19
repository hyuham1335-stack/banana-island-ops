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
function dedupeById<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
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

// ---- FR-025 브랜드 기준 화면 --------------------------------------------------

/** brand_rules 행 형태(화면용) — resolveRules 의 BrandRuleRow 에 scope 분기 필드를 더한 것. */
export interface StandardRuleRow extends BrandRuleRow {
  lang: "ko" | "en";
  country: string | null;
  channelId: number | null;
  productId: number | null;
  createdAt: Date;
}

export interface StandardChannelInput {
  id: number;
  name: string;
  country: string;
  lang: "ko" | "en";
}

export interface StandardProductInput {
  id: number;
  name: string;
}

export interface ChannelStandard {
  channelId: number;
  name: string;
  lang: "ko" | "en";
  persona: string;
  tone: string;
  format: string;
  version: string;
  updatedAt: Date | null;
}

export interface BanStandard {
  ruleId: number;
  label: string;
  severity: Severity;
  alternative: string | null;
  reason: string | null;
  legalBasis: string | null;
  lang: "ko" | "en";
  scopeLabel: string;
}

export interface MustGroup {
  lang: "ko" | "en";
  scopeLabel: string;
  items: string[];
}

export interface ProductException {
  productId: number;
  productName: string;
  lang: "ko" | "en";
  persona: string | null;
  tone: string | null;
  format: string | null;
  must: string[];
  affectedChannels: string[];
}

export interface BrandStandards {
  isEmpty: boolean;
  channels: ChannelStandard[];
  bans: BanStandard[];
  musts: MustGroup[];
  productExceptions: ProductException[];
}

function scopeLabel(
  row: Pick<StandardRuleRow, "scope" | "country" | "channelId" | "productId">,
  channels: StandardChannelInput[],
  products: StandardProductInput[],
): string {
  switch (row.scope) {
    case "common":
      return "공통";
    case "country":
      return `국가 ${row.country}`;
    case "channel": {
      const channel = channels.find((ch) => ch.id === row.channelId);
      return `채널 ${channel ? channel.name : `#${row.channelId}`}`;
    }
    case "product": {
      const product = products.find((p) => p.id === row.productId);
      return `제품 ${product ? product.name : `#${row.productId}`}`;
    }
  }
}

export function buildBrandStandards(input: {
  rules: StandardRuleRow[];
  channels: StandardChannelInput[];
  products: StandardProductInput[];
}): BrandStandards {
  const { rules, channels, products } = input;

  if (rules.length === 0) {
    return { isEmpty: true, channels: [], bans: [], musts: [], productExceptions: [] };
  }

  // ---- channels --------------------------------------------------------
  const channelsWithRule = channels
    .filter((ch) => rules.some((row) => row.scope === "channel" && row.channelId === ch.id))
    .sort((a, b) => a.id - b.id);

  const channelStandards: ChannelStandard[] = channelsWithRule.map((ch) => {
    const applicable = rules.filter(
      (row) =>
        row.lang === ch.lang &&
        (row.scope === "common" ||
          (row.scope === "country" && row.country === ch.country) ||
          (row.scope === "channel" && row.channelId === ch.id)),
    );
    const merged = mergeRules(applicable);
    const appliedRows = applicable.filter((row) => merged.appliedRuleIds.includes(row.id));
    const updatedAt =
      appliedRows.length === 0
        ? null
        : appliedRows.reduce<Date>(
            (max, row) => (row.createdAt > max ? row.createdAt : max),
            appliedRows[0].createdAt,
          );
    return {
      channelId: ch.id,
      name: ch.name,
      lang: ch.lang,
      persona: merged.persona,
      tone: merged.tone,
      format: merged.format,
      version: merged.version,
      updatedAt,
    };
  });

  // ---- bans --------------------------------------------------------------
  const banRows = dedupeById(rules.filter((row) => row.ruleType === "ban"));
  const bans: BanStandard[] = banRows.map((row) => ({
    ruleId: row.id,
    label: row.content,
    severity: row.severity ?? "block",
    alternative: row.alternative,
    reason: row.reason,
    legalBasis: row.legalBasis,
    lang: row.lang,
    scopeLabel: scopeLabel(row, channels, products),
  }));

  // ---- musts (non-product scope) -----------------------------------------
  const mustRowsAll = rules.filter(
    (row) => row.ruleType === "must" && (row.scope === "common" || row.scope === "country" || row.scope === "channel"),
  );
  const mustGroupOrder: string[] = [];
  const mustGroupMap = new Map<string, { lang: "ko" | "en"; scopeLabel: string; rows: StandardRuleRow[] }>();
  for (const row of mustRowsAll) {
    const label = scopeLabel(row, channels, products);
    const key = `${row.lang}\u0000${label}`;
    let group = mustGroupMap.get(key);
    if (!group) {
      group = { lang: row.lang, scopeLabel: label, rows: [] };
      mustGroupMap.set(key, group);
      mustGroupOrder.push(key);
    }
    group.rows.push(row);
  }
  const musts: MustGroup[] = mustGroupOrder.map((key) => {
    const group = mustGroupMap.get(key)!;
    const items = dedupeById(group.rows).map((row) => row.content);
    return { lang: group.lang, scopeLabel: group.scopeLabel, items };
  });

  // ---- productExceptions --------------------------------------------------
  const productRows = rules.filter((row) => row.scope === "product");
  const productGroupOrder: string[] = [];
  const productGroupMap = new Map<
    string,
    { productId: number; lang: "ko" | "en"; rows: StandardRuleRow[] }
  >();
  for (const row of productRows) {
    const key = `${row.productId}\u0000${row.lang}`;
    let group = productGroupMap.get(key);
    if (!group) {
      group = { productId: row.productId!, lang: row.lang, rows: [] };
      productGroupMap.set(key, group);
      productGroupOrder.push(key);
    }
    group.rows.push(row);
  }
  const channelNamesByLang = new Map<"ko" | "en", string[]>();
  for (const ch of channelStandards) {
    const list = channelNamesByLang.get(ch.lang) ?? [];
    list.push(ch.name);
    channelNamesByLang.set(ch.lang, list);
  }
  const productExceptions: ProductException[] = productGroupOrder.map((key) => {
    const group = productGroupMap.get(key)!;
    const product = products.find((p) => p.id === group.productId);
    const findFirst = (ruleType: RuleType) => group.rows.find((row) => row.ruleType === ruleType)?.content ?? null;
    const mustItems = dedupeById(group.rows.filter((row) => row.ruleType === "must")).map((row) => row.content);
    return {
      productId: group.productId,
      productName: product ? product.name : `#${group.productId}`,
      lang: group.lang,
      persona: findFirst("persona"),
      tone: findFirst("tone"),
      format: findFirst("format"),
      must: mustItems,
      affectedChannels: channelNamesByLang.get(group.lang) ?? [],
    };
  });

  return {
    isEmpty: false,
    channels: channelStandards,
    bans,
    musts,
    productExceptions,
  };
}
