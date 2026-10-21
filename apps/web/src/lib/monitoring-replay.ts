import { replayIntegration } from '@sentry/react'

// Sentry's session replay (docs/sentry_planing.md Q3), loaded on its own by
// monitoring.ts after the app has started. Kept in memory and sent only
// when an error happens. Text is visible (Mario, 2026-10-21); passwords
// are always masked; images, video and canvases (window drawings, the PDF
// preview) aren't recorded; no request or response bodies.
export function replay() {
  return replayIntegration({
    maskAllText: false,
    maskAllInputs: false,
    blockAllMedia: true,
  })
}
