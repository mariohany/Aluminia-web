/**
 * The empty-input rule for every optional text field in the workspace.
 *
 * The shared Zod schemas carry no transforms on purpose — a transform
 * gives a schema a different input type than its output type, which
 * breaks `useForm` typed by the output (the same trap already
 * documented on `z.coerce.number()` in companies.ts). So the conversion
 * happens here, at the form layer, exactly as numbers do via
 * `valueAsNumber`.
 *
 * Blank becomes `null`, not `undefined`, and the distinction matters:
 * the API reads `undefined` as "this field was not in the request,
 * leave it alone" and `null` as "clear it". A user who empties the
 * Arabic name box means the second. Sending `undefined` would silently
 * discard the edit and leave the old value in place.
 */
export const optionalTextField = {
  setValueAs: (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  },
}
