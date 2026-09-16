/**
 * 홈 대시보드(FR-016)의 KPI 표시 — Panel.tsx 와 같은 상태 없는 순수 프레젠테이셔널
 * 컴포넌트다. `now` 는 항상 실제 정수(0 포함) — 플레이스홀더로 쓰지 않는다
 * (docs/UI_GUIDE.md 안티패턴 표 "플레이스홀더 KPI" 금지).
 */
export function KpiBand({ label, now }: { label: string; now: number }) {
  return (
    <div className="kpi-band">
      <span className="kpi-now">{now}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
