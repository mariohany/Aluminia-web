export function WindowElevationIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 480" fill="none" className={className} aria-hidden="true">
      {/* corner measurement ticks */}
      <path
        d="M20 60 h16 M20 60 v16 M380 60 h-16 M380 60 v16 M20 420 h16 M20 420 v-16 M380 420 h-16 M380 420 v-16"
        stroke="var(--muted-foreground)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />

      {/* outer frame */}
      <rect x="60" y="60" width="280" height="360" rx="4" stroke="var(--foreground)" strokeWidth="6" />

      {/* mullions */}
      <path d="M200 60 V420 M60 240 H340" stroke="var(--foreground)" strokeWidth="6" />
      <path d="M130 60 V240 M270 240 V420" stroke="var(--border)" strokeWidth="4" />

      {/* accent pane */}
      <rect x="72" y="72" width="116" height="156" rx="1" fill="var(--primary)" opacity="0.12" />
      <rect x="72" y="72" width="116" height="156" rx="1" stroke="var(--primary)" strokeWidth="2" />

      {/* glazing lines on remaining panes */}
      <path d="M212 72 L328 216 M328 72 L212 216" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M72 252 L188 408 M188 252 L72 408" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M212 252 L328 408 M328 252 L212 408" stroke="var(--border)" strokeWidth="1.5" />
    </svg>
  )
}
