import { describe, expect, it } from "vitest";
import { buildUtmLink } from "./utm";

/**
 * 계약: FR-005 「유닛 · src/lib/utm.ts · buildUtmLink」
 *
 * 순수 함수 — DB·env 접근 없음, 부수효과 없음, 예외 없음(모든 입력 조합에 문자열 반환).
 * 계약이 명시한 규칙:
 *   - productCode 있으면 `${baseUrl}/product/${productCode}`, 없으면 baseUrl 루트에 URL 을 만든다.
 *   - utmSource·utmMedium 있으면 각각 utm_source·utm_medium 쿼리 파라미터로, 없으면 생략.
 *   - utm_campaign 은 항상 `c-${contentId}`.
 *   - URLSearchParams 가 인코딩을 처리한다(별도 이스케이프 불필요).
 *
 * 쿼리 파라미터 추가 순서(utm_source → utm_medium → utm_campaign)는 계약이 문장에서 나열한
 * 순서를 그대로 구현 순서로 가정한 것이다 — 계약이 정확한 순서를 문자 그대로 고정하지는
 * 않았으므로 이는 이 테스트가 고른 "골든" 기준이다(GA4 UTM 관례상 source→medium→campaign
 * 순서와도 일치한다). impl 이 다른 순서로 낸다면 이 부분만 재조정하면 된다(계약 밖 영역).
 *
 * 기대값은 Node.js 내장 URL/URLSearchParams 로 직접 계산해 고정했다(수작업 추측이 아니다) —
 * 아래 각 케이스 옆 주석의 node -e 계산 결과를 그대로 옮겼다.
 */

interface Case {
  label: string;
  params: {
    baseUrl: string;
    productCode: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    contentId: number;
  };
  expected: string;
}

const CASES: Case[] = [
  {
    label: "제품 있음 + utmSource·utmMedium 둘 다 있음",
    params: {
      baseUrl: "https://shop.banana-island.co.kr",
      productCode: "BANANA-001",
      utmSource: "kakao",
      utmMedium: "sns",
      contentId: 42,
    },
    expected:
      "https://shop.banana-island.co.kr/product/BANANA-001?utm_source=kakao&utm_medium=sns&utm_campaign=c-42",
  },
  {
    label: "제품 없음(null) + utmSource 만 있음 + utmMedium null → utm_medium 생략",
    params: {
      baseUrl: "https://us.banana-island.com",
      productCode: null,
      utmSource: "instagram",
      utmMedium: null,
      contentId: 7,
    },
    expected: "https://us.banana-island.com/?utm_source=instagram&utm_campaign=c-7",
  },
  {
    label: "제품 없음(null) + utmMedium 만 있음 + utmSource null → utm_source 생략",
    params: {
      baseUrl: "https://ph.banana-island.com",
      productCode: null,
      utmSource: null,
      utmMedium: "email",
      contentId: 100,
    },
    expected: "https://ph.banana-island.com/?utm_medium=email&utm_campaign=c-100",
  },
  {
    label: "제품 있음 + utmSource·utmMedium 둘 다 null → utm_campaign 만 남는다",
    params: {
      baseUrl: "https://shop.banana-island.co.kr",
      productCode: "BANANA-777",
      utmSource: null,
      utmMedium: null,
      contentId: 3,
    },
    expected: "https://shop.banana-island.co.kr/product/BANANA-777?utm_campaign=c-3",
  },
  {
    label: "제품·utm 모두 없음(null) — 루트 URL + utm_campaign 만",
    params: {
      baseUrl: "https://shop.banana-island.co.kr",
      productCode: null,
      utmSource: null,
      utmMedium: null,
      contentId: 1,
    },
    expected: "https://shop.banana-island.co.kr/?utm_campaign=c-1",
  },
  {
    label:
      "특수문자 인코딩 — productCode 의 공백·& ·한글은 경로 인코딩, utm 값의 공백·& ·한글은 쿼리 인코딩(둘의 인코딩 규칙이 다르다)",
    params: {
      baseUrl: "https://shop.banana-island.co.kr",
      productCode: "BANANA 001&한글",
      utmSource: "네이버 블로그",
      utmMedium: "cpc&direct",
      contentId: 55,
    },
    // node -e 로 계산: 경로의 '&'·한글은 WHATWG URL 경로 인코딩 규칙(퍼센트 인코딩, '&'는
    // 경로에서 그대로 허용)을, 쿼리 값의 공백은 '+'(URLSearchParams 관례), '&'는 %26 으로
    // 인코딩한다 — 같은 문자라도 위치(경로 vs 쿼리)에 따라 인코딩 결과가 다르다.
    expected:
      "https://shop.banana-island.co.kr/product/BANANA%20001&%ED%95%9C%EA%B8%80" +
      "?utm_source=%EB%84%A4%EC%9D%B4%EB%B2%84+%EB%B8%94%EB%A1%9C%EA%B7%B8" +
      "&utm_medium=cpc%26direct&utm_campaign=c-55",
  },
];

describe("buildUtmLink", () => {
  it.each(CASES)("$label", ({ params, expected }) => {
    expect(buildUtmLink(params)).toBe(expected);
  });

  it("예외 없음 — 극단적인 조합(모두 null·contentId=0)에도 문자열을 반환한다", () => {
    expect(() =>
      buildUtmLink({ baseUrl: "https://x.example.com", productCode: null, utmSource: null, utmMedium: null, contentId: 0 }),
    ).not.toThrow();
    expect(
      buildUtmLink({ baseUrl: "https://x.example.com", productCode: null, utmSource: null, utmMedium: null, contentId: 0 }),
    ).toBe("https://x.example.com/?utm_campaign=c-0");
  });

  it("순수 함수 — 같은 입력을 여러 번 호출해도 항상 같은 결과다(부수효과 없음)", () => {
    const params = {
      baseUrl: "https://shop.banana-island.co.kr",
      productCode: "BANANA-001",
      utmSource: "kakao",
      utmMedium: "sns",
      contentId: 42,
    };
    const first = buildUtmLink(params);
    const second = buildUtmLink(params);
    expect(first).toBe(second);
  });
});
