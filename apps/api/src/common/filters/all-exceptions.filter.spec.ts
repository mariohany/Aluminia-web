import { ArgumentsHost, ConflictException } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const response = {
    status: jest.fn(() => ({ json })),
    setHeader: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/x', id: 'req-1' }),
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
});
