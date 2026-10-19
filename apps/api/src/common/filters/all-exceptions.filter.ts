import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Request, Response } from 'express';

// A plain number, not the enum member, so the >= comparison below never
// mixes an enum type with a plain number (eslint's
// no-unsafe-enum-comparison rule flags that combination either way).
const INTERNAL_SERVER_ERROR_CODE: number = HttpStatus.INTERNAL_SERVER_ERROR;

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
  /** Set on a 429 that knows when it lifts (the failed-login limit). */
  retryAfterSeconds?: number;
  /** A machine-readable reason the client branches on, when the
   * exception was raised with one (e.g. `outdated_client`). */
  code?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const isHttpException = exception instanceof HttpException;
    const clientError = isHttpException ? null : exposedClientError(exception);
    const statusCode: number = isHttpException
      ? exception.getStatus()
      : (clientError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);

    const body: ErrorBody = {
      statusCode,
      error: isHttpException
        ? exception.name
        : (clientError?.name ?? 'InternalServerError'),
      // Never leak an unexpected error's message to the client — only
      // HttpExceptions we raised ourselves, and the body parser's own
      // client errors, are safe to echo back.
      message: isHttpException
        ? extractMessage(exception)
        : (clientError?.message ?? 'Something went wrong.'),
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    const retryAfterSeconds = isHttpException
      ? extractRetryAfter(exception)
      : undefined;
    if (retryAfterSeconds !== undefined) {
      body.retryAfterSeconds = retryAfterSeconds;
      response.setHeader('Retry-After', String(retryAfterSeconds));
    }

    const code = isHttpException ? extractCode(exception) : undefined;
    if (code !== undefined) body.code = code;

    if (
      (!isHttpException && !clientError) ||
      statusCode >= INTERNAL_SERVER_ERROR_CODE
    ) {
      this.logger.error(
        { err: exception, requestId: request.id },
        'Unhandled exception',
      );
    }

    response.status(statusCode).json(body);
  }
}

function extractMessage(exception: HttpException): string | string[] {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (
    typeof response === 'object' &&
    response !== null &&
    'message' in response
  ) {
    return (response as { message: string | string[] }).message;
  }
  return exception.message;
}

/**
 * Express's body parser rejects a body before Nest sees it (too large,
 * malformed JSON) with an `http-errors` error, not an HttpException. It
 * marks 4xx ones `expose: true`, meaning the message is safe to show:
 * answer with that status (413, 400) instead of a 500.
 */
function exposedClientError(
  exception: unknown,
): { status: number; message: string; name: string } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const { status, expose, message, name } = exception as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
    name?: unknown;
  };
  if (
    expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof message === 'string'
  ) {
    return {
      status,
      message,
      name: typeof name === 'string' ? name : 'ClientError',
    };
  }
  return null;
}

function extractCode(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    typeof response.code === 'string'
  ) {
    return (response as { code: string }).code;
  }
  return undefined;
}

function extractRetryAfter(exception: HttpException): number | undefined {
  const response = exception.getResponse();
  if (
    typeof response === 'object' &&
    response !== null &&
    'retryAfterSeconds' in response &&
    typeof response.retryAfterSeconds === 'number'
  ) {
    return response.retryAfterSeconds;
  }
  return undefined;
}
