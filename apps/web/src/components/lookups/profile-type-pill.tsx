import { useTranslation } from 'react-i18next'
import type { ProfileType } from '@repo/types/lookups'
import { cn } from '@/lib/utils'

// One hue per profile type so a long profiles list scans by colour
// (Mario, 2026-10-03). UI colour only — not a material colour.
const TYPE_CLASS: Record<ProfileType, string> = {
  frame: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
  leaf: 'bg-violet-500/12 text-violet-700 dark:text-violet-400',
  transom: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  glass_beading: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  insert: 'bg-rose-500/12 text-rose-700 dark:text-rose-400',
  sliding_insert: 'bg-teal-500/12 text-teal-700 dark:text-teal-400',
  control_rod: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  bottom_rail: 'bg-orange-500/12 text-orange-700 dark:text-orange-400',
}

/** A profile's type as a coloured pill (Data warehouse, company Data page). */
export function ProfileTypePill({ type }: { type: ProfileType }) {
  const { t } = useTranslation('lookups')
  return (
    <span className={cn('inline-flex h-5.5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap', TYPE_CLASS[type])}>
      {t(`profileType.${type}`)}
    </span>
  )
}
