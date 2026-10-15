import type {
  ReportLanguage,
  ReportMember,
  ReportPieceAt,
} from '@repo/types/reports';

// Every word on the bar optimiser PDF, English and Arabic
// (docs/reports_planing.md §8). Arabic reuses the window editor's
// workshop terms (apps/web/src/locales/ar/workspace.json): برواز, دفة,
// عارضة, عمود قسمة, اسكواش, بروفايل, شباك. Numbers stay Latin digits in
// both languages (D25).

export interface PdfStrings {
  dir: 'ltr' | 'rtl';
  title: string;
  subtitle: string;
  planTitle: string;
  planSubtitle: string;
  client: string;
  project: string;
  windows: string;
  windowsValue: (types: number, units: number) => string;
  settings: string;
  settingsValue: (lengths: string, kerf: number, trim: number) => string;
  membersHeading: string;
  membersNote: string;
  ordersHeading: string;
  colMembers: string;
  colPieces: string;
  colOnly: (lengthMm: number) => string;
  colLeastWaste: string;
  colProfile: string;
  colMember: string;
  colInWindows: string;
  colOrder: string;
  total: string;
  approximate: string;
  wasteNote: string;
  skippedHeading: string;
  skippedNote: string;
  tooLongHeading: string;
  tooLongNote: string;
  legendPiece: string;
  legendWaste: string;
  legendTrim: (trim: number) => string;
  legendScale: string;
  waste: string;
  wasteShort: string;
  bars: (n: number) => string;
  noPieces: string;
  groups: Record<ReportMember, string>;
  member: Record<ReportMember, string>;
  /** "W-01 Living room · sash B left" (D17). */
  partLabel: (
    member: ReportMember,
    at: ReportPieceAt,
    panels: number,
  ) => string;
  /** The compact part name a short piece shows (D26). */
  partShort: (member: ReportMember, at: ReportPieceAt) => string;
  generatedBy: string;
  dateLocale: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = (i: number | null) =>
  i === null ? '' : (LETTERS[i] ?? String(i + 1));
const fmt = (n: number) => String(Math.round(n));

const EN_POS: Record<ReportPieceAt['position'], string> = {
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  head: 'arch',
  edge: 'edge',
  bar: '',
};
const EN_POS_SHORT: Record<ReportPieceAt['position'], string> = {
  top: 'T',
  bottom: 'B',
  left: 'L',
  right: 'R',
  head: 'arch',
  edge: 'E',
  bar: '',
};
const AR_POS: Record<ReportPieceAt['position'], string> = {
  top: 'أعلى',
  bottom: 'أسفل',
  left: 'يسار',
  right: 'يمين',
  head: 'القوس',
  edge: 'ضلع',
  bar: '',
};

function positionText(
  names: Record<ReportPieceAt['position'], string>,
  at: ReportPieceAt,
): string {
  const base = names[at.position];
  return at.positionIndex !== undefined && at.position !== 'bar'
    ? `${base} ${at.positionIndex + 1}`
    : base;
}

const EN: PdfStrings = {
  dir: 'ltr',
  title: 'Bar optimisation',
  subtitle: 'What to order with the least waste',
  planTitle: 'Bar optimisation — cutting plan',
  planSubtitle: 'Each bar drawn to scale, pieces in cutting order',
  client: 'Client',
  project: 'Project',
  windows: 'Windows',
  windowsValue: (types, units) =>
    `${types} type${types === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}`,
  settings: 'Settings',
  settingsValue: (lengths, kerf, trim) =>
    `${lengths} mm · kerf ${kerf} · trim ${trim}`,
  membersHeading: 'Bars needed per member',
  membersNote:
    'Each cell: bars · waste. Highlighted = the least-waste order, mixing lengths where that wastes less.',
  ordersHeading: 'Order list per profile',
  colMembers: 'Members',
  colPieces: 'Pieces',
  colOnly: (l) => `Only ${l}`,
  colLeastWaste: 'Least waste (mixed)',
  colProfile: 'Profile',
  colMember: 'Member',
  colInWindows: 'In windows',
  colOrder: 'Order',
  total: 'Total',
  approximate:
    'Approximate: sash, transom and bead lengths use stand-in profile widths until each profile has its real sizes.',
  wasteNote:
    'Waste = everything bought that is not inside a window: saw kerf, end trim and every offcut.',
  skippedHeading: 'Left out — no profile picked',
  skippedNote: 'These parts have no profile to cut them from.',
  tooLongHeading: 'Too long for any bar',
  tooLongNote:
    'Longer than the longest stock length can give: order separately.',
  legendPiece: 'piece (mm · window)',
  legendWaste: 'waste',
  legendTrim: (t) => `end trim ${t} mm`,
  legendScale: 'Every bar drawn to the same scale.',
  waste: 'waste',
  wasteShort: 'waste',
  bars: (n) => `${n} bar${n === 1 ? '' : 's'}`,
  noPieces: 'No pieces to cut.',
  groups: {
    frame: 'Frames',
    sash: 'Sashes / leaves',
    divider: 'Transoms & mullions',
    bead: 'Glazing beads',
  },
  member: {
    frame: 'Frame',
    sash: 'Sash / leaf',
    divider: 'Transom / mullion',
    bead: 'Glazing bead',
  },
  partLabel: (member, at, panels) => {
    const panel = panels > 1 ? `panel ${at.panelIndex + 1} · ` : '';
    const pos = positionText(EN_POS, at);
    if (member === 'divider' && at.divider) {
      return `${panel}${at.divider.kind} ${at.divider.number}`;
    }
    if (member === 'frame') return `${panel}frame ${pos}`;
    const where = `${letter(at.sectionIndex)}${at.sashIndex !== null && at.sashIndex > 0 ? at.sashIndex + 1 : ''}`;
    return `${panel}${member === 'sash' ? 'sash' : 'bead'} ${where} ${pos}`.trim();
  },
  partShort: (member, at) => {
    const pos = positionText(EN_POS_SHORT, at);
    if (member === 'divider' && at.divider) {
      return `${at.divider.kind === 'mullion' ? 'M' : 'T'}${at.divider.number}`;
    }
    const kind = member === 'frame' ? 'fr' : member === 'sash' ? 'sa' : 'bd';
    // "sa B/T": section B, top — a slash so the letter and side don't run
    // together ("BT").
    return member === 'frame'
      ? `${kind} ${pos}`
      : `${kind} ${letter(at.sectionIndex)}/${pos}`;
  },
  generatedBy: 'Generated by Aluminia',
  dateLocale: 'en-GB',
};

const AR: PdfStrings = {
  dir: 'rtl',
  title: 'تحسين تقطيع الأعواد',
  subtitle: 'المطلوب شراؤه بأقل هالك',
  planTitle: 'تحسين تقطيع الأعواد — خطة القص',
  planSubtitle: 'كل عود مرسوم بنفس المقياس، والقطع بترتيب القص',
  client: 'العميل',
  project: 'المشروع',
  windows: 'الشبابيك',
  windowsValue: (types, units) => `${types} نوع · ${units} وحدة`,
  settings: 'الإعدادات',
  settingsValue: (lengths, kerf, trim) =>
    `${lengths} مم · سلاح المنشار ${kerf} · تنظيف الأطراف ${trim}`,
  membersHeading: 'عدد الأعواد لكل عنصر',
  membersNote:
    'كل خانة: عدد الأعواد · نسبة الهالك. المظلّل = الطلب بأقل هالك، مع خلط الأطوال لو ده بيقلّل الهالك.',
  ordersHeading: 'قائمة الطلب لكل بروفايل',
  colMembers: 'العنصر',
  colPieces: 'القطع',
  colOnly: (l) => `${l} فقط`,
  colLeastWaste: 'أقل هالك (مختلط)',
  colProfile: 'البروفايل',
  colMember: 'العنصر',
  colInWindows: 'في الشبابيك',
  colOrder: 'الطلب',
  total: 'الإجمالي',
  approximate:
    'تقريبي: أطوال الدفف والفواصل والاسكواش محسوبة بعروض بروفايل افتراضية لحد ما تتسجّل المقاسات الحقيقية لكل بروفايل.',
  wasteNote:
    'الهالك = كل اللي اتشترى ومش داخل في شباك: سُمك سلاح المنشار، تنظيف الأطراف، وكل البواقي.',
  skippedHeading: 'غير محسوب — بدون بروفايل',
  skippedNote: 'الأجزاء دي مالهاش بروفايل تتقص منه.',
  tooLongHeading: 'أطول من أي عود',
  tooLongNote: 'أطول من أطول عود متاح: تتطلب لوحدها.',
  legendPiece: 'قطعة (مم · الشباك)',
  legendWaste: 'هالك',
  legendTrim: (t) => `تنظيف الطرف ${t} مم`,
  legendScale: 'كل الأعواد مرسومة بنفس المقياس.',
  waste: 'هالك',
  wasteShort: 'هالك',
  bars: (n) => `${n} عود`,
  noPieces: 'مفيش قطع للقص.',
  groups: {
    frame: 'البراويز',
    sash: 'الدفف / الضلف',
    divider: 'العوارض وأعمدة القسمة',
    bead: 'الاسكواش',
  },
  member: {
    frame: 'برواز',
    sash: 'دفة / ضلفة',
    divider: 'عارضة / عمود قسمة',
    bead: 'اسكواش',
  },
  partLabel: (member, at, panels) => {
    const panel = panels > 1 ? `وحدة ${at.panelIndex + 1} · ` : '';
    const pos = positionText(AR_POS, at);
    if (member === 'divider' && at.divider) {
      return `${panel}${at.divider.kind === 'mullion' ? 'عمود قسمة' : 'عارضة'} ${at.divider.number}`;
    }
    if (member === 'frame') return `${panel}برواز ${pos}`;
    const where = `${letter(at.sectionIndex)}${at.sashIndex !== null && at.sashIndex > 0 ? at.sashIndex + 1 : ''}`;
    return `${panel}${member === 'sash' ? 'دفة' : 'اسكواش'} ${where} ${pos}`.trim();
  },
  partShort: (member, at) => {
    const pos = positionText(AR_POS, at);
    if (member === 'divider' && at.divider) {
      return `${at.divider.kind === 'mullion' ? 'عمود' : 'عارضة'} ${at.divider.number}`;
    }
    const kind =
      member === 'frame' ? 'برواز' : member === 'sash' ? 'دفة' : 'اسكواش';
    return `${kind} ${member === 'frame' ? '' : letter(at.sectionIndex)} ${pos}`
      .replace(/\s+/g, ' ')
      .trim();
  },
  generatedBy: 'Aluminia',
  dateLocale: 'ar-EG-u-nu-latn',
};

export function stringsFor(language: ReportLanguage): PdfStrings {
  return language === 'ar' ? AR : EN;
}

export { fmt };
