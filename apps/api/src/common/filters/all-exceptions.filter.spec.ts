import {
  ArgumentsHost,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { reportFailure } from '../monitoring';
import { AllExceptionsFilter } from './all-exceptions.filter';

// What's reported is monitoring.ts's call (monitoring.spec.ts); here only
// that the filter hands it every answered error with the right details.
jest.mock('../monitoring', () => ({ reportFailure: jest.fn() }));

function run(exception: unknown) {
  const json = jest.fn();
  const response = {
    status: jest.fn(() => ({ json })),
    setHeader: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        url: '/projects/7',
        id: 'req-1',
        method: 'GET',
        route: { path: '/projects/:id' },
        user: { id: 'user-1', role: 'USER', companyId: 'company-1' },
      }),
    }),
  } as unknown as ArgumentsHost;
  const logger = { error: jest.fn() };
  new AllExceptionsFilter(logger as unknown as Logger).catch(exception, host);
  return {
    status: (response.status.mock.calls[0] as unknown[])[0],
    body: (json.mock.calls[0] as unknown[])[0] as Record<string, unknown>,
    logged: logger.error.mock.calls.length > 0,
  };
}

describe('AllExceptionsFilter', () => {
  it('passes a machine-readable code through (docs/browser_solve_planing.md §7)', () => {
    const { status, body } = run(
      new ConflictException({ message: 'Reload.', code: 'outdated_client' }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ message: 'Reload.', code: 'outdated_client' });
  });

  it("answers the body parser's own client errors with their status, not 500", () => {
    // What Express's body parser throws for a body over its limit.
    const tooLarge = Object.assign(new Error('request entity too large'), {
      name: 'PayloadTooLargeError',
      status: 413,
      expose: true,
    });
    const { status, body, logged } = run(tooLarge);
    expect(status).toBe(413);
    expect(body).toMatchObject({
      statusCode: 413,
      error: 'PayloadTooLargeError',
      message: 'request entity too large',
    });
    expect(logged).toBe(false);
  });

  it('still hides an unexpected error behind a 500', () => {
    const { status, body, logged } = run(
      Object.assign(new Error('db password is hunter2'), { status: 400 }),
    );
    expect(status).toBe(500);
    expect(body.message).toBe('Something went wrong.');
    expect(body).not.toHaveProperty('code');
    expect(logged).toBe(true);
  });

  it('hands every answered error to monitoring with its status, route and code', () => {
    jest.mocked(reportFailure).mockClear();
    run(new NotFoundException());
    run(new ConflictException({ message: 'Busy.', code: 'solving_elsewhere' }));
    expect(
      jest.mocked(reportFailure).mock.calls.map(([, context]) => context),
    ).toEqual([
      {
        status: 404,
        method: 'GET',
        route: '/projects/:id',
        requestId: 'req-1',
        userId: 'user-1',
        companyId: 'company-1',
        role: 'USER',
        code: undefined,
      },
      expect.objectContaining({ status: 409, code: 'solving_elsewhere' }),
    ]);
  });
});
