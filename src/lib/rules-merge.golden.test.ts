import { describe, expect, it } from "vitest";
import { mergeRules } from "./rules-merge";
import type { BanRule, BrandRuleRow, ResolvedRules } from "./rules-merge";

/**
 * 계약: FR-003 「유닛 · src/lib/rules-merge.ts · mergeRules」
 *
 * 규칙(계약 원문):
 *   - persona/tone/format: scope 우선순위 product > channel > country > common 으로 각 1개만
 *     채택. 같은 scope 안에서는 배열의 첫 매칭 행을 쓴다(순서 규칙 없음 → 첫 매칭).
 *   - ban/must: 규칙 id 기준 중복 제거한 합집합.
 *   - appliedRuleIds: 실제 병합에 쓰인(= 선택되거나 합집합에 들어간) 모든 행의 id.
 *   - version: appliedRuleIds 가 가리키는 행 중 최대 version 을 "v" + n 으로.
 *   - 빈 배열: must/ban/appliedRuleIds 는 [], version 은 "v0", persona/tone/format 은 각각 "".
 *   - 부분 결측(예: tone 만 없음): 그 필드만 "".
 *   - `ban[].label` 은 `content` 컬럼값 그대로(02-cross-verify F-1).
 *
 * appliedRuleIds·must·ban 은 합집합/집합 연산이라 계약이 순서를 고정하지 않는다 —
 * 비교 전에 정렬해 순서 비의존적으로 검증한다(normalize, 계약 밖 테스트 픽스처 구성).
 */

function row(
  overrides: Partial<BrandRuleRow> & Pick<BrandRuleRow, "id" | "scope" | "ruleType" | "content" | "version">,
): BrandRuleRow {
  return {
    detectPattern: null,
    alternative: null,
    reason: null,
    legalBasis: null,
    severity: null,
    ...overrides,
  };
}

/** appliedRuleIds·must·ban 의 원소 순서를 정렬해 비교를 순서 비의존적으로 만든다. */
function normalize(r: ResolvedRules): ResolvedRules {
  return {
    ...r,
    appliedRuleIds: [...r.appliedRuleIds].sort((a, b) => a - b),
    must: [...r.must].sort(),
    ban: [...r.ban].sort((a, b) => a.ruleId - b.ruleId),
  };
}

type Case = {
  label: string;
  rows: BrandRuleRow[];
  expected: ResolvedRules;
};

const CASES: Case[] = [
  // ---- 빈 배열 -----------------------------------------------------------
  {
    label: "빈 배열 → 전체 공백(persona/tone/format='', must/ban/appliedRuleIds=[], version='v0')",
    rows: [],
    expected: { version: "v0", appliedRuleIds: [], persona: "", tone: "", format: "", must: [], ban: [] },
  },

  // ---- scope 단독 존재(4단계 전수, persona 로 대표) ------------------------
  {
    label: "common 단독 — persona/tone/format/must/ban 모두 common 값 채택",
    rows: [
      row({ id: 1, scope: "common", ruleType: "persona", content: "친근한 이웃", version: 1 }),
      row({ id: 2, scope: "common", ruleType: "tone", content: "다정함", version: 1 }),
      row({ id: 3, scope: "common", ruleType: "format", content: "짧은 문단", version: 1 }),
      row({ id: 4, scope: "common", ruleType: "must", content: "필수: 출처 표기", version: 1 }),
      row({
        id: 5,
        scope: "common",
        ruleType: "ban",
        content: "효능 단정",
        detectPattern: "완치|치료",
        alternative: "도움",
        reason: "과장광고",
        legalBasis: "식약처 가이드",
        severity: "block",
        version: 1,
      }),
    ],
    expected: {
      version: "v1",
      appliedRuleIds: [1, 2, 3, 4, 5],
      persona: "친근한 이웃",
      tone: "다정함",
      format: "짧은 문단",
      must: ["필수: 출처 표기"],
      ban: [
        {
          ruleId: 5,
          label: "효능 단정",
          detectPattern: "완치|치료",
          severity: "block",
          alternative: "도움",
          reason: "과장광고",
          legalBasis: "식약처 가이드",
        },
      ],
    },
  },
  {
    label: "country 단독 — persona 채택",
    rows: [row({ id: 10, scope: "country", ruleType: "persona", content: "국가 맞춤", version: 2 })],
    expected: { version: "v2", appliedRuleIds: [10], persona: "국가 맞춤", tone: "", format: "", must: [], ban: [] },
  },
  {
    label: "channel 단독 — persona 채택",
    rows: [row({ id: 11, scope: "channel", ruleType: "persona", content: "채널 맞춤", version: 3 })],
    expected: { version: "v3", appliedRuleIds: [11], persona: "채널 맞춤", tone: "", format: "", must: [], ban: [] },
  },
  {
    label: "product 단독 — persona 채택",
    rows: [row({ id: 12, scope: "product", ruleType: "persona", content: "제품 맞춤", version: 4 })],
    expected: { version: "v4", appliedRuleIds: [12], persona: "제품 맞춤", tone: "", format: "", must: [], ban: [] },
  },

  // ---- scope 우선순위 사다리(단계별 승자 검증, persona) ---------------------
  {
    label: "country 가 common 을 이긴다",
    rows: [
      row({ id: 20, scope: "common", ruleType: "persona", content: "일반", version: 1 }),
      row({ id: 21, scope: "country", ruleType: "persona", content: "국가별", version: 4 }),
    ],
    expected: { version: "v4", appliedRuleIds: [21], persona: "국가별", tone: "", format: "", must: [], ban: [] },
  },
  {
    label: "channel 이 country 를 이긴다",
    rows: [
      row({ id: 22, scope: "country", ruleType: "persona", content: "국가별", version: 1 }),
      row({ id: 23, scope: "channel", ruleType: "persona", content: "채널별", version: 9 }),
    ],
    expected: { version: "v9", appliedRuleIds: [23], persona: "채널별", tone: "", format: "", must: [], ban: [] },
  },
  {
    label: "product 가 channel 을 이긴다",
    rows: [
      row({ id: 24, scope: "channel", ruleType: "persona", content: "채널별", version: 2 }),
      row({ id: 25, scope: "product", ruleType: "persona", content: "제품별", version: 7 }),
    ],
    expected: { version: "v7", appliedRuleIds: [25], persona: "제품별", tone: "", format: "", must: [], ban: [] },
  },
  {
    label: "4 단계 모두 존재 — product 가 전체를 이긴다",
    rows: [
      row({ id: 30, scope: "common", ruleType: "persona", content: "공통", version: 1 }),
      row({ id: 31, scope: "country", ruleType: "persona", content: "국가", version: 2 }),
      row({ id: 32, scope: "channel", ruleType: "persona", content: "채널", version: 3 }),
      row({ id: 33, scope: "product", ruleType: "persona", content: "제품", version: 4 }),
    ],
    expected: { version: "v4", appliedRuleIds: [33], persona: "제품", tone: "", format: "", must: [], ban: [] },
  },

  // ---- tone·format 도 같은 우선순위를 따르는지(persona 뿐 아니라) ----------
  {
    label: "tone: channel 이 country 를 이긴다",
    rows: [
      row({ id: 40, scope: "country", ruleType: "tone", content: "국가 톤", version: 1 }),
      row({ id: 41, scope: "channel", ruleType: "tone", content: "채널 톤", version: 5 }),
    ],
    expected: { version: "v5", appliedRuleIds: [41], persona: "", tone: "채널 톤", format: "", must: [], ban: [] },
  },
  {
    label: "format: product 가 common 을 이긴다(중간 단계 결측)",
    rows: [
      row({ id: 42, scope: "common", ruleType: "format", content: "공통 포맷", version: 1 }),
      row({ id: 43, scope: "product", ruleType: "format", content: "제품 포맷", version: 6 }),
    ],
    expected: { version: "v6", appliedRuleIds: [43], persona: "", tone: "", format: "제품 포맷", must: [], ban: [] },
  },

  // ---- 같은 scope 안 동률 → 배열의 첫 매칭 행 ------------------------------
  {
    label: "같은 scope(channel) 안에 persona 가 2행이면 배열의 첫 행을 쓴다(둘째는 appliedRuleIds 밖)",
    rows: [
      row({ id: 50, scope: "channel", ruleType: "persona", content: "첫번째", version: 1 }),
      row({ id: 51, scope: "channel", ruleType: "persona", content: "두번째", version: 2 }),
    ],
    expected: { version: "v1", appliedRuleIds: [50], persona: "첫번째", tone: "", format: "", must: [], ban: [] },
  },

  // ---- 부분 결측(각 필드만 빠짐) -------------------------------------------
  {
    label: "부분 결측 — tone 만 없음",
    rows: [
      row({ id: 60, scope: "common", ruleType: "persona", content: "페르소나", version: 1 }),
      row({ id: 61, scope: "common", ruleType: "format", content: "포맷", version: 1 }),
    ],
    expected: {
      version: "v1",
      appliedRuleIds: [60, 61],
      persona: "페르소나",
      tone: "",
      format: "포맷",
      must: [],
      ban: [],
    },
  },
  {
    label: "부분 결측 — persona 만 없음",
    rows: [
      row({ id: 62, scope: "common", ruleType: "tone", content: "톤", version: 1 }),
      row({ id: 63, scope: "common", ruleType: "format", content: "포맷", version: 1 }),
    ],
    expected: { version: "v1", appliedRuleIds: [62, 63], persona: "", tone: "톤", format: "포맷", must: [], ban: [] },
  },
  {
    label: "부분 결측 — format 만 없음",
    rows: [
      row({ id: 64, scope: "common", ruleType: "persona", content: "페르소나", version: 1 }),
      row({ id: 65, scope: "common", ruleType: "tone", content: "톤", version: 1 }),
    ],
    expected: {
      version: "v1",
      appliedRuleIds: [64, 65],
      persona: "페르소나",
      tone: "톤",
      format: "",
      must: [],
      ban: [],
    },
  },
  {
    label: "persona/tone/format 모두 없음 — ban/must 만 있어도 세 필드는 '' 로 떨어진다",
    rows: [
      row({ id: 66, scope: "common", ruleType: "must", content: "필수사항", version: 1 }),
      row({
        id: 67,
        scope: "common",
        ruleType: "ban",
        content: "금칙어",
        detectPattern: "금칙",
        severity: "warn",
        version: 1,
      }),
    ],
    expected: {
      version: "v1",
      appliedRuleIds: [66, 67],
      persona: "",
      tone: "",
      format: "",
      must: ["필수사항"],
      ban: [
        { ruleId: 67, label: "금칙어", detectPattern: "금칙", severity: "warn", alternative: null, reason: null, legalBasis: null },
      ],
    },
  },

  // ---- ban/must 합집합·중복 제거 -------------------------------------------
  {
    label: "ban/must — 서로 다른 scope 의 여러 행이 합집합으로 전부 포함된다",
    rows: [
      row({ id: 70, scope: "common", ruleType: "must", content: "공통 필수", version: 1 }),
      row({ id: 71, scope: "channel", ruleType: "must", content: "채널 필수", version: 1 }),
      row({
        id: 72,
        scope: "common",
        ruleType: "ban",
        content: "공통 금칙",
        detectPattern: "완치",
        alternative: "개선",
        reason: "과장",
        legalBasis: "식약처",
        severity: "block",
        version: 1,
      }),
      row({
        id: 73,
        scope: "country",
        ruleType: "ban",
        content: "국가 금칙",
        detectPattern: null,
        alternative: null,
        reason: null,
        legalBasis: null,
        severity: "warn",
        version: 2,
      }),
    ],
    expected: {
      version: "v2",
      appliedRuleIds: [70, 71, 72, 73],
      persona: "",
      tone: "",
      format: "",
      must: ["공통 필수", "채널 필수"],
      ban: [
        { ruleId: 72, label: "공통 금칙", detectPattern: "완치", severity: "block", alternative: "개선", reason: "과장", legalBasis: "식약처" },
        { ruleId: 73, label: "국가 금칙", detectPattern: null, severity: "warn", alternative: null, reason: null, legalBasis: null },
      ],
    },
  },
  {
    label: "ban 행이 동일 id 로 두 번 들어와도(중복 조회 방어) 결과에는 한 번만 반영된다",
    rows: [
      row({
        id: 80,
        scope: "common",
        ruleType: "ban",
        content: "중복 금칙",
        detectPattern: "패턴",
        alternative: "대안",
        reason: "사유",
        legalBasis: "근거",
        severity: "block",
        version: 3,
      }),
      row({
        id: 80,
        scope: "common",
        ruleType: "ban",
        content: "중복 금칙",
        detectPattern: "패턴",
        alternative: "대안",
        reason: "사유",
        legalBasis: "근거",
        severity: "block",
        version: 3,
      }),
    ],
    expected: {
      version: "v3",
      appliedRuleIds: [80],
      persona: "",
      tone: "",
      format: "",
      must: [],
      ban: [
        { ruleId: 80, label: "중복 금칙", detectPattern: "패턴", severity: "block", alternative: "대안", reason: "사유", legalBasis: "근거" },
      ],
    },
  },

  // ---- version 은 "실제 적용된 행" 중 최대다(전체 최대가 아니다) -----------
  {
    label: "version 은 appliedRuleIds 가 가리키는 행 중 최대다 — 우선순위에 밀려 탈락한 고버전 행은 무시한다",
    rows: [
      // common persona 가 v10 으로 가장 높지만 country persona 에 밀려 탈락 → version 계산에서 제외돼야 한다.
      row({ id: 90, scope: "common", ruleType: "persona", content: "탈락(공통)", version: 10 }),
      row({ id: 91, scope: "country", ruleType: "persona", content: "채택(국가)", version: 2 }),
      row({ id: 92, scope: "common", ruleType: "ban", content: "금칙", detectPattern: null, severity: "warn", version: 9 }),
    ],
    expected: {
      version: "v9",
      appliedRuleIds: [91, 92],
      persona: "채택(국가)",
      tone: "",
      format: "",
      must: [],
      ban: [{ ruleId: 92, label: "금칙", detectPattern: null, severity: "warn", alternative: null, reason: null, legalBasis: null }],
    },
  },
];

describe("mergeRules", () => {
  it.each(CASES)("$label", ({ rows, expected }) => {
    expect(normalize(mergeRules(rows))).toEqual(normalize(expected));
  });

  it("scope 4단계(product/channel/country/common) 전부와 ruleType 5종(ban/must/tone/format/persona) 전부를 CASES 가 다룬다(자체 커버리지 점검)", () => {
    const scopes = new Set<string>();
    const ruleTypes = new Set<string>();
    for (const c of CASES) {
      for (const r of c.rows) {
        scopes.add(r.scope);
        ruleTypes.add(r.ruleType);
      }
    }
    for (const s of ["common", "country", "channel", "product"]) expect(scopes.has(s)).toBe(true);
    for (const t of ["ban", "must", "tone", "format", "persona"]) expect(ruleTypes.has(t)).toBe(true);
  });

  it("순수 함수 — 같은 입력을 여러 번 호출해도 항상 같은 결과이고 입력 배열을 변형하지 않는다", () => {
    const rows: BrandRuleRow[] = [
      row({ id: 1, scope: "common", ruleType: "persona", content: "페르소나", version: 1 }),
      row({ id: 2, scope: "common", ruleType: "ban", content: "금칙", detectPattern: null, severity: "block", version: 1 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(rows));

    const first = mergeRules(rows);
    const second = mergeRules(rows);

    expect(normalize(first)).toEqual(normalize(second));
    expect(rows).toEqual(snapshot);
  });

  it("ban[].label 은 brand_rules.content 컬럼값을 그대로 쓴다(별도 label 컬럼 없음 — 02-cross-verify F-1)", () => {
    const rows: BrandRuleRow[] = [
      row({ id: 5, scope: "common", ruleType: "ban", content: "이 문구가 곧 label 이다", detectPattern: null, severity: "block", version: 1 }),
    ];
    const result = mergeRules(rows);
    const ban: BanRule | undefined = result.ban[0];
    expect(ban?.label).toBe("이 문구가 곧 label 이다");
  });
});
