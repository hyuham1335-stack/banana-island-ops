/**
 * FR-012 채널 형식 변환 — 계약(run 20260916-*) 「유닛 · lib/channel-format.ts::formatForChannel」.
 * 순수 함수. DB·네트워크 호출 없음.
 */

export interface ChannelFormat {
  body: string;
  hashtags: string[];
  writeUrl: string | null;
}

/**
 * `content.body` 를 채널의 `linkPolicy` 에 맞춰 변환한다.
 * - "bio": 본문 그대로. 해시태그는 본문에서 `#태그` 패턴을 등장 순서로 중복 제거해 추출.
 * - "none": 본문 그대로. 해시태그 없음.
 * - "inline": 링크가 있고 본문에 아직 없으면 본문 끝에 빈 줄 하나를 두고 붙인다. 이미
 *   포함돼 있거나 링크가 없으면 본문 그대로. 해시태그 없음.
 */
export function formatForChannel(
  content: { body: string },
  channel: { linkPolicy: "inline" | "bio" | "none"; writeUrl: string | null },
  link: string,
): ChannelFormat {
  if (channel.linkPolicy === "bio") {
    const matches = content.body.match(/#[^\s#]+/g) ?? [];
    const hashtags = Array.from(new Set(matches));
    return { body: content.body, hashtags, writeUrl: channel.writeUrl };
  }

  if (channel.linkPolicy === "inline") {
    const body = link !== "" && !content.body.includes(link) ? `${content.body}\n\n${link}` : content.body;
    return { body, hashtags: [], writeUrl: channel.writeUrl };
  }

  // linkPolicy === "none"
  return { body: content.body, hashtags: [], writeUrl: channel.writeUrl };
}
