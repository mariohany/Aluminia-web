import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 from the failed-login limit. Carries `retryAfterSeconds`, which
 * AllExceptionsFilter copies into the body and the `Retry-After` header,
 * so the login page can say how long to wait.
 */
export class TooManyLoginAttemptsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        message: 'Too many failed login attempts. Try again later.',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
