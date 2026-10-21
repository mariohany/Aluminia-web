// After a deploy, a tab opened before it still names the old build's
// files; loading one of them on demand (the PDF preview, say) fails, since
// the host answers a missing file with index.html. Vite reports that as
// `vite:preloadError`: reload once to pick up the new build. A second
// failure within RETRY_MS is a real one, so it goes on to the error
// boundary instead of reloading forever.

const KEY = 'aluminia.staleChunkReloadAt'
const RETRY_MS = 10_000

export function reloadOnStaleChunk(): void {
  window.addEventListener('vite:preloadError', (event) => {
    try {
      const last = Number(sessionStorage.getItem(KEY)) || 0
      if (Date.now() - last < RETRY_MS) return
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      // No storage to remember the last reload: never risk a reload loop.
      return
    }
    event.preventDefault()
    window.location.reload()
  })
}
