import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약: FR-016 홈 대시보드 「유닛 · src/services/getHomeDashboard」
//
// 외부 경계(계약): "테스트가 모킹할 대상은 Db(Drizzle 클라이언트) 하나뿐". getHomeDashboard 는
// 내부적으로 listContents·listContentChannels(둘 다 실제 함수, 다시 구현하거나 모킹하지 않음)를
// 재사용하므로, 이 파일은 plans.test.ts·content-workflow.test.ts 와 같은 Proxy 체인 DB 스텁
// 패턴으로 deps.db 만 테스트 더블로 주입한다.
//
// contents 테이블은 이 유닛 안에서 세 번 select() 된다 — ① publishedThisMonth count 쿼리
// ② listContents(in_review) ③ listContents(approved). 세 호출은 컬럼 구성이 서로 달라(count
// 쿼리는 단일 집계 컬럼, 나머지 둘은 동일한 ContentSummary 원본 컬럼) 셋 중 뒤 두 개(②·③)는
// 셰이프만으로 구분할 수 없다 — Promise.all 배열 리터럴이 좌에서 우로 동기 평가된다는 전제
// 아래(plans.test.ts 의 "Promise.all 병렬 실행" 테스트와 같은 전제) 계약이 나열한 순서(①~④)대로
// 호출된다고 가정하고 순서 기반으로 응답을 배정한다. 이건 계약이 고정한 것이 아니라 구현
// 세부사항 가정이다 — impl 이 다른 순서로 구성하면 이 파일의 contentsSequence 배열 순서만
// 재조정하면 된다(plans.test.ts 13행 근방과 같은 계약 밖 가정 처리 방식).
//
// admin 전용 광고 합산 쿼리(ad_performance leftJoin sales_channels, channelId 로 그룹핑)의
// 원본 응답 행 별칭(channelId·channelName·spendAmount·revenueAmount·currency)도 계약이
// 고정하지 않은 구현 세부사항이다 — 이 파일은 계약 「데이터 형태」의 AdChannelSummary 최종
// 형태에 가장 자연스럽게 대응하는 별칭을 가정한다. impl 이 다른 별칭을 쓰면 이 부분만
// 재조정하면 된다.

import type { Actor } from "@/lib/auth";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { getHomeDashboard } from "./dashboard";

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — plans.test.ts 의 makeChainNode/makePendingChainNode 패턴 재사용.
// ---------------------------------------------------------------------------

/** 어떤 메서드를 몇 번 체이닝하든(leftJoin·where·groupBy·orderBy…) 결국 resolvedValue 로
 * resolve 되는 노드. calls 를 넘기면 호출된 메서드 이름을 기록하고(구조적 검증용),
 * callArgs 를 넘기면 메서드별 실제 호출 인자(예: where() 에 전달된 drizzle 조건 객체)를
 * 그대로 기록한다(인자 값 검증용 — 05 code-review Major 수리: nothing_locked). */
function makeChainNode(resolvedValue: unknown, calls?: string[], callArgs?: Record<string, unknown[][]>) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue),
    catch: () => node,
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (...args: unknown[]) => {
        const name = String(prop);
        calls?.push(name);
        if (callArgs) (callArgs[name] ??= []).push(args);
        return node;
      };
    },
  });
}

/**
 * drizzle SQL 조건 트리(eq/and/gte/lt 등이 만드는 SQL 객체)를 재귀적으로 훑어, 실제
 * 바인딩된 리터럴 값(Param.value — 예: "published"·Date 경계)을 전부 모아 배열로 낸다.
 *
 * drizzle 의 Param 클래스는 {value, encoder, brand} 형태다(생성자 이름에 기대지 않고
 * 구조로 식별 — 번들링에 안전하다). eq()/gte()/lt() 하나짜리 조건도, and(...) 로 묶인
 * 여러 조건도 모두 queryChunks 를 통해 같은 방식으로 내려간다.
 *
 * 이 함수가 없으면 makeChainNode 의 calls 배열이 "where 가 호출됐다"만 보고 실제로
 * 어떤 값으로 필터했는지는 보지 못한다 — 상태 문자열이 뒤바뀌거나 날짜 경계가 빠져도
 * 스위트가 통과하는 취약점(05 code-review Major)이 여기서 생겼다.
 */
function collectParamValues(node: unknown, acc: unknown[] = []): unknown[] {
  if (node === null || typeof node !== "object") return acc;
  const anyNode = node as Record<string, unknown>;
  if ("encoder" in anyNode && "value" in anyNode) {
    acc.push(anyNode.value);
    return acc;
  }
  if (Array.isArray(anyNode.queryChunks)) {
    for (const chunk of anyNode.queryChunks as unknown[]) collectParamValues(chunk, acc);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const item of node as unknown[]) collectParamValues(item, acc);
  }
  return acc;
}

/** 절대 resolve 되지 않는 체이닝 노드 — Promise.all 병렬 호출 검증용. */
function makePendingChainNode() {
  const pending = new Promise(() => {
    /* 의도적으로 영원히 pending */
  });
  const node: Record<string, unknown> = {
    then: pending.then.bind(pending),
    catch: pending.catch.bind(pending),
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (..._args: unknown[]) => node;
    },
  });
}

interface ContentRawRow {
  id: number;
  title: string;
  status: "draft" | "in_review" | "approved" | "rejected" | "published";
  channelId: number;
  lang: "ko" | "en";
  publishPlanId: number | null;
  scheduledDate: string | null;
  authorId: number | null;
  authorName: string | null;
  detectedTerms: { blocks: unknown[]; warns: unknown[]; missing: unknown[] } | null;
  updatedAt: Date;
  submittedAt: Date | null;
}

interface ChannelRow {
  id: number;
  name: string;
  lang: "ko" | "en";
  channelCode: string;
}

interface AdRawRow {
  channelId: number;
  channelName: string | null;
  spendAmount: string;
  revenueAmount: string | null;
  currency: string;
}

function createDbMock(opts: {
  publishedCountRows?: { count: number }[];
  inReviewRows?: ContentRawRow[];
  approvedRows?: ContentRawRow[];
  channelRows?: ChannelRow[];
  adRows?: AdRawRow[];
  // count 쿼리(contents 테이블 1번째 호출)를 영원히 pending 으로 만들어 병렬 실행을 검증한다.
  pendingCountQuery?: boolean;
}) {
  const countCalls: string[] = [];
  // contents 테이블 select() 호출 순서(0=count·1=in_review·2=approved)별로 그 체인에
  // 실제로 전달된 메서드 인자를 기록한다 — where() 에 담긴 조건의 실제 값(상태 문자열·
  // 날짜 경계)을 검증하기 위함이다(05 code-review Major 수리: nothing_locked).
  const contentsCallArgs: Record<string, unknown[][]>[] = [{}, {}, {}];
  let contentsCallIndex = 0;
  let adPerformanceQueried = false;
  let salesChannelsFromQueried = false;

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.contents) {
        const index = contentsCallIndex;
        contentsCallIndex += 1;
        if (index === 0) {
          if (opts.pendingCountQuery) return makePendingChainNode();
          return makeChainNode(opts.publishedCountRows ?? [{ count: 0 }], countCalls, contentsCallArgs[0]);
        }
        if (index === 1) return makeChainNode(opts.inReviewRows ?? [], undefined, contentsCallArgs[1]);
        if (index === 2) return makeChainNode(opts.approvedRows ?? [], undefined, contentsCallArgs[2]);
        throw new Error("unexpected extra select().from(contents) call in test mock");
      }
      if (table === schema.salesChannels) {
        salesChannelsFromQueried = true;
        return makeChainNode(opts.channelRows ?? []);
      }
      if (table === schema.adPerformance) {
        adPerformanceQueried = true;
        return makeChainNode(opts.adRows ?? []);
      }
      throw new Error(`unexpected select().from() table in test mock: ${String(table)}`);
    }),
  }));

  return {
    db: { select } as unknown as Db,
    select,
    countCalls,
    contentsCallArgs,
    get adPerformanceQueried() {
      return adPerformanceQueried;
    },
    get salesChannelsFromQueried() {
      return salesChannelsFromQueried;
    },
  };
}

const EDITOR: Actor = { role: "editor" };
const ADMIN: Actor = { role: "admin" };

function contentRow(overrides: Partial<ContentRawRow>): ContentRawRow {
  return {
    id: 1,
    title: "제목",
    status: "in_review",
    channelId: 1,
    lang: "ko",
    publishPlanId: null,
    scheduledDate: null,
    authorId: null,
    authorName: null,
    detectedTerms: null,
    updatedAt: new Date("2026-09-15T00:00:00Z"),
    submittedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getHomeDashboard", () => {
  it("이번 달 count 쿼리 결과를 publishedThisMonth 로 그대로 매핑하고, published 상태·이번 달(월초 포함~다음달 월초 미포함) 범위로 실제로 필터한다", async () => {
    // currentMonthRange() 가 new Date() 로 "이번 달"을 계산하므로, 시스템 시각을 고정해
    // 기대하는 월 경계(2026-09-01~2026-10-01)를 결정적으로 만든다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 16, 3, 0, 0));
    try {
      const { db, countCalls, contentsCallArgs } = createDbMock({ publishedCountRows: [{ count: 7 }] });

      const result = await getHomeDashboard({ db }, EDITOR);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.publishedThisMonth).toBe(7);
      expect(countCalls).toContain("where");

      // 구조 확인(호출됐다)을 넘어, where() 에 실제로 전달된 조건에 담긴 값 자체를 본다.
      // status 문자열이 뒤바뀌거나(e.g. "approved") 날짜 경계가 빠져도 "where 호출됨"만
      // 보는 검증으로는 잡히지 않는다 — 05 code-review Major(nothing_locked) 수리.
      const whereCalls = contentsCallArgs[0].where ?? [];
      expect(whereCalls).toHaveLength(1);
      const paramValues = collectParamValues(whereCalls[0][0]);
      expect(paramValues).toContainEqual("published");
      expect(paramValues).toContainEqual(new Date(2026, 8, 1)); // 월초(포함)
      expect(paramValues).toContainEqual(new Date(2026, 9, 1)); // 다음달 월초(미포함)
    } finally {
      vi.useRealTimers();
    }
  });

  it("inReview·approved 는 listContents(status, mine:false) 호출 결과를 그대로 담는다", async () => {
    const inReviewRaw = contentRow({
      id: 10,
      title: "검토중 콘텐츠",
      status: "in_review",
      channelId: 3,
      lang: "ko",
      publishPlanId: 100,
      scheduledDate: "2026-09-20",
      authorId: 5,
      authorName: "김담당",
      detectedTerms: { blocks: [], warns: [{ matched: "완치", rule: 1 }], missing: [] },
      updatedAt: new Date("2026-09-16T00:00:00Z"),
      submittedAt: new Date("2026-09-16T00:01:00Z"),
    });
    const approvedRaw = contentRow({
      id: 20,
      title: "승인된 콘텐츠",
      status: "approved",
      channelId: 4,
      lang: "en",
      publishPlanId: null,
      scheduledDate: null,
      authorId: null,
      authorName: null,
      detectedTerms: null,
      updatedAt: new Date("2026-09-15T00:00:00Z"),
      submittedAt: null,
    });
    const { db, contentsCallArgs } = createDbMock({ inReviewRows: [inReviewRaw], approvedRows: [approvedRaw] });

    const result = await getHomeDashboard({ db }, EDITOR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // listContents 가 실제로 받은 status 필터 값 자체를 본다(호출 순서만으로는 두 번째·
    // 세 번째 select().from(contents) 호출에 어떤 status 인자가 들어갔는지 구분할 수
    // 없다 — status 가 뒤바뀌어도 데이터가 index 로만 배정되면 이 스위트가 못 잡는다).
    const inReviewWhere = contentsCallArgs[1].where?.[0]?.[0];
    const approvedWhere = contentsCallArgs[2].where?.[0]?.[0];
    expect(collectParamValues(inReviewWhere)).toEqual(["in_review"]);
    expect(collectParamValues(approvedWhere)).toEqual(["approved"]);

    expect(result.data.inReview).toEqual([
      {
        id: 10,
        title: "검토중 콘텐츠",
        status: "in_review",
        channelId: 3,
        lang: "ko",
        publishPlanId: 100,
        scheduledDate: "2026-09-20",
        authorId: 5,
        authorName: "김담당",
        warnCount: 1,
        updatedAt: "2026-09-16T00:00:00.000Z",
        submittedAt: "2026-09-16T00:01:00.000Z",
      },
    ]);
    expect(result.data.approved).toEqual([
      {
        id: 20,
        title: "승인된 콘텐츠",
        status: "approved",
        channelId: 4,
        lang: "en",
        publishPlanId: null,
        scheduledDate: null,
        authorId: null,
        authorName: null,
        warnCount: 0,
        updatedAt: "2026-09-15T00:00:00.000Z",
        submittedAt: null,
      },
    ]);
  });

  it("channelNames 가 listContentChannels 결과(id→name 맵)로 채워진다", async () => {
    const { db } = createDbMock({
      channelRows: [
        { id: 1, name: "카카오스토어", lang: "ko", channelCode: "kakao" },
        { id: 2, name: "Shopee PH", lang: "en", channelCode: "shopee_ph" },
      ],
    });

    const result = await getHomeDashboard({ db }, EDITOR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.channelNames).toEqual({ 1: "카카오스토어", 2: "Shopee PH" });
  });

  it("actor.role === 'editor' 면 adSummary 는 null 이고, 광고 조인 쿼리 자체를 실행하지 않는다", async () => {
    const mock = createDbMock({});

    const result = await getHomeDashboard({ db: mock.db }, EDITOR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.adSummary).toBeNull();
    expect(mock.adPerformanceQueried).toBe(false);
  });

  it("actor.role === 'admin' 이고 ad_performance 행이 없으면 adSummary: [] (권한은 있으나 데이터 없음)", async () => {
    const mock = createDbMock({ adRows: [] });

    const result = await getHomeDashboard({ db: mock.db }, ADMIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.adSummary).toEqual([]);
    expect(mock.adPerformanceQueried).toBe(true);
  });

  it("actor.role === 'admin' 이고 ad_performance 행이 있으면 채널별로 채워지고, 통화는 그 채널 행의 currency 를 그대로 쓴다(revenue 없는 채널은 null)", async () => {
    const { db } = createDbMock({
      adRows: [
        { channelId: 5, channelName: "Shopee PH", spendAmount: "150.5000", revenueAmount: "300.0000", currency: "USD" },
        { channelId: 6, channelName: "카카오스토어", spendAmount: "80.0000", revenueAmount: null, currency: "KRW" },
      ],
    });

    const result = await getHomeDashboard({ db }, ADMIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.adSummary).toEqual([
      {
        channelId: 5,
        channelName: "Shopee PH",
        spend: { amount: "150.5000", currency: "USD" },
        revenue: { amount: "300.0000", currency: "USD" },
      },
      {
        channelId: 6,
        channelName: "카카오스토어",
        spend: { amount: "80.0000", currency: "KRW" },
        revenue: null,
      },
    ]);
  });

  it("네 조회(publishedThisMonth·inReview·approved·channelNames)를 Promise.all 로 병렬 실행한다 (count 쿼리가 pending 이어도 나머지가 이미 호출됨)", () => {
    const { db, select } = createDbMock({ pendingCountQuery: true });

    // 의도적으로 await 하지 않는다 — 첫 await(Promise.all)에 이르기까지 모든 쿼리가
    // 이미 동기적으로 구성됐는지만 본다(plans.test.ts 의 같은 이름 테스트와 같은 방식).
    void getHomeDashboard({ db }, EDITOR);

    // contents 3회(count·in_review·approved) + salesChannels 1회(channelNames) = 4회.
    // editor 라 admin 전용 광고 쿼리는 구성되지 않는다.
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("DB 쿼리가 실패하면 {ok:false, error:{code:'INTERNAL'}} 을 반환하고 throw 하지 않는다", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const select = vi.fn(() => {
      throw new Error("connection refused");
    });
    const db = { select } as unknown as Db;

    const result = await getHomeDashboard({ db }, EDITOR);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
