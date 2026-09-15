import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「진입점 · GET /api/contents/{id}」
//
// 이 라우트(src/app/api/contents/[id]/route.ts, 작성 시점에 이미 존재)는 단일 서비스 함수를
// 부르는 다른 라우트들과 달리 DB 조회(contents·content_history 카운트)와
// resolveContentLink()·toContentDetail() 조립을 라우트 안에서 직접 한다. 그래서
// getDb·getEnv·resolveContentLink(services/content-workflow, 별도로 단위테스트됨)만 모킹하고
// toContentDetail 은 실물을 그대로 통과시켜(순수 함수, content-detail.test.ts 가 이미 전수
// 검증) 배선이 맞는지를 본다.

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ PRODUCT_BASE_URL: "https://shop.banana-island.co.kr" })),
}));

vi.mock("@/services/content-workflow", () => ({
  resolveContentLink: vi.fn(),
}));

import { getDb } from "@/lib/db/client";
import type { ContentsRow } from "@/lib/content-detail";
import * as schema from "@/lib/db/schema";
import { resolveContentLink } from "@/services/content-workflow";
import { GET, maxDuration } from "./route";

const JSON_UTF8 = "application/json; charset=utf-8";

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

function stubDb(opts: { contentRows: ContentsRow[]; historyCountRows?: { count: number }[] }) {
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.contents) return makeChainNode(opts.contentRows);
      if (table === schema.contentHistory) return makeChainNode(opts.historyCountRows ?? [{ count: 0 }]);
      throw new Error(`unexpected select().from() table in test mock: ${String(table)}`);
    }),
  }));
  return { select } as unknown as ReturnType<typeof getDb>;
}

const ROW: ContentsRow = {
  id: 501,
  publishPlanId: null,
  sourceContentId: null,
  productId: null,
  channelId: 10,
  templateId: 900,
  authorId: null,
  reviewerId: null,
  publisherId: null,
  lang: "ko",
  postType: "health_info",
  targetPersona: "30대 직장인",
  status: "draft",
  title: "여름철 든든한 간식",
  titleCandidates: null,
  body: "정상적인 본문입니다.",
  regenCount: 0,
  ruleSnapshot: { ruleIds: [], version: "v0", exampleIds: [] },
  detectedTerms: { blocks: [], warns: [], missing: [] },
  sentPrompt: "===SYSTEM===\n...\n\n===USER===\n...",
  model: "claude-test-model",
  rejectReason: null,
  publishedUrl: null,
  urlCheck: null,
  submittedAt: null,
  reviewedAt: null,
  publishedAt: null,
  updatedAt: new Date("2026-09-15T00:01:00Z"),
  createdAt: new Date("2026-09-15T00:00:00Z"),
};

function reqFor(id: string): { request: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    request: new Request(`http://localhost/api/contents/${id}`),
    ctx: { params: Promise.resolve({ id }) },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/contents/{id}", () => {
  it("maxDuration 이 10초로 예산화되어 있다 (계약 고정값)", () => {
    expect(maxDuration).toBe(10);
  });

  it("존재하는 id 면 200 + { data: ContentDetail } 을 돌려준다", async () => {
    vi.mocked(getDb).mockReturnValue(stubDb({ contentRows: [ROW], historyCountRows: [{ count: 2 }] }));
    vi.mocked(resolveContentLink).mockResolvedValue("https://shop.banana-island.co.kr/?utm_campaign=c-501");

    const { request, ctx } = reqFor("501");
    const res = await GET(request, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_UTF8);
    const body = await res.json();
    expect(body.data.id).toBe(501);
    expect(body.data.link).toBe("https://shop.banana-island.co.kr/?utm_campaign=c-501");
    expect(body.data.historyCount).toBe(2);
    expect(body.data.status).toBe("draft");
    expect(resolveContentLink).toHaveBeenCalledTimes(1);
  });

  it("id 가 정수 형식이 아니면 400 VALIDATION_ERROR 를 돌려주고 DB 를 조회하지 않는다", async () => {
    const { request, ctx } = reqFor("abc");
    const res = await GET(request, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("id 가 0 이하이면 400 VALIDATION_ERROR 를 돌려준다", async () => {
    const { request, ctx } = reqFor("0");
    const res = await GET(request, ctx);

    expect(res.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("존재하지 않는 id 면 404 NOT_FOUND 를 돌려준다", async () => {
    vi.mocked(getDb).mockReturnValue(stubDb({ contentRows: [] }));

    const { request, ctx } = reqFor("999");
    const res = await GET(request, ctx);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.details).toEqual({ resource: "content", id: 999 });
    expect(resolveContentLink).not.toHaveBeenCalled();
  });
});
