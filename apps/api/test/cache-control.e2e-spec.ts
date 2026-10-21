import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * No API response may stay on the user's disk
 * (docs/lookup_caching_planing.md D1): every response is `no-store`,
 * errors included. `GET /files/:id` is checked in files.e2e-spec.ts.
 */
describe('Cache-Control (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('marks a JSON response no-store', async () => {
    // Terminus widens it to `no-cache, no-store, must-revalidate`.
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('marks a refused request no-store', async () => {
    const res = await request(app.getHttpServer())
      .get('/lookups/version')
      .expect(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('marks an unknown route no-store', async () => {
    const res = await request(app.getHttpServer())
      .get('/no-such-route')
      .expect(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
