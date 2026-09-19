import type { FxSnapshot } from "@/services/fx";

/**
 * FR-022 상단 레일 뷰 변환 — 계약(run 20260919-2343-1c04). 순수 함수, I/O 없음.
 * 문구·숫자 포맷은 이 파일이 유일한 출처 — 화면(FxRail.tsx)은 이 결과만 렌더한다.
 */

export type FxRailState = { kind: "ok"; snapshot: FxSnapshot } | { kind: "unavailable" };

export interface FxRailView {
  text: string;
  stale: string | null;
  failed: boolean;
}

function formatKrw(value: string): string {
  return Number(value).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function toFxRailView(state: FxRailState): FxRailView {
  if (state.kind === "unavailable") {
    return { text: "환율을 불러오지 못했습니다", stale: null, failed: true };
  }

  const { snapshot } = state;
  const [, month, day] = snapshot.asOf.split("-");
  const text = `USD→KRW ${formatKrw(snapshot.rates.usdKrw)} · PHP→KRW ${formatKrw(snapshot.rates.phpKrw)} · ${month}-${day} 기준`;
  const stale = snapshot.staleDays >= 1 ? `${snapshot.staleDays}일 전 환율` : null;

  return { text, stale, failed: false };
}
