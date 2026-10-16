// Saving and printing a PDF the app already holds as a Blob — the bar
// optimiser report (docs/reports_planing.md §9, D20).

/** Revoke object URLs only after the browser has had time to use them. */
const REVOKE_AFTER_MS = 60_000

export function downloadPdf(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
}

/**
 * Opens the browser's print dialog with the PDF itself, so what prints
 * is exactly the download (A4, page numbers). Chrome, Edge and Firefox
 * print a PDF loaded in a hidden iframe; Safari prints such a frame
 * blank, so there the PDF opens in a new tab for ⌘P.
 */
export function printPdf(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const cleanUp = (frame?: HTMLIFrameElement) =>
    setTimeout(() => {
      frame?.remove()
      URL.revokeObjectURL(url)
    }, REVOKE_AFTER_MS)

  if (isSafari()) {
    window.open(url, '_blank', 'noopener')
    cleanUp()
    return
  }

  const frame = document.createElement('iframe')
  // Not display:none — some browsers won't print a frame that isn't laid out.
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '1px',
    height: '1px',
    border: '0',
    opacity: '0',
  })
  frame.setAttribute('aria-hidden', 'true')
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      window.open(url, '_blank', 'noopener')
    }
    cleanUp(frame)
  }
  frame.src = url
  document.body.appendChild(frame)
}

function isSafari(): boolean {
  const ua = navigator.userAgent
  return /safari/i.test(ua) && !/chrome|chromium|crios|fxios|android|edg/i.test(ua)
}
