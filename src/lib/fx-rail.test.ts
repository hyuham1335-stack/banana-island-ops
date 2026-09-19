import { describe, expect, it } from "vitest";
import { toFxRailView, type FxRailState } from "./fx-rail";

// 계약: FR-022(런 20260919-2343-1c04) 「유닛 · lib/fx-rail.ts · toFxRailView」. 순수 함수,
// I/O 없음 — 문구·숫자 포맷의 유일한 출처. 화면(FxRail.tsx)은 이 결과만 렌더한다.

function okState(staleDays: number): FxRailState {
  return {
    kind: "ok",
    snapshot: {
      asOf: "2026-09-18",
      staleDays,
      rates: { usdKrw: "1380.50000000", phpKrw: "24.60784314" },
      source: "api",
    },
  };
}

describe("toFxRailView", () => {
  it("staleDays 0 이면 stale 은 null 이고 failed 는 false", () => {
    const view = toFxRailView(okState(0));
    expect(view.stale).toBeNull();
    expect(view.failed).toBe(false);
  });

  it("staleDays 2 면 stale 은 '2일 전 환율'", () => {
    expect(toFxRailView(okState(2)).stale).toBe("2일 전 환율");
  });

  it("staleDays 1 이면(경계값) stale 이 표시된다", () => {
    expect(toFxRailView(okState(1)).stale).toBe("1일 전 환율");
  });

  it("숫자는 천 단위 쉼표·소수 2자리로 포맷하고 MM-DD 기준을 뒤에 붙인다", () => {
    expect(toFxRailView(okState(0)).text).toBe("USD→KRW 1,380.50 · PHP→KRW 24.61 · 09-18 기준");
  });

  it("unavailable 상태면 고정 문구·failed:true·stale:null 을 돌려준다", () => {
    expect(toFxRailView({ kind: "unavailable" })).toEqual({
      text: "환율을 불러오지 못했습니다",
      stale: null,
      failed: true,
    });
  });
});
