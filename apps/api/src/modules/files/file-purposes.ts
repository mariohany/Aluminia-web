import { UserRole } from '@repo/types/auth';
import { FILE_PURPOSE_LIMITS, FilePurpose } from '@repo/types/files';

/**
 * Every kind of upload, in one place (docs/company_profile_planing.md
 * §3b): which types and sizes it takes (shared with the web via
 * `FILE_PURPOSE_LIMITS`) and who may upload it. A new kind of file is one
 * entry here, one in `@repo/types/files`, and the API that attaches it.
 */
export const FILE_PURPOSES: Record<
  FilePurpose,
  { contentTypes: readonly string[]; maxBytes: number; roles: UserRole[] }
> = {
  // The company logo: set from Config, which only a company admin opens.
  [FilePurpose.LOGO]: {
    ...FILE_PURPOSE_LIMITS[FilePurpose.LOGO],
    roles: [UserRole.COMPANY_ADMIN],
  },
  // The platform's logo on quotations and invoices: Billing profile.
  [FilePurpose.BILLING_LOGO]: {
    ...FILE_PURPOSE_LIMITS[FilePurpose.BILLING_LOGO],
    roles: [UserRole.SUPER_ADMIN],
  },
};

/** The largest any purpose accepts: multer's own cap, so a huge upload is
 * cut off while streaming instead of buffered whole. */
export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(FILE_PURPOSES).map((p) => p.maxBytes),
);

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? 'bin';
}

/**
 * The type a file really is, from its first bytes, never from the
 * browser's `Content-Type` (which the client chooses). Null for anything
 * not recognised.
 */
export function sniffContentType(body: Buffer): string | null {
  if (
    body.length >= 8 &&
    body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    body.length >= 12 &&
    body.toString('ascii', 0, 4) === 'RIFF' &&
    body.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
