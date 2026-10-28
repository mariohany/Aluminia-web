/** The red asterisk after a required field's label (Mario: every mandatory label gets one). */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  )
}
