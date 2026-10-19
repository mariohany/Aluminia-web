import { Font } from '@react-pdf/renderer'

// The PDF's fonts (docs/browser_pdf_planing.md §5, Q2): IBM Plex Sans
// Arabic and Geist / Geist Mono, regular · semibold · bold. Vendored in
// ../fonts (OFL, licences beside them) because @react-pdf's font engine
// can't subset the app's own web fonts (Geist's variable woff2, the
// @fontsource Arabic subset): complete WOFF / static TTF files only.

export const FONT_FAMILY = {
  arabic: 'Plex Arabic',
  sans: 'Geist',
  mono: 'Geist Mono',
} as const

export const FONT_WEIGHTS = [400, 600, 700] as const

/** Every file, by family and weight, as named in ../fonts. */
export const FONT_FILES = {
  arabic: ['IBMPlexSansArabic-Regular.woff', 'IBMPlexSansArabic-SemiBold.woff', 'IBMPlexSansArabic-Bold.woff'],
  sans: ['Geist-Regular.ttf', 'Geist-SemiBold.ttf', 'Geist-Bold.ttf'],
  mono: ['GeistMono-Regular.ttf', 'GeistMono-SemiBold.ttf', 'GeistMono-Bold.ttf'],
} as const

export type FontFile = (typeof FONT_FILES)[keyof typeof FONT_FILES][number]

let registered = false

/** Registers the fonts once. `locate` turns a file name into what the
 * caller can load: a URL in the browser (the bundler's asset URL), a path
 * in Node. */
export function registerFonts(locate: (file: FontFile) => string): void {
  if (registered) return
  registered = true
  for (const key of ['arabic', 'sans', 'mono'] as const) {
    Font.register({
      family: FONT_FAMILY[key],
      fonts: FONT_FILES[key].map((file, i) => ({ src: locate(file), fontWeight: FONT_WEIGHTS[i] })),
    })
  }
  // Never hyphenate: piece labels and profile numbers must stay whole.
  Font.registerHyphenationCallback((word) => [word])
}
