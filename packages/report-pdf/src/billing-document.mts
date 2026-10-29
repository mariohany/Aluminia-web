import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { Document, Image, Page, Text, View, pdf, type DocumentProps } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import type { BillingDocumentSummary, PaymentMethod } from '@repo/types/billing-documents'
import { FONT_FAMILY } from './fonts.mts'

// A quotation or a tax invoice (docs/subscriptions_planing.md §5, B17,
// boards bill-pdf-quotation / bill-pdf-invoice): ONE page, English and
// Arabic side by side, drawn in the browser from the document's snapshot
// (seller, buyer, prices and rate as issued). Paper colours, never themed.
// Every Arabic text sets `direction: 'rtl'` (see bar-optimiser-document.mts),
// and an Arabic label never embeds a number or a bracket (a rate, a percent):
// the English label beside it carries those, so nothing can print reordered.

export interface BillingPdfInput {
  document: BillingDocumentSummary
  /** The seller's logo as a PNG or JPEG data URI, or null for the "A" mark. */
  logo: string | null
}

const C = {
  ink: '#0E1218',
  mute: '#5F646A',
  line: '#DBDEE2',
  accent: '#D04400',
  paid: '#1E8A55',
}
const px = (n: number) => n * 0.75

const METHODS: Record<PaymentMethod, [string, string]> = {
  bank_transfer: ['Bank transfer', 'تحويل بنكي'],
  instapay: ['InstaPay', 'InstaPay'],
  cash: ['Cash', 'نقدًا'],
  cheque: ['Cheque', 'شيك'],
}

const CURRENCY_AR: Record<string, string> = {
  EGP: 'جنيه',
  SAR: 'ريال',
  AED: 'درهم',
  USD: 'دولار',
  EUR: 'يورو',
}

const en = (content: ReactNode, style: Style = {}) =>
  h(Text, { style: { fontFamily: [FONT_FAMILY.sans, FONT_FAMILY.arabic], ...style } }, content)
const ar = (content: ReactNode, style: Style = {}) =>
  h(
    Text,
    { style: { fontFamily: [FONT_FAMILY.arabic, FONT_FAMILY.sans], direction: 'rtl', textAlign: 'right', ...style } },
    content,
  )
const num = (content: ReactNode, style: Style = {}) =>
  h(Text, { style: { fontFamily: FONT_FAMILY.mono, direction: 'ltr', ...style } }, content)
const row = (style: Style, ...children: ReactNode[]) => h(View, { style: { flexDirection: 'row', ...style } }, ...children)
const col = (style: Style, ...children: ReactNode[]) => h(View, { style }, ...children)

/** A small bilingual label: English on the left, Arabic on the right. */
const label = (english: string, arabic: string) =>
  row(
    { justifyContent: 'space-between', flexWrap: 'wrap', columnGap: px(6) },
    en(english.toUpperCase(), { fontSize: px(8), color: C.mute, fontWeight: 600, letterSpacing: px(0.4) }),
    ar(arabic, { fontSize: px(8.5), color: C.mute, fontWeight: 600 }),
  )

/** 1234.5 → "1,234.50" (Latin digits in both languages, like the app). */
export function amount(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

/** A YYYY-MM-DD day in each language: "17 Jan 2027" / "17 يناير 2027". */
export function day(iso: string): [string, string] {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
  return [
    new Intl.DateTimeFormat('en-GB', opts).format(date),
    new Intl.DateTimeFormat('ar-EG-u-nu-latn', { ...opts, month: 'long' }).format(date),
  ]
}

export function billingDocument(input: BillingPdfInput): ReactElement<DocumentProps> {
  const doc = input.document
  const invoice = doc.kind === 'invoice'
  const { seller, buyer, totals } = doc
  const cur = doc.currency
  const [issuedEn, issuedAr] = day(doc.createdAt)
  const [startEn] = day(doc.startsOn)
  const [endEn, endAr] = day(doc.endsOn)

  const mark = input.logo
    ? h(Image, { src: input.logo, style: { width: px(52), height: px(52), objectFit: 'contain' } })
    : h(
        View,
        { style: { width: px(52), height: px(52), borderRadius: px(10), backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' } },
        h(Text, { style: { fontFamily: FONT_FAMILY.sans, fontWeight: 700, fontSize: px(22), color: '#FFFFFF' } }, 'A'),
      )

  const registration = (p: { taxId: string | null; commercialRegister: string | null }) =>
    [p.taxId && `Tax no. ${p.taxId}`, p.commercialRegister && `CR ${p.commercialRegister}`].filter(Boolean).join(' · ')

  const head = row(
    { alignItems: 'flex-start', gap: px(16), paddingBottom: px(18), borderBottomWidth: px(2), borderBottomColor: C.ink },
    mark,
    col(
      { flex: 1, gap: px(2) },
      en(seller.nameEn, { fontSize: px(16), fontWeight: 700 }),
      en([seller.addressEn, seller.billingEmail, seller.phone].filter(Boolean).join(' · '), {
        fontSize: px(10.5),
        color: C.mute,
      }),
      registration(seller) ? en(registration(seller), { fontSize: px(10.5), color: C.mute }) : null,
    ),
    col(
      { alignItems: 'flex-end', gap: px(2), maxWidth: '40%' },
      seller.nameAr ? ar(seller.nameAr, { fontSize: px(15), fontWeight: 700 }) : null,
      seller.addressAr ? ar(seller.addressAr, { fontSize: px(10.5), color: C.mute }) : null,
    ),
  )

  const [titleEn, titleAr] = invoice ? ['Tax invoice', 'فاتورة ضريبية'] : ['Quotation', 'عرض سعر']
  const title = row(
    { alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: px(22), paddingBottom: px(16) },
    col({ gap: px(2) }, en(titleEn, { fontSize: px(26), fontWeight: 700 }), num(doc.number, { fontSize: px(13) })),
    ar(titleAr, { fontSize: px(26), fontWeight: 700 }),
  )

  const meta = (english: string, arabic: string, value: string, valueAr?: string) =>
    col(
      { flex: 1, gap: px(3) },
      label(english, arabic),
      en(value, { fontSize: px(12), fontWeight: 600 }),
      valueAr ? ar(valueAr, { fontSize: px(10.5), color: C.mute }) : null,
    )
  const dates = invoice
    ? [
        meta('Issued', 'تاريخ الإصدار', issuedEn, issuedAr),
        meta('Paid on', 'تاريخ الدفع', ...(doc.paidOn ? day(doc.paidOn) : (['—', ''] as [string, string]))),
        meta('From quotation', 'من عرض السعر', doc.quotationNumber ?? '—'),
      ]
    : [
        meta('Issued', 'تاريخ الإصدار', issuedEn, issuedAr),
        meta('Valid until', 'صالح حتى', ...(doc.validUntil ? day(doc.validUntil) : (['—', ''] as [string, string]))),
        meta('Currency', 'العملة', cur, CURRENCY_AR[cur]),
      ]
  const billTo = row(
    { gap: px(18), padding: px(14), borderWidth: px(1), borderColor: C.line, borderRadius: px(8) },
    col(
      { flex: 1.4, gap: px(3) },
      label('Bill to', 'إلى'),
      en(buyer.nameEn, { fontSize: px(13), fontWeight: 700 }),
      buyer.nameAr ? ar(buyer.nameAr, { fontSize: px(12) }) : null,
      buyer.addressEn ? en(buyer.addressEn, { fontSize: px(10.5), color: C.mute }) : null,
      registration(buyer) ? en(registration(buyer), { fontSize: px(10.5), color: C.mute }) : null,
    ),
    ...dates,
  )

  const th = (english: string, arabic: string, style: Style = {}) =>
    col(
      { paddingVertical: px(8), paddingHorizontal: px(10), ...style },
      en(english, { fontSize: px(9), color: C.mute, fontWeight: 600, textAlign: style.alignItems === 'flex-end' ? 'right' : 'left' }),
      ar(arabic, { fontSize: px(9), color: C.mute, fontWeight: 600 }),
    )
  const right: Style = { alignItems: 'flex-end' }
  const lines = col(
    { marginTop: px(18) },
    row(
      { borderBottomWidth: px(1), borderBottomColor: C.ink },
      th('Description', 'البيان', { flex: 3 }),
      th('Months', 'المدة', { flex: 1, ...right }),
      th('Seats', 'المستخدمين', { flex: 1, ...right }),
      th('Amount', 'المبلغ', { flex: 1.3, ...right }),
    ),
    row(
      { borderBottomWidth: px(1), borderBottomColor: C.line },
      col(
        { flex: 3, padding: px(10), gap: px(2) },
        row(
          { justifyContent: 'space-between', gap: px(8) },
          en(`Aluminia ${doc.plan.nameEn} — ${doc.months} ${doc.months === 1 ? 'month' : 'months'}`, { fontSize: px(11.5), fontWeight: 700 }),
          ar(
            `باقة ${doc.plan.nameAr} — ${doc.months === 1 ? 'شهر واحد' : `${doc.months} ${doc.months === 12 ? 'شهرًا' : 'أشهر'}`}`,
            { fontSize: px(11.5), fontWeight: 600 },
          ),
        ),
        en(`${startEn} – ${endEn}`, { fontSize: px(10.5), color: C.mute }),
      ),
      col({ flex: 1, padding: px(10), ...right }, num(String(doc.months), { fontSize: px(11) })),
      col({ flex: 1, padding: px(10), ...right }, num(String(doc.seats), { fontSize: px(11) })),
      col({ flex: 1.3, padding: px(10), ...right }, num(amount(totals.subtotal), { fontSize: px(11) })),
    ),
  )

  const totalRow = (english: string, arabic: string, value: string, opts: { bold?: boolean; color?: string } = {}) =>
    row(
      {
        alignItems: 'center',
        gap: px(10),
        paddingVertical: px(6),
        ...(opts.bold ? { borderTopWidth: px(2), borderTopColor: C.ink, paddingTop: px(10) } : {}),
      },
      en(english, { flex: 1, fontSize: px(opts.bold ? 15 : 11.5), fontWeight: opts.bold ? 700 : 400, color: opts.color ?? C.ink }),
      ar(arabic, { flex: 1, fontSize: px(opts.bold ? 14 : 11), fontWeight: opts.bold ? 700 : 400, color: opts.color ?? C.ink }),
      num(value, { width: px(110), textAlign: 'right', fontSize: px(opts.bold ? 15 : 11.5), fontWeight: opts.bold ? 700 : 400, color: opts.color ?? C.ink }),
    )
  const discountLabel =
    doc.discountKind === 'percent' ? [`Discount ${doc.discountValue} %`, 'خصم'] : ['Discount', 'خصم']
  const taxable = totals.subtotal - totals.discountAmount
  const totalsBlock = col(
    { marginLeft: 'auto', width: px(380), marginTop: px(10) },
    totalRow('Subtotal', 'الإجمالي قبل الخصم', amount(totals.subtotal)),
    totals.discountAmount > 0
      ? totalRow(discountLabel[0]!, discountLabel[1]!, `-${amount(totals.discountAmount)}`, { color: C.paid })
      : null,
    totals.discountAmount > 0 ? totalRow('Taxable amount', 'المبلغ الخاضع للضريبة', amount(taxable)) : null,
    totalRow(`VAT ${doc.vatRate} %`, 'ضريبة القيمة المضافة', amount(totals.vatAmount)),
    totalRow(`Total ${cur}`, `الإجمالي بال${CURRENCY_AR[cur] ?? cur}`, amount(totals.total), { bold: true }),
    doc.fxRate
      ? row(
          { justifyContent: 'space-between', gap: px(10), paddingTop: px(6) },
          en(`Converted from EGP at 1 ${cur} = ${doc.fxRate} EGP`, { fontSize: px(9.5), color: C.mute }),
          ar(`محوّل من الجنيه: 1 ${CURRENCY_AR[cur] ?? cur} = ${doc.fxRate} جنيه`, { fontSize: px(9.5), color: C.mute }),
        )
      : null,
  )

  const box = (...children: ReactNode[]) =>
    row({ gap: px(18), marginTop: px(26), padding: px(14), borderWidth: px(1), borderColor: C.line, borderRadius: px(8) }, ...children)
  const [method, methodAr] = doc.paymentMethod ? METHODS[doc.paymentMethod] : ['—', '—']
  const foot = invoice
    ? box(
        col(
          { flex: 1, gap: px(3) },
          label('Payment received', 'تم استلام الدفعة'),
          en(`${method} · ref ${doc.paymentReference ?? '—'} · ${cur} ${amount(doc.amountReceived ?? 0)}`, { fontSize: px(11) }),
          ar(`${methodAr} · مرجع ${doc.paymentReference ?? '—'}`, { fontSize: px(10.5), color: C.mute }),
        ),
        col(
          { flex: 1, gap: px(3) },
          label('Subscription', 'الاشتراك'),
          en(`${doc.plan.nameEn} · ${doc.seats} seats · active until ${endEn}, 23:59 Cairo`, { fontSize: px(11) }),
          ar(`${doc.plan.nameAr} · ${doc.seats} مستخدمين · سارٍ حتى ${endAr} 11:59 مساءً بتوقيت القاهرة`, { fontSize: px(10.5), color: C.mute }),
        ),
      )
    : box(
        col(
          { flex: 1, gap: px(4) },
          label('How to pay', 'طريقة الدفع'),
          en(seller.bankAccount, { fontSize: px(11) }),
          seller.instapay ? en(`InstaPay ${seller.instapay}`, { fontSize: px(11) }) : null,
          en(`Please quote ${doc.number} in the transfer.`, { fontSize: px(10.5), color: C.mute }),
          ar(`برجاء كتابة رقم عرض السعر ${doc.number} في التحويل.`, { fontSize: px(10.5), color: C.mute }),
        ),
      )

  const stamp = invoice
    ? h(
        View,
        {
          style: {
            // The empty middle of the title row, clear of both titles.
            position: 'absolute',
            left: '42%',
            top: px(118),
            transform: 'rotate(-8deg)',
            borderWidth: px(3),
            borderColor: C.paid,
            borderRadius: px(8),
            paddingVertical: px(6),
            paddingHorizontal: px(14),
            alignItems: 'center',
          },
        },
        en('PAID', { fontSize: px(22), fontWeight: 700, color: C.paid, letterSpacing: px(1.5) }),
        ar('مدفوعة', { fontSize: px(15), fontWeight: 700, color: C.paid, textAlign: 'center' }),
        doc.paidOn ? en(day(doc.paidOn)[0], { fontSize: px(10), color: C.paid }) : null,
      )
    : null

  const footer = h(
    View,
    {
      fixed: true,
      style: {
        position: 'absolute',
        left: px(48),
        right: px(48),
        bottom: px(30),
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: px(1),
        borderTopColor: C.line,
        paddingTop: px(8),
      },
    },
    h(Text, {
      style: { fontFamily: FONT_FAMILY.sans, fontSize: px(9.5), color: C.mute },
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        `${doc.number} · page ${pageNumber} of ${totalPages}`,
    }),
    en('aluminia.app', { fontSize: px(9.5), color: C.mute }),
  )

  return h(
    Document,
    { title: `${titleEn} ${doc.number}`, creator: 'Aluminia', producer: 'Aluminia' },
    h(
      Page,
      { size: 'A4', style: { paddingTop: px(44), paddingBottom: px(70), paddingHorizontal: px(48), color: C.ink, fontSize: px(11) } },
      head,
      stamp,
      title,
      billTo,
      lines,
      totalsBlock,
      foot,
      doc.note ? en(`Note: ${doc.note}`, { marginTop: px(10), fontSize: px(10.5), color: C.mute }) : null,
      footer,
    ),
  )
}

/** The drawn PDF's bytes. Fonts must be registered first (`registerFonts`). */
export async function billingPdfBytes(input: BillingPdfInput): Promise<ArrayBuffer> {
  return (await pdf(billingDocument(input)).toBlob()).arrayBuffer()
}
