import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「유닛 · src/services/content-workflow.ts ·
// listContents()·transition()·resolveContentLink()·getContentDetail()」— 07 code-review
// 수리 라운드로 실제 구현이 다시 바뀌어(ADR-002: 낙관적 잠금 UPDATE 가 성공을 확인한 뒤에만
// content_history 를 best-effort 로 쓴다) 이 스위트도 다시 썼다(추측이 아니라
// src/services/content-workflow.ts 를 직접 읽어 확정).
//
// 외부 경계(계약): resolveRules·validate·buildUtmLink 는 실물 그대로 통과시킨다(내부 위임이지
// 외부 경계가 아니다). resolveRules 의 호출 여부·인자를 관측해야 하는 케이스가 있어
// content-generation.test.ts 와 같은 vi.mock(importOriginal) 스파이 패턴을 그대로 쓴다.
// DB(drizzle)는 content-generation.test.ts 의 makeChainNode 패턴을 재사용해 모킹한다.
//
//   - listContents(deps: {db}, query: {status?, mine}, actor) — 이전 라운드 그대로(변경 없음).
//   - transition(deps: {db, productBaseUrl}, contentId, action, actor) — 4개 위치 인자.
//   - resolveContentLink(deps: {db, productBaseUrl}, row) — deps 그대로(변경 없음).
//   - getContentDetail(deps: {db, productBaseUrl}, contentId) — 신설. GET 상세 조회·조립을
//     라우트에서 옮겨왔다 — select().from(contents) → 없으면 NOT_FOUND → resolveContentLink →
//     historyCount(select count(*) from content_history) → toContentDetail 조립. transition()
//     과 같은 try/catch·Result 패턴이라 DB 예외는 INTERNAL 로 매핑된다.
//   - resolveRules 는 transition() 의 deps({db, productBaseUrl})를 그대로 넘겨 호출한다
//     (resolveRules 는 db 만 쓰지만 구조적 타이핑상 그대로 통과된다).
//   - transition() 조회 순서(ADR-002): select().from(contents) 로 대상 행 전체 → (submit 이면)
//     resolveRules → validate → 차단 있으면 update(contents).set({detectedTerms, updatedAt})
//     .where(id=contentId AND status=row.status) 만 하고 반환(BLOCKED_TERMS_REMAIN, 이 UPDATE
//     도 status 가드가 걸린다) → 차단 없으면 update(contents).set({status, updatedAt,
//     submittedAt, detectedTerms}).where(id=contentId AND status=row.status).returning() 을
//     먼저 실행한다(낙관적 잠금). .returning() 이 0행이면(다른 요청이 먼저 상태를 바꿨다)
//     content_history 는 전혀 건드리지 않고 다시 select().from(contents) 로 최신 행을 읽어 그
//     status 기준 INVALID_TRANSITION 을 반환한다(덮어쓰지 않는다). UPDATE 가 성공을 확인한
//     뒤에만(action==='submit') select count(*) from content_history 로 count 를 구해
//     nextVersionNo=count+1 을 계산하고 db.insert(contentHistory).values(...) 로 이력을 쓴다
//     (원자 raw SQL 이 아니라 평범한 count→insert 두 단계다 — 이 UPDATE 를 통과하는 동시
//     요청은 하나뿐이라 versionNo 계산이 레이스에 노출되지 않는다). cancel_review 는
//     resolveRules 를 건너뛰고 바로 같은 가드가 걸린 update(contents).set({status, updatedAt,
//     submittedAt: null}).where(id=contentId AND status=row.status).returning() 한 뒤
//     select({count}).from(contentHistory) 로 historyCount 만 다시 구한다(history_reason enum
//     에 'cancel_review' 값이 없어 이력 자체를 쓰지 않는다) — submittedAt 은 UPDATE 의
//     .returning() 값과 무관하게 결과 조립 시 항상 null 로 고정된다.
//   - FORBIDDEN_ROLE details = { required: "editor" }(cancel_review 만 role 제한).
//   - INVALID_TRANSITION details = { from: row.status, action } — 동시성 충돌 경로에서는
//     row.status 가 아니라 재조회한 최신 status 를 쓴다.
//   - BLOCKED_TERMS_REMAIN details = { blocks: validation.blocks }.

vi.mock("@/services/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rules")>();
  return { ...actual, resolveRules: vi.fn(actual.resolveRules) };
});

import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { ContentsRow } from "@/lib/content-detail";
import type { BrandRuleRow } from "@/lib/rules-merge";
import { resolveRules } from "@/services/rules";
import {
  approveContent,
  bodyUnchangedGuard,
  getContentDetail,
  listContents,
  resolveContentLink,
  statusAfterEdit,
  transition,
} from "./content-workflow";

// 계약: FR-010·FR-011(런 20260915-2042-728c) 「유닛 · src/services/content-workflow.ts ·
// TRANSITIONS(approve/reject)·resolveActorUserId·transition(approve/reject 경로)·
// approveContent」— 위 FR-009 스위트에 이어 붙인다. createDbMock 을 users·brandExamples
// 테이블까지 지원하도록 확장해 재사용한다(아래 opts.userRows·opts.brandExampleInsertShouldThrow).
//
// 플랜과의 차이(F-2·F-1·F-3-new) 수리 검증:
//   - F-2: approve 의 .set() 이 rejectReason:null 을 명시하는지 — reject→submit→approve 를
//     거쳐 rejectReason 이 비어있지 않았던 픽스처로 확인한다.
//   - F-1: submittedAt 이 approve/reject 모두 row(=submit 시점 값) 그대로 보존되는지.
//   - F-3-new: approve/reject 성공 시 content_history insert 가 대칭적으로 호출되지 않는지.

// ---------------------------------------------------------------------------
// DB 스텁 헬퍼 — src/services/content-generation.test.ts 와 같은 Proxy 체인 패턴.
// ---------------------------------------------------------------------------

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

interface ChannelRow {
  id: number;
  country: string;
  utmSource: string | null;
  utmMedium: string | null;
  linkPolicy: "inline" | "bio" | "none";
  // FR-012(채널 형식 변환) 계약 — resolveChannelFormat 이 같은 salesChannels 테이블에서
  // 함께 SELECT 하는 컬럼. 기존 resolveContentLink 케이스들은 이 값을 보지 않으므로
  // 기본값(null)을 둬도 영향이 없다.
  writeUrl?: string | null;
}

interface ProductRow {
  productCode: string;
}

function contentRow(overrides: Partial<ContentsRow> = {}): ContentsRow {
  return {
    id: 1,
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
    title: "제목",
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
    updatedAt: new Date("2026-09-15T00:00:00Z"),
    createdAt: new Date("2026-09-14T00:00:00Z"),
    ...overrides,
  };
}

const CHANNEL_ROW: ChannelRow = {
  id: 10,
  country: "KR",
  utmSource: "kakao",
  utmMedium: "sns",
  linkPolicy: "inline",
  writeUrl: null,
};

const DEFAULT_RETURNING_ROW = {
  updatedAt: new Date("2026-09-15T00:05:00Z"),
  submittedAt: new Date("2026-09-15T00:05:00Z"),
};

function createDbMock(opts: {
  contentRows: ContentsRow[];
  // select().from(contents) 가 여러 번 호출될 때(동시성 충돌 후 재조회) 호출 순서대로 하나씩
  // 소비한다 — 미지정 시 매 호출마다 contentRows 를 그대로 돌려준다(기존 동작 그대로).
  contentRowsSequence?: ContentsRow[][];
  channelRows?: ChannelRow[];
  ruleRows?: BrandRuleRow[];
  productRows?: ProductRow[];
  historyCountRows?: { count: number }[];
  updateReturningResult?: Record<string, unknown>[];
  // resolveActorUserId(approve/reject)가 조회하는 users — 미지정 시 빈 배열(시드 전, null 근사).
  userRows?: { id: number }[];
  // approveContent 의 brandExamples insert 가 예외를 던지는 경로(계약 케이스 15)를 재현한다.
  brandExampleInsertShouldThrow?: boolean;
}) {
  const updateSetCalls: unknown[] = [];
  const updateWhereCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];
  const brandExampleInsertCalls: unknown[] = [];
  let contentsSelectCallIndex = 0;

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.contents) {
        const rows = opts.contentRowsSequence
          ? opts.contentRowsSequence[Math.min(contentsSelectCallIndex, opts.contentRowsSequence.length - 1)]
          : opts.contentRows;
        contentsSelectCallIndex += 1;
        return makeChainNode(rows);
      }
      if (table === schema.salesChannels) return makeChainNode(opts.channelRows ?? [CHANNEL_ROW]);
      if (table === schema.brandRules) return makeChainNode(opts.ruleRows ?? []);
      if (table === schema.products) return makeChainNode(opts.productRows ?? []);
      if (table === schema.contentHistory) return makeChainNode(opts.historyCountRows ?? [{ count: 0 }]);
      if (table === schema.users) return makeChainNode(opts.userRows ?? []);
      throw new Error(`unexpected select().from() table in test mock: ${String(table)}`);
    }),
  }));

  const update = vi.fn((table: unknown) => {
    if (table !== schema.contents) throw new Error("unexpected update() table in test mock");
    return {
      set: vi.fn((vals: unknown) => {
        updateSetCalls.push(vals);
        return {
          where: vi.fn((whereArg: unknown) => {
            updateWhereCalls.push(whereArg);
            return {
              // set().where() 자체가 await 될 수도 있고(BLOCKED_TERMS_REMAIN 경로),
              // .returning() 이 더 붙을 수도 있다(성공 경로・lost-update 0행 경로) — 둘 다 지원한다.
              then: (resolve: (v: unknown) => void) => resolve([]),
              catch: () => {},
              returning: vi.fn(() => makeChainNode(opts.updateReturningResult ?? [DEFAULT_RETURNING_ROW])),
            };
          }),
        };
      }),
    };
  });

  // ADR-002: content_history 의 versionNo 계산+삽입은 원자 raw SQL(db.execute)이 아니라 평범한
  // select count(*) → db.insert(contentHistory).values() 두 단계다. 상태 UPDATE(낙관적 잠금)가
  // 성공을 확인한 뒤에만 호출된다.
  const insert = vi.fn((table: unknown) => {
    if (table === schema.contentHistory) {
      return {
        values: vi.fn((vals: unknown) => {
          insertValuesCalls.push(vals);
          return makeChainNode(undefined);
        }),
      };
    }
    if (table === schema.brandExamples) {
      return {
        values: vi.fn((vals: unknown) => {
          brandExampleInsertCalls.push(vals);
          // 계약 케이스 15: insert 가 예외를 던지는 경로 — approveContent 가 이 예외를
          // 삼키고 exampleSkippedReason 으로 바꾸는지를 본다(transition() 자체는 이미 성공).
          if (opts.brandExampleInsertShouldThrow) throw new Error("brand example insert failed");
          return makeChainNode(undefined);
        }),
      };
    }
    throw new Error("unexpected insert() table in test mock");
  });

  return {
    db: { select, update, insert } as unknown as Db,
    select,
    update,
    insert,
    updateSetCalls,
    updateWhereCalls,
    insertValuesCalls,
    brandExampleInsertCalls,
  };
}

function ruleRow(
  overrides: Partial<BrandRuleRow> & Pick<BrandRuleRow, "id" | "scope" | "ruleType" | "content" | "version">,
): BrandRuleRow {
  return {
    detectPattern: null,
    alternative: null,
    reason: null,
    legalBasis: null,
    severity: null,
    ...overrides,
  };
}

const CURE_BAN_RULE = ruleRow({
  id: 1,
  scope: "common",
  ruleType: "ban",
  content: "질병 치료·예방 표현",
  detectPattern: "완치",
  severity: "block",
  version: 1,
});

const PRODUCT_BASE_URL = "https://shop.banana-island.co.kr";
const DEPS = { productBaseUrl: PRODUCT_BASE_URL };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listContents — CONTRACT_DEFECT 수리(05 arch 리뷰)로 원래 app/api/contents/route.ts GET
// 핸들러 안에 인라인이던 조회·필터링·매핑이 여기로 옮겨왔다. select({...}).from(contents)
// 위에 .leftJoin()·.where()·.orderBy() 를 체이닝하는 형태라 makeCallRecordingNode(호출된
// 메서드 이름만 기록하는 프록시, 옛 route.test.ts 의 stubListDb 패턴 그대로) 로 배선만
// 관측한다 — 드리즐 조건 객체 내부 구조까지는 보지 않는다.
// ---------------------------------------------------------------------------

function makeCallRecordingNode(resolvedValue: unknown, calls: string[]) {
  const node: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(resolvedValue),
    catch: () => node,
  };
  return new Proxy(node, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "constructor" || typeof prop === "symbol") return undefined;
      return (..._args: unknown[]) => {
        calls.push(String(prop));
        return node;
      };
    },
  });
}

function createListDbMock(opts: { userRows?: { id: number }[]; contentRows?: Record<string, unknown>[] }) {
  const usersFromCalled = { value: false };
  const contentsCalls: string[] = [];
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === schema.users) {
        usersFromCalled.value = true;
        return makeCallRecordingNode(opts.userRows ?? [], []);
      }
      if (table === schema.contents) {
        return makeCallRecordingNode(opts.contentRows ?? [], contentsCalls);
      }
      throw new Error(`unexpected select().from() table in test mock: ${String(table)}`);
    }),
  }));
  return { db: { select } as unknown as Db, usersFromCalled, contentsCalls };
}

describe("listContents", () => {
  it("status·mine 이 없으면 조건 없이 조회하고(where 미호출) ContentSummary 로 매핑해 반환한다(warnCount 포함)", async () => {
    const row = {
      id: 1,
      title: "제목1",
      status: "draft" as const,
      channelId: 10,
      lang: "ko" as const,
      publishPlanId: null,
      scheduledDate: null,
      authorId: null,
      authorName: null,
      detectedTerms: { blocks: [], warns: [{ matched: "다이어트", rule: 1 }], missing: [] },
      updatedAt: new Date("2026-09-15T00:00:00Z"),
      submittedAt: new Date("2026-09-15T00:01:00Z"),
    };
    const { db, contentsCalls, usersFromCalled } = createListDbMock({ contentRows: [row] });

    const result = await listContents({ db }, { mine: false }, { role: "editor" });

    expect(result).toEqual([
      {
        id: 1,
        title: "제목1",
        status: "draft",
        channelId: 10,
        lang: "ko",
        publishPlanId: null,
        scheduledDate: null,
        authorId: null,
        authorName: null,
        warnCount: 1,
        updatedAt: "2026-09-15T00:00:00.000Z",
        submittedAt: "2026-09-15T00:01:00.000Z",
      },
    ]);
    expect(contentsCalls).not.toContain("where");
    expect(usersFromCalled.value).toBe(false);
  });

  it("status 필터가 있으면 contents 쿼리에 where() 가 호출된다", async () => {
    const { db, contentsCalls } = createListDbMock({ contentRows: [] });

    const result = await listContents({ db }, { status: "in_review", mine: false }, { role: "editor" });

    expect(result).toEqual([]);
    expect(contentsCalls).toContain("where");
  });

  it("mine=true 이고 그 역할의 유저가 있으면 users 를 조회해 authorId 로 필터링한다(contents where 호출)", async () => {
    const { db, usersFromCalled, contentsCalls } = createListDbMock({ userRows: [{ id: 42 }], contentRows: [] });

    const result = await listContents({ db }, { mine: true }, { role: "admin" });

    expect(usersFromCalled.value).toBe(true);
    expect(contentsCalls).toContain("where");
    expect(result).toEqual([]);
  });

  it("mine=true 인데 해당 역할의 유저가 없으면(시드 전) contents 조회 없이 즉시 빈 배열(결과 없음)을 반환한다", async () => {
    const { db, contentsCalls } = createListDbMock({
      userRows: [],
      contentRows: [{ id: 1 }] as unknown as Record<string, unknown>[],
    });

    const result = await listContents({ db }, { mine: true }, { role: "editor" });

    expect(result).toEqual([]);
    expect(contentsCalls).toHaveLength(0); // contents 테이블 자체를 조회하지 않았다
  });

  it("detectedTerms 가 null 이면 warnCount 는 0 이고, publishPlanId·scheduledDate·authorId·authorName 은 있는 그대로 매핑되며 submittedAt 은 null 이면 null 로 나간다", async () => {
    const row = {
      id: 2,
      title: "제목2",
      status: "in_review" as const,
      channelId: 11,
      lang: "en" as const,
      publishPlanId: 5,
      scheduledDate: "2026-09-20",
      authorId: 7,
      authorName: "홍길동",
      detectedTerms: null,
      updatedAt: new Date("2026-09-15T00:00:00Z"),
      submittedAt: null,
    };
    const { db } = createListDbMock({ contentRows: [row] });

    const result = await listContents({ db }, { mine: false }, { role: "editor" });

    expect(result).toEqual([
      {
        id: 2,
        title: "제목2",
        status: "in_review",
        channelId: 11,
        lang: "en",
        publishPlanId: 5,
        scheduledDate: "2026-09-20",
        authorId: 7,
        authorName: "홍길동",
        warnCount: 0,
        updatedAt: "2026-09-15T00:00:00.000Z",
        submittedAt: null,
      },
    ]);
  });
});

// -----------------------------------------------------------------------------
// bodyUnchangedGuard · statusAfterEdit — FR-008 계약(_workspace/contract_fr-008-direct-edit.md)
// 「유닛」. 둘 다 순수 함수라 DB 모킹 없이 직접 호출·검증한다.
// -----------------------------------------------------------------------------

describe("bodyUnchangedGuard", () => {
  it("body: null 이면 isNull(contents.body) 조건을 반환한다(eq(contents.body, null) 은 SQL 상 항상 거짓이라 쓰지 않는다)", () => {
    expect(bodyUnchangedGuard(null)).toEqual(isNull(schema.contents.body));
  });

  it("body: 'x' 이면 eq(contents.body, 'x') 조건을 반환한다", () => {
    expect(bodyUnchangedGuard("x")).toEqual(eq(schema.contents.body, "x"));
  });
});

describe("statusAfterEdit", () => {
  it("status='rejected' 면 'draft' 를 반환한다(FR-011 — 수정하러 가기)", () => {
    expect(statusAfterEdit("rejected")).toBe("draft");
  });

  it.each(["draft", "in_review", "approved", "published"] as const)(
    "status='%s' 면 입력 그대로 반환한다(편집으로 상태가 바뀌지 않는다)",
    (status) => {
      expect(statusAfterEdit(status)).toBe(status);
    },
  );
});

describe("transition", () => {
  it("NOT_FOUND — 존재하지 않는 contentId 면 NOT_FOUND 를 돌려주고 아무 것도 쓰지 않는다", async () => {
    const { db, update, insert } = createDbMock({ contentRows: [] });

    const result = await transition({ db, ...DEPS }, 999, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("FORBIDDEN_ROLE — cancel_review 를 role=admin 이 호출하면 거부된다", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, update } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "cancel_review", { role: "admin" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN_ROLE");
      expect(result.error.details).toEqual({ required: "editor" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("INVALID_TRANSITION — submit 을 status=in_review 인 행에 호출하면 409 다", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, update } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "in_review", action: "submit" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("INVALID_TRANSITION — cancel_review 를 status=draft 인 행에 호출하면 409 다", async () => {
    const row = contentRow({ status: "draft" });
    const { db, update } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "cancel_review", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "draft", action: "cancel_review" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("INVALID_TRANSITION(동시성 충돌) — 최종 UPDATE 가 0행을 반환하면(다른 요청이 먼저 상태를 바꿨다) 최신 상태로 다시 읽어 그 값 기준 INVALID_TRANSITION 을 반환하고, ADR-002 대로 content_history 에는 아무 것도 쓰지 않는다", async () => {
    const staleRow = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const freshRow = contentRow({ status: "in_review" });
    const { db, update, insert } = createDbMock({
      contentRows: [staleRow],
      contentRowsSequence: [[staleRow], [freshRow]],
      ruleRows: [],
      updateReturningResult: [], // .returning() 이 0행 — lost update
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "in_review", action: "submit" });
    }
    // 최종 UPDATE 는 가드에 걸려 0행 — update() 자체는 1번(최종 UPDATE)만 호출된다(재조회는
    // select 이지 update 가 아니다). 상태 UPDATE 가 실패했으므로 content_history INSERT
    // 자체가 실행되지 않는다(ADR-002).
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  // FR-008 계약(01 라운드2 critical 수리) 회귀 방지 — submit 성공 UPDATE 의 .where() 에
  // bodyUnchangedGuard(row.body) 가 추가됐는데, body 가 null 인 행에서 eq(contents.body,
  // null) 을 그대로 썼다면 SQL 상 x = NULL 은 항상 UNKNOWN 이 되어 동시성 경합이 전혀
  // 없어도 이 UPDATE 가 매번 0행으로 떨어져 항상 409 를 오반환했을 것이다. 실제 where
  // 인자가 isNull(contents.body) 로 분기됐는지까지 구조적으로 확인한다.
  it("body 가 null 인 draft 에 동시성 경합 없이 submit 을 호출하면 정상 처리된다(bodyUnchangedGuard 가 isNull 로 분기하지 않으면 항상 409가 났던 버그의 재발 방지)", async () => {
    const row = contentRow({ status: "draft", body: null });
    const { db, update, insert, updateWhereCalls } = createDbMock({
      contentRows: [row],
      ruleRows: [],
      historyCountRows: [{ count: 0 }],
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(updateWhereCalls[0]).toEqual(
      and(eq(schema.contents.id, 1), eq(schema.contents.status, "draft"), eq(schema.contents.regenCount, 0), isNull(schema.contents.body)),
    );
  });

  // FR-008 계약 §1 — submit 의 성공 UPDATE 가드에 bodyUnchangedGuard(row.body) 를 추가한
  // 이유: 동시에 editContent(또는 regenerate)가 body 를 바꾸면 이 UPDATE 는 0행이 되어야
  // 하고(stale detectedTerms 가 in_review 로 커밋되는 것을 막는다), 기존 regenCount 가드만
  // 으로는 editContent 의 body 변경을 못 잡는다(editContent 는 regenCount 를 안 건드린다).
  // 기존 status/regenCount 축 경합 테스트와 같은 패턴을 body 축에 추가한다.
  it("submit 성공 진행 중 body 가 바뀌면(가짜 db.update 0행 목킹) 409 를 돌려주고 content_history 는 쓰지 않는다 — body 축 경합(status/regenCount 축과 별개)", async () => {
    const staleRow = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const freshRow = contentRow({ status: "draft", body: "동시에 editContent 가 바꾼 새 본문" });
    const { db, update, insert } = createDbMock({
      contentRows: [staleRow],
      contentRowsSequence: [[staleRow], [freshRow]],
      ruleRows: [],
      updateReturningResult: [], // body 가드에 걸려 0행
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "draft", action: "submit" });
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("BLOCKED_TERMS_REMAIN — submit 시 차단 등급 표현이 남아 있으면 422 를 돌려주고, 상태는 바꾸지 않되 detectedTerms 는 갱신하는 UPDATE(status 가드 포함)를 호출한다", async () => {
    const row = contentRow({ status: "draft", body: "당뇨 완치 프로젝트 본문" });
    const { db, update, insert, updateSetCalls, updateWhereCalls } = createDbMock({
      contentRows: [row],
      ruleRows: [CURE_BAN_RULE],
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BLOCKED_TERMS_REMAIN");
      expect(result.error.details).toMatchObject({
        blocks: [expect.objectContaining({ matched: "완치" })],
      });
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({
      detectedTerms: expect.objectContaining({ blocks: expect.any(Array) }),
    });
    expect(updateSetCalls[0]).not.toHaveProperty("status");
    // 이 UPDATE 도 .where() 가 호출됐다(id=contentId AND status=row.status 가드) — 인자가 있는
    // (0-arg 가 아닌) 호출이었는지를 본다.
    expect(updateWhereCalls[0]).toBeTruthy();
    // 차단으로 끝났으니 이력 insert 는 일어나지 않는다.
    expect(insert).not.toHaveBeenCalled();
  });

  // 02 교차검증 major 수리 — 차단-거부(422) 분기의 detectedTerms 갱신 UPDATE 도 body 가드가
  // 걸린다. 동시에 editContent 가 본문을 차단어 없는 내용으로 고쳐 먼저 커밋하면, 이
  // UPDATE 가 SELECT 시점의(차단된) validation 을 이미 깨끗해진 본문 위에 덮어써 GET
  // 상세가 계속 "차단됨"으로 보이는 정합성 결함이 생긴다 — 0행이면 BLOCKED_TERMS_REMAIN
  // 대신 INVALID_TRANSITION(409, details 에 action 포함)을 반환하고 detectedTerms 도
  // 갱신되지 않는다(이미 0행이라 UPDATE 자체가 반영되지 않았다).
  it("submit 이 차단어 잔존(422)으로 끝나는 도중 body 가 바뀌면(가짜 db.update 0행 목킹) INVALID_TRANSITION(409)으로 바뀌고 detectedTerms 갱신도 안 된다", async () => {
    const row = contentRow({ status: "draft", body: "당뇨 완치 프로젝트 본문" });
    const { db, update, insert } = createDbMock({
      contentRows: [row],
      ruleRows: [CURE_BAN_RULE],
      updateReturningResult: [], // detectedTerms 갱신 UPDATE 가 body 가드에 걸려 0행
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "draft", action: "submit" });
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("submit 성공(draft→in_review, 차단 0건) — 상태 UPDATE(낙관적 잠금)가 성공을 확인한 뒤에만(ADR-002) db.insert(contentHistory).values() 로 이력이 쓰이고, count+1 이 historyCount 로, contents.submittedAt 이 설정된다", async () => {
    const row = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const { db, update, insert, updateSetCalls, insertValuesCalls } = createDbMock({
      contentRows: [row],
      ruleRows: [],
      historyCountRows: [{ count: 4 }],
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("in_review");
      expect(result.data.historyCount).toBe(5); // count(4) + 1
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "in_review" });
    expect(updateSetCalls[0]).toHaveProperty("submittedAt");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(schema.contentHistory);
    expect(insertValuesCalls[0]).toMatchObject({
      contentId: 1,
      versionNo: 5,
      reason: "submit",
      title: row.title,
      body: row.body,
    });
    // ADR-002: UPDATE(낙관적 잠금)가 먼저 호출되고, 그 성공을 확인한 뒤에만 insert 가 호출된다
    // (raw SQL 원자 INSERT...SELECT 가 아니다).
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it("submit 성공(rejected→in_review) — draft 와 별도로 rejected 출발도 허용된다", async () => {
    const row = contentRow({ status: "rejected", body: "깨끗한 본문입니다." });
    const { db, update, insert, updateSetCalls } = createDbMock({
      contentRows: [row],
      ruleRows: [],
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.historyCount).toBe(1); // count(0)+1
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "in_review" });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("submit 은 role=admin 이 호출해도 허용된다(누구나, API_SPEC.md — submit 은 role 제한이 없다)", async () => {
    const row = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const { db, update } = createDbMock({ contentRows: [row], ruleRows: [] });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "admin" });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("cancel_review 성공(in_review→draft, role=editor) — 기존에 submittedAt 이 있던 콘텐츠도 submittedAt 을 null 로 초기화하고 이력은 쓰지 않는다", async () => {
    const row = contentRow({ status: "in_review", submittedAt: new Date("2026-09-15T00:02:00Z") });
    const { db, update, insert, updateSetCalls } = createDbMock({
      contentRows: [row],
      historyCountRows: [{ count: 3 }],
    });

    const result = await transition({ db, ...DEPS }, 1, "cancel_review", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("draft");
      expect(result.data.submittedAt).toBeNull();
      expect(result.data.historyCount).toBe(3);
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "draft", submittedAt: null });
    // history_reason enum(src/lib/db/schema.ts)에 'cancel_review' 값이 없다 — 이력 insert 없음.
    expect(insert).not.toHaveBeenCalled();
  });

  it("cancel_review 는 resolveRules 를 호출하지 않는다(재검증이 필요 없는 되돌리기)", async () => {
    const row = contentRow({ status: "in_review" });
    const { db } = createDbMock({ contentRows: [row] });

    await transition({ db, ...DEPS }, 1, "cancel_review", { role: "editor" });

    expect(resolveRules).not.toHaveBeenCalled();
  });

  it("resolveRules 가 실패(NOT_FOUND)를 돌려주면 submit 은 그 실패를 그대로 전파하고 아무 것도 쓰지 않는다", async () => {
    const row = contentRow({ status: "draft", channelId: 999 });
    const { db, update, insert } = createDbMock({ contentRows: [row], channelRows: [] });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(resolveRules).toHaveBeenCalledWith(
      { db, ...DEPS },
      { channelId: 999, lang: "ko", productId: undefined },
    );
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("productId: null 인 행은 resolveRules 에 productId: undefined 로 전달된다", async () => {
    const row = contentRow({ status: "draft", productId: null, body: "깨끗한 본문입니다." });
    const { db } = createDbMock({ contentRows: [row], ruleRows: [] });

    await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(resolveRules).toHaveBeenCalledWith(
      { db, ...DEPS },
      { channelId: row.channelId, lang: "ko", productId: undefined },
    );
  });

  // -------------------------------------------------------------------------
  // approve / reject — FR-010·FR-011(런 20260915-2042-728c).
  // -------------------------------------------------------------------------

  it("approve: in_review→approved 성공 — reviewerId·reviewedAt 이 채워지고, rejectReason 이 null 로 초기화되며(F-2 수리 — 비어있지 않던 값이었던 픽스처), submittedAt 은 row 그대로 보존된다(F-1 수리)", async () => {
    const submittedAt = new Date("2026-09-10T00:00:00Z");
    const row = contentRow({ status: "in_review", rejectReason: "이전 반려 사유", submittedAt });
    const reviewedAt = new Date("2026-09-15T01:00:00Z");
    const { db, update, updateSetCalls } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 42 }],
      updateReturningResult: [
        {
          updatedAt: reviewedAt,
          submittedAt,
          reviewerId: 42,
          reviewedAt,
          rejectReason: null,
        },
      ],
    });

    const result = await transition({ db, ...DEPS }, 1, "approve", { role: "admin" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.reviewerId).toBe(42);
      expect(result.data.reviewedAt).toBe(reviewedAt.toISOString());
      expect(result.data.rejectReason).toBeNull();
      expect(result.data.submittedAt).toBe(submittedAt.toISOString());
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "approved", rejectReason: null });
  });

  it("reject: in_review→rejected 성공 + extra.reason — rejectReason·reviewerId·reviewedAt 이 반영되고, submittedAt 은 row 그대로 보존된다(F-1 수리)", async () => {
    const submittedAt = new Date("2026-09-11T00:00:00Z");
    const row = contentRow({ status: "in_review", submittedAt });
    const reviewedAt = new Date("2026-09-15T02:00:00Z");
    const { db, update, updateSetCalls } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 7 }],
      updateReturningResult: [
        {
          updatedAt: reviewedAt,
          submittedAt,
          reviewerId: 7,
          reviewedAt,
          rejectReason: "표현 수정 필요",
        },
      ],
    });

    const result = await transition({ db, ...DEPS }, 1, "reject", { role: "admin" }, { reason: "표현 수정 필요" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("rejected");
      expect(result.data.rejectReason).toBe("표현 수정 필요");
      expect(result.data.reviewerId).toBe(7);
      expect(result.data.reviewedAt).toBe(reviewedAt.toISOString());
      expect(result.data.submittedAt).toBe(submittedAt.toISOString());
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "rejected", rejectReason: "표현 수정 필요" });
  });

  it("FORBIDDEN_ROLE — approve 를 role=editor 가 호출하면 거부된다({required:'admin'}), UPDATE 미실행", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, update } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "approve", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN_ROLE");
      expect(result.error.details).toEqual({ required: "admin" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("FORBIDDEN_ROLE — reject 를 role=editor 가 호출하면 거부된다({required:'admin'})", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, update } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "reject", { role: "editor" }, { reason: "사유" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN_ROLE");
      expect(result.error.details).toEqual({ required: "admin" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it.each(["draft", "approved", "rejected", "published"] as const)(
    "INVALID_TRANSITION — approve 를 status='%s' 인 행에 호출하면 409 다",
    async (status) => {
      const row = contentRow({ status });
      const { db, update } = createDbMock({ contentRows: [row] });

      const result = await transition({ db, ...DEPS }, 1, "approve", { role: "admin" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        expect(result.error.details).toEqual({ from: status, action: "approve" });
      }
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("INVALID_TRANSITION — reject 를 in_review 가 아닌 상태(draft)에 호출하면 409 다", async () => {
    const row = contentRow({ status: "draft" });
    const { db, update } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "reject", { role: "admin" }, { reason: "사유" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "draft", action: "reject" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("INVALID_TRANSITION(동시성 충돌) — approve 의 최종 UPDATE 가 0행을 반환하면 최신 상태로 다시 읽어 그 값 기준 INVALID_TRANSITION 을 반환하고, content_history 에는 아무 것도 쓰지 않는다", async () => {
    const staleRow = contentRow({ status: "in_review" });
    const freshRow = contentRow({ status: "rejected" });
    const { db, update, insert } = createDbMock({
      contentRows: [staleRow],
      contentRowsSequence: [[staleRow], [freshRow]],
      userRows: [{ id: 1 }],
      updateReturningResult: [],
    });

    const result = await transition({ db, ...DEPS }, 1, "approve", { role: "admin" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.details).toEqual({ from: "rejected", action: "approve" });
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("approve: admin 시드 유저가 없을 때(resolveActorUserId 가 null 을 반환) → reviewerId:null 로 성공한다(에러 아님)", async () => {
    const row = contentRow({ status: "in_review" });
    const { db } = createDbMock({
      contentRows: [row],
      userRows: [],
      updateReturningResult: [
        {
          updatedAt: new Date("2026-09-15T03:00:00Z"),
          submittedAt: row.submittedAt,
          reviewerId: null,
          reviewedAt: new Date("2026-09-15T03:00:00Z"),
          rejectReason: null,
        },
      ],
    });

    const result = await transition({ db, ...DEPS }, 1, "approve", { role: "admin" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.reviewerId).toBeNull();
    }
  });

  it("approve 성공 시 content_history insert 가 호출되지 않는다(F-3-new)", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, insert } = createDbMock({ contentRows: [row], userRows: [{ id: 1 }] });

    const result = await transition({ db, ...DEPS }, 1, "approve", { role: "admin" });

    expect(result.ok).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  it("reject 성공 시 content_history insert 가 호출되지 않는다(F-3-new — approve 와 대칭)", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, insert } = createDbMock({ contentRows: [row], userRows: [{ id: 1 }] });

    const result = await transition({ db, ...DEPS }, 1, "reject", { role: "admin" }, { reason: "사유" });

    expect(result.ok).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("resolveContentLink", () => {
  it("채널이 있으면 buildUtmLink 로 링크를 계산해 돌려준다", async () => {
    const { db } = createDbMock({ contentRows: [], channelRows: [CHANNEL_ROW], productRows: [] });
    const row = contentRow({ id: 501, channelId: 10, productId: null });

    const link = await resolveContentLink({ db, ...DEPS }, row);

    expect(link).toContain("utm_source=kakao");
    expect(link).toContain("c-501");
  });

  it("채널을 못 찾으면(방어적 케이스) 예외를 던지지 않고 빈 문자열을 반환한다", async () => {
    const { db } = createDbMock({ contentRows: [], channelRows: [] });
    const row = contentRow({ id: 501, channelId: 999, productId: null });

    const link = await resolveContentLink({ db, ...DEPS }, row);

    expect(link).toBe("");
  });

  it("linkPolicy='none' 이면 빈 문자열을 반환한다", async () => {
    const noneChannel: ChannelRow = { ...CHANNEL_ROW, linkPolicy: "none" };
    const { db } = createDbMock({ contentRows: [], channelRows: [noneChannel] });
    const row = contentRow({ id: 501, channelId: 10, productId: null });

    const link = await resolveContentLink({ db, ...DEPS }, row);

    expect(link).toBe("");
  });
});

describe("getContentDetail", () => {
  it("존재하는 id 면 resolveContentLink 와 historyCount 를 조립해 Result.ok(ContentDetail) 을 반환한다", async () => {
    const row = contentRow({ id: 501, channelId: 10, productId: null });
    const { db } = createDbMock({
      contentRows: [row],
      channelRows: [CHANNEL_ROW],
      historyCountRows: [{ count: 2 }],
    });

    const result = await getContentDetail({ db, ...DEPS }, 501);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(501);
      expect(result.data.status).toBe("draft");
      expect(result.data.link).toContain("utm_source=kakao");
      expect(result.data.link).toContain("c-501");
      expect(result.data.historyCount).toBe(2);
    }
  });

  it("NOT_FOUND — 존재하지 않는 contentId 면 NOT_FOUND 를 반환한다", async () => {
    const { db } = createDbMock({ contentRows: [] });

    const result = await getContentDetail({ db, ...DEPS }, 999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.details).toEqual({ resource: "content", id: 999 });
    }
  });

  it("DB 조회 중 예외가 발생하면 INTERNAL 을 반환한다", async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error("connection lost");
      }),
    } as unknown as Db;

    const result = await getContentDetail({ db, ...DEPS }, 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  // ---------------------------------------------------------------------------
  // channelFormat — FR-012(채널 형식 변환) 계약 「유닛 · getContentDetail」: status가
  // approved 일 때만 resolveChannelFormat 을 호출해 채운다. 그 외 상태는 null.
  // ---------------------------------------------------------------------------

  it("status='approved' 면 channelFormat 을 계산해 채운다(linkPolicy='inline' — link 가 본문 끝에 붙는다)", async () => {
    const row = contentRow({ id: 501, status: "approved", channelId: 10, productId: null, body: "승인된 본문입니다." });
    const { db } = createDbMock({
      contentRows: [row],
      channelRows: [{ ...CHANNEL_ROW, writeUrl: "https://blog.naver.com/write" }],
      historyCountRows: [{ count: 2 }],
    });

    const result = await getContentDetail({ db, ...DEPS }, 501);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.channelFormat).not.toBeNull();
      expect(result.data.channelFormat?.body).toBe(`${row.body}\n\n${result.data.link}`);
      expect(result.data.channelFormat?.hashtags).toEqual([]);
      expect(result.data.channelFormat?.writeUrl).toBe("https://blog.naver.com/write");
    }
  });

  it.each(["draft", "in_review", "rejected", "published"] as const)(
    "status='%s' 면(approved 가 아니면) channelFormat 은 null 이다",
    async (status) => {
      const row = contentRow({ id: 501, status, channelId: 10 });
      const { db } = createDbMock({ contentRows: [row], channelRows: [CHANNEL_ROW] });

      const result = await getContentDetail({ db, ...DEPS }, 501);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.channelFormat).toBeNull();
    },
  );

  it("status='approved' 인데 채널을 찾을 수 없으면(방어적 케이스) channelFormat 은 null 이고 전체 요청은 계속 성공한다", async () => {
    const row = contentRow({ id: 501, status: "approved", channelId: 999 });
    const { db } = createDbMock({ contentRows: [row], channelRows: [] });

    const result = await getContentDetail({ db, ...DEPS }, 501);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.channelFormat).toBeNull();
      expect(result.data.link).toBe(""); // resolveContentLink 도 같은 방어적 응답
    }
  });
});

// -----------------------------------------------------------------------------
// approveContent — FR-010·FR-011(런 20260915-2042-728c) 「유닛 ·
// approveContent(deps, contentId, actor, registerAsExample)」. transition() 의 approve
// 경로를 내부에서 타므로 위 승인 성공 테스트와 같은 db 배선(users·brandExamples)을 쓴다.
// 본문을 800자보다 짧게 유지해(F-3-new 와 무관하게) summary 계산 방식(전체 슬라이스 여부)에
// 상관없이 summary === row.body 로 단정할 수 있게 한다.
// -----------------------------------------------------------------------------

describe("approveContent", () => {
  it("registerAsExample=false → exampleRegistered:false, exampleSkippedReason:null, brandExamples insert 는 호출되지 않는다", async () => {
    const row = contentRow({ status: "in_review", channelId: 10, lang: "ko" });
    const { db, insert } = createDbMock({ contentRows: [row], userRows: [{ id: 1 }] });

    const result = await approveContent({ db, ...DEPS }, 1, { role: "admin" }, false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.exampleRegistered).toBe(false);
      expect(result.data.exampleSkippedReason).toBeNull();
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("registerAsExample=true, detectedTerms.warns=[] → brandExamples.insert 호출 인자(contentId·channelId·lang·summary·reason:'admin_approval')가 맞고 exampleRegistered:true 다", async () => {
    const row = contentRow({
      status: "in_review",
      channelId: 10,
      lang: "ko",
      body: "짧은 본문",
      detectedTerms: { blocks: [], warns: [], missing: [] },
    });
    const { db, brandExampleInsertCalls } = createDbMock({ contentRows: [row], userRows: [{ id: 1 }] });

    const result = await approveContent({ db, ...DEPS }, 1, { role: "admin" }, true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.exampleRegistered).toBe(true);
      expect(result.data.exampleSkippedReason).toBeNull();
    }
    expect(brandExampleInsertCalls).toHaveLength(1);
    expect(brandExampleInsertCalls[0]).toMatchObject({
      contentId: 1,
      channelId: 10,
      lang: "ko",
      summary: "짧은 본문",
      reason: "admin_approval",
    });
  });

  it("registerAsExample=true, detectedTerms.warns.length>0 → 승인 전이는 성공하되 exampleRegistered:false, exampleSkippedReason='경고 표현이 있어 예시로 등록하지 않았습니다.', insert 는 호출되지 않는다", async () => {
    const row = contentRow({
      status: "in_review",
      detectedTerms: { blocks: [], warns: [{ matched: "다이어트", rule: 1 }], missing: [] },
    });
    const { db, insert } = createDbMock({ contentRows: [row], userRows: [{ id: 1 }] });

    const result = await approveContent({ db, ...DEPS }, 1, { role: "admin" }, true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.exampleRegistered).toBe(false);
      expect(result.data.exampleSkippedReason).toBe("경고 표현이 있어 예시로 등록하지 않았습니다.");
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("brandExamples.insert 가 예외를 던지면 transition() 은 이미 성공했으므로 ok:true 를 유지하고, exampleRegistered:false·exampleSkippedReason='예시 등록 중 오류가 발생했습니다.' 를 반환한다", async () => {
    const row = contentRow({
      status: "in_review",
      detectedTerms: { blocks: [], warns: [], missing: [] },
    });
    const { db } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 1 }],
      brandExampleInsertShouldThrow: true,
    });

    const result = await approveContent({ db, ...DEPS }, 1, { role: "admin" }, true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.exampleRegistered).toBe(false);
      expect(result.data.exampleSkippedReason).toBe("예시 등록 중 오류가 발생했습니다.");
    }
  });

  // FR-012(채널 형식 변환) 계약 「유닛 · approveContent」: transition() 이 성공(approved 로
  // 전이)하면 같은 방식으로 channelFormat 을 계산해 ApproveResult 에 포함한다.
  it("승인 성공 시 응답에 channelFormat 이 포함된다(F-012)", async () => {
    const row = contentRow({ status: "in_review", channelId: 10, lang: "ko", body: "짧은 본문" });
    const { db } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 1 }],
      channelRows: [{ ...CHANNEL_ROW, writeUrl: "https://blog.naver.com/write" }],
    });

    const result = await approveContent({ db, ...DEPS }, 1, { role: "admin" }, false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("approved");
      expect(result.data.channelFormat).not.toBeNull();
      expect(result.data.channelFormat?.writeUrl).toBe("https://blog.naver.com/write");
    }
  });
});

// -----------------------------------------------------------------------------
// transition(action: "publish") — FR-013 계약(_workspace/contract_fr-013-publish.md)
// 「유닛 · transition」. 기존 describe("transition") 블록·DEPS 상수는 건드리지 않고, publish
// 전용 호출에서만 `{ ...DEPS, urlChecker: mockChecker }` 로 개별 주입한다(다른 액션 테스트는
// 여전히 urlChecker 없는 DEPS 를 그대로 쓴다). urlChecker 는 실제 네트워크를 타지 않는 순수
// mock(`{ check: vi.fn() }`)이다 — createUrlChecker() 자체의 fetch 동작은 url-check.test.ts 가
// 이미 덮는다.
// -----------------------------------------------------------------------------

function urlCheckerMock(result: "ok" | "unreachable" | "skipped") {
  return { check: vi.fn().mockResolvedValue(result) };
}

describe("transition — publish", () => {
  it("approved→published 허용 — publishedUrl·urlCheck·publishedAt·publisherId 가 저장된다", async () => {
    const row = contentRow({ status: "approved" });
    const publishedAt = new Date("2026-09-16T00:00:00Z");
    const checker = urlCheckerMock("ok");
    const { db, update, updateSetCalls } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 5 }],
      updateReturningResult: [
        {
          updatedAt: publishedAt,
          publishedUrl: "https://blog.naver.com/post/1",
          urlCheck: "ok",
          publishedAt,
          publisherId: 5,
        },
      ],
    });

    const result = await transition(
      { db, ...DEPS, urlChecker: checker },
      1,
      "publish",
      { role: "editor" },
      { publishedUrl: "https://blog.naver.com/post/1" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("published");
      expect(result.data.publishedUrl).toBe("https://blog.naver.com/post/1");
      expect(result.data.urlCheck).toBe("ok");
      expect(result.data.publisherId).toBe(5);
      expect(result.data.publishedAt).toBe(publishedAt.toISOString());
    }
    expect(checker.check).toHaveBeenCalledWith("https://blog.naver.com/post/1");
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "published", urlCheck: "ok" });
  });

  it.each(["draft", "in_review", "rejected", "published"] as const)(
    "INVALID_TRANSITION — publish 를 status='%s' 인 행에 호출하면 409 다(urlChecker 는 호출되지 않는다)",
    async (status) => {
      const row = contentRow({ status });
      const checker = urlCheckerMock("ok");
      const { db, update } = createDbMock({ contentRows: [row] });

      const result = await transition(
        { db, ...DEPS, urlChecker: checker },
        1,
        "publish",
        { role: "editor" },
        { publishedUrl: "https://blog.naver.com/post/1" },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_TRANSITION");
        expect(result.error.details).toEqual({ from: status, action: "publish" });
      }
      expect(update).not.toHaveBeenCalled();
      expect(checker.check).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ok", "https://blog.naver.com/post/2"],
    ["unreachable", "https://blog.naver.com/post/3"],
    ["skipped", "https://blog.naver.com/post/4"],
  ] as const)(
    "urlChecker.check 가 '%s' 를 반환하면 urlCheck 컬럼에 그대로 저장된다",
    async (checkResult, publishedUrl) => {
      const row = contentRow({ status: "approved" });
      const checker = urlCheckerMock(checkResult);
      const { db, updateSetCalls } = createDbMock({
        contentRows: [row],
        userRows: [{ id: 1 }],
        updateReturningResult: [
          { updatedAt: new Date(), publishedUrl, urlCheck: checkResult, publishedAt: new Date(), publisherId: 1 },
        ],
      });

      const result = await transition(
        { db, ...DEPS, urlChecker: checker },
        1,
        "publish",
        { role: "editor" },
        { publishedUrl },
      );

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.urlCheck).toBe(checkResult);
      expect(updateSetCalls[0]).toMatchObject({ urlCheck: checkResult });
    },
  );

  it("publishedUrl 없이 호출해도 발행에 성공한다 — urlChecker.check 가 null 로 호출되고 urlCheck='skipped' 가 저장된다", async () => {
    const row = contentRow({ status: "approved" });
    const checker = urlCheckerMock("skipped");
    const { db, updateSetCalls } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 1 }],
      updateReturningResult: [
        { updatedAt: new Date(), publishedUrl: null, urlCheck: "skipped", publishedAt: new Date(), publisherId: 1 },
      ],
    });

    const result = await transition({ db, ...DEPS, urlChecker: checker }, 1, "publish", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.publishedUrl).toBeNull();
      expect(result.data.urlCheck).toBe("skipped");
    }
    expect(checker.check).toHaveBeenCalledWith(null);
    expect(updateSetCalls[0]).toMatchObject({ publishedUrl: null, urlCheck: "skipped" });
  });

  it("publish: 시드 유저가 없을 때(resolveActorUserId 가 null 반환) → publisherId:null 로 성공한다(에러 아님)", async () => {
    const row = contentRow({ status: "approved" });
    const checker = urlCheckerMock("ok");
    const { db } = createDbMock({
      contentRows: [row],
      userRows: [],
      updateReturningResult: [
        {
          updatedAt: new Date(),
          publishedUrl: "https://blog.naver.com/post/5",
          urlCheck: "ok",
          publishedAt: new Date(),
          publisherId: null,
        },
      ],
    });

    const result = await transition(
      { db, ...DEPS, urlChecker: checker },
      1,
      "publish",
      { role: "editor" },
      { publishedUrl: "https://blog.naver.com/post/5" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.publisherId).toBeNull();
  });

  it("urlChecker 를 넘기지 않으면 기본값 createUrlChecker() 를 쓴다 — publishedUrl 없이 호출하면 실제 네트워크를 타지 않고 urlCheck='skipped' 로 성공한다", async () => {
    const row = contentRow({ status: "approved" });
    const { db } = createDbMock({
      contentRows: [row],
      userRows: [{ id: 1 }],
      updateReturningResult: [
        { updatedAt: new Date(), publishedUrl: null, urlCheck: "skipped", publishedAt: new Date(), publisherId: 1 },
      ],
    });

    // urlChecker 를 deps 에 아예 넣지 않는다 — transition() 내부에서 createUrlChecker() 로
    // 기본값을 만든다(계약 「유닛」). publishedUrl 을 넘기지 않으므로 checker.check(null) 이
    // 호출되고, createUrlChecker() 의 실제 구현은 url 이 null 이면 fetch 를 시도하지 않고
    // 즉시 "skipped" 를 반환한다(url-check.test.ts 로 이미 검증) — 이 테스트는 실제 네트워크
    // 요청 없이 그 배선만 확인한다.
    const result = await transition({ db, ...DEPS }, 1, "publish", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.publishedUrl).toBeNull();
      expect(result.data.urlCheck).toBe("skipped");
    }
  });
});
