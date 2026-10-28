import type { BillingDocumentSummary } from '@repo/types/billing-documents';

// The bilingual emails (docs/subscriptions_planing.md §6a, boards
// bill-mail-remind / bill-mail-invoice): English, then the same in Arabic
// right to left. Plain functions; every value is escaped.

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

const esc = (value: string | number) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (currency: string, n: number) =>
  `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

function day(iso: string): [string, string] {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  };
  return [
    new Intl.DateTimeFormat('en-GB', opts).format(date),
    new Intl.DateTimeFormat('ar-EG-u-nu-latn', opts).format(date),
  ];
}

/** The two language blocks in one simple, mail-client-safe page. */
function page(
  enHtml: string,
  arHtml: string,
  link?: { url: string; label: string },
): string {
  const button = link
    ? `<p style="margin:20px 0 0"><a href="${esc(link.url)}" style="display:inline-block;background:#D04400;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(link.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F2F3F6;font-family:Arial,Helvetica,sans-serif;color:#0E1218">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="background:#ffffff;border-radius:12px;padding:28px">
<div dir="ltr" style="font-size:15px;line-height:1.55">${enHtml}</div>
<hr style="border:none;border-top:1px solid #DBDEE2;margin:24px 0">
<div dir="rtl" style="font-size:15px;line-height:1.7;text-align:right">${arHtml}</div>
${button}
</div>
<p style="text-align:center;color:#5F646A;font-size:12px;margin:16px 0 0">Aluminia</p>
</div></body></html>`;
}

const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|h1|div)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function compose(
  subject: string,
  en: string,
  ar: string,
  link?: { url: string; label: string },
): MailContent {
  return {
    subject,
    html: page(en, ar, link),
    text: `${strip(en)}\n\n${strip(ar)}${link ? `\n\n${link.url}` : ''}`,
  };
}

/** A quotation or an invoice, its PDF attached. `subject` is the one the
 * super admin typed (prefilled with `defaultSubject`). */
export function documentEmail(
  doc: BillingDocumentSummary,
  subject: string,
): MailContent {
  const company = esc(doc.buyer.nameEn);
  const companyAr = esc(doc.buyer.nameAr ?? doc.buyer.nameEn);
  const total = esc(money(doc.currency, doc.totals.total));
  const [endEn, endAr] = day(doc.endsOn);
  if (doc.kind === 'invoice') {
    return compose(
      subject,
      `<h1 style="margin:0 0 10px;font-size:22px">Payment received — thank you</h1>
<p style="margin:0">We received <b>${total}</b>${doc.quotationNumber ? ` for quotation ${esc(doc.quotationNumber)}` : ''}. ${company}'s <b>${esc(doc.plan.nameEn)}</b> plan (${doc.seats} seats) now runs until <b>${esc(endEn)}</b>. Your invoice <b>${esc(doc.number)}</b> is attached.</p>`,
      `<h1 style="margin:0 0 10px;font-size:22px">تم استلام الدفعة — شكرًا لك</h1>
<p style="margin:0">استلمنا <b>${total}</b>. باقة <b>${esc(doc.plan.nameAr)}</b> لشركة ${companyAr} (${doc.seats} مستخدمين) سارية حتى <b>${esc(endAr)}</b>. الفاتورة <b>${esc(doc.number)}</b> مرفقة.</p>`,
    );
  }
  const [validEn, validAr] = doc.validUntil ? day(doc.validUntil) : ['—', '—'];
  return compose(
    subject,
    `<h1 style="margin:0 0 10px;font-size:22px">Your Aluminia quotation</h1>
<p style="margin:0 0 10px">Please find attached quotation <b>${esc(doc.number)}</b> for ${company}: the <b>${esc(doc.plan.nameEn)}</b> plan, ${doc.seats} seats, ${doc.months} ${doc.months === 1 ? 'month' : 'months'}, <b>${total}</b>.</p>
<p style="margin:0">It is valid until <b>${esc(validEn)}</b>. To pay, transfer to the account on the quotation and reply with the transfer reference.</p>`,
    `<h1 style="margin:0 0 10px;font-size:22px">عرض سعر Aluminia</h1>
<p style="margin:0 0 10px">مرفق عرض السعر <b>${esc(doc.number)}</b> لشركة ${companyAr}: باقة <b>${esc(doc.plan.nameAr)}</b>، ${doc.seats} مستخدمين، <b>${total}</b>.</p>
<p style="margin:0">صالح حتى <b>${esc(validAr)}</b>. للدفع حوّل المبلغ إلى الحساب المذكور في عرض السعر وأرسل لنا رقم التحويل.</p>`,
  );
}

/** What the send dialog prefills as the subject. */
export function defaultSubject(doc: BillingDocumentSummary): string {
  return doc.kind === 'invoice'
    ? `Invoice ${doc.number} — thank you · فاتورة — شكرًا لك`
    : `Quotation ${doc.number} from Aluminia · عرض سعر`;
}

/** The warning before the end (B15): 30 / 15 / 5 / 1 days. */
export function reminderEmail(p: {
  companyEn: string;
  companyAr: string | null;
  planEn: string;
  planAr: string;
  endsOn: string;
  daysLeft: number;
  appUrl: string;
}): MailContent {
  const [endEn, endAr] = day(p.endsOn);
  const days = p.daysLeft === 1 ? '1 day' : `${p.daysLeft} days`;
  const daysAr = p.daysLeft === 1 ? 'يوم واحد' : `${p.daysLeft} يومًا`;
  return compose(
    `Your Aluminia subscription ends in ${days} · اشتراكك ينتهي خلال ${daysAr}`,
    `<h1 style="margin:0 0 10px;font-size:22px">Your subscription ends in ${days}</h1>
<p style="margin:0">${esc(p.companyEn)}'s <b>${esc(p.planEn)}</b> plan ends on <b>${esc(endEn)}</b> at 23:59 (Cairo time). After that, every user is signed out and nobody can sign in until it's renewed. Your projects and windows stay safe.</p>`,
    `<h1 style="margin:0 0 10px;font-size:22px">اشتراكك ينتهي خلال ${daysAr}</h1>
<p style="margin:0">باقة <b>${esc(p.planAr)}</b> لشركة ${esc(p.companyAr ?? p.companyEn)} تنتهي يوم <b>${esc(endAr)}</b> الساعة 11:59 مساءً بتوقيت القاهرة. بعدها يتم تسجيل خروج كل المستخدمين ولن يستطيع أحد الدخول حتى التجديد. مشاريعك وبياناتك محفوظة.</p>`,
    { url: `${p.appUrl}/workspace`, label: 'Open Aluminia · افتح Aluminia' },
  );
}
