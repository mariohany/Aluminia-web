import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import type Redis from 'ioredis';
import { UserRole } from '@repo/types/auth';
import { AppModule } from './../src/app.module';
import { createRedisClient, REDIS_CLIENT } from './../src/common/redis.module';
import { PasswordService } from './../src/modules/auth/password.service';

/**
 * Stability S9: the app with Redis unreachable. The app's client points
 * at a closed port (built by the real `createRedisClient`, so the same
 * fail-fast settings apply); everything else is real. Agreed behaviour:
 * the process stays up, requests aren't rate-limited, caches and the
 * auth-version check read Postgres, /health stays 200 and shows Redis
 * as not connected, and only login is refused (503), so the failed-login
 * limit is never off.
 */
describe('Redis outage (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;
  let token: string;

  const email = `e2e-redis-outage-${Date.now()}@test.local`;
  const password = 'TestPassword123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REDIS_CLIENT)
      // Port 1 is never listening: connections are refused at once.
      .useValue(createRedisClient('redis://127.0.0.1:1'))
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    controlPlane = app.get<DataSource>(getDataSourceToken());

    const passwordHash = await app.get(PasswordService).hash(password);
    const [{ id }] = await controlPlane.query<Array<{ id: string }>>(
      `INSERT INTO users (email, password_hash, role, company_id, status)
       VALUES ($1, $2, $3, NULL, 'active') RETURNING id`,
      [email, passwordHash, UserRole.SUPER_ADMIN],
    );
    // Login is refused while Redis is down, so the token is signed here,
    // as AuthService would.
    token = await app.get(JwtService).signAsync({
      sub: id,
      role: UserRole.SUPER_ADMIN,
      companyId: null,
      ver: 0,
    });
  });

  afterAll(async () => {
    try {
      await controlPlane.query(`DELETE FROM users WHERE email = $1`, [email]);
    } finally {
      await app.close();
      app.get<Redis>(REDIS_CLIENT).disconnect();
    }
  });

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  it('serves a signed-in user: the version check reads Postgres, the throttle lets it through', async () => {
    const started = Date.now();
    await get('/me').expect(200);
    // Redis calls fail at once instead of waiting out a timeout or
    // ioredis's reconnect retries.
    expect(Date.now() - started).toBeLessThan(300);
  });

  it('serves the lookups from Postgres', async () => {
    const res = await get('/lookups/colors').expect(200);
    expect(res.body).toHaveProperty('data');
  });

  it('serves the dashboard (project counts) from the tenant schemas', async () => {
    await get('/admin/dashboard/summary').expect(200);
  });

  it('keeps /health at 200 and reports Redis as not connected', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as {
      info: { redis: { status: string; connected: boolean } };
    };
    expect(body.info.redis).toMatchObject({ status: 'up', connected: false });
  });

  it('refuses login with a 503 rather than skipping the failed-login limit', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(503);
    expect((res.body as { message: string }).message).toMatch(
      /temporarily unavailable/,
    );
  });
});
