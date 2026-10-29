import { useTranslation } from 'react-i18next'

/**
 * The top half of a quotation as the Billing profile prints it (board
 * bill-seller-a), drawn live from the form. Paper colours, fixed and never
 * themed, like the company letterhead preview: a picture of the page.
 */
const PAPER = { bg: '#FFFFFF', ink: '#0E1218', mute: '#5F646A', line: '#E3E5E8', accent: '#D04400' } as const

export function QuotationPreview({
  logoUrl,
  legalNameEn,
  legalNameAr,
  addressEn,
  addressAr,
  taxId,
  commercialRegister,
  bankAccount,
  instapay,
  number,
}: {
  logoUrl: string | null
  legalNameEn: string
  legalNameAr: string
  addressEn: string
  addressAr: string
  taxId: string
  commercialRegister: string
  bankAccount: string
  instapay: string | null
  number: string
}) {
  const { t } = useTranslation('admin')
  const registration = [
    taxId && t('billingProfile.preview.taxNo', { value: taxId }),
    commercialRegister && t('billingProfile.preview.cr', { value: commercialRegister }),
  ]
    .filter(Boolean)
    .join(' · ')
  const box = { border: `1px solid ${PAPER.line}`, borderRadius: 4 }

  return (
    <div
      className="flex flex-col gap-3 rounded-md p-5 text-[9.5px] shadow-sm"
      style={{ background: PAPER.bg, color: PAPER.ink }}
      aria-hidden="true"
    >
      <div className="flex items-start gap-2.5 pb-2.5" style={{ borderBottom: `1.5px solid ${PAPER.ink}` }}>
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-[30px] shrink-0 rounded-md object-contain" />
        ) : (
          <span
            className="flex size-[30px] shrink-0 items-center justify-center rounded-md text-[13px] font-bold text-white"
            style={{ background: PAPER.accent }}
          >
            A
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-px" dir="ltr">
          <b className="truncate text-[11px]">{legalNameEn || '—'}</b>
          {addressEn && <span style={{ color: PAPER.mute }}>{addressEn}</span>}
          {registration && <span style={{ color: PAPER.mute }}>{registration}</span>}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-px" dir="rtl">
          <b className="truncate text-[10.5px]">{legalNameAr || '—'}</b>
          {addressAr && <span style={{ color: PAPER.mute }}>{addressAr}</span>}
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div className="flex flex-col" dir="ltr">
          <b className="text-[15px]">Quotation</b>
          <span className="font-mono">{number}</span>
        </div>
        <b className="text-[15px]" dir="rtl">
          عرض سعر
        </b>
      </div>
      <div className="h-[34px]" style={box} />
      <div className="h-[46px]" style={box} />
      <div className="flex flex-col gap-0.5 p-2" style={box} dir="ltr">
        <span className="flex justify-between text-[7.5px] font-semibold" style={{ color: PAPER.mute }}>
          <span>HOW TO PAY</span>
          <span dir="rtl">طريقة الدفع</span>
        </span>
        <span>{bankAccount || '—'}</span>
        {instapay && <span>InstaPay {instapay}</span>}
      </div>
    </div>
  )
}
