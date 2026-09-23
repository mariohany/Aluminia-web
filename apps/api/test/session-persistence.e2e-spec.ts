import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@repo/types/auth';
import { AppModule } from './../src/app.module';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * "Stay logged in until something actually invalidates the session."
 *
 * Real Postgres, real HTTP, real cookies. The bug these guard against:
 * the refresh token rotates on every call, and when the token it
 * replaced died instantly, a browser waking several tabs at once fired
 * several /auth/refresh calls with the same cookie — one won, the rest
 * were left holding a token the session row no longer stored, and the
 * user was bounced to the login screen on what looked like every visit.
 * Rotated-away tokens now stay valid for REFRESH_GRACE_MS.
 */
describe('Session persistence (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const email = 'e2e-session@test.local';
  const password = 'TestPassword123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts registers this for the real server; an e2e app is built
    // straight from AppModule and never runs bootstrap(), so without it
    // `req.cookies` is undefined and every refresh here would 401 for
    // the wrong reason.
    app.use(cookieParser());
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const passwordService = app.get(PasswordService);

    await controlPlane.query(`DELETE FROM users WHERE email = $1`, [email]);
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [email, await passwordService.hash(password), UserRole.SUPER_ADMIN],
    );
  });

  afterAll(async () => {
    try {
      await controlPlane.query(`DELETE FROM users WHERE email = $1`, [email]);
    } finally {
      await app.close();
    }
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return refreshCookie(res);
  }

  function refreshCookie(res: request.Response): string {
    const headers = res.headers['set-cookie'] as unknown as string[];
    const cookie = headers.find((value) => value.startsWith('refresh_token='));
    if (!cookie) throw new Error('No refresh cookie on the response.');
    return cookie.split(';')[0];
  }

  function cookieExpiry(res: request.Response): Date {
    const headers = res.headers['set-cookie'] as unknown as string[];
    const cookie = headers.find((value) => value.startsWith('refresh_token='));
    const expires = /Expires=([^;]+)/.exec(cookie ?? '')?.[1];
    return new Date(expires ?? 0);
  }

  const refreshWith = (cookie: string) =>
    request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);

  it('restores a session from the refresh cookie alone, weeks out', async () => {
    const cookie = await login();

    const res = await refreshWith(cookie).expect(200);

    expect((res.body as { accessToken: string }).accessToken).toEqual(
      expect.any(String),
    );
    // Sliding 30-day window — anything under a fortnight means the TTL
    // was quietly shortened.
    const daysOut =
      (cookieExpiry(res).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(14);
  });

  it('survives several tabs refreshing the same cookie at once', async () => {
    const cookie = await login();

    const responses = await Promise.all(
      [1, 2, 3, 4].map(() => refreshWith(cookie)),
    );

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200]);

    // Whichever of those four cookies the browser ends up keeping, the
    // next page load has to work — that is the whole point.
    for (const res of responses) {
      await refreshWith(refreshCookie(res)).expect(200);
    }
  });

  it('refuses a token past its grace window without logging the session out', async () => {
    const first = await login();
    const second = refreshCookie(await refreshWith(first).expect(200));

    // Age out the grace list rather than waiting a minute for it.
    await controlPlane.query(
      `UPDATE sessions SET grace_tokens = '[]'::jsonb WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );

    await refreshWith(first).expect(401);
    // The holder of the current token is still signed in.
    await refreshWith(second).expect(200);
  });

  it('ends the session on logout', async () => {
    const cookie = await login();

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    await refreshWith(cookie).expect(401);
  });
});
