import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2

/** Wheel pixels per e-fold of zoom: a mouse notch (~100 px) ≈ ×1.3, a
 * pinch's small steps follow the fingers. */
const WHEEL_SCALE = 0.0025
/** One event moves at most this many wheel pixels (fast flicks). */
const MAX_WHEEL_STEP = 120
/** Padding above the first page (the viewer's `py-6`): it doesn't scale. */
const TOP_PADDING = 24

const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** Safari's own pinch event (not in the DOM typings). */
interface GestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

/**
 * Smooth zoom over a scrolling element: a trackpad pinch (Chrome, Edge
 * and Firefox send it as a wheel with Ctrl; Safari as `gesture*`) or
 * Ctrl/⌘ + mouse wheel. A plain wheel still scrolls. The spot under the
 * pointer stays put: the scroll is moved after the zoomed layout. Pages
 * are centred, so x is kept relative to the centre line.
 */
export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  zoom: number,
  setZoom: (zoom: number) => void,
  enabled: boolean,
) {
  // The zoom the next render will have, while events outrun renders.
  const target = useRef(zoom)
  // Where the pointer was in the layout at `from`, until it is restored.
  const anchor = useRef<{ x: number; y: number; fromCentre: number; fromTop: number; from: number } | null>(null)

  useEffect(() => {
    target.current = zoom
  }, [zoom])

  useLayoutEffect(() => {
    const el = ref.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = null
    const f = zoom / a.from
    el.scrollLeft = el.scrollWidth / 2 + a.fromCentre * f - a.x
    el.scrollTop = TOP_PADDING + a.fromTop * f - a.y
  }, [ref, zoom])

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const zoomTo = (next: number, clientX: number, clientY: number) => {
      next = clamp(next)
      if (next === target.current) return
      if (!anchor.current) {
        const rect = el.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top
        anchor.current = {
          x,
          y,
          fromCentre: el.scrollLeft + x - el.scrollWidth / 2,
          fromTop: el.scrollTop + y - TOP_PADDING,
          from: target.current,
        }
      }
      target.current = next
      setZoom(next)
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      // Keeps the browser from zooming the whole page instead.
      e.preventDefault()
      const pixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY
      const step = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, pixels))
      zoomTo(target.current * Math.exp(-step * WHEEL_SCALE), e.clientX, e.clientY)
    }

    let gestureFrom = target.current
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureFrom = target.current
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEvent
      zoomTo(gestureFrom * g.scale, g.clientX, g.clientY)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [ref, setZoom, enabled])
}
