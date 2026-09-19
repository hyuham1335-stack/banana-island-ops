import type { FxRailState } from "@/services/fx";
import { toFxRailView } from "@/lib/fx-rail";

/**
 * 상단바 환율 레일 — 계약(run 20260919-2343-1c04) 「화면 · FxRail」.
 * 서버 컴포넌트(클라이언트 훅 없음). 문구·숫자 포맷은 toFxRailView 가 만든다 —
 * 여기서 다시 만들지 않는다.
 */
export function FxRail({ state }: { state: FxRailState }) {
  const { text, stale, failed } = toFxRailView(state);

  return (
    <span className="fx-rail" data-failed={failed || undefined}>
      {text}
      {stale ? <span className="fx-rail-stale down">{stale}</span> : null}
    </span>
  );
}
