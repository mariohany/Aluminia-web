import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { App } from 'supertest/types';
import type { QuoteRequestResponse } from '@repo/types/quote-request';
import { AppModule } from './../src/app.module';

/**
 * The one route an anonymous visitor can reach. No login, no tenant —
 * real Postgres, real HTTP, same policy as every other e2e suite here.
 */
describe('Leads (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const validBody = {
    companyName: 'Test Fabricators',
    requesterName: 'Test Requester',
    phone: '+20 100 000 0000',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts's bootstrap() is what registers this in production —
    // Test.createTestingModule() never runs main.ts, so it has to be
    // applied here too, or DTO-shape validation silently never happens
    // in this test at all. Found by this suite failing in exactly the
    // way an unvalidated body would: the honeypot test got a 201
    // instead of 400, and the missing-field test got a raw 500 (a
    // NOT NULL violation reaching Postgres unvalidated) instead of a
    // clean 400. No other e2e spec in this project registers this
    // either — their own `.expect(400)` assertions all happen to catch
    // an explicit BadRequestException thrown by service code, not
    // schema validation, so the gap never surfaced before this route.
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();

    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM leads WHERE company_name = $1`, [
      validBody.companyName,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists a real submission with no auth required', async () => {
    const res = await request(app.getHttpServer())
      .post('/leads/quote-requests')
      .send(validBody)
      .expect(201);

    const body = res.body as QuoteRequestResponse;
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.receivedAt).toString()).not.toBe('Invalid Date');

    const rows: Array<{ company_name: string; phone: string }> =
      await dataSource.query(
        `SELECT company_name, phone FROM leads WHERE id = $1`,
        [body.id],
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].company_name).toBe(validBody.companyName);
    expect(rows[0].phone).toBe(validBody.phone);
  });

  it('rejects a filled-in honeypot before it reaches the database', async () => {
    await request(app.getHttpServer())
      .post('/leads/quote-requests')
      .send({ ...validBody, website: 'https://spambot.example' })
      .expect(400);

    const rows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM leads WHERE company_name = $1`,
      [validBody.companyName],
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects a missing required field', async () => {
    await request(app.getHttpServer())
      .post('/leads/quote-requests')
      .send({ companyName: validBody.companyName, phone: validBody.phone })
      .expect(400);
  });

  it('rate-limits repeated submissions from the same caller', async () => {
    // The limit is 5 per 10 minutes (leads.module.ts). Six in a row from
    // the same test client — sharing one IP, same as a real flood —
    // must produce at least one 429. A test that fires one request at a
    // time and checks nothing was throttled would not catch a guard
    // that was never wired up.
    const server = app.getHttpServer();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(server).post('/leads/quote-requests').send(validBody),
      ),
    );

    expect(results.some((res) => res.status === 429)).toBe(true);
  });
});
