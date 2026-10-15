import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../../../config/env.schema';

/** A render that hasn't finished by now is killed (Chrome hung). */
const RENDER_TIMEOUT_MS = 60_000;

/**
 * HTML → PDF through headless Chrome, one render at a time
 * (docs/reports_planing.md §8). Each render runs `render-pdf.mjs` in its
 * own Node process: Puppeteer is ESM-only, and a short-lived Chrome
 * keeps nothing resident between reports.
 */
@Injectable()
export class PdfRenderer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService<Env, true>) {}

  render(html: string, footer: string): Promise<Buffer> {
    const task = this.queue.then(() => this.renderNow(html, footer));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async renderNow(html: string, footer: string): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'aluminia-pdf-'));
    try {
      const htmlPath = join(dir, 'report.html');
      const footerPath = join(dir, 'footer.html');
      const outPath = join(dir, 'report.pdf');
      await writeFile(htmlPath, html, 'utf8');
      await writeFile(footerPath, footer, 'utf8');
      await this.runScript([htmlPath, footerPath, outPath]);
      return await readFile(outPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private runScript(args: string[]): Promise<void> {
    const executable = this.config.get('PUPPETEER_EXECUTABLE_PATH', {
      infer: true,
    });
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(__dirname, 'render-pdf.mjs'), ...args],
        {
          env: {
            ...process.env,
            ...(executable ? { PUPPETEER_EXECUTABLE_PATH: executable } : {}),
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), RENDER_TIMEOUT_MS);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `PDF render failed (${signal ?? `exit ${code}`}): ${stderr.trim().split('\n').slice(-3).join(' ')}`,
            ),
          );
      });
    });
  }
}
