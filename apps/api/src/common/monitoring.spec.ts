import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';
import {
  FailureCap,
  reportFailure,
  scrubEvent,
  shouldReport,
  type FailureContext,
} from './monitoring';

jest.mock('@sentry/nestjs', () => ({
  isInitialized: jest.fn(() => true),
  withScope: jest.fn(),
  captureException: jest.fn(),
}));

const scope = {
  setLevel: jest.fn(),
  setUser: jest.fn(),
  setTags: jest.fn(),
  setFingerprint: jest.fn(),
};
const sentry = jest.mocked(Sentry);
sentry.withScope.mockImplementation(((callback: (s: typeof scope) => void) =>
  callback(scope)) as unknown as typeof Sentry.withScope);

const HOUR = 3_600_000;
// Each test gets its own clock hour, so the module's cap starts empty.
let hour = 1;
const context = (over: Partial<FailureContext> = {}): FailureContext => ({
  status: 404,
  method: 'GET',
  route: '/projects/:id',
  requestId: 'req-1',
  userId: 'user-1',
  companyId: 'company-1',
  role: 'USER',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  hour++;
});

describe('shouldReport (docs/sentry_planing.md §4)', () => {
  it('reports crashes and 5xx, and of the 4xx only 400 and 404', () => {
    for (const status of [500, 502, 503, 400, 404]) {
      expect(shouldReport(status)).toBe(true);
    }
    for (const status of [401, 403, 409, 413, 422, 429]) {
      expect(shouldReport(status)).toBe(false);
    }
  });
});

describe('reportFailure', () => {
  it('sends a 5xx as an error, grouped by its stack', () => {
    reportFailure(new Error('boom'), context({ status: 500 }), hour * HOUR);
    expect(scope.setLevel).toHaveBeenCalledWith('error');
    expect(scope.setFingerprint).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('sends a 404 as a warning, one issue per method + route + status + code', () => {
    reportFailure(new Error('Not Found'), context(), hour * HOUR);
    expect(scope.setLevel).toHaveBeenCalledWith('warning');
    expect(scope.setFingerprint).toHaveBeenCalledWith([
      'http',
      '404',
      'GET',
      '/projects/:id',
      '',
    ]);
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
    expect(scope.setTags).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', requestId: 'req-1' }),
    );
  });

  it('sends nothing for a 401, a 403 or a 409', () => {
    for (const status of [401, 403, 409]) {
      reportFailure(new Error('no'), context({ status }), hour * HOUR);
    }
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends nothing when Sentry was never started (no DSN)', () => {
    sentry.isInitialized.mockReturnValueOnce(false);
    reportFailure(new Error('boom'), context({ status: 500 }), hour * HOUR);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('stops after 10 of the same route + status in an hour', () => {
    for (let i = 0; i < 15; i++) {
      reportFailure(new Error('Not Found'), context(), hour * HOUR + i);
    }
    expect(sentry.captureException).toHaveBeenCalledTimes(10);
  });
});

describe('FailureCap (§7.2)', () => {
  it('allows 100 an hour in all and 10 per key, then starts again next hour', () => {
    const cap = new FailureCap();
    const start = 5 * HOUR;
    let allowed = 0;
    for (let route = 0; route < 20; route++) {
      for (let i = 0; i < 10; i++) if (cap.allow(`r${route}`, start)) allowed++;
    }
    expect(allowed).toBe(100);
    expect(cap.allow('r0', start + HOUR - 1)).toBe(false);
    expect(cap.allow('r0', start + HOUR)).toBe(true);
  });
});

describe('scrubEvent (§8)', () => {
  it('removes the body, cookies, headers, query strings, frame variables and all but the user id', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://api/projects/1',
        data: { password: 'hunter2' },
        cookies: { refresh: 'secret' },
        headers: { authorization: 'Bearer secret' },
        query_string: 'q=Villa',
      },
      user: { id: 'user-1', email: 'a@b.c', ip_address: '1.2.3.4' },
      exception: {
        values: [
          {
            value: 'Cannot GET /no-such-page?q=Villa',
            stacktrace: { frames: [{ vars: { password: 'hunter2' } }] },
          },
        ],
      },
    } as ErrorEvent;
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request).toEqual({ url: 'https://api/projects/1' });
    expect(scrubbed.user).toEqual({ id: 'user-1' });
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual(
      {},
    );
    // Found by running the built API against a fake Sentry: Nest's own 404
    // message carries the query string, which can hold a searched name.
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'Cannot GET /no-such-page',
    );
  });
});
