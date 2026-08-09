import { z } from 'zod'

// The super-admin's view of a lead — everything captured at submission
// plus whether it's been called. `contactedAt` is null until
// `POST /admin/leads/:id/contacted`, and only ever moves from null to a
// timestamp; there's no "un-call" action.
export interface LeadSummary {
  id: string
  companyName: string
  requesterName: string
  phone: string
  createdAt: string
  contactedAt: string | null
}

// Bulk delete, driven by the dashboard's row checkboxes rather than a
// single "delete all" button — the caller picks which rows, so the ids
// always come from the client's own selection state.
export const deleteLeadsSchema = z.object({
  ids: z.array(z.uuid()).min(1),
})
export type DeleteLeadsInput = z.infer<typeof deleteLeadsSchema>

export interface DeleteLeadsResponse {
  deletedCount: number
}
