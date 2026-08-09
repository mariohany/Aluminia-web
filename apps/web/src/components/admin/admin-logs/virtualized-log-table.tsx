import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const ROW_HEIGHT = 40
const HEADER_HEIGHT = 40
const OVERSCAN = 2
// Upper bound on how many row elements can ever sit in the DOM at once.
// Visible rows are sized down to leave room for the overscan buffer on
// both edges within that same budget, so the total never exceeds it.
const MAX_RENDERED_ROWS = 20
const VISIBLE_ROWS = MAX_RENDERED_ROWS - OVERSCAN * 2

export interface LogColumn<T> {
  key: string
  header: string
  width: string
  cell: (row: T) => React.ReactNode
  className?: string
}

interface VirtualizedLogTableProps<T> {
  columns: LogColumn<T>[]
  rows: T[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  loadingMoreLabel: string
}

// A fixed, small number of row elements exist in the DOM at any time
// (at most MAX_RENDERED_ROWS) regardless of how many hundreds of entries
// are loaded — scrolling recycles those positions with different data
// instead of growing the DOM per row, the same trade RecyclerView makes
// on Android. Fetching more data (the react-query infinite pages) and
// rendering more rows (the virtualizer's window) are deliberately
// separate concerns here.
export function VirtualizedLogTable<T>({
  columns,
  rows,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  loadingMoreLabel,
}: VirtualizedLogTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridTemplateColumns = columns.map((c) => c.width).join(' ')

  const rowCount = rows.length + (hasNextPage ? 1 : 0)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems.at(-1)
    if (!last) return
    if (last.index >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [virtualItems, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border">
      <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns }}>
        {columns.map((column) => (
          <div
            key={column.key}
            className="flex h-10 min-w-0 items-center truncate px-2 text-sm font-medium text-foreground"
          >
            {column.header}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        style={{ maxHeight: HEADER_HEIGHT + VISIBLE_ROWS * ROW_HEIGHT }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                className="absolute inset-x-0 top-0 grid w-full items-center border-b border-border text-sm hover:bg-muted/50"
                style={{
                  gridTemplateColumns,
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row ? (
                  columns.map((column) => (
                    <div key={column.key} className={cn('min-w-0 truncate px-2', column.className)}>
                      {column.cell(row)}
                    </div>
                  ))
                ) : (
                  <div className="col-span-full flex min-w-0 items-center gap-2 truncate px-2 text-muted-foreground">
                    <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    {loadingMoreLabel}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
