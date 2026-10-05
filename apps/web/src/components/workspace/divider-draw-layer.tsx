import { useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemType } from '@repo/types/lookups'
import type { WindowDividerInput } from '@repo/types/windows'
import type { PointMm } from '@/lib/arch-geometry'
import { hoverReadout, previewDraw, type DrawPreview, type HoverReadout } from '@/lib/divider-draw'
import type { SnapHit } from '@/lib/dividers'
import { newDivider, nextDividerId, panelGeometry, type PanelLightsContext } from '@/lib/panel-lights'
import { dividerNames, formatDimensionMm, type RectMm, type WindowPart } from '@/lib/window-geometry'
import type { PanelRender } from '@/lib/window-render'

// The Divider tool's capture layer (docs/free_dividers_planing.md §6):
// hover readout, first click on a member, the shadow line, second click
// commits. Sits over the whole drawing while the tool is on, so a click
// on empty canvas cancels. Everything here is panel-local mm until it is
// painted, offset by the panel's rect.

/** Same screen pull as the drawing's other snaps. */
const SNAP_PX = 14

export interface DividerDrawLayerProps {
  panels: PanelRender[]
  panelRects: RectMm[]
  parts: WindowPart[]
  viewBox: { minX: number; minY: number; width: number; height: number }
  scale: number
  strokeWeight: number
  /** Commits the panel's new dividers; `added` are the new divider's
   * ids, for selecting it. */
  onDraw: (panelIndex: number, dividers: WindowDividerInput[], added: string[]) => void
  /** Escape with nothing pending — back to Select. */
  onExit: () => void
}

interface Pending {
  panelIndex: number
  start: SnapHit
}

export function DividerDrawLayer({ panels, panelRects, parts, viewBox, scale, strokeWeight, onDraw, onExit }: DividerDrawLayerProps) {
  const { t } = useTranslation('workspace')
  const [pending, setPending] = useState<Pending | null>(null)
  const [pointer, setPointer] = useState<{ point: PointMm; tolMm: number } | null>(null)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (pending) setPending(null)
      else onExit()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, onExit])

  const ctxFor = (i: number): PanelLightsContext => ({
    metrics: panels[i].metrics,
    doorSill: panels[i].isDoor && panels[i].systemType === SystemType.HINGED,
  })
  const shapeOf = (i: number) => ({
    widthMm: panels[i].placement.widthMm,
    heightMm: panels[i].placement.heightMm,
    headShape: panels[i].headShape,
    headRiseMm: panels[i].headRiseMm,
    dividers: panels[i].dividers,
  })
  const springOffset = (i: number) => panels[i].metrics.dividerFace / 2
  const local = (i: number, p: PointMm): PointMm => ({ x: p.x - panelRects[i].x, y: p.y - panelRects[i].y })
  const global = (i: number, p: PointMm): PointMm => ({ x: p.x + panelRects[i].x, y: p.y + panelRects[i].y })
  const panelAt = (p: PointMm, tol: number) =>
    panelRects.findIndex((r) => p.x >= r.x - tol && p.x <= r.x + r.width + tol && p.y >= r.y - tol && p.y <= r.y + r.height + tol)

  // What the pointer means right now: a hover readout before the first
  // click, the shadow line after it.
  let hover: { panelIndex: number; readout: HoverReadout } | null = null
  let preview: DrawPreview<WindowDividerInput> | null = null
  if (pointer && pending) {
    const i = pending.panelIndex
    const dividers = panels[i].dividers
    const id = nextDividerId(dividers)
    preview = previewDraw(
      panelGeometry(shapeOf(i), ctxFor(i)),
      dividers,
      (from, to) => newDivider(id, from, to),
      pending.start,
      local(i, pointer.point),
      pointer.tolMm,
      springOffset(i),
    )
  } else if (pointer) {
    const i = panelAt(pointer.point, pointer.tolMm)
    if (i >= 0) {
      const readout = hoverReadout(panelGeometry(shapeOf(i), ctxFor(i)), panels[i].dividers, local(i, pointer.point), pointer.tolMm, springOffset(i))
      if (readout) hover = { panelIndex: i, readout }
    }
  }

  const toMm = (e: MouseEvent<SVGRectElement>) => {
    const ctm = e.currentTarget.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { point: { x: p.x, y: p.y }, tolMm: SNAP_PX / ctm.a }
  }

  const onClick = (e: MouseEvent<SVGRectElement>) => {
    const at = toMm(e)
    if (!at) return
    if (pending) {
      // A click outside the panel being drawn in cancels (§6.4).
      if (panelAt(at.point, at.tolMm) !== pending.panelIndex) {
        setPending(null)
        return
      }
      if (preview?.dividers) {
        onDraw(pending.panelIndex, preview.dividers, preview.added)
        setPending(null)
      }
      return
    }
    if (hover) setPending({ panelIndex: hover.panelIndex, start: hover.readout.snap })
  }

  // ---- Labels -------------------------------------------------------------

  const names = dividerNames(parts)
  const memberName = (panelIndex: number, memberId: string, kind: SnapHit['kind']): string => {
    if (kind === 'springing') return t('windowDialog.design.dividerTool.springing')
    if (['left', 'right', 'sill', 'top', 'head'].includes(memberId)) return t(`windowDialog.design.dividerTool.members.${memberId}`)
    const name = names.get(`p${panelIndex}:div-${memberId}`)
    if (!name) return t('windowDialog.design.parts.divider')
    return `${t(name.kind === 'mullion' ? 'windowDialog.design.parts.mullion' : 'windowDialog.design.parts.transom')} ${name.number}`
  }
  const fontSize = scale * 0.02
  const dot = strokeWeight * 2.2
  const refusedColor = 'var(--destructive)'

  let label: { at: PointMm; text: string; danger: boolean } | null = null
  if (preview && pending) {
    const i = pending.panelIndex
    const end = preview.hit ? preview.hit.point : pending.start.point
    const mid = global(i, { x: (pending.start.point.x + end.x) / 2, y: (pending.start.point.y + end.y) / 2 })
    const length = formatDimensionMm(Math.round(preview.lengthMm))
    if (preview.refusal === 'notSquare') label = { at: mid, text: t('windowDialog.design.dividerTool.squareOnly'), danger: true }
    else if (preview.hit) label = { at: mid, text: preview.zone === 'arch' ? `${preview.angleDeg}° · ${length} mm` : `${length} mm`, danger: false }
  } else if (hover && pointer) {
    const { snap, value, unit } = hover.readout
    const name = memberName(hover.panelIndex, snap.anchor.on, snap.kind)
    const text = snap.kind === 'springing' ? name : `${name} · ${unit === 'mm' ? `${formatDimensionMm(value)} mm` : `${value}%`}`
    label = { at: global(hover.panelIndex, snap.point), text, danger: false }
  }

  return (
    <g>
      <rect
        x={viewBox.minX}
        y={viewBox.minY}
        width={viewBox.width}
        height={viewBox.height}
        fill="transparent"
        className="cursor-crosshair"
        onMouseMove={(e) => setPointer(toMm(e))}
        onMouseLeave={() => setPointer(null)}
        onClick={onClick}
      />

      {hover && <circle cx={global(hover.panelIndex, hover.readout.snap.point).x} cy={global(hover.panelIndex, hover.readout.snap.point).y} r={dot} fill="none" stroke="var(--primary)" strokeWidth={strokeWeight} pointerEvents="none" />}

      {pending && (
        <g pointerEvents="none">
          {preview?.hit && (
            <line
              x1={global(pending.panelIndex, pending.start.point).x}
              y1={global(pending.panelIndex, pending.start.point).y}
              x2={global(pending.panelIndex, preview.hit.point).x}
              y2={global(pending.panelIndex, preview.hit.point).y}
              stroke={preview.refusal ? refusedColor : 'var(--primary)'}
              strokeWidth={panels[pending.panelIndex].metrics.dividerFace}
              strokeOpacity={0.35}
            />
          )}
          {preview?.hit && (
            <line
              x1={global(pending.panelIndex, pending.start.point).x}
              y1={global(pending.panelIndex, pending.start.point).y}
              x2={global(pending.panelIndex, preview.hit.point).x}
              y2={global(pending.panelIndex, preview.hit.point).y}
              stroke={preview.refusal ? refusedColor : 'var(--primary)'}
              strokeWidth={strokeWeight}
              strokeDasharray={`${strokeWeight * 4} ${strokeWeight * 3}`}
            />
          )}
          <circle cx={global(pending.panelIndex, pending.start.point).x} cy={global(pending.panelIndex, pending.start.point).y} r={dot} fill="var(--primary)" />
          {preview?.hit && (
            <circle
              cx={global(pending.panelIndex, preview.hit.point).x}
              cy={global(pending.panelIndex, preview.hit.point).y}
              r={dot}
              fill="none"
              stroke={preview.refusal ? refusedColor : 'var(--primary)'}
              strokeWidth={strokeWeight}
            />
          )}
        </g>
      )}

      {label && (
        <text
          x={label.at.x + fontSize * 0.6}
          y={label.at.y - fontSize * 0.6}
          fontSize={fontSize}
          fontWeight={600}
          fill={label.danger ? refusedColor : 'var(--foreground)'}
          stroke="var(--card)"
          strokeWidth={fontSize * 0.25}
          paintOrder="stroke"
          pointerEvents="none"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {label.text}
        </text>
      )}
    </g>
  )
}
