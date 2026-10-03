// Audit-log entries as readable sentences (dashboard "Recent admin
// activity" card and the Logs page). Plain module so the hook and the
// AuditIcon component (components/admin/audit-entry.tsx) live apart.
import { useTranslation } from 'react-i18next'
import { Building2, Database, Phone, UserRound, type LucideIcon } from 'lucide-react'
import type { AuditLogEntry } from '@repo/types/logs'

type Tone = 'primary' | 'danger' | 'warn' | 'info' | 'neutral'

export const TONE_CLASS: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  danger: 'bg-destructive/10 text-destructive',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-500',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  neutral: 'bg-muted text-muted-foreground',
}

// The verb (last part of the action) decides the colour for company and
// user actions; catalogue and lead entries stay neutral.
const VERB_TONE: Record<string, Tone> = {
  created: 'primary',
  reactivated: 'primary',
  updated: 'info',
  plan_changed: 'info',
  archived: 'danger',
  deactivated: 'danger',
  deleted: 'danger',
  password_reset: 'warn',
  session_ended: 'warn',
}

// Audit `lookup.<entity>.<verb>` → the Data warehouse tab it belongs to
// (lookups.json `tables.*`), so a catalogue entry names the table.
const LOOKUP_TABLE: Record<string, string> = {
  system_brand: 'systemBrands',
  system_catalog: 'systemCatalogs',
  system_profile: 'systemProfiles',
  glass: 'glass',
  glass_combination: 'glassCombinations',
  color: 'colors',
  paint_brand: 'paintingPrices',
  painting_price: 'paintingPrices',
}

export interface Described {
  icon: LucideIcon
  tone: Tone
  text: string
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/**
 * One readable sentence per audit entry, filled from its metadata (what
 * companies.service / users.service / leads.service / the lookup
 * services record). An action this doesn't know shows its raw name, so
 * a new audit action never renders as a blank row.
 */
type Translate = (key: string, options?: Record<string, unknown>) => string

function describe(entry: AuditLogEntry, t: Translate, tLookups: Translate, exists: (key: string) => boolean): Described {
  const meta = entry.metadata ?? {}
  const [area, ...rest] = entry.action.split('.')
  const verb = rest[rest.length - 1] ?? ''
  const fallback: Described = { icon: Database, tone: 'neutral', text: entry.action }

  if (area === 'company' || area === 'user') {
    const key = `dashboardPage.activity.actions.${entry.action}`
    if (!exists(key)) return fallback
    return {
      icon: area === 'company' ? Building2 : UserRound,
      tone: VERB_TONE[verb] ?? 'neutral',
      text: t(key, {
        name: text(meta.name),
        email: text(meta.email),
        plan: text(meta.plan),
        maxUsers: text(meta.maxUsers),
      }),
    }
  }

  if (area === 'lead') {
    if (entry.action === 'lead.deleted') {
      return { icon: Phone, tone: 'neutral', text: t('dashboardPage.activity.actions.lead.deleted', { name: text(meta.companyName) }) }
    }
    if (entry.action === 'lead.deleted_bulk') {
      return {
        icon: Phone,
        tone: 'neutral',
        text: t('dashboardPage.activity.actions.lead.deletedBulk', { count: Number(meta.count) || 0 }),
      }
    }
    return { ...fallback, icon: Phone }
  }

  if (area === 'lookup') {
    if (entry.action === 'lookup.systems.imported') {
      return { icon: Database, tone: 'neutral', text: t('dashboardPage.activity.lookup.systemsImported') }
    }
    const table = LOOKUP_TABLE[rest[0] ?? '']
    const key = `dashboardPage.activity.lookup.${verb}`
    if (!table || !exists(key)) return fallback
    const name = text(meta.name)
    const sentence = t(key, { table: tLookups(`tables.${table}`), count: Number(meta.count) || 0 })
    return { icon: Database, tone: 'neutral', text: name ? `${sentence} · ${name}` : sentence }
  }

  return fallback
}

/**
 * `describe` bound to the current language — a hook so both the
 * dashboard card and the Logs page get the same sentences.
 */
export function useDescribeAudit(): (entry: AuditLogEntry) => Described {
  const { t, i18n } = useTranslation('admin')
  const { t: tLookups } = useTranslation('lookups')
  return (entry) =>
    describe(entry, t, tLookups, (key) =>
      // Plural-only keys (bulk counts) exist as `<key>_other`.
      i18n.exists(key, { ns: 'admin' }) || i18n.exists(`${key}_other`, { ns: 'admin' }),
    )
}

