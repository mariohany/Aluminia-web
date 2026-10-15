import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The PDF's fonts (docs/reports_planing.md §8, D24): Geist + Geist Mono
// for Latin text and numbers, IBM Plex Sans Arabic for Arabic — the same
// faces the app uses. Embedded as data URIs so Chrome never fetches
// anything at render time. Read once, on first use.

function fontFile(pkg: string, file: string): string {
  const root = dirname(require.resolve(`${pkg}/package.json`));
  return readFileSync(join(root, 'files', file)).toString('base64');
}

function face(
  family: string,
  data: string,
  weight: string,
  unicodeRange?: string,
): string {
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-style:normal;${unicodeRange ? `unicode-range:${unicodeRange};` : ''}}`;
}

let css: string | null = null;

export function fontCss(): string {
  if (css) return css;
  const arabic = (weight: number) =>
    face(
      'IBM Plex Sans Arabic',
      fontFile(
        '@fontsource/ibm-plex-sans-arabic',
        `ibm-plex-sans-arabic-arabic-${weight}-normal.woff2`,
      ),
      String(weight),
      'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC',
    );
  css = [
    face(
      'Geist',
      fontFile('@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'),
      '100 900',
    ),
    face(
      'Geist Mono',
      fontFile(
        '@fontsource-variable/geist-mono',
        'geist-mono-latin-wght-normal.woff2',
      ),
      '100 900',
    ),
    arabic(400),
    arabic(500),
    arabic(600),
    arabic(700),
  ].join('\n');
  return css;
}
