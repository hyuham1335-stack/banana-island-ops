import type { ReactNode } from "react";

/**
 * 제네릭 표 — 홈 대시보드(FR-016)에서 콘텐츠 목록·광고 요약 양쪽에 재사용한다.
 * 결과 없음은 rows.length === 0 일 때 <tbody> 안에 colSpan 행 하나로 렌더한다
 * (docs/UI_GUIDE.md 79행 규격) — 호출부가 <Empty> 로 바꿔치기하지 않는다.
 * 로딩·실패 상태는 이 컴포넌트가 다루지 않는다(호출부가 Result 분기로 처리).
 */
export function Table<T>({
  headers,
  rows,
  renderRow,
  emptyLabel,
}: {
  headers: string[];
  rows: T[];
  renderRow: (row: T) => ReactNode[];
  emptyLabel: string;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={headers.length}>{emptyLabel}</td>
          </tr>
        ) : (
          rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {renderRow(row).map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
