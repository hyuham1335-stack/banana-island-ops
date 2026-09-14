"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
  /** disabled 일 때 옆에 보여줄 사유 문구 — docs/UI_GUIDE.md 「Button」. */
  disabledReason?: string;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "",
  ghost: " ghost",
  danger: " danger",
};

export function Button({
  variant = "primary",
  small = false,
  disabledReason,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = `btn${VARIANT_CLASS[variant]}${small ? " small" : ""}${
    className ? ` ${className}` : ""
  }`;
  return (
    <span>
      <button className={classes} {...rest}>
        {children}
      </button>
      {rest.disabled && disabledReason ? (
        <span className="btn-disabled-reason">{disabledReason}</span>
      ) : null}
    </span>
  );
}
