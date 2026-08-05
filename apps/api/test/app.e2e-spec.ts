import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface HealthResponseBody {
  status: string;
  info: {
    database: { status: string };
    redis: { status: string };
  };
}

// Runs against the real local Postgres/Redis from docker-compose.yml —
// `docker compose up -d` before running this. At this project's scale
// (single Postgres instance, no sharding) a real integration test is
// simpler and more honest than mocking the database.
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) reports the database and Redis as up', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthResponseBody;
        expect(body.status).toBe('ok');
        expect(body.info.database.status).toBe('up');
        expect(body.info.redis.status).toBe('up');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
