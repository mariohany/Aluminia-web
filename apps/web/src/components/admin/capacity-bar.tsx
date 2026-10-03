import { PLATFORM_COMPANY_LIMIT } from '@repo/types/companies'
import { cn } from '@/lib/utils'

/**
 * Companies used out of the platform's cap, as a thin bar: primary, amber
 * from 80%, red at the cap. Shared by the admin sidebar's capacity card
 * and the dashboard's Companies tile.
 */
export function CapacityBar({ used, label, valueText }: { used: number; label: string; valueText: string }) {
  const ratio = Math.min(used / PLATFORM_COMPANY_LIMIT, 1)
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={PLATFORM_COMPANY_LIMIT}
      aria-valuenow={used}
      aria-valuetext={valueText}
      className="h-1.5 w-full overflow-hidden rounded-full bg-accent"
    >
      <div
        className={cn('h-full rounded-full', ratio >= 1 ? 'bg-destructive' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary')}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}
