/**
 * 상단바 — docs/UI_GUIDE.md 「컴포넌트 · Topbar」. 환율 레일·역할 전환은
 * 해당 기능(FX·role)이 아직 없어 넣지 않는다(최소 셸 범위).
 */
export function Topbar() {
  return (
    <header className="topbar">
      <span className="topbar-brand">
        <span className="topbar-mark" aria-hidden="true">
          BI
        </span>
        바나나아일랜드 운영
      </span>
    </header>
  );
}
