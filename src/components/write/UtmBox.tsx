/**
 * 발행용 링크 표시 — docs/UI_GUIDE.md 「UtmBox」. `.utm` 박스 자체(배경·버튼 행)는
 * GenPanel 이 감싼다 — 이 컴포넌트는 라벨+URL(또는 링크 없음 안내)만 낸다.
 */
export function UtmBox({ link }: { link: string | null }) {
  if (link === null) {
    return (
      <>
        <div className="utm-label">발행용 링크</div>
        <p className="panel-note">이 채널은 본문 링크를 넣지 않습니다 · 프로필 링크</p>
      </>
    );
  }

  const queryIndex = link.indexOf("?");
  const base = queryIndex === -1 ? link : link.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : link.slice(queryIndex + 1);

  return (
    <>
      <div className="utm-label">
        발행용 링크 <span className="panel-note">본문 생성 전에 만들어 템플릿 변수 {"{링크}"}로 넘겼습니다</span>
      </div>
      <div className="utm-url">
        {base}
        {query ? (
          <>
            ?<b>{query}</b>
          </>
        ) : null}
      </div>
    </>
  );
}
