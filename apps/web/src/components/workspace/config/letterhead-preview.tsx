import { useTranslation } from 'react-i18next'

/**
 * How the company profile prints at the top of a report / quote page,
 * drawn live from the form. Paper colours, fixed and never themed — like
 * window material colours, this is a picture of the printed page, not UI
 * chrome. The orange rule is the PDF's accent.
 */
const PAPER = { bg: '#FFFFFF', ink: '#0E1218', mute: '#5F646A', rule: '#D04400', mark: '#D04400' } as const

export function LetterheadPreview({
  logoUrl,
  enName,
  arName,
  enAddress,
  arAddress,
  phone,
  taxId,
  commercialRegister,
}: {
  logoUrl: string | null
  enName: string
  arName: string | null
  enAddress: string | null
  arAddress: string | null
  phone: string | null
  taxId: string | null
  commercialRegister: string | null
}) {
  const { t } = useTranslation('workspace')
  const registration = [
    taxId && `${t('config.company.fields.taxId')} ${taxId}`,
    commercialRegister && `${t('config.company.fields.crShort')} ${commercialRegister}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const contact = [enAddress, phone].filter(Boolean).join(' · ')

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <figcaption className="text-[11.5px] text-muted-foreground">{t('config.company.previewCaption')}</figcaption>
      <div
        className="flex items-center gap-3.5 rounded-lg border border-border px-4 py-3.5"
        style={{ background: PAPER.bg, color: PAPER.ink }}
      >
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-11 shrink-0 object-contain" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] text-[15px] font-bold text-white"
            style={{ background: PAPER.mark }}
          >
            A
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5" dir="ltr">
          <span className="truncate text-sm font-semibold">{enName}</span>
          {contact && (
            <span className="truncate text-[11px]" style={{ color: PAPER.mute }}>
              {contact}
            </span>
          )}
          {registration && (
            <span className="truncate font-mono text-[11px]" style={{ color: PAPER.mute }}>
              {registration}
            </span>
          )}
        </span>
        {(arName || arAddress) && (
          <span className="flex min-w-0 flex-col gap-0.5 text-end" dir="rtl">
            {arName && <span className="truncate text-sm font-semibold">{arName}</span>}
            {arAddress && (
              <span className="truncate text-[11px]" style={{ color: PAPER.mute }}>
                {arAddress}
              </span>
            )}
          </span>
        )}
      </div>
      <span aria-hidden="true" className="h-0.5 rounded-full" style={{ background: PAPER.rule }} />
    </figure>
  )
}
