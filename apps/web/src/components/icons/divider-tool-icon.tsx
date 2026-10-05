import type { SVGProps } from 'react'

/** The editor pill's Divider tool: a window frame with a transom and a
 * mullion standing on it — the shape the tool draws. Drawn on lucide's
 * 24 grid with its 2px round stroke so it sits with Select and Hand
 * (Mario, 2026-10-05, option A). */
export function DividerToolIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 11h18" />
      <path d="M12 11v10" />
    </svg>
  )
}
