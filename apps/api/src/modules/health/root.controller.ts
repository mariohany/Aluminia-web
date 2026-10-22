import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

// Render requests `GET /` and `HEAD /` on every new instance after a
// deploy. With no route there they were 404s, and every 404 goes to
// Sentry (ALUMINIA-API-3 / -4). An empty 204 answers them; the real
// check stays `/health`. Express answers HEAD from the GET route.
@Controller()
export class RootController {
  @Public()
  @Get()
  @HttpCode(HttpStatus.NO_CONTENT)
  root(): void {}
}
