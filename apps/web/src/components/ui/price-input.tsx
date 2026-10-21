import * as React from 'react'

import { Input } from '@/components/ui/input'
import { caretAfterSignificant, formatPrice, groupPriceText, parsePriceText } from '@/lib/price'

const SIGNIFICANT = /[\d٠-٩.٫]/

function textFor(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatPrice(value) : ''
}

/**
 * A price box: groups thousands while typing ("12,345.6") and pads to
 * two decimals on blur ("12,345.60"). Hands the form a number (NaN
 * when empty), so it drops into a `Controller` where a
 * `register(..., { valueAsNumber: true })` number input used to be.
 */
function PriceInput({
  value,
  onChange,
  onBlur,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined
  onChange: (value: number) => void
}) {
  const [text, setText] = React.useState(() => textFor(value))
  const caret = React.useRef<{ input: HTMLInputElement; at: number } | null>(null)

  // Follow the form when it changes the value itself (reset, a copied
  // row) — but not the echo of what was just typed.
  const typed = parsePriceText(text)
  const outside = !(typeof value === 'number' && (value === typed || (Number.isNaN(value) && Number.isNaN(typed))))
  if (outside && textFor(value) !== text) setText(textFor(value))

  React.useLayoutEffect(() => {
    if (caret.current === null) return
    caret.current.input.setSelectionRange(caret.current.at, caret.current.at)
    caret.current = null
  }, [text])

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const input = event.target
        const before = [...input.value.slice(0, input.selectionStart ?? input.value.length)].filter((c) =>
          SIGNIFICANT.test(c),
        ).length
        const next = groupPriceText(input.value)
        caret.current = { input, at: caretAfterSignificant(next, before) }
        setText(next)
        onChange(parsePriceText(next))
      }}
      onBlur={(event) => {
        const number = parsePriceText(text)
        if (Number.isFinite(number)) setText(formatPrice(number))
        onBlur?.(event)
      }}
    />
  )
}

export { PriceInput }
