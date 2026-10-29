import { Writable } from 'node:stream';
import pino from 'pino';
import { LOG_REDACT_PATHS } from './logger.module';

describe('request log redaction', () => {
  it('never writes the access token or the refresh cookie', () => {
    const lines: string[] = [];
    const out = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino(
      { redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } },
      out,
    );

    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer secret-access',
            cookie: 'refresh_token=secret-refresh',
            'user-agent': 'jest',
          },
        },
        res: { headers: { 'set-cookie': 'refresh_token=secret-new' } },
      },
      'request completed',
    );

    const line = lines.join('');
    expect(line).not.toContain('secret');
    const logged = JSON.parse(line) as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(logged.req.headers.authorization).toBe('[redacted]');
    expect(logged.req.headers.cookie).toBe('[redacted]');
    expect(logged.res.headers['set-cookie']).toBe('[redacted]');
    expect(logged.req.headers['user-agent']).toBe('jest');
  });
});
