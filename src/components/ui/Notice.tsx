import type { ReactNode } from "react";

export function Notice({
  variant = "warn",
  children,
}: {
  variant?: "ok" | "bad" | "warn";
  children: ReactNode;
}) {
  const variantClass = variant === "warn" ? "" : ` ${variant}`;
  return <div className={`notice${variantClass}`}>{children}</div>;
}
