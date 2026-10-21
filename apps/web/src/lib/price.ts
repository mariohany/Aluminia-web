// Every price in the app reads "12,345.00": Western digits, comma
// thousands, two decimals — in Arabic too (Mario's call), so not the
// i18n.language formatters the counts use.
const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPrice(value: number): string {
  return priceFormatter.format(value)
}

const ARABIC_INDIC_ZERO = 0x0660

/**
 * What a price box shows while it's being typed in: only digits and one
 * dot kept, at most two decimals, the whole part grouped with commas
 * ("12345.6" → "12,345.6"). Arabic-Indic digits and the Arabic decimal
 * separator are read as their Western twins.
 */
export function groupPriceText(raw: string): string {
  const western = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/٫/g, '.')
  const kept = western.replace(/[^\d.]/g, '')
  const dot = kept.indexOf('.')
  let whole = dot === -1 ? kept : kept.slice(0, dot)
  const fraction = dot === -1 ? null : kept.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  whole = whole.replace(/^0+(?=\d)/, '')
  if (whole === '' && fraction !== null) whole = '0'
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === null ? grouped : `${grouped}.${fraction}`
}

/** The number a price box holds; NaN when empty, like `valueAsNumber`. */
export function parsePriceText(text: string): number {
  const plain = text.replace(/,/g, '')
  return plain === '' ? Number.NaN : Number(plain)
}

/** The caret index in `text` that sits after its `count`-th digit or dot. */
export function caretAfterSignificant(text: string, count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ',' && ++seen === count) return i + 1
  }
  return text.length
}
