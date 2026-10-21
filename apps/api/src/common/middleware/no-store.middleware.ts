import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * No API response may stay on the user's disk (docs/lookup_caching_planing.md
 * D1): lookups, prices and logos would otherwise sit readable in the browser
 * profile of a shared office PC. Set before the handler runs, so error
 * responses from AllExceptionsFilter carry it too. The web keeps what it
 * needs in memory (TanStack Query) instead.
 */
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
}
