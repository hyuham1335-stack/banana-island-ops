import { describe, expect, it } from "vitest";
import { buildBrandStandards, mergeRules } from "./rules-merge";
import type {
  BanRule,
  BanStandard,
  BrandRuleRow,
  BrandStandards,
  ChannelStandard,
  MustGroup,
  ProductException,
  ResolvedRules,
  StandardChannelInput,
  StandardProductInput,
  StandardRuleRow,
} from "./rules-merge";

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

/**
 * 계약: FR-025 「유닛 · src/lib/rules-merge.ts · buildBrandStandards」
 * (`_workspace/contract_fr-025-brand-rules-screen.md` 37~46행)
 *
 * 규칙(계약 원문 요약):
 *   - isEmpty = rules.length===0. 비어 있으면 나머지 배열 전부 [].
 *   - scopeLabel: common→공통 · country→국가 {country} · channel→채널 {채널명} · product→제품 {제품명}.
 *     이름 못 찾으면 채널 #{id} / 제품 #{id} 폴백.
 *   - channels: channel-scope 규칙이 ≥1 있는 채널만, id 오름차순. 채널마다
 *     lang===ch.lang && (common || country&&country===ch.country || channel&&channelId===ch.id)
 *     인 행을 골라 mergeRules 를 호출하고 persona/tone/format/version 을 그대로 쓴다.
 *     updatedAt = 적용 행 createdAt 최댓값(적용 행 없으면 null).
 *   - bans: ruleType==="ban" 전부, id 중복 제거(첫 등장 유지), severity null→"block".
 *   - musts: ruleType==="must" 이고 scope∈{common,country,channel} 를 (lang,scopeLabel) 로 묶음.
 *     product scope must 는 musts 에 넣지 않는다(productExceptions 로).
 *   - productExceptions: scope=product 를 (productId,lang) 로 묶음. persona/tone/format 은
 *     해당 ruleType 첫 행의 content, 없으면 null. must 는 그룹의 must content. ban 은 여기 없다.
 *     affectedChannels = 출력 channels 중 lang 같은 채널의 name(출력 순서).
 */

function standardRow(
  overrides: Partial<StandardRuleRow> &
    Pick<StandardRuleRow, "id" | "scope" | "ruleType" | "content" | "version" | "lang">,
): StandardRuleRow {
  return {
    detectPattern: null,
    alternative: null,
    reason: null,
    legalBasis: null,
    severity: null,
    country: null,
    channelId: null,
    productId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const D1 = new Date("2026-01-01T00:00:00Z");
const D2 = new Date("2026-02-01T00:00:00Z");
const D3 = new Date("2026-03-01T00:00:00Z");

describe("buildBrandStandards", () => {
  it("rules 가 비어 있으면 isEmpty:true 이고 channels·products 입력이 있어도 나머지 배열은 전부 []", () => {
    const channels: StandardChannelInput[] = [{ id: 1, name: "채널A", country: "KR", lang: "ko" }];
    const products: StandardProductInput[] = [{ id: 10, name: "제품A" }];

    const result: BrandStandards = buildBrandStandards({ rules: [], channels, products });

    expect(result).toEqual<BrandStandards>({
      isEmpty: true,
      channels: [],
      bans: [],
      musts: [],
      productExceptions: [],
    });
  });

  it("channel-scope 규칙이 없는 채널은 channels 결과에서 제외된다", () => {
    const channels: StandardChannelInput[] = [
      { id: 1, name: "채널A", country: "KR", lang: "ko" },
      { id: 2, name: "채널B", country: "KR", lang: "ko" },
    ];
    const rules: StandardRuleRow[] = [
      standardRow({ id: 1, scope: "common", ruleType: "persona", content: "공통", lang: "ko", version: 1 }),
      standardRow({ id: 2, scope: "channel", ruleType: "tone", content: "채널A 톤", lang: "ko", channelId: 1, version: 1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.channels.map((c) => c.channelId)).toEqual([1]);
  });

  it("채널 병합은 mergeRules 결과(persona/tone/format/version)를 그대로 쓰고, updatedAt 은 적용 행 createdAt 최댓값이다", () => {
    const channels: StandardChannelInput[] = [{ id: 5, name: "채널X", country: "KR", lang: "ko" }];
    const rules: StandardRuleRow[] = [
      standardRow({ id: 1, scope: "common", ruleType: "persona", content: "공통 페르소나", lang: "ko", version: 1, createdAt: D1 }),
      standardRow({ id: 2, scope: "channel", ruleType: "format", content: "채널 포맷", lang: "ko", channelId: 5, version: 3, createdAt: D2 }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });
    const oracle = mergeRules(rules);

    expect(result.channels).toHaveLength(1);
    const ch: ChannelStandard = result.channels[0];
    expect(ch.channelId).toBe(5);
    expect(ch.name).toBe("채널X");
    expect(ch.lang).toBe("ko");
    expect(ch.persona).toBe(oracle.persona);
    expect(ch.tone).toBe(oracle.tone);
    expect(ch.format).toBe(oracle.format);
    expect(ch.version).toBe(oracle.version);
    expect(ch.persona).toBe("공통 페르소나");
    expect(ch.format).toBe("채널 포맷");
    // updatedAt = 적용 행(id 1,2) createdAt 최댓값 = D2 (id 2 가 더 늦음).
    expect(ch.updatedAt).toEqual(D2);
  });

  it("country-scope 행이 채널의 country 와 실제로 일치하면(배제 디코이가 아니라) 병합에 포함되고 common 을 덮는다 — common·country·channel 셋 다 채워진다", () => {
    const channels: StandardChannelInput[] = [{ id: 7, name: "채널KR", country: "KR", lang: "ko" }];
    const rules: StandardRuleRow[] = [
      standardRow({ id: 1, scope: "common", ruleType: "persona", content: "공통 페르소나", lang: "ko", version: 1 }),
      // country 가 채널의 country(KR)와 일치 — 배제되지 않고 실제로 채택돼야 한다.
      standardRow({ id: 2, scope: "country", ruleType: "persona", content: "국가 페르소나", lang: "ko", country: "KR", version: 2 }),
      standardRow({ id: 3, scope: "country", ruleType: "tone", content: "국가 톤", lang: "ko", country: "KR", version: 1 }),
      standardRow({ id: 4, scope: "channel", ruleType: "format", content: "채널 포맷", lang: "ko", channelId: 7, version: 1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.channels).toHaveLength(1);
    const ch = result.channels[0];
    // country(id=2) 가 common(id=1) 을 이긴다 — mergeRules 의 scope 우선순위 그대로.
    expect(ch.persona).toBe("국가 페르소나");
    expect(ch.tone).toBe("국가 톤");
    expect(ch.format).toBe("채널 포맷");
  });

  it("updatedAt 은 적용 행만의 createdAt 최댓값이다 — 덮인(비적용) 행의 더 늦은 createdAt 은 무시하고, 적용 행이 시간순과 무관하게 배열에 놓여도 진짜 최댓값 Date 인스턴스를 그대로 돌려준다", () => {
    const channels: StandardChannelInput[] = [{ id: 9, name: "채널Y", country: "KR", lang: "ko" }];
    const coveredDate = new Date("2026-05-01T00:00:00Z"); // 가장 늦지만 탈락(비적용) 행 — 최댓값 계산에서 빠져야 한다.
    const appliedMidDate = new Date("2026-02-01T00:00:00Z");
    const appliedEarliestDate = new Date("2026-01-01T00:00:00Z");
    const appliedMaxDate = new Date("2026-04-01T00:00:00Z"); // 적용 행 중 진짜 최댓값 — 배열에서는 마지막이 아니라 중간에 있다.
    const rules: StandardRuleRow[] = [
      standardRow({ id: 1, scope: "channel", ruleType: "persona", content: "채널 페르소나(적용)", lang: "ko", channelId: 9, version: 1, createdAt: appliedMidDate }),
      // channel persona 에 밀려 탈락하는 common persona — createdAt 이 가장 늦지만 비적용이므로 무시돼야 한다.
      standardRow({ id: 2, scope: "common", ruleType: "persona", content: "공통 페르소나(탈락)", lang: "ko", version: 1, createdAt: coveredDate }),
      standardRow({ id: 3, scope: "channel", ruleType: "tone", content: "채널 톤(적용, 최댓값)", lang: "ko", channelId: 9, version: 1, createdAt: appliedMaxDate }),
      standardRow({ id: 4, scope: "channel", ruleType: "format", content: "채널 포맷(적용, 최솟값)", lang: "ko", channelId: 9, version: 1, createdAt: appliedEarliestDate }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.channels).toHaveLength(1);
    const ch = result.channels[0];
    expect(ch.persona).toBe("채널 페르소나(적용)");
    // 새 Date 를 만들지 않고 그 행의 값을 그대로 썼는지 — 참조 동일성(toBe)으로 확인.
    expect(ch.updatedAt).toBe(appliedMaxDate);
  });

  it("channel-scope 규칙은 있어 channels 목록에는 들어가지만 그 규칙의 lang 이 채널과 달라 적용 행이 0개면 updatedAt 은 null 이다", () => {
    const channels: StandardChannelInput[] = [{ id: 20, name: "채널Z", country: "KR", lang: "ko" }];
    const rules: StandardRuleRow[] = [
      // channel-scope 조건(row.scope==="channel" && row.channelId===ch.id)만 보고 채널 목록에는
      // 포함되지만, 실제 병합 대상(applicable)은 lang 일치도 요구하므로 이 행은 제외된다.
      standardRow({ id: 1, scope: "channel", ruleType: "tone", content: "EN 채널 톤", lang: "en", channelId: 20, version: 1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.channels).toHaveLength(1);
    const ch = result.channels[0];
    expect(ch.tone).toBe("");
    expect(ch.updatedAt).toBeNull();
  });

  it("채널 병합에는 다른 lang·country·channel 의 규칙이 섞이지 않는다", () => {
    const channels: StandardChannelInput[] = [{ id: 1, name: "채널A", country: "KR", lang: "ko" }];
    const rules: StandardRuleRow[] = [
      standardRow({ id: 1, scope: "channel", ruleType: "tone", content: "채널 톤", lang: "ko", channelId: 1, version: 1, createdAt: D1 }),
      // 디코이: 다른 국가의 country-scope 규칙 — ch1.country="KR" 이므로 섞이면 안 된다.
      standardRow({ id: 2, scope: "country", ruleType: "persona", content: "잘못된 국가", lang: "ko", country: "US", version: 1, createdAt: D1 }),
      // 디코이: 다른 언어의 common-scope 규칙 — ch1.lang="ko" 이므로 섞이면 안 된다.
      standardRow({ id: 3, scope: "common", ruleType: "persona", content: "잘못된 언어", lang: "en", version: 1, createdAt: D1 }),
      // 디코이: 다른 채널을 겨냥한 channel-scope 규칙.
      standardRow({ id: 4, scope: "channel", ruleType: "format", content: "잘못된 채널", lang: "ko", channelId: 999, version: 1, createdAt: D1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.channels).toHaveLength(1);
    const ch = result.channels[0];
    expect(ch.tone).toBe("채널 톤");
    // 디코이가 섞였다면 persona·format 이 채워졌을 것 — 섞이지 않았으므로 공백이다.
    expect(ch.persona).toBe("");
    expect(ch.format).toBe("");
  });

  it("채널은 입력 순서와 무관하게 channel id 오름차순으로 정렬된다", () => {
    const channels: StandardChannelInput[] = [
      { id: 3, name: "채널C", country: "KR", lang: "ko" },
      { id: 1, name: "채널A", country: "KR", lang: "ko" },
      { id: 2, name: "채널B", country: "KR", lang: "ko" },
    ];
    const rules: StandardRuleRow[] = [3, 1, 2].map((cid, i) =>
      standardRow({ id: 100 + i, scope: "channel", ruleType: "tone", content: `채널${cid} 톤`, lang: "ko", channelId: cid, version: 1 }),
    );

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.channels.map((c) => c.channelId)).toEqual([1, 2, 3]);
  });

  it("bans: scopeLabel 4종 + 이름 못 찾으면 폴백 + severity null→block + id 중복 제거(첫 등장 유지)", () => {
    const channels: StandardChannelInput[] = [{ id: 1, name: "채널A", country: "KR", lang: "ko" }];
    const products: StandardProductInput[] = [{ id: 10, name: "제품A" }];
    const rules: StandardRuleRow[] = [
      standardRow({
        id: 100,
        scope: "common",
        ruleType: "ban",
        content: "공통금칙",
        lang: "ko",
        severity: "block",
        alternative: "대안1",
        reason: "사유1",
        legalBasis: "근거1",
        version: 1,
      }),
      standardRow({ id: 101, scope: "country", ruleType: "ban", content: "국가금칙", lang: "ko", country: "KR", severity: null, version: 1 }),
      standardRow({ id: 102, scope: "channel", ruleType: "ban", content: "채널금칙", lang: "ko", channelId: 1, severity: "warn", version: 1 }),
      standardRow({ id: 103, scope: "channel", ruleType: "ban", content: "미지채널금칙", lang: "ko", channelId: 77, severity: "warn", version: 1 }),
      standardRow({ id: 104, scope: "product", ruleType: "ban", content: "제품금칙", lang: "ko", productId: 10, severity: "block", version: 1 }),
      standardRow({ id: 105, scope: "product", ruleType: "ban", content: "미지제품금칙", lang: "ko", productId: 999, severity: "block", version: 1 }),
      // 중복 id — 첫 등장(위 id 100)만 유지되고 이 행은 무시된다.
      standardRow({ id: 100, scope: "common", ruleType: "ban", content: "중복무시", lang: "ko", severity: "block", version: 1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products });

    expect(result.bans.map((b) => b.ruleId)).toEqual([100, 101, 102, 103, 104, 105]);

    const byId = new Map(result.bans.map((b) => [b.ruleId, b]));
    expect(byId.get(100)).toMatchObject<Partial<BanStandard>>({ label: "공통금칙", scopeLabel: "공통", severity: "block" });
    expect(byId.get(101)).toMatchObject<Partial<BanStandard>>({ label: "국가금칙", scopeLabel: "국가 KR", severity: "block" });
    expect(byId.get(102)).toMatchObject<Partial<BanStandard>>({ label: "채널금칙", scopeLabel: "채널 채널A", severity: "warn" });
    expect(byId.get(103)).toMatchObject<Partial<BanStandard>>({ label: "미지채널금칙", scopeLabel: "채널 #77", severity: "warn" });
    expect(byId.get(104)).toMatchObject<Partial<BanStandard>>({ label: "제품금칙", scopeLabel: "제품 제품A", severity: "block" });
    expect(byId.get(105)).toMatchObject<Partial<BanStandard>>({ label: "미지제품금칙", scopeLabel: "제품 #999", severity: "block" });
  });

  it("musts: (lang, scopeLabel) 로 그룹핑하고 product scope must 는 제외한다 — 채널 이름 폴백도 적용된다", () => {
    const channels: StandardChannelInput[] = [{ id: 1, name: "채널A", country: "KR", lang: "ko" }];
    const rules: StandardRuleRow[] = [
      standardRow({ id: 200, scope: "common", ruleType: "must", content: "필수1", lang: "ko", version: 1, createdAt: D1 }),
      standardRow({ id: 201, scope: "common", ruleType: "must", content: "필수2", lang: "ko", version: 1, createdAt: D2 }),
      standardRow({ id: 202, scope: "country", ruleType: "must", content: "국가필수", lang: "ko", country: "KR", version: 1 }),
      standardRow({ id: 203, scope: "channel", ruleType: "must", content: "채널필수", lang: "ko", channelId: 1, version: 1 }),
      // product scope must — musts 에는 나오지 않고 productExceptions 몫이다.
      standardRow({ id: 204, scope: "product", ruleType: "must", content: "제품필수", lang: "ko", productId: 10, version: 1 }),
      standardRow({ id: 205, scope: "common", ruleType: "must", content: "EN필수", lang: "en", version: 1 }),
      // 미지 채널 — scopeLabel 폴백 "채널 #55".
      standardRow({ id: 206, scope: "channel", ruleType: "must", content: "미지채널필수", lang: "ko", channelId: 55, version: 1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products: [] });

    expect(result.musts).toEqual<MustGroup[]>([
      { lang: "ko", scopeLabel: "공통", items: ["필수1", "필수2"] },
      { lang: "ko", scopeLabel: "국가 KR", items: ["국가필수"] },
      { lang: "ko", scopeLabel: "채널 채널A", items: ["채널필수"] },
      { lang: "en", scopeLabel: "공통", items: ["EN필수"] },
      { lang: "ko", scopeLabel: "채널 #55", items: ["미지채널필수"] },
    ]);
  });

  it("productExceptions: (productId, lang) 그룹핑, 결측 필드는 null, must 는 content 배열, ban 은 섞이지 않고, productName 은 폴백된다", () => {
    const channels: StandardChannelInput[] = [
      { id: 1, name: "채널A", country: "KR", lang: "ko" },
      { id: 2, name: "채널B", country: "US", lang: "en" },
    ];
    const products: StandardProductInput[] = [{ id: 10, name: "제품A" }];
    const rules: StandardRuleRow[] = [
      // 채널을 channels 출력에 포함시키기 위한 channel-scope 행(각 채널 1개 이상 필요).
      standardRow({ id: 1, scope: "channel", ruleType: "persona", content: "채널A 페르소나", lang: "ko", channelId: 1, version: 1 }),
      standardRow({ id: 2, scope: "channel", ruleType: "persona", content: "채널B 페르소나", lang: "en", channelId: 2, version: 1 }),
      // productId=10(known), lang=ko
      standardRow({ id: 400, scope: "product", ruleType: "persona", content: "제품 페르소나", lang: "ko", productId: 10, version: 1 }),
      standardRow({ id: 401, scope: "product", ruleType: "tone", content: "제품 톤", lang: "ko", productId: 10, version: 1 }),
      standardRow({ id: 402, scope: "product", ruleType: "must", content: "제품 필수", lang: "ko", productId: 10, version: 1 }),
      standardRow({ id: 403, scope: "product", ruleType: "ban", content: "제품 금칙(제외되어야)", lang: "ko", productId: 10, severity: "block", version: 1 }),
      // productId=999(unknown), lang=en — persona 만 있고 나머지는 결측.
      standardRow({ id: 410, scope: "product", ruleType: "persona", content: "Unknown Persona EN", lang: "en", productId: 999, version: 1 }),
    ];

    const result = buildBrandStandards({ rules, channels, products });

    expect(result.productExceptions).toEqual<ProductException[]>([
      {
        productId: 10,
        productName: "제품A",
        lang: "ko",
        persona: "제품 페르소나",
        tone: "제품 톤",
        format: null,
        must: ["제품 필수"],
        affectedChannels: ["채널A"],
      },
      {
        productId: 999,
        productName: "#999",
        lang: "en",
        persona: "Unknown Persona EN",
        tone: null,
        format: null,
        must: [],
        affectedChannels: ["채널B"],
      },
    ]);

    // ban 행(id 403)은 productExceptions 가 아니라 bans 에만 나온다.
    expect(result.bans.map((b) => b.ruleId)).toContain(403);
    expect(result.productExceptions.flatMap((p) => [p.persona, p.tone, p.format, ...p.must])).not.toContain(
      "제품 금칙(제외되어야)",
    );
  });

  it("순수 함수 — 입력 배열을 변형하지 않고, 같은 입력을 여러 번 호출해도 같은 결과다", () => {
    const channels: StandardChannelInput[] = [{ id: 1, name: "채널A", country: "KR", lang: "ko" }];
    const products: StandardProductInput[] = [{ id: 10, name: "제품A" }];
    const rules: StandardRuleRow[] = [
      standardRow({ id: 1, scope: "channel", ruleType: "persona", content: "페르소나", lang: "ko", channelId: 1, version: 1, createdAt: D3 }),
      standardRow({ id: 2, scope: "product", ruleType: "must", content: "필수", lang: "ko", productId: 10, version: 1 }),
    ];
    const rulesSnapshot = JSON.parse(JSON.stringify(rules));
    const channelsSnapshot = JSON.parse(JSON.stringify(channels));
    const productsSnapshot = JSON.parse(JSON.stringify(products));

    const first = buildBrandStandards({ rules, channels, products });
    const second = buildBrandStandards({ rules, channels, products });

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(rules))).toEqual(rulesSnapshot);
    expect(JSON.parse(JSON.stringify(channels))).toEqual(channelsSnapshot);
    expect(JSON.parse(JSON.stringify(products))).toEqual(productsSnapshot);
  });
});
