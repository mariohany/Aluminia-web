import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { UserRole } from '@repo/types/auth';
import { AppModule } from './../src/app.module';
import { PasswordService } from './../src/modules/auth/password.service';
import {
  LOGIN_FAILURE_LIMIT_PER_EMAIL,
  LOGIN_FAILURE_LIMIT_PER_IP,
  REFRESH_RATE_LIMIT,
} from './../src/modules/auth/auth.constants';

/**
 * Stability S1: failed logins are limited per email and per IP, counted
 * in real Redis, and /auth/refresh has its own per-IP limit.
 *
 * Every e2e suite runs in parallel from 127.0.0.1, so blocking that IP
 * here would fail other suites' logins. Instead each test calls from its
 * own made-up IP (X-Forwarded-For, trusted by this test app only) and
 * logs in as its own user, new each run — nothing here touches another
 * test's or suite's counts, and nothing needs clearing: the keys expire
 * on their own.
 */
describe('Login rate limit (e2e)', () => {
  let app: NestExpressApplication;
  let controlPlane: DataSource;
  let passwordHash: string;

  const run = Math.random().toString(36).slice(2, 8);
  const password = 'TestPassword123!';
  const created: string[] = [];

  // 198.18.0.0/15 (131,072 addresses) is reserved for benchmarking —
  // never a real caller. Each run takes its own block of 8 (it uses 7),
  // picked by the current second: blocks repeat only every ~4.5 hours,
  // so a run never lands on an IP an earlier run blocked within the
  // 15-minute window.
  let nextIp = (Math.floor(Date.now() / 1000) * 8) % 131_072;
  const freshIp = () => {
    const n = nextIp++;
    return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
  };

  async function freshUser(): Promise<string> {
    const email = `e2e-login-limit-${run}-${created.length}@test.local`;
    await controlPlane.query(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active')`,
      [email, passwordHash, UserRole.SUPER_ADMIN],
    );
    created.push(email);
    return email;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', true);
    app.use(cookieParser());
    // Listening on one port up front: left to itself, supertest opens a
    // fresh ephemeral port per request, and the bursts of 20-60 requests
    // here then intermittently fail with "socket hang up" under the load
    // of the other suites.
    await app.listen(0);

    controlPlane = app.get<DataSource>(getDataSourceToken());
    passwordHash = await app.get(PasswordService).hash(password);
  });

  afterAll(async () => {
    try {
      await controlPlane.query(`DELETE FROM users WHERE email = ANY($1)`, [
        created,
      ]);
    } finally {
      await app.close();
    }
  });

  const login = (ip: string, email: string, pass: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: pass });

  it('blocks an email after 5 failures, even with the right password, and says when it lifts', async () => {
    const ip = freshIp();
    const email = await freshUser();
    const other = await freshUser();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT_PER_EMAIL; i++) {
      await login(ip, email, 'wrong-password').expect(401);
    }

    const res = await login(ip, email, password).expect(429);
    const body = res.body as { retryAfterSeconds?: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(res.headers['retry-after']).toBe(String(body.retryAfterSeconds));

    // Blocked from every IP, not just the one the guesses came from.
    await login(freshIp(), email, password).expect(429);
    // Another account from the same IP is unaffected.
    await login(ip, other, password).expect(200);
  });

  it('counts the email case-insensitively', async () => {
    const ip = freshIp();
    const email = await freshUser();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT_PER_EMAIL; i++) {
      const sent = i % 2 ? email.toUpperCase() : email;
      await login(ip, sent, 'wrong-password').expect(401);
    }
    await login(ip, email, password).expect(429);
  });

  it('a successful login clears the email count', async () => {
    const ip = freshIp();
    const email = await freshUser();
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < LOGIN_FAILURE_LIMIT_PER_EMAIL - 1; i++) {
        await login(ip, email, 'wrong-password').expect(401);
      }
      await login(ip, email, password).expect(200);
    }
  });

  it('blocks an IP after 20 failures spread over many emails', async () => {
    const ip = freshIp();
    const email = await freshUser();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT_PER_IP; i++) {
      await login(ip, `nobody-${run}-${i}@test.local`, 'guess').expect(401);
    }
    await login(ip, email, password).expect(429);
    // The same account from another IP is fine.
    await login(freshIp(), email, password).expect(200);
  });

  it('limits /auth/refresh per IP', async () => {
    const ip = freshIp();
    const server = app.getHttpServer();
    for (let i = 0; i < REFRESH_RATE_LIMIT.limit; i++) {
      await request(server)
        .post('/auth/refresh')
        .set('X-Forwarded-For', ip)
        .expect(401);
    }
    await request(server)
      .post('/auth/refresh')
      .set('X-Forwarded-For', ip)
      .expect(429);
  });
});
