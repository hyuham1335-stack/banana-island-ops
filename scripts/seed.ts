import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { brandRules, products, salesChannels, users } from "../src/lib/db/schema";

/**
 * Must 기능(FR-001·002·003) 최소 마스터 데이터 시드.
 * 값의 출처는 목업 bananaislandops_2.html — 자세한 매핑은 계획 문서 참고.
 * users·products·sales_channels 는 unique 키로 재실행 안전(onConflictDoNothing).
 * brand_rules 는 자연키가 없어 테이블이 비어 있을 때만 넣는다.
 */

async function seedUsers(db: ReturnType<typeof getDb>) {
  const rows = await db
    .insert(users)
    .values([
      { email: "admin@bananaisland.kr", name: "대표", role: "admin" },
      { email: "editor@bananaisland.kr", name: "마케팅 담당", role: "editor" },
    ])
    .onConflictDoNothing()
    .returning({ id: users.id });
  console.log(`users: ${rows.length}행 삽입(이미 있던 행은 스킵)`);
}

async function seedProducts(db: ReturnType<typeof getDb>) {
  const rows = await db
    .insert(products)
    .values([
      {
        productCode: "green-banana-flour-300g",
        name: "그린바나나가루 300g",
        weightG: 300,
        priceKrw: "10135",
        priceUsd: "12.90",
      },
      {
        productCode: "gluten-free-baking-mix-150g",
        name: "글루텐프리 베이킹 믹스 150g",
        weightG: 150,
      },
      {
        productCode: "green-banana-pound-cake",
        name: "그린바나나 파운드케이크",
      },
    ])
    .onConflictDoNothing()
    .returning({ id: products.id });
  console.log(`products: ${rows.length}행 삽입(이미 있던 행은 스킵)`);
}

async function seedSalesChannels(db: ReturnType<typeof getDb>) {
  const rows = await db
    .insert(salesChannels)
    .values([
      // 발행 채널(kind=content) — 시트 C열과 정확히 일치해야 하는 name
      {
        channelCode: "naver-blog",
        name: "네이버 블로그",
        country: "KR",
        currency: "KRW",
        lang: "ko",
        distributionRoute: "kr_domestic",
        publishMethod: "manual",
        trackingMethod: "nt_smartstore",
        kind: "content",
        utmSource: "naver_blog",
        utmMedium: "referral",
        linkPolicy: "inline",
        writeUrl: "https://blog.naver.com/banana_island",
        persona: "40대·50대 요리 애호가. 재료 원산지와 조리법을 꼼꼼히 보고 후기·레시피에 반응",
        tone: "담백하고 정보 중심",
        format: "1,500자 내외 · 소제목 3개 · 마지막에 스마트스토어 링크",
      },
      {
        channelCode: "instagram",
        name: "인스타그램",
        country: "KR",
        currency: "KRW",
        lang: "ko",
        distributionRoute: "kr_domestic",
        publishMethod: "manual",
        trackingMethod: "redirect",
        kind: "content",
        utmSource: "instagram",
        utmMedium: "social",
        linkPolicy: "bio",
        writeUrl: "https://www.instagram.com/banana.island_official",
        persona: "30대·40대 부모, 웰니스 관심층. 짧은 문장과 비주얼에 반응",
        tone: "짧고 다정하게",
        format: "캡션 300자 이내 · 해시태그 5~8개 · 이모지 최대 2개",
      },
      {
        channelCode: "shopify-blog",
        name: "Shopify 블로그",
        country: "US",
        currency: "USD",
        lang: "en",
        distributionRoute: "us_export",
        publishMethod: "api",
        trackingMethod: "utm_ga4",
        kind: "content",
        utmSource: "shopify_blog",
        utmMedium: "referral",
        linkPolicy: "inline",
        writeUrl: "https://greenbanana-flour.com/admin/blogs",
        persona: "미국 글루텐프리·저GI 식단 실천층. 영양 성분표를 비교하는 독자",
        tone: "근거를 먼저, 문장은 짧게",
        format: "800~1,200 words · H2 3개 · CTA 1회",
      },
      {
        channelCode: "amazon-detail",
        name: "Amazon 상세",
        country: "US",
        currency: "USD",
        lang: "en",
        distributionRoute: "us_export",
        publishMethod: "manual",
        trackingMethod: "amazon_attribution",
        kind: "content",
        utmSource: "amazon_us",
        utmMedium: "referral",
        linkPolicy: "none",
        writeUrl: "https://sellercentral.amazon.com",
        persona: "미국 홈베이킹 소비자. 사양·용량·사용법을 먼저 확인",
        tone: "사양과 사용법 위주",
        format: "불릿 5개 · 각 200자 이내 · 효능 표현 없이 성분·용법만",
      },
      // 판매 채널(kind=sales)
      {
        channelCode: "smartstore",
        name: "스마트스토어",
        country: "KR",
        currency: "KRW",
        lang: "ko",
        distributionRoute: "kr_domestic",
        kind: "sales",
        feeRate: "0.184",
      },
      {
        channelCode: "coupang",
        name: "쿠팡",
        country: "KR",
        currency: "KRW",
        lang: "ko",
        distributionRoute: "kr_domestic",
        kind: "sales",
      },
      {
        channelCode: "dakdamall",
        name: "닥다몰",
        country: "KR",
        currency: "KRW",
        lang: "ko",
        distributionRoute: "kr_domestic",
        kind: "sales",
      },
      {
        channelCode: "beautiful-coffee",
        name: "아름다운커피",
        country: "KR",
        currency: "KRW",
        lang: "ko",
        distributionRoute: "kr_domestic",
        kind: "sales",
      },
      {
        channelCode: "amazon-us",
        name: "Amazon US",
        country: "US",
        currency: "USD",
        lang: "en",
        distributionRoute: "us_export",
        kind: "sales",
        feeRate: "0.22",
      },
      {
        channelCode: "shopee-ph",
        name: "Shopee PH",
        country: "PH",
        currency: "PHP",
        lang: "en",
        distributionRoute: "ph_local",
        kind: "sales",
        feeRate: "0.22",
      },
    ])
    .onConflictDoNothing()
    .returning({ id: salesChannels.id });
  console.log(`sales_channels: ${rows.length}행 삽입(이미 있던 행은 스킵)`);
}

async function seedBrandRules(db: ReturnType<typeof getDb>) {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(brandRules);
  if (count > 0) {
    console.log(`brand_rules: 이미 ${count}행 있음 — 스킵`);
    return;
  }

  const channelRows = await db
    .select({ id: salesChannels.id, channelCode: salesChannels.channelCode })
    .from(salesChannels);
  const channelIdByCode = new Map(channelRows.map((r) => [r.channelCode, r.id]));

  const productRows = await db.select({ id: products.id, productCode: products.productCode }).from(products);
  const glutenFreeMixId = productRows.find((r) => r.productCode === "gluten-free-baking-mix-150g")?.id;

  const naverId = channelIdByCode.get("naver-blog");
  const instaId = channelIdByCode.get("instagram");
  const shopifyId = channelIdByCode.get("shopify-blog");
  const amazonId = channelIdByCode.get("amazon-detail");

  if (!naverId || !instaId || !shopifyId || !amazonId || !glutenFreeMixId) {
    throw new Error("brand_rules 시드 실패: 선행 seedSalesChannels/seedProducts 결과를 찾을 수 없음");
  }

  const rows = await db
    .insert(brandRules)
    .values([
      // 공통 · ko · 금칙어(RULES.ko.ban)
      {
        scope: "common",
        ruleType: "ban",
        lang: "ko",
        content: "질병 치료·예방 표현",
        detectPattern: "(당뇨|혈당|질병)[^\\s]{0,3}\\s?(을|를|에)?\\s?(치료|예방|완치)[^\\s]{0,3}",
        severity: "block",
        alternative: "혈당 관리에 관심 있는 분께",
        reason: "식약처 표시광고 기준 — 질병 예방·치료 효능 표시 금지",
        status: "active",
      },
      {
        scope: "common",
        ruleType: "ban",
        lang: "ko",
        content: "효능 단정 표현",
        detectPattern: "(확실히|반드시|무조건)\\s?(낮|떨어|좋아)[^\\s]{0,3}",
        severity: "block",
        alternative: "~에 도움을 줄 수 있는",
        reason: "식약처 표시광고 기준 — 효능 단정 금지",
        status: "active",
      },
      {
        scope: "common",
        ruleType: "ban",
        lang: "ko",
        content: "최상급·유일 표현",
        detectPattern: "(최고|최상|유일|1위)",
        severity: "warn",
        alternative: "국내에서 드문",
        reason: "표시광고 공정화 — 객관적 근거 없는 최상급 표현",
        status: "active",
      },
      // 공통 · ko · 필수표현(RULES.ko.must)
      { scope: "common", ruleType: "must", lang: "ko", content: "글루텐프리", status: "active" },
      { scope: "common", ruleType: "must", lang: "ko", content: "저GI", status: "active" },
      // 공통 · en · 금칙어(RULES.en.ban)
      {
        scope: "common",
        ruleType: "ban",
        lang: "en",
        content: "Disease claims",
        detectPattern: "\\b(cures?|treats?|prevents?)\\b",
        severity: "block",
        alternative: "may support",
        reason: "FDA — disease treatment/prevention claims prohibited for foods",
        status: "active",
      },
      {
        scope: "common",
        ruleType: "ban",
        lang: "en",
        content: "Superlatives",
        detectPattern: "\\b(best|only|#1)\\b",
        severity: "warn",
        alternative: "one of the few",
        reason: "FTC — unsubstantiated superlative claims",
        status: "active",
      },
      // 공통 · en · 필수표현(RULES.en.must)
      { scope: "common", ruleType: "must", lang: "en", content: "gluten-free", status: "active" },
      { scope: "common", ruleType: "must", lang: "en", content: "low GI", status: "active" },
      // 채널(scope=channel) · persona/tone/format — CH 객체 그대로
      {
        scope: "channel",
        channelId: naverId,
        ruleType: "persona",
        lang: "ko",
        content: "40대·50대 요리 애호가. 재료 원산지와 조리법을 꼼꼼히 보고 후기·레시피에 반응",
        status: "active",
      },
      { scope: "channel", channelId: naverId, ruleType: "tone", lang: "ko", content: "담백하고 정보 중심", status: "active" },
      {
        scope: "channel",
        channelId: naverId,
        ruleType: "format",
        lang: "ko",
        content: "1,500자 내외 · 소제목 3개 · 마지막에 스마트스토어 링크",
        status: "active",
      },
      {
        scope: "channel",
        channelId: instaId,
        ruleType: "persona",
        lang: "ko",
        content: "30대·40대 부모, 웰니스 관심층. 짧은 문장과 비주얼에 반응",
        status: "active",
      },
      { scope: "channel", channelId: instaId, ruleType: "tone", lang: "ko", content: "짧고 다정하게", status: "active" },
      {
        scope: "channel",
        channelId: instaId,
        ruleType: "format",
        lang: "ko",
        content: "캡션 300자 이내 · 해시태그 5~8개 · 이모지 최대 2개",
        status: "active",
      },
      {
        scope: "channel",
        channelId: shopifyId,
        ruleType: "persona",
        lang: "en",
        content: "미국 글루텐프리·저GI 식단 실천층. 영양 성분표를 비교하는 독자",
        status: "active",
      },
      {
        scope: "channel",
        channelId: shopifyId,
        ruleType: "tone",
        lang: "en",
        content: "근거를 먼저, 문장은 짧게",
        status: "active",
      },
      {
        scope: "channel",
        channelId: shopifyId,
        ruleType: "format",
        lang: "en",
        content: "800~1,200 words · H2 3개 · CTA 1회",
        status: "active",
      },
      {
        scope: "channel",
        channelId: amazonId,
        ruleType: "persona",
        lang: "en",
        content: "미국 홈베이킹 소비자. 사양·용량·사용법을 먼저 확인",
        status: "active",
      },
      {
        scope: "channel",
        channelId: amazonId,
        ruleType: "tone",
        lang: "en",
        content: "사양과 사용법 위주",
        status: "active",
      },
      {
        scope: "channel",
        channelId: amazonId,
        ruleType: "format",
        lang: "en",
        content: "불릿 5개 · 각 200자 이내 · 효능 표현 없이 성분·용법만",
        status: "active",
      },
      // 제품(scope=product, 글루텐프리 베이킹 믹스 150g) — PRODUCT_RULES
      {
        scope: "product",
        productId: glutenFreeMixId,
        ruleType: "persona",
        lang: "ko",
        content: "아이 간식을 직접 만드는 30~40대 부모",
        status: "active",
      },
      {
        scope: "product",
        productId: glutenFreeMixId,
        ruleType: "persona",
        lang: "en",
        content: "아이 간식을 직접 만드는 30~40대 부모",
        status: "active",
      },
      { scope: "product", productId: glutenFreeMixId, ruleType: "must", lang: "ko", content: "슈가프리", status: "active" },
      {
        scope: "product",
        productId: glutenFreeMixId,
        ruleType: "must",
        lang: "en",
        content: "sugar-free",
        status: "active",
      },
    ])
    .returning({ id: brandRules.id });
  console.log(`brand_rules: ${rows.length}행 삽입`);
}

async function main() {
  const db = getDb();
  await seedUsers(db);
  await seedProducts(db);
  await seedSalesChannels(db);
  await seedBrandRules(db);
}

main()
  .then(() => {
    console.log("시드 완료");
  })
  .catch((err) => {
    console.error("시드 실패:", err);
    process.exitCode = 1;
  });
