import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Routes are protected by default (JwtAuthGuard is registered globally
// in AppModule) — this is the explicit opt-out, so a new endpoint has to
// deliberately choose to be public rather than accidentally end up that
// way.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
