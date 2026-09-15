import { describe, expect, it } from "vitest";

// 계약: FR-004(런 20260914-2058-0053) 「유닛 · src/lib/validator.ts::validate」
//
// 골든 테스트 — 픽스처는 `scripts/seed.ts` 의 실제 brand_rules 시드값(정규식·content·
// severity·alternative·reason)을 그대로 옮긴 것이다(같은 파일 191~281행). 시드가 바뀌면
// 이 테스트의 픽스처도 함께 갱신해야 한다 — 이것이 "골든"의 의미다.
//
// validate(text, { must, ban }) => ValidationResult { blocks, warns, missing }
// Finding { ruleId, label, matched, index, severity, alternative, reason } — legalBasis 는
// BanRule 에는 있지만 Finding 에는 없다(계약 「데이터 형태」). 최소 한 케이스는 Finding
// 객체 전체를 toEqual 로 검증해 이 경계(legalBasis 가 새지 않는가)를 명시적으로 잡는다.

import type { BanRule } from "@/lib/rules-merge";
import { validate } from "./validator";

// ---------------------------------------------------------------------------
// scripts/seed.ts 191~281행의 실제 규칙을 BanRule 형태로 옮긴 픽스처.
// ---------------------------------------------------------------------------

const KO_DISEASE_CLAIM: BanRule = {
  ruleId: 1,
  label: "질병 치료·예방 표현",
  detectPattern: "(당뇨|혈당|질병)[^\\s]{0,3}\\s?(을|를|에)?\\s?(치료|예방|완치)[^\\s]{0,3}",
  severity: "block",
  alternative: "혈당 관리에 관심 있는 분께",
  reason: "식약처 표시광고 기준 — 질병 예방·치료 효능 표시 금지",
  legalBasis: null,
};

const KO_EFFICACY_ASSERTION: BanRule = {
  ruleId: 2,
  label: "효능 단정 표현",
  detectPattern: "(확실히|반드시|무조건)\\s?(낮|떨어|좋아)[^\\s]{0,3}",
  severity: "block",
  alternative: "~에 도움을 줄 수 있는",
  reason: "식약처 표시광고 기준 — 효능 단정 금지",
  legalBasis: null,
};

const KO_SUPERLATIVE: BanRule = {
  ruleId: 3,
  label: "최상급·유일 표현",
  detectPattern: "(최고|최상|유일|1위)",
  severity: "warn",
  alternative: "국내에서 드문",
  reason: "표시광고 공정화 — 객관적 근거 없는 최상급 표현",
  legalBasis: null,
};

const EN_DISEASE_CLAIMS: BanRule = {
  ruleId: 4,
  label: "Disease claims",
  detectPattern: "\\b(cures?|treats?|prevents?)\\b",
  severity: "block",
  alternative: "may support",
  reason: "FDA — disease treatment/prevention claims prohibited for foods",
  legalBasis: null,
};

const EN_SUPERLATIVES: BanRule = {
  ruleId: 5,
  label: "Superlatives",
  detectPattern: "\\b(best|only|#1)\\b",
  severity: "warn",
  alternative: "one of the few",
  reason: "FTC — unsubstantiated superlative claims",
  legalBasis: null,
};

const KO_BAN = [KO_DISEASE_CLAIM, KO_EFFICACY_ASSERTION, KO_SUPERLATIVE];
const EN_BAN = [EN_DISEASE_CLAIMS, EN_SUPERLATIVES];

const KO_MUST = ["글루텐프리", "저GI"];
const EN_MUST = ["gluten-free", "low GI"];

describe("validate — 차단(block)", () => {
  it("ko 질병 치료·예방 표현('혈당을 완치')을 block 으로 잡고 Finding 전체 형태가 계약과 일치한다(legalBasis 없음)", () => {
    const text = "혈당을 완치할 수 있어요";

    const result = validate(text, { must: [], ban: KO_BAN });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toEqual({
      ruleId: 1,
      label: "질병 치료·예방 표현",
      matched: "혈당을 완치할",
      index: 0,
      severity: "block",
      alternative: "혈당 관리에 관심 있는 분께",
      reason: "식약처 표시광고 기준 — 질병 예방·치료 효능 표시 금지",
    });
    expect(result.warns).toEqual([]);
  });

  it("ko 효능 단정 표현('무조건 좋아집니다')을 block 으로 잡는다", () => {
    const text = "무조건 좋아집니다";

    const result = validate(text, { must: [], ban: KO_BAN });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].ruleId).toBe(2);
    expect(result.blocks[0].severity).toBe("block");
    expect(result.blocks[0].matched).toBe("무조건 좋아집니다");
    expect(result.blocks[0].alternative).toBe("~에 도움을 줄 수 있는");
  });

  it("en disease claim('cures')을 block 으로 잡는다(word boundary)", () => {
    const text = "This tea cures diabetes naturally.";

    const result = validate(text, { must: [], ban: EN_BAN });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      ruleId: 4,
      label: "Disease claims",
      matched: "cures",
      index: 9,
      severity: "block",
      alternative: "may support",
    });
  });

  it("같은 텍스트에 두 block 규칙이 각각 매치되면 둘 다 blocks 에 담긴다", () => {
    const text = "혈당을 완치하고 무조건 좋아집니다";

    const result = validate(text, { must: [], ban: KO_BAN });

    const ruleIds = result.blocks.map((f) => f.ruleId).sort();
    expect(ruleIds).toEqual([1, 2]);
  });
});

describe("validate — 경고(warn)", () => {
  it("ko 최상급 표현('최고')을 warn 으로 잡고 blocks 에는 넣지 않는다", () => {
    const text = "국내 최고의 상품입니다";

    const result = validate(text, { must: [], ban: KO_BAN });

    expect(result.blocks).toEqual([]);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toEqual({
      ruleId: 3,
      label: "최상급·유일 표현",
      matched: "최고",
      index: 3,
      severity: "warn",
      alternative: "국내에서 드문",
      reason: "표시광고 공정화 — 객관적 근거 없는 최상급 표현",
    });
  });

  it("ko 최상급 표현('유일')도 warn 으로 잡는다", () => {
    const text = "이 지역에서 유일한 제품";

    const result = validate(text, { must: [], ban: KO_BAN });

    expect(result.warns).toHaveLength(1);
    expect(result.warns[0].matched).toBe("유일");
    expect(result.warns[0].severity).toBe("warn");
  });

  it("en superlative('best')를 warn 으로 잡는다", () => {
    const text = "This is simply the best snack.";

    const result = validate(text, { must: [], ban: EN_BAN });

    expect(result.blocks).toEqual([]);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toMatchObject({
      ruleId: 5,
      label: "Superlatives",
      matched: "best",
      index: 19,
      severity: "warn",
    });
  });
});

describe("validate — 필수표현 누락(missing)", () => {
  it("must 항목을 둘 다 포함하지 않으면 둘 다 missing 에 담긴다", () => {
    const text = "제품 소개입니다.";

    const result = validate(text, { must: KO_MUST, ban: [] });

    expect(result.missing).toEqual(["글루텐프리", "저GI"]);
  });

  it("must 항목 중 하나만 포함하면 나머지 하나만 missing 에 담긴다", () => {
    const text = "이 제품은 글루텐프리 원료를 사용합니다.";

    const result = validate(text, { must: KO_MUST, ban: [] });

    expect(result.missing).toEqual(["저GI"]);
  });

  it("en must 항목 중 'low GI' 가 없으면 그것만 missing 에 담긴다", () => {
    const text = "This snack is gluten-free and tasty.";

    const result = validate(text, { must: EN_MUST, ban: [] });

    expect(result.missing).toEqual(["low GI"]);
  });

  it("must 검사는 대소문자를 무시한다 — 'GLUTEN-FREE' 는 'gluten-free' 요구를 충족한다", () => {
    const text = "This GLUTEN-FREE snack also needs low gi mention.";

    const result = validate(text, { must: EN_MUST, ban: [] });

    // "low GI" 요구도 소문자 "low gi" 로 충족되어야 한다 — 대소문자 무시.
    expect(result.missing).toEqual([]);
  });
});

describe("validate — 통과(차단·경고·누락 모두 없음)", () => {
  it("ko: 필수표현 둘 다 있고 금칙어가 없으면 전부 빈 배열이다", () => {
    const text = "이 제품은 글루텐프리와 저GI 원료로 만든 건강한 간식입니다.";

    const result = validate(text, { must: KO_MUST, ban: KO_BAN });

    expect(result).toEqual({ blocks: [], warns: [], missing: [] });
  });

  it("en: 필수표현 둘 다 있고 금칙어가 없으면 전부 빈 배열이다", () => {
    const text = "This gluten-free, low GI snack is a delicious daily choice.";

    const result = validate(text, { must: EN_MUST, ban: EN_BAN });

    expect(result).toEqual({ blocks: [], warns: [], missing: [] });
  });

  it("ko: 다른 문장 구성이어도 필수표현 충족 + 금칙어 없음이면 통과한다", () => {
    const text = "글루텐프리, 저GI 인증 원료를 사용한 프리미엄 베이킹 믹스입니다.";

    const result = validate(text, { must: KO_MUST, ban: KO_BAN });

    expect(result).toEqual({ blocks: [], warns: [], missing: [] });
  });
});
