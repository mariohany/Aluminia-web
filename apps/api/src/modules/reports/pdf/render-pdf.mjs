// Prints one HTML file to PDF with headless Chrome, then exits
// (docs/reports_planing.md §8). Plain ESM on purpose: Puppeteer is
// ESM-only, and a separate process keeps it out of the API's CommonJS
// and Jest worlds. One Chrome per render, gone afterwards: nothing
// resident between reports (Render free has 512 MB).
//
//   node render-pdf.mjs <in.html> <footer.html> <out.pdf>

import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const [, , htmlPath, footerPath, outPath] = process.argv;

// chrome-headless-shell in one process: the same PDF in less than half
// the memory of full Chrome (583 → 267 MB on Linux;
// docs/report_queue_planing.md §1, C9).
const browser = await puppeteer.launch({
  headless: 'shell',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--single-process',
    '--no-zygote',
  ],
});
try {
  const page = await browser.newPage();
  await page.setContent(await readFile(htmlPath, 'utf8'), {
    waitUntil: 'load',
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: await readFile(footerPath, 'utf8'),
    margin: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
    timeout: 20_000,
  });
  await writeFile(outPath, pdf);
} finally {
  await browser.close();
}
