import { isRtlLanguage } from '@/lib/i18n'

interface Bilingual {
  enName: string
  arName: string | null
}

/**
 * The display name for a bilingual record, in the active language.
 *
 * ONE implementation on purpose. Arabic is optional everywhere (see
 * docs/projects_planing.md's bilingual rule), so every surface that
 * renders a client or a project needs this same fallback — and every
 * bilingual entity added later will too. Copies of it drift, and a
 * surface that forgets the fallback renders an empty row rather than an
 * obviously-missing translation.
 *
 * Note this is a *display* decision, not a data one: paperwork
 * generation will face the same question and must answer it
 * deliberately rather than reusing this silently. An Arabic quote that
 * quietly prints an English name is a bug, not a fallback.
 */
export function displayName(entity: Bilingual, language: string): string {
  if (isRtlLanguage(language)) return entity.arName?.trim() || entity.enName
  return entity.enName
}
