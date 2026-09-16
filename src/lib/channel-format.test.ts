import { describe, expect, it } from "vitest";
import { formatForChannel } from "./channel-format";

// 계약: FR-012(채널 형식 변환 텍스트 제공) 「유닛 · src/lib/channel-format.ts ·
// formatForChannel(content, channel, link)」— 골든 테스트.
//
// 순수 함수다. 세 linkPolicy 분기(inline·bio·none) 각각 최소 2케이스, writeUrl 은
// 모든 분기에서 가공 없이 그대로 통과되는 것을 확인한다(계약 「유닛」).

describe("formatForChannel", () => {
  describe("linkPolicy: inline (블로그)", () => {
    it("link 가 이미 content.body 에 포함돼 있으면 body 를 그대로 반환한다", () => {
      const link = "https://shop.banana-island.co.kr/product/abc?utm_source=blog&utm_campaign=c-1";
      const content = { body: `이미 링크가 포함된 본문입니다. ${link}` };
      const channel = { linkPolicy: "inline" as const, writeUrl: "https://blog.naver.com/write" };

      const result = formatForChannel(content, channel, link);

      expect(result.body).toBe(content.body);
      expect(result.hashtags).toEqual([]);
      expect(result.writeUrl).toBe("https://blog.naver.com/write");
    });

    it("link 가 content.body 에 없으면 본문 끝에 빈 줄 하나를 두고 link 를 덧붙인다", () => {
      const link = "https://shop.banana-island.co.kr/product/abc?utm_source=blog&utm_campaign=c-1";
      const content = { body: "링크가 없는 본문입니다." };
      const channel = { linkPolicy: "inline" as const, writeUrl: "https://blog.naver.com/write" };

      const result = formatForChannel(content, channel, link);

      expect(result.body).toBe(`${content.body}\n\n${link}`);
      expect(result.hashtags).toEqual([]);
      expect(result.writeUrl).toBe("https://blog.naver.com/write");
    });

    it("link 가 빈 문자열이면(방어적 케이스) body 를 그대로 반환한다", () => {
      const content = { body: "링크 계산이 안 된 본문입니다." };
      const channel = { linkPolicy: "inline" as const, writeUrl: null };

      const result = formatForChannel(content, channel, "");

      expect(result.body).toBe(content.body);
      expect(result.hashtags).toEqual([]);
      expect(result.writeUrl).toBeNull();
    });
  });

  describe("linkPolicy: bio (인스타그램)", () => {
    it("본문에 해시태그가 있으면 등장 순서로 중복 제거해 hashtags 로 뽑아낸다(body 는 그대로)", () => {
      const content = { body: "맛있는 바나나 이야기 #건강 #다이어트 오늘도 #건강 챙기세요" };
      const channel = { linkPolicy: "bio" as const, writeUrl: null };

      const result = formatForChannel(content, channel, "https://shop.banana-island.co.kr/product/abc");

      expect(result.body).toBe(content.body);
      expect(result.hashtags).toEqual(["#건강", "#다이어트"]);
      expect(result.writeUrl).toBeNull();
    });

    it("본문에 해시태그가 없으면 hashtags 는 빈 배열이다", () => {
      const content = { body: "해시태그가 전혀 없는 본문입니다." };
      const channel = { linkPolicy: "bio" as const, writeUrl: "https://instagram.com" };

      const result = formatForChannel(content, channel, "https://shop.banana-island.co.kr/product/abc");

      expect(result.body).toBe(content.body);
      expect(result.hashtags).toEqual([]);
      expect(result.writeUrl).toBe("https://instagram.com");
    });
  });

  describe("linkPolicy: none (아마존)", () => {
    it("본문을 변형하지 않고 hashtags 는 항상 빈 배열이다(본문에 해시태그가 있어도)", () => {
      const content = { body: "아마존 상품 설명 본문 #프로모션" };
      const channel = { linkPolicy: "none" as const, writeUrl: null };

      const result = formatForChannel(content, channel, "https://shop.banana-island.co.kr/product/abc");

      expect(result.body).toBe(content.body);
      expect(result.hashtags).toEqual([]);
      expect(result.writeUrl).toBeNull();
    });

    it("link 값과 무관하게(빈 문자열이든 아니든) body·hashtags 결과가 같다", () => {
      const content = { body: "아마존 상품 설명 본문" };
      const channel = { linkPolicy: "none" as const, writeUrl: "https://sellercentral.amazon.com" };

      const withLink = formatForChannel(content, channel, "https://shop.banana-island.co.kr/product/abc");
      const withoutLink = formatForChannel(content, channel, "");

      expect(withLink).toEqual(withoutLink);
      expect(withLink.body).toBe(content.body);
      expect(withLink.writeUrl).toBe("https://sellercentral.amazon.com");
    });
  });
});
