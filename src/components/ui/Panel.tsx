import type { ReactNode } from "react";

export function Panel({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        {note ? <span className="panel-note">{note}</span> : null}
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
