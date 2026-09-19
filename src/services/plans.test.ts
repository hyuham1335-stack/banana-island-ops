import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약: _workspace/contract_fr002-plans-list.md 「유닛 · src/services/plans.ts」
//
// 외부 경계(계약): "테스트가 모킹할 대상은 Drizzle Db 클라이언트 하나뿐이다
// (plan-sync.test.ts 의 인메모리/스텁 DB 패턴을 재사용)". 이 파일도 같은 패턴을 쓴다:
// db.select(...).from(table) 을 테이블 정체성으로 분기하고, 그 뒤에 얼마나 더
// 체이닝(leftJoin·where·orderBy·limit)하든 항상 같은 결과로 resolve 되는 Proxy 노드를 돌려준다.
// 이렇게 하면 listPlans 가 정확히 어떤 메서드를 몇 번 체이닝하는지에 테스트가 묶이지 않는다.
//
// 조인 결과 행의 컬럼 별칭(예: contentId·contentStatus·ownerName)은 계약이 고정하지 않은
// 구현 세부사항이다 — 이 파일은 TRD.md §47("publish_plans LEFT JOIN contents")과
// Plan 데이터 형태(계약 「데이터 형태」절)에 가장 자연스럽게 대응하는 별칭을 가정한다.
// impl 이 다른 별칭을 쓰면 이 부분만 재조정하면 된다(계약 밖 영역).

import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listPlans } from "./plans";

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — plan-sync.test.ts 의 makeChainNode 패턴을 일반화(Proxy)한 버전.
// ---------------------------------------------------------------------------

/** 어떤 메서드를 몇 번 체이닝하든(leftJoin·where·orderBy·limit…) 결국 resolvedValue 로 resolve 되는 노드. */
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

interface PlanRow {
  id: number;
  sheetRowKey: string;
  scheduledDate: string;
  channelId: number;
  productId: number | null;
  lang: "ko" | "en";
  postType: "health_info" | "activity_news" | "comparison" | "review";
  topicMemo: string;
  ownerId: number | null;
  onHold: boolean;
  contentId: number | null;
  contentStatus: "draft" | "in_review" | "approved" | "rejected" | "published" | null;
  ownerName: string | null;
  channelName: string | null;
  productName: string | null;
}

interface LastSyncRow {
  id: number;
  createdAt: Date;
  totalRows: number;
  okRows: number;
  failedRows: number;
  trigger: "manual" | "webhook";
}

function createDbMock(opts: { planRows: PlanRow[]; lastSyncRows: LastSyncRow[] }) {
  const selectCalls: unknown[] = [];
  const select = vi.fn((...args: unknown[]) => {
    selectCalls.push(args);
    return {
      from: vi.fn((table: unknown) => {
        if (table === schema.publishPlans) return makeChainNode(opts.planRows);
        if (table === schema.importLogs) return makeChainNode(opts.lastSyncRows);
        throw new Error("unexpected select().from() table in test mock");
      }),
      // 참고: channelName·productName 은 leftJoin(salesChannels)·leftJoin(products) 로
      // planRows 자체에 이미 얹혀 나온다고 가정한다(위 makeChainNode 패턴 — from() 이후
      // 얼마나 조인하든 같은 resolvedValue). 별도 select().from(salesChannels|products) 분기는
      // 필요 없다.
    };
  });
  return { db: { select } as unknown as Db, select, selectCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPlans", () => {
  it("plans·lastSync 를 정확히 매핑한다 — derivePlanStatus 적용, contentId·ownerName 파생, trigger 는 저장값 그대로", async () => {
    const createdAt = new Date("2026-09-10T00:00:00Z");
    const { db } = createDbMock({
      planRows: [
        {
          id: 1,
          sheetRowKey: "PLAN-1",
          scheduledDate: "2026-09-05",
          channelId: 10,
          productId: null,
          lang: "ko",
          postType: "health_info",
          topicMemo: "토픽1",
          ownerId: null,
          onHold: false,
          contentId: null,
          contentStatus: null,
          ownerName: null,
          channelName: "카카오스토어",
          productName: null,
        },
        {
          id: 2,
          sheetRowKey: "PLAN-2",
          scheduledDate: "2026-09-06",
          channelId: 11,
          productId: 20,
          lang: "en",
          postType: "review",
          topicMemo: "토픽2",
          ownerId: 100,
          onHold: false,
          contentId: 55,
          contentStatus: "approved",
          ownerName: "김담당",
          channelName: "Shopee PH",
          productName: "황금바나나칩",
        },
      ],
      lastSyncRows: [{ id: 9, createdAt, totalRows: 12, okRows: 10, failedRows: 2, trigger: "webhook" }],
    });

    const result = await listPlans({ db }, "2026-09");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.plans).toEqual([
      {
        id: 1,
        sheetRowKey: "PLAN-1",
        scheduledDate: "2026-09-05",
        channelId: 10,
        productId: null,
        lang: "ko",
        postType: "health_info",
        topicMemo: "토픽1",
        ownerId: null,
        ownerName: null,
        onHold: false,
        status: "scheduled",
        contentId: null,
        channelName: "카카오스토어",
        productName: null,
      },
      {
        id: 2,
        sheetRowKey: "PLAN-2",
        scheduledDate: "2026-09-06",
        channelId: 11,
        productId: 20,
        lang: "en",
        postType: "review",
        topicMemo: "토픽2",
        ownerId: 100,
        ownerName: "김담당",
        onHold: false,
        status: "approved",
        contentId: 55,
        channelName: "Shopee PH",
        productName: "황금바나나칩",
      },
    ]);

    // FR-024: trigger 는 import_logs.trigger 컬럼의 저장값을 그대로 돌려준다.
    expect(result.data.lastSync).toEqual({
      id: 9,
      createdAt,
      totalRows: 12,
      okRows: 10,
      failedRows: 2,
      trigger: "webhook",
    });
  });

  it("계획이 0건이면 plans: [] 를 돌려준다", async () => {
    const { db } = createDbMock({ planRows: [], lastSyncRows: [] });

    const result = await listPlans({ db }, "2026-09");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.plans).toEqual([]);
  });

  it("import_logs 에 기록이 없으면 lastSync 는 null", async () => {
    const { db } = createDbMock({ planRows: [], lastSyncRows: [] });

    const result = await listPlans({ db }, "2026-09");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.lastSync).toBeNull();
  });

  it("담당자가 없는 계획은 ownerId·ownerName 모두 null 이다", async () => {
    const { db } = createDbMock({
      planRows: [
        {
          id: 3,
          sheetRowKey: "PLAN-3",
          scheduledDate: "2026-09-07",
          channelId: 12,
          productId: null,
          lang: "ko",
          postType: "activity_news",
          topicMemo: "토픽3",
          ownerId: null,
          onHold: false,
          contentId: null,
          contentStatus: null,
          ownerName: null,
          channelName: "카카오스토어",
          productName: null,
        },
      ],
      lastSyncRows: [],
    });

    const result = await listPlans({ db }, "2026-09");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plans[0]?.ownerId).toBeNull();
      expect(result.data.plans[0]?.ownerName).toBeNull();
    }
  });

  it("channelId·productId 를 실제 채널명·제품명으로 붙여 돌려준다 (leftJoin salesChannels·products)", async () => {
    const { db } = createDbMock({
      planRows: [
        {
          id: 4,
          sheetRowKey: "PLAN-4",
          scheduledDate: "2026-09-08",
          channelId: 13,
          productId: 21,
          lang: "ko",
          postType: "comparison",
          topicMemo: "토픽4",
          ownerId: null,
          onHold: false,
          contentId: null,
          contentStatus: null,
          ownerName: null,
          channelName: "스마트스토어",
          productName: "바나나칩 오리지널",
        },
      ],
      lastSyncRows: [],
    });

    const result = await listPlans({ db }, "2026-09");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plans[0]?.channelName).toBe("스마트스토어");
      expect(result.data.plans[0]?.productName).toBe("바나나칩 오리지널");
    }
  });

  it.each(["manual", "webhook"] as const)(
    "저장된 trigger 를 그대로 돌려준다 ('%s' 행 → '%s')",
    async (trigger) => {
      const { db } = createDbMock({
        planRows: [],
        lastSyncRows: [
          { id: 1, createdAt: new Date("2026-09-01T00:00:00Z"), totalRows: 0, okRows: 0, failedRows: 0, trigger },
        ],
      });

      const result = await listPlans({ db }, "2026-09");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.lastSync?.trigger).toBe(trigger);
    },
  );

  it("계획 목록 조회와 lastSync 조회를 Promise.all 로 병렬 실행한다 (하나가 pending 이어도 둘 다 이미 호출됨)", () => {
    const pendingNode = makePendingChainNode();
    const select = vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === schema.publishPlans) return pendingNode;
        if (table === schema.importLogs) return makeChainNode([]);
        throw new Error("unexpected select().from() table in test mock");
      }),
    }));
    const db = { select } as unknown as Db;

    // 의도적으로 await 하지 않는다 — listPlans 가 첫 await(Promise.all) 에 이르기까지
    // 동기적으로 두 쿼리를 모두 구성했는지만 확인한다. 순차(await a; await b) 였다면
    // publishPlans 가 pending 인 동안 importLogs select 는 아직 호출되지 않았을 것이다.
    void listPlans({ db }, "2026-09");

    expect(select).toHaveBeenCalledTimes(2);
  });

  it("DB 조회가 실패하면 INTERNAL 로 감싸고 console.error 로 로그를 남긴다", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const select = vi.fn(() => {
      throw new Error("connection refused");
    });
    const db = { select } as unknown as Db;

    const result = await listPlans({ db }, "2026-09");

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
