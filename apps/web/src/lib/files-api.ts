import type { FilePurpose, UploadedFileSummary } from '@repo/types/files'
import { apiFetch } from '@/lib/api-client'

// The one upload API (docs/company_profile_planing.md P8): upload a file
// for a purpose, keep the returned id, and hand that id to the API that
// uses it (e.g. the company profile's `logoFileId`).

export function uploadFile(file: File, purpose: FilePurpose): Promise<UploadedFileSummary> {
  const body = new FormData()
  body.append('purpose', purpose)
  body.append('file', file)
  return apiFetch<UploadedFileSummary>('/files', { method: 'POST', body })
}

/** The file's bytes. Fetched, not linked: the access token is a Bearer
 * header, which an `<img src>` can't send. */
export function getFileBlob(id: string): Promise<Blob> {
  return apiFetch<Blob>(`/files/${id}`, { responseType: 'blob' })
}
