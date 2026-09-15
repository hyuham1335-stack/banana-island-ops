import { beforeEach, describe, expect, it, vi } from "vitest";

// listContentChannels·listActiveProducts 는 /write 화면(서버 컴포넌트)이 채널 chip·제품 select
// 옵션을 채우려고 직접 읽는 서비스다(docs/ARCHITECTURE.md "Pages(읽기전용) → Services").
// 새 /api 라우트를 만들지 않는다 — 읽기이므로 페이지가 서비스를 바로 호출한다.

import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listActiveProducts, listContentChannels } from "./content-options";

function makeChainNode(resolvedValue: unknown) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue),
    catch: () => node,
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (..._args: unknown[]) => node;
    },
  });
}

function createDbMock(opts: { channelRows?: unknown[]; productRows?: unknown[] }) {
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.salesChannels) return makeChainNode(opts.channelRows ?? []);
      if (table === schema.products) return makeChainNode(opts.productRows ?? []);
      throw new Error("unexpected select().from() table in test mock");
    }),
  }));
  return { db: { select } as unknown as Db, select };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listContentChannels", () => {
  it("kind='content' 채널만 id 순으로 반환한다", async () => {
    const { db, select } = createDbMock({
      channelRows: [
        { id: 2, name: "인스타그램", lang: "ko", channelCode: "insta" },
        { id: 1, name: "네이버 블로그", lang: "ko", channelCode: "naver" },
      ],
    });

    const result = await listContentChannels({ db });

    expect(result).toEqual([
      { id: 2, name: "인스타그램", lang: "ko", channelCode: "insta" },
      { id: 1, name: "네이버 블로그", lang: "ko", channelCode: "naver" },
    ]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("채널이 없으면 빈 배열을 반환한다", async () => {
    const { db } = createDbMock({ channelRows: [] });
    const result = await listContentChannels({ db });
    expect(result).toEqual([]);
  });
});

describe("listActiveProducts", () => {
  it("isActive=true 인 제품만 반환한다", async () => {
    const { db } = createDbMock({
      productRows: [
        { id: 1, name: "그린바나나가루 300g" },
        { id: 2, name: "글루텐프리 베이킹 믹스 150g" },
      ],
    });

    const result = await listActiveProducts({ db });

    expect(result).toEqual([
      { id: 1, name: "그린바나나가루 300g" },
      { id: 2, name: "글루텐프리 베이킹 믹스 150g" },
    ]);
  });

  it("제품이 없으면 빈 배열을 반환한다", async () => {
    const { db } = createDbMock({ productRows: [] });
    const result = await listActiveProducts({ db });
    expect(result).toEqual([]);
  });
});
