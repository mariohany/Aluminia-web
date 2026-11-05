import { z } from 'zod'

// ETA e-invoicing readiness (docs/payment_cycle_planing.md §9, P8; tasks
// phase 8, Mario 2026-11-05: optional for now, alongside the free-text
// addresses). Stored and copied onto invoices today; the ETA integration
// (submission, signing) is its own later plan and will make them required.

/** B business · P person · F foreign (the ETA receiver type). */
export const ETA_BUYER_TYPES = ['B', 'P', 'F'] as const
export type EtaBuyerType = (typeof ETA_BUYER_TYPES)[number]

export const ETA_LIMITS = {
  governorate: 80,
  city: 80,
  street: 160,
  building: 40,
  activityCode: 10,
  itemCode: 100,
} as const

/** The structured address the ETA wants (country ISO 3166-1 alpha-2). */
export interface EtaAddress {
  country: string | null
  governorate: string | null
  city: string | null
  street: string | null
  building: string | null
}

const optional = (max: number) => z.string().trim().min(1).max(max).nullable().optional()

/** The flat address fields a form saves (each optional, null clears). */
export const etaAddressFields = {
  etaCountry: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Two capital letters, e.g. EG.')
    .nullable()
    .optional(),
  etaGovernorate: optional(ETA_LIMITS.governorate),
  etaCity: optional(ETA_LIMITS.city),
  etaStreet: optional(ETA_LIMITS.street),
  etaBuilding: optional(ETA_LIMITS.building),
}

export interface EtaAddressFields {
  etaCountry: string | null
  etaGovernorate: string | null
  etaCity: string | null
  etaStreet: string | null
  etaBuilding: string | null
}

/** The address as a document snapshot keeps it; null when nothing is filled. */
export function etaAddressOf(fields: Partial<EtaAddressFields>): EtaAddress | null {
  const address: EtaAddress = {
    country: fields.etaCountry ?? null,
    governorate: fields.etaGovernorate ?? null,
    city: fields.etaCity ?? null,
    street: fields.etaStreet ?? null,
    building: fields.etaBuilding ?? null,
  }
  return Object.values(address).some((v) => v !== null) ? address : null
}

export const etaActivityCode = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/, 'Digits only, e.g. 6201.')
  .nullable()
  .optional()

export const etaItemCode = z.string().trim().min(1).max(ETA_LIMITS.itemCode).nullable().optional()
