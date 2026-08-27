import * as React from 'react'

/**
 * A four-pane window with a glass-reflection glint in each pane — same
 * visual language as lucide's icons (24×24, `currentColor` stroke,
 * round caps/joins) so it drops into the toolbar next to them without
 * looking out of place. Custom because no stock lucide icon has the
 * reflection detail.
 */
export const WindowPaneIcon = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  function WindowPaneIcon({ className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M12 3v18" />
        <path d="M3 12h18" />
        <g strokeWidth={1}>
          <path d="M7 9 9 7" />
          <path d="M8.5 9 9 8.5" />
          <path d="M16 9 18 7" />
          <path d="M17.5 9 18 8.5" />
          <path d="M7 18 9 16" />
          <path d="M8.5 18 9 17.5" />
          <path d="M16 18 18 16" />
          <path d="M17.5 18 18 17.5" />
        </g>
      </svg>
    )
  },
)
