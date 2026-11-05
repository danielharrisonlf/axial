import type { CSSProperties } from "react";
export function Icon({ name, size = 16, style }: { name: string; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <use href={`/icons.svg#${name}`} />
    </svg>
  );
}
