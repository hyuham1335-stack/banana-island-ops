import { beforeEach, describe, expect, it, vi } from "vitest";

// 계약: FR-009(런 20260915-1754-5568) 「유닛 · src/services/content-workflow.ts ·
// listContents()·transition()·resolveContentLink()」— 05 리뷰 수리 라운드로 실제 구현이
// 옛 계약(라우트 인라인 조회, insert(contentHistory).values() 직접 호출)에서 아래로 바뀌어
// 이 스위트도 다시 썼다(추측이 아니라 src/services/content-workflow.ts 를 직접 읽어 확정).
//
// 외부 경계(계약): resolveRules·validate·buildUtmLink 는 실물 그대로 통과시킨다(내부 위임이지
// 외부 경계가 아니다). resolveRules 의 호출 여부·인자를 관측해야 하는 케이스가 있어
// content-generation.test.ts 와 같은 vi.mock(importOriginal) 스파이 패턴을 그대로 쓴다.
// DB(drizzle)는 content-generation.test.ts 의 makeChainNode 패턴을 재사용해 모킹한다.
//
//   - listContents(deps: {db}, query: {status?, mine}, actor) — GET /api/contents 목록 조회가
//     라우트에서 여기로 옮겨졌다. mine=true 면 select({id}).from(users).where(role=actor.role)
//     로 유저를 찾고, 없으면(그 역할의 유저가 아직 없음) contents 조회 자체를 하지 않고 즉시
//     [] 를 반환한다(결과 없음, 실패 아님). status·authorId 조건이 하나도 없으면 contents
//     쿼리에 .where() 자체가 호출되지 않는다. detectedTerms(jsonb)의 warns.length 를
//     warnCount 로 매핑하고, updatedAt·submittedAt 은 ISO 문자열로 바꾼다.
//   - transition(deps: {db, productBaseUrl}, contentId, action, actor) — 4개 위치 인자.
//   - resolveContentLink(deps: {db, productBaseUrl}, row) — deps 그대로.
//   - resolveRules 는 transition() 의 deps({db, productBaseUrl})를 그대로 넘겨 호출한다
//     (resolveRules 는 db 만 쓰지만 구조적 타이핑상 그대로 통과된다).
//   - 조회 순서: select().from(contents) 로 대상 행 전체 → (submit 이면) resolveRules →
//     validate → 차단 있으면 update(contents).set({detectedTerms, updatedAt}).where(...) 만
//     하고 반환(BLOCKED_TERMS_REMAIN) → 차단 없으면 versionNo 계산과 INSERT 를
//     `db.execute(sql\`INSERT ... SELECT ... RETURNING version_no\`)` 원자 문 하나로 처리한다
//     (count(*) 후 insert(contentHistory).values() 두 단계가 아니다 — 동시 submit 이 같은
//     versionNo 를 계산하는 것을 막는다) → update(contents).set({status, updatedAt,
//     submittedAt, detectedTerms}).where(id=contentId AND status=row.status).returning() —
//     AND status=row.status 가 lost-update 가드다. .returning() 이 0행이면(다른 요청이 먼저
//     상태를 바꿨다) 다시 select().from(contents) 로 최신 행을 읽어 그 status 기준
//     INVALID_TRANSITION 을 반환한다(덮어쓰지 않는다). cancel_review 는 resolveRules 를
//     건너뛰고 바로 같은 가드가 걸린 update(contents).set({status, updatedAt}).where(id=
//     contentId AND status=row.status).returning() 한 뒤 select({count}).from(contentHistory)
//     로 historyCount 를 다시 구한다(submit 과 달리 이미 계산해둔 값이 없어서, 그리고
//     history_reason enum 에 'cancel_review' 값이 없어 이력 자체를 쓰지 않는다).
//   - FORBIDDEN_ROLE details = { required: "editor" }(cancel_review 만 role 제한).
//   - INVALID_TRANSITION details = { from: row.status, action } — 동시성 충돌 경로에서는
//     row.status 가 아니라 재조회한 최신 status 를 쓴다.
//   - BLOCKED_TERMS_REMAIN details = { blocks: validation.blocks }.

vi.mock("@/services/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rules")>();
  return { ...actual, resolveRules: vi.fn(actual.resolveRules) };
});

import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { ContentsRow } from "@/lib/content-detail";
import type { BrandRuleRow } from "@/lib/rules-merge";
import { resolveRules } from "@/services/rules";
import { listContents, resolveContentLink, transition } from "./content-workflow";

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
  executeResult?: { version_no: number }[];
}) {
  const updateSetCalls: unknown[] = [];
  const executeCalls: unknown[] = [];
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
      throw new Error(`unexpected select().from() table in test mock: ${String(table)}`);
    }),
  }));

  const update = vi.fn((table: unknown) => {
    if (table !== schema.contents) throw new Error("unexpected update() table in test mock");
    return {
      set: vi.fn((vals: unknown) => {
        updateSetCalls.push(vals);
        return {
          where: vi.fn(() => ({
            // set().where() 자체가 await 될 수도 있고(BLOCKED_TERMS_REMAIN 경로),
            // .returning() 이 더 붙을 수도 있다(성공 경로・lost-update 0행 경로) — 둘 다 지원한다.
            then: (resolve: (v: unknown) => void) => resolve([]),
            catch: () => {},
            returning: vi.fn(() => makeChainNode(opts.updateReturningResult ?? [DEFAULT_RETURNING_ROW])),
          })),
        };
      }),
    };
  });

  // content_history 의 versionNo 계산+삽입이 INSERT...SELECT 원자 문(raw SQL, deps.db.execute)
  // 으로 바뀌었다 — db.insert(contentHistory).values() 는 더 이상 프로덕션 코드가 호출하지 않는다.
  const execute = vi.fn(async (query: unknown) => {
    executeCalls.push(query);
    return { rows: opts.executeResult ?? [{ version_no: 1 }] };
  });

  return {
    db: { select, update, execute } as unknown as Db,
    select,
    update,
    execute,
    updateSetCalls,
    executeCalls,
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

describe("transition", () => {
  it("NOT_FOUND — 존재하지 않는 contentId 면 NOT_FOUND 를 돌려주고 아무 것도 쓰지 않는다", async () => {
    const { db, update, execute } = createDbMock({ contentRows: [] });

    const result = await transition({ db, ...DEPS }, 999, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(update).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
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

  it("INVALID_TRANSITION(동시성 충돌) — 최종 UPDATE 가 0행을 반환하면(다른 요청이 먼저 상태를 바꿨다) 최신 상태로 다시 읽어 그 값 기준 INVALID_TRANSITION 을 반환하고 조용히 덮어쓰지 않는다", async () => {
    const staleRow = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const freshRow = contentRow({ status: "in_review" });
    const { db, update, execute } = createDbMock({
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
    // 이력 insert(execute)는 정상 실행됐지만(차단 없음) 최종 UPDATE 는 가드에 걸려 0행 —
    // update() 자체는 1번(최종 UPDATE)만 호출된다(재조회는 select 이지 update 가 아니다).
    expect(update).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("BLOCKED_TERMS_REMAIN — submit 시 차단 등급 표현이 남아 있으면 422 를 돌려주고, 상태는 바꾸지 않되 detectedTerms 는 갱신하는 UPDATE 를 호출한다", async () => {
    const row = contentRow({ status: "draft", body: "당뇨 완치 프로젝트 본문" });
    const { db, update, execute, updateSetCalls } = createDbMock({
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
    // 차단으로 끝났으니 이력 execute(INSERT...SELECT) 는 일어나지 않는다.
    expect(execute).not.toHaveBeenCalled();
  });

  it("submit 성공(draft→in_review, 차단 0건) — content_history 에 INSERT...SELECT(execute) 원자 문으로 이력이 쓰이고 그 versionNo 가 historyCount 로, contents.submittedAt 이 설정된다", async () => {
    const row = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const { db, update, execute, updateSetCalls } = createDbMock({
      contentRows: [row],
      ruleRows: [],
      executeResult: [{ version_no: 5 }],
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("in_review");
      // db.execute() 가 돌려준 version_no 가 그대로 historyCount 로 쓰인다.
      expect(result.data.historyCount).toBe(5);
    }
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "in_review" });
    expect(updateSetCalls[0]).toHaveProperty("submittedAt");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("submit 성공(rejected→in_review) — draft 와 별도로 rejected 출발도 허용된다", async () => {
    const row = contentRow({ status: "rejected", body: "깨끗한 본문입니다." });
    const { db, update, execute, updateSetCalls } = createDbMock({
      contentRows: [row],
      ruleRows: [],
    });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.historyCount).toBe(1); // execute mock 기본값(version_no:1)
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "in_review" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("submit 은 role=admin 이 호출해도 허용된다(누구나, API_SPEC.md — submit 은 role 제한이 없다)", async () => {
    const row = contentRow({ status: "draft", body: "깨끗한 본문입니다." });
    const { db, update } = createDbMock({ contentRows: [row], ruleRows: [] });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "admin" });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("cancel_review 성공(in_review→draft, role=editor)", async () => {
    const row = contentRow({ status: "in_review" });
    const { db, update, execute, updateSetCalls } = createDbMock({ contentRows: [row] });

    const result = await transition({ db, ...DEPS }, 1, "cancel_review", { role: "editor" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("draft");
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "draft" });
    // history_reason enum(src/lib/db/schema.ts 58행)에 'cancel_review' 값이 없다 — 이력 execute 없음.
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancel_review 는 resolveRules 를 호출하지 않는다(재검증이 필요 없는 되돌리기)", async () => {
    const row = contentRow({ status: "in_review" });
    const { db } = createDbMock({ contentRows: [row] });

    await transition({ db, ...DEPS }, 1, "cancel_review", { role: "editor" });

    expect(resolveRules).not.toHaveBeenCalled();
  });

  it("resolveRules 가 실패(NOT_FOUND)를 돌려주면 submit 은 그 실패를 그대로 전파하고 아무 것도 쓰지 않는다", async () => {
    const row = contentRow({ status: "draft", channelId: 999 });
    const { db, update, execute } = createDbMock({ contentRows: [row], channelRows: [] });

    const result = await transition({ db, ...DEPS }, 1, "submit", { role: "editor" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(resolveRules).toHaveBeenCalledWith(
      { db, ...DEPS },
      { channelId: 999, lang: "ko", productId: undefined },
    );
    expect(update).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
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
