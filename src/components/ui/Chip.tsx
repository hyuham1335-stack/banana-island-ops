"use client";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

/** 단일 선택 칩 그룹 — docs/UI_GUIDE.md 「Chip」. */
export function Chip<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="chip-group" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="chip"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
