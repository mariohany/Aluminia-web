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
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const isHttpException = exception instanceof HttpException;
    const statusCode: number = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorBody = {
      statusCode,
      error: isHttpException ? exception.name : 'InternalServerError',
      // Never leak an unexpected error's message to the client — only
      // HttpExceptions we raised ourselves are safe to echo back.
      message: isHttpException
        ? extractMessage(exception)
        : 'Something went wrong.',
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    if (!isHttpException || statusCode >= INTERNAL_SERVER_ERROR_CODE) {
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
