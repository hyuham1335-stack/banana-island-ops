/**
 * FR-005 발행 링크 UTM 빌더 — _workspace/contract_fr-005-body-generation.md §유닛.
 * 순수 함수. DB·env 접근 없음(호출자가 getEnv().PRODUCT_BASE_URL 을 baseUrl 로 넘긴다).
 */

export function buildUtmLink(params: {
  baseUrl: string;
  productCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  contentId: number;
}): string {
  const base = params.productCode ? `${params.baseUrl}/product/${params.productCode}` : params.baseUrl;
  const url = new URL(base);

  if (params.utmSource) url.searchParams.set("utm_source", params.utmSource);
  if (params.utmMedium) url.searchParams.set("utm_medium", params.utmMedium);
  url.searchParams.set("utm_campaign", `c-${params.contentId}`);

  return url.toString();
}
