import { z } from 'zod'

// One upload API for every file (docs/company_profile_planing.md P8, §3b):
// `POST /files` takes the file + a purpose and returns an opaque id;
// the API that uses the file stores that id.

export const FilePurpose = {
  LOGO: 'logo',
} as const
export type FilePurpose = (typeof FilePurpose)[keyof typeof FilePurpose]
export const filePurposeSchema = z.enum([FilePurpose.LOGO])

/** The multipart fields next to `file`. */
export const uploadFileSchema = z.object({ purpose: filePurposeSchema }).strict()
export type UploadFileInput = z.infer<typeof uploadFileSchema>

/** What each purpose accepts. The API checks the type from the file's own
 * bytes, never the browser's MIME. Logo: PNG / JPEG / WebP only, no SVG
 * (an SVG can carry scripts; Mario 2026-10-17, Q1). */
export const FILE_PURPOSE_LIMITS = {
  [FilePurpose.LOGO]: {
    contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: 1024 * 1024,
  },
} as const satisfies Record<FilePurpose, { contentTypes: readonly string[]; maxBytes: number }>

export interface UploadedFileSummary {
  id: string
  purpose: FilePurpose
  contentType: string
  sizeBytes: number
}
