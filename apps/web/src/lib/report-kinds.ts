import { FileText, Package, Receipt, Ruler, Scissors, type LucideIcon } from 'lucide-react'

/** Every report the section lists (docs/reports_planing.md §1). Only
 * the bar optimiser exists today; the rest show as "Later". */
export const REPORTS: { key: string; slug: string | null; icon: LucideIcon }[] = [
  { key: 'barOptimiser', slug: 'bar-optimiser', icon: Ruler },
  { key: 'quotation', slug: null, icon: Receipt },
  { key: 'cuttingList', slug: null, icon: Scissors },
  { key: 'specSheet', slug: null, icon: FileText },
  { key: 'orders', slug: null, icon: Package },
]
