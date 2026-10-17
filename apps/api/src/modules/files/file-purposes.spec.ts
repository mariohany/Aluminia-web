import { FilePurpose } from '@repo/types/files';
import {
  FILE_PURPOSES,
  MAX_UPLOAD_BYTES,
  sniffContentType,
} from './file-purposes';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('sniffContentType', () => {
  it('reads PNG, JPEG and WebP from their first bytes', () => {
    expect(sniffContentType(PNG)).toBe('image/png');
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
    expect(sniffContentType(WEBP)).toBe('image/webp');
  });

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['GIF', Buffer.from('GIF89a......')],
    ['PDF', Buffer.from('%PDF-1.7')],
    [
      'RIFF that is not WebP',
      Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt '),
    ],
    ['empty', Buffer.alloc(0)],
    ['truncated PNG', PNG.subarray(0, 5)],
  ])('returns null for %s', (_, body) => {
    expect(sniffContentType(body)).toBeNull();
  });
});

describe('FILE_PURPOSES', () => {
  it('takes logos as PNG / JPEG / WebP up to 1 MB, from company admins only (Q1)', () => {
    expect(FILE_PURPOSES[FilePurpose.LOGO]).toEqual({
      contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 1024 * 1024,
      roles: ['company_admin'],
    });
  });

  it('caps multer at the largest purpose', () => {
    expect(MAX_UPLOAD_BYTES).toBe(1024 * 1024);
  });
});
