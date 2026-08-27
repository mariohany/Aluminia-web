import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'

/**
 * A form label with an optional "(optional)" marker, or a red asterisk
 * for `required` — never both; `required` is for fields whose emptiness
 * is itself invalid (a real "must fill this in"), not just a habit
 * applied to every field that happens to lack `optional`.
 *
 * The marker lives INSIDE a single span rather than as a sibling of the
 * label text, because shadcn's `Label` is a flex container: two
 * children get pushed to opposite ends, so "Site address (English)"
 * rendered with the marker stranded at the far right and the text
 * wrapping under it. One child means normal inline flow, and the marker
 * wraps with the words it belongs to.
 */
export function FieldLabel({
  htmlFor,
  children,
  optional = false,
  required = false,
}: {
  htmlFor: string
  children: React.ReactNode
  optional?: boolean
  required?: boolean
}) {
  const { t } = useTranslation('workspace')
  return (
    <Label htmlFor={htmlFor}>
      <span>
        {children}
        {optional && <span className="ms-1 font-normal text-muted-foreground">{t('fields.optional')}</span>}
        {required && (
          <span className="ms-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </span>
    </Label>
  )
}
