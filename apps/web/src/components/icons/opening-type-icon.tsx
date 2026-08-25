import { HingedOpeningType } from '@repo/types/windows'

// Transcribed from ~/Desktop/hinged_opening_types_svg/*.svg — same
// literal shapes/coordinates as the source files (a 0..100 viewBox,
// outer frame at 1..99, operable pane at 14..86), just recoloured onto
// this app's theme tokens instead of each file's own hardcoded hex
// (which was inconsistent across files — blue-ish, grey, and white
// backgrounds depending on which one). The drawing's own opening-type
// symbols (window-drawing.tsx) are a *separate* transcription, scaled
// to a real sash rect instead of a fixed thumbnail square — the two
// deliberately don't share code, since one draws on the elevation and
// this one is a static icon-button glyph.
const INK = 'var(--foreground)'
const PANE_OUTER_FILL = 'var(--muted)'
const PANE_INNER_FILL = 'var(--background)'

function OuterFrame({
  inset = 1,
  size = 98,
  fill = PANE_OUTER_FILL,
}: {
  inset?: number
  size?: number
  fill?: string
}) {
  return <rect x={inset} y={inset} width={size} height={size} fill={fill} stroke={INK} strokeWidth={3} />
}

function Pane({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} fill={PANE_INNER_FILL} stroke={INK} strokeWidth={2} />
}

function HingeLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
}

function HingeDot({ cx, cy, r = 3.2 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill={INK} />
}

function DashedArc({ d }: { d: string }) {
  return <path d={d} fill="none" stroke={INK} strokeWidth={1.4} strokeDasharray="2.5,2.5" />
}

const ICON_SHAPES: Record<HingedOpeningType, React.ReactNode> = {
  [HingedOpeningType.TOP_HUNG]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={14} y1={86} x2={50} y2={14} />
      <HingeLine x1={86} y1={86} x2={50} y2={14} />
      <HingeDot cx={50} cy={14} />
    </>
  ),
  [HingedOpeningType.FIXED_CLOSED]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
    </>
  ),
  [HingedOpeningType.SIDE_HUNG_LEFT]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={14} y1={14} x2={86} y2={50} />
      <HingeLine x1={14} y1={86} x2={86} y2={50} />
      <HingeDot cx={14} cy={14} />
      <HingeDot cx={14} cy={86} />
    </>
  ),
  [HingedOpeningType.SIDE_HUNG_RIGHT]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={86} y1={14} x2={14} y2={50} />
      <HingeLine x1={86} y1={86} x2={14} y2={50} />
      <HingeDot cx={86} cy={14} />
      <HingeDot cx={86} cy={86} />
    </>
  ),
  [HingedOpeningType.TILT_TURN_LEFT]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={14} y1={86} x2={50} y2={14} />
      <HingeLine x1={86} y1={86} x2={50} y2={14} />
      <HingeLine x1={14} y1={14} x2={86} y2={50} />
      <HingeLine x1={14} y1={86} x2={86} y2={50} />
      <HingeDot cx={50} cy={14} />
      <HingeDot cx={14} cy={14} />
      <HingeDot cx={14} cy={86} />
    </>
  ),
  [HingedOpeningType.TILT_TURN_RIGHT]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={14} y1={86} x2={50} y2={14} />
      <HingeLine x1={86} y1={86} x2={50} y2={14} />
      <HingeLine x1={86} y1={14} x2={14} y2={50} />
      <HingeLine x1={86} y1={86} x2={14} y2={50} />
      <HingeDot cx={50} cy={14} />
      <HingeDot cx={86} cy={14} />
      <HingeDot cx={86} cy={86} />
    </>
  ),
  [HingedOpeningType.PIVOT_BOTTOM]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <DashedArc d="M 14 50 Q 50.0 32.0 86 50" />
      <HingeLine x1={50} y1={86} x2={14} y2={50} />
      <HingeLine x1={50} y1={86} x2={86} y2={50} />
      <HingeDot cx={50} cy={86} />
    </>
  ),
  [HingedOpeningType.PIVOT_SIDE]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <DashedArc d="M 50 14 Q 39.071067811865476 39.071067811865476 14 50" />
      <DashedArc d="M 50 14 Q 60.928932188134524 39.071067811865476 86 50" />
      <HingeLine x1={50} y1={86} x2={14} y2={50} />
      <HingeLine x1={50} y1={86} x2={86} y2={50} />
      <polygon points="13,46 13,54 18,50" fill={INK} />
      <polygon points="87,46 87,54 82,50" fill={INK} />
      <HingeDot cx={50} cy={86} r={2.4} />
    </>
  ),
  [HingedOpeningType.DOUBLE_DOOR_FRENCH_A]: (
    <>
      <OuterFrame inset={1} size={98} />
      <Pane x={10} y={10} w={38} h={76} />
      <Pane x={52} y={10} w={38} h={76} />
      <HingeLine x1={10} y1={10} x2={48} y2={48} />
      <HingeLine x1={10} y1={86} x2={48} y2={48} />
      <HingeDot cx={10} cy={10} r={2.6} />
      <HingeDot cx={10} cy={86} r={2.6} />
      <HingeLine x1={90} y1={10} x2={52} y2={48} />
      <HingeLine x1={90} y1={86} x2={52} y2={48} />
      <HingeDot cx={90} cy={10} r={2.6} />
      <HingeDot cx={90} cy={86} r={2.6} />
      <rect x={8} y={90} width={20} height={6} fill={INK} />
      <rect x={72} y={90} width={20} height={6} fill={INK} />
    </>
  ),
  [HingedOpeningType.DOUBLE_DOOR_FRENCH_B]: (
    <>
      <OuterFrame inset={1} size={98} />
      <Pane x={10} y={10} w={38} h={76} />
      <Pane x={52} y={10} w={38} h={76} />
      <HingeLine x1={10} y1={10} x2={48} y2={48} />
      <HingeLine x1={10} y1={86} x2={48} y2={48} />
      <HingeDot cx={10} cy={10} r={2.6} />
      <HingeDot cx={10} cy={86} r={2.6} />
      <HingeLine x1={90} y1={10} x2={52} y2={48} />
      <HingeLine x1={90} y1={86} x2={52} y2={48} />
      <HingeDot cx={90} cy={10} r={2.6} />
      <HingeDot cx={90} cy={86} r={2.6} />
      <rect x={8} y={90} width={20} height={6} fill={INK} />
      <rect x={72} y={90} width={20} height={6} fill={INK} />
    </>
  ),
  [HingedOpeningType.SINGLE_DOOR_HINGE_LEFT]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={14} y1={14} x2={86} y2={50} />
      <HingeLine x1={14} y1={86} x2={86} y2={50} />
      <HingeDot cx={14} cy={14} />
      <HingeDot cx={14} cy={86} />
      <rect x={8} y={90} width={84} height={5} fill={INK} />
    </>
  ),
  [HingedOpeningType.SINGLE_DOOR_HINGE_RIGHT]: (
    <>
      <OuterFrame />
      <Pane x={14} y={14} w={72} h={72} />
      <HingeLine x1={86} y1={14} x2={14} y2={50} />
      <HingeLine x1={86} y1={86} x2={14} y2={50} />
      <HingeDot cx={86} cy={14} />
      <HingeDot cx={86} cy={86} />
      <rect x={8} y={90} width={84} height={5} fill={INK} />
    </>
  ),
  [HingedOpeningType.DOUBLE_DOOR_HANDLES_A]: (
    <>
      <OuterFrame inset={1} size={98} />
      <Pane x={10} y={10} w={38} h={76} />
      <Pane x={52} y={10} w={38} h={76} />
      <HingeLine x1={10} y1={10} x2={48} y2={48} />
      <HingeLine x1={10} y1={86} x2={48} y2={48} />
      <HingeDot cx={10} cy={10} r={2.6} />
      <HingeDot cx={10} cy={86} r={2.6} />
      <HingeLine x1={90} y1={10} x2={52} y2={48} />
      <HingeLine x1={90} y1={86} x2={52} y2={48} />
      <HingeDot cx={90} cy={10} r={2.6} />
      <HingeDot cx={90} cy={86} r={2.6} />
      <path d="M 44 46 v 8 h 6" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <path d="M 56 46 v 8 h -6" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <rect x={8} y={90} width={20} height={6} fill={INK} />
      <rect x={72} y={90} width={20} height={6} fill={INK} />
    </>
  ),
  [HingedOpeningType.DOUBLE_DOOR_HANDLES_B]: (
    <>
      <OuterFrame inset={1} size={98} />
      <Pane x={10} y={10} w={38} h={76} />
      <Pane x={52} y={10} w={38} h={76} />
      <HingeLine x1={10} y1={10} x2={48} y2={48} />
      <HingeLine x1={10} y1={86} x2={48} y2={48} />
      <HingeDot cx={10} cy={10} r={2.6} />
      <HingeDot cx={10} cy={86} r={2.6} />
      <HingeLine x1={90} y1={10} x2={52} y2={48} />
      <HingeLine x1={90} y1={86} x2={52} y2={48} />
      <HingeDot cx={90} cy={10} r={2.6} />
      <HingeDot cx={90} cy={86} r={2.6} />
      <path d="M 44 46 v 8 h 6" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <path d="M 56 46 v 8 h -6" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <rect x={8} y={90} width={20} height={6} fill={INK} />
      <rect x={72} y={90} width={20} height={6} fill={INK} />
    </>
  ),
  [HingedOpeningType.FIXED_VERTICAL_MULLION]: (
    <>
      <OuterFrame inset={4} size={92} fill={PANE_INNER_FILL} />
      <line x1={50} y1={4} x2={50} y2={96} stroke={INK} strokeWidth={3} />
    </>
  ),
  [HingedOpeningType.FIXED_HORIZONTAL_MULLION]: (
    <>
      <OuterFrame inset={4} size={92} fill={PANE_INNER_FILL} />
      <line x1={4} y1={62} x2={96} y2={62} stroke={INK} strokeWidth={3} />
    </>
  ),
}

export function OpeningTypeIcon({ type, className }: { type: HingedOpeningType; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {ICON_SHAPES[type]}
    </svg>
  )
}
