import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import type { LoginResponse } from '@repo/types/auth';
import type {
  ProjectSettings,
  ProjectStatus,
  ProjectStatusEvent,
} from '@repo/types/project-settings';
import type { ProjectDetail } from '@repo/types/projects';
import { AppModule } from './../src/app.module';
import { TenantProvisioningService } from './../src/modules/tenancy/tenant-provisioning.service';

/**
 * Config › Project settings (docs/project_settings_planing.md §6): the
 * seeded defaults and statuses, who may read and write, responsible
 * users, delete / reorder rules, and where a new project starts.
 */
describe('Project settings (e2e)', () => {
  let app: INestApplication<App>;
  let controlPlane: DataSource;

  const alphaName = 'E2E Statuses Alpha Aluminium';
  const betaName = 'E2E Statuses Beta Glazing';
  const alphaAdmin = 'e2e-statuses-alpha@test.local';
  const alphaUser = 'e2e-statuses-alpha-user@test.local';
  const betaAdmin = 'e2e-statuses-beta@test.local';
  const password = 'TestPassword123!';

  let alphaToken: string;
  let alphaUserToken: string;
  let betaToken: string;
  let alphaAdminId: string;
  let alphaUserId: string;
  let betaAdminId: string;
  let alphaSchema: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    controlPlane = app.get<DataSource>(getDataSourceToken());
    const provisioning = app.get(TenantProvisioningService);
    for (const [name, email] of [
      [alphaName, alphaAdmin],
      [betaName, betaAdmin],
    ]) {
      await provisioning.provision({
        name,
        plan: 'starter',
        maxUsers: 5,
        admin: { email, password },
      });
    }

    alphaToken = await loginAs(alphaAdmin);
    betaToken = await loginAs(betaAdmin);
    await request(app.getHttpServer())
      .post('/company/users')
      .set('Authorization', `Bearer ${alphaToken}`)
      .send({ email: alphaUser, password })
      .expect(201);
    alphaUserToken = await loginAs(alphaUser);

    alphaAdminId = await userId(alphaAdmin);
    alphaUserId = await userId(alphaUser);
    betaAdminId = await userId(betaAdmin);
    const [{ schema_name }]: Array<{ schema_name: string }> =
      await controlPlane.query(
        `SELECT schema_name FROM companies WHERE name = $1`,
        [alphaName],
      );
    alphaSchema = schema_name;
  });

  afterAll(async () => {
    try {
      for (const name of [alphaName, betaName]) {
        const companies: Array<{ id: string; schema_name: string }> =
          await controlPlane.query(
            `SELECT id, schema_name FROM companies WHERE name = $1`,
            [name],
          );
        for (const company of companies) {
          await controlPlane.query(
            `DROP SCHEMA IF EXISTS "${company.schema_name}" CASCADE`,
          );
          await controlPlane.query(
            `DELETE FROM admin_audit_log
              WHERE actor_user_id IN (SELECT id FROM users WHERE company_id = $1)`,
            [company.id],
          );
          await controlPlane.query(`DELETE FROM users WHERE company_id = $1`, [
            company.id,
          ]);
          await controlPlane.query(
            `DELETE FROM billing WHERE company_id = $1`,
            [company.id],
          );
          await controlPlane.query(`DELETE FROM companies WHERE id = $1`, [
            company.id,
          ]);
        }
      }
    } finally {
      await app.close();
    }
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as LoginResponse).accessToken;
  }

  async function userId(email: string): Promise<string> {
    const [{ id }]: Array<{ id: string }> = await controlPlane.query(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    return id;
  }

  const server = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function statuses(token = alphaToken): Promise<ProjectStatus[]> {
    const res = await server()
      .get('/project-statuses')
      .set(auth(token))
      .expect(200);
    return res.body as ProjectStatus[];
  }

  async function newProject(token = alphaToken): Promise<ProjectDetail> {
    const client = await server()
      .post('/clients')
      .set(auth(token))
      .send({ enName: `Client ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const project = await server()
      .post('/projects')
      .set(auth(token))
      .send({
        clientId: (client.body as { id: string }).id,
        enName: `Project ${randomUUID().slice(0, 8)}`,
      })
      .expect(201);
    return project.body as ProjectDetail;
  }

  describe('defaults', () => {
    it('start at EGP with no system, and a user can read them', async () => {
      const res = await server()
        .get('/project-settings')
        .set(auth(alphaUserToken))
        .expect(200);
      expect(res.body).toMatchObject({
        defaultSystemBrand: null,
        defaultSystemCatalog: null,
        currency: 'EGP',
      } satisfies Partial<ProjectSettings>);
    });

    it('the admin changes them; a missing key is left alone', async () => {
      const brand = `company:${randomUUID()}`;
      await server()
        .patch('/project-settings')
        .set(auth(alphaToken))
        .send({ defaultSystemBrand: brand, currency: 'USD' })
        .expect(200);
      const res = await server()
        .patch('/project-settings')
        .set(auth(alphaToken))
        .send({ currency: null })
        .expect(200);
      expect(res.body).toMatchObject({
        defaultSystemBrand: brand,
        currency: null,
      });
      // Another company is untouched.
      const beta = await server()
        .get('/project-settings')
        .set(auth(betaToken))
        .expect(200);
      expect((beta.body as ProjectSettings).currency).toBe('EGP');
    });

    it('refuses a user, a bad currency and an unknown key', async () => {
      await server()
        .patch('/project-settings')
        .set(auth(alphaUserToken))
        .send({ currency: 'EGP' })
        .expect(403);
      await server()
        .patch('/project-settings')
        .set(auth(alphaToken))
        .send({ currency: 'GBP' })
        .expect(400);
      await server()
        .patch('/project-settings')
        .set(auth(alphaToken))
        .send({ vatRate: 14 })
        .expect(400);
    });
  });

  describe('statuses', () => {
    it('come seeded with the 7 built-in steps, nobody responsible', async () => {
      const list = await statuses(alphaUserToken);
      expect(list.map((s) => [s.position, s.enName, s.color])).toEqual([
        [1, 'New', 'grey'],
        [2, 'Measuring', 'blue'],
        [3, 'Quoted', 'amber'],
        [4, 'Approved', 'green'],
        [5, 'In production', 'violet'],
        [6, 'Installed', 'sky'],
        [7, 'Closed', 'emerald'],
      ]);
      expect(list[0].arName).toBe('جديد');
      expect(list.every((s) => s.responsible.length === 0)).toBe(true);
    });

    it('only the admin writes', async () => {
      const [first] = await statuses();
      await server()
        .post('/project-statuses')
        .set(auth(alphaUserToken))
        .send({ enName: 'Nope', color: 'red', responsibleUserIds: [] })
        .expect(403);
      await server()
        .patch(`/project-statuses/${first.id}`)
        .set(auth(alphaUserToken))
        .send({ color: 'red' })
        .expect(403);
      await server()
        .delete(`/project-statuses/${first.id}`)
        .set(auth(alphaUserToken))
        .expect(403);
      await server()
        .put('/project-statuses/order')
        .set(auth(alphaUserToken))
        .send({ ids: [first.id] })
        .expect(403);
    });

    it("another company's status is a 404", async () => {
      const [first] = await statuses();
      await server()
        .patch(`/project-statuses/${first.id}`)
        .set(auth(betaToken))
        .send({ color: 'red' })
        .expect(404);
      await server()
        .delete(`/project-statuses/${first.id}`)
        .set(auth(betaToken))
        .expect(404);
    });

    it('adds at the end, renames and recolours; a duplicate name is 409', async () => {
      const created = await server()
        .post('/project-statuses')
        .set(auth(alphaToken))
        .send({ enName: 'On hold', color: 'red', responsibleUserIds: [] })
        .expect(201);
      const status = created.body as ProjectStatus;
      expect(status).toMatchObject({
        position: 8,
        enName: 'On hold',
        arName: null,
        projectCount: 0,
      });

      const renamed = await server()
        .patch(`/project-statuses/${status.id}`)
        .set(auth(alphaToken))
        .send({ enName: 'Paused', arName: 'متوقف', color: 'amber' })
        .expect(200);
      expect(renamed.body).toMatchObject({
        enName: 'Paused',
        arName: 'متوقف',
        color: 'amber',
      });

      await server()
        .patch(`/project-statuses/${status.id}`)
        .set(auth(alphaToken))
        .send({ enName: 'quoted' })
        .expect(409);
      await server()
        .post('/project-statuses')
        .set(auth(alphaToken))
        .send({ enName: 'NEW', color: 'grey', responsibleUserIds: [] })
        .expect(409);
      await server()
        .post('/project-statuses')
        .set(auth(alphaToken))
        .send({ enName: 'Pink', color: 'pink', responsibleUserIds: [] })
        .expect(400);

      await server()
        .delete(`/project-statuses/${status.id}`)
        .set(auth(alphaToken))
        .expect(204);
    });

    it('responsible users: this company only, inactive ones drop out', async () => {
      const [, measuring] = await statuses();
      await server()
        .patch(`/project-statuses/${measuring.id}`)
        .set(auth(alphaToken))
        .send({ responsibleUserIds: [betaAdminId] })
        .expect(400);
      await server()
        .patch(`/project-statuses/${measuring.id}`)
        .set(auth(alphaToken))
        .send({ responsibleUserIds: [randomUUID()] })
        .expect(400);

      const res = await server()
        .patch(`/project-statuses/${measuring.id}`)
        .set(auth(alphaToken))
        .send({
          responsibleUserIds: [alphaUserId, alphaAdminId, alphaUserId],
        })
        .expect(200);
      expect((res.body as ProjectStatus).responsible).toEqual([
        { id: alphaUserId, email: alphaUser },
        { id: alphaAdminId, email: alphaAdmin },
      ]);

      await controlPlane.query(
        `UPDATE users SET status = 'inactive' WHERE id = $1`,
        [alphaUserId],
      );
      try {
        const after = (await statuses()).find((s) => s.id === measuring.id);
        expect(after?.responsible).toEqual([
          { id: alphaAdminId, email: alphaAdmin },
        ]);
        // Can't be assigned while inactive either.
        await server()
          .patch(`/project-statuses/${measuring.id}`)
          .set(auth(alphaToken))
          .send({ responsibleUserIds: [alphaUserId] })
          .expect(400);
      } finally {
        await controlPlane.query(
          `UPDATE users SET status = 'active' WHERE id = $1`,
          [alphaUserId],
        );
      }
    });

    it('a new project starts at the first status with a "created" event', async () => {
      const project = await newProject(alphaUserToken);
      const [first] = await statuses();

      const [row]: Array<{ status_id: string }> = await controlPlane.query(
        `SELECT status_id FROM "${alphaSchema}".projects WHERE id = $1`,
        [project.id],
      );
      expect(row.status_id).toBe(first.id);

      const events: Array<Record<string, unknown>> = await controlPlane.query(
        `SELECT from_status_id, to_status_id, to_en_name, to_color, by_user_id, by_user_email
           FROM "${alphaSchema}".project_status_events WHERE project_id = $1`,
        [project.id],
      );
      expect(events).toEqual([
        {
          from_status_id: null,
          to_status_id: first.id,
          to_en_name: 'New',
          to_color: 'grey',
          by_user_id: alphaUserId,
          by_user_email: alphaUser,
        },
      ]);
      expect(first.projectCount).toBeGreaterThanOrEqual(1);
    });

    it('refuses to delete a status in use', async () => {
      const [first] = await statuses();
      const res = await server()
        .delete(`/project-statuses/${first.id}`)
        .set(auth(alphaToken))
        .expect(409);
      expect((res.body as { message: string }).message).toMatch(
        /in this status/,
      );
    });

    it('reorders; a stale id set is 409; new projects follow the new first', async () => {
      const list = await statuses();
      const ids = list.map((s) => s.id);
      const reversed = [...ids].reverse();

      await server()
        .put('/project-statuses/order')
        .set(auth(alphaToken))
        .send({ ids: ids.slice(1) })
        .expect(409);
      await server()
        .put('/project-statuses/order')
        .set(auth(alphaToken))
        .send({ ids: [...ids.slice(1), randomUUID()] })
        .expect(409);

      const res = await server()
        .put('/project-statuses/order')
        .set(auth(alphaToken))
        .send({ ids: reversed })
        .expect(200);
      expect((res.body as ProjectStatus[]).map((s) => s.id)).toEqual(reversed);
      expect((res.body as ProjectStatus[]).map((s) => s.position)).toEqual(
        reversed.map((_, i) => i + 1),
      );

      const project = await newProject();
      const [row]: Array<{ status_id: string }> = await controlPlane.query(
        `SELECT status_id FROM "${alphaSchema}".projects WHERE id = $1`,
        [project.id],
      );
      expect(row.status_id).toBe(reversed[0]);

      // Put it back for the tests below.
      await server()
        .put('/project-statuses/order')
        .set(auth(alphaToken))
        .send({ ids })
        .expect(200);
    });

    it('deleting closes the gap in positions, and the last one stays', async () => {
      // Beta has no projects, so every status can go except the last.
      const list = await statuses(betaToken);
      await server()
        .delete(`/project-statuses/${list[2].id}`)
        .set(auth(betaToken))
        .expect(204);
      const after = await statuses(betaToken);
      expect(after.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(after.map((s) => s.enName)).not.toContain('Quoted');

      for (const status of after.slice(1)) {
        await server()
          .delete(`/project-statuses/${status.id}`)
          .set(auth(betaToken))
          .expect(204);
      }
      const [last] = await statuses(betaToken);
      await server()
        .delete(`/project-statuses/${last.id}`)
        .set(auth(betaToken))
        .expect(409);
    });
  });

  describe("a project's status", () => {
    it('detail carries the status id and since when; a user reads the history', async () => {
      const created = await newProject(alphaUserToken);
      const [first] = await statuses();
      expect(created.statusId).toBe(first.id);

      const detail = await server()
        .get(`/projects/${created.id}`)
        .set(auth(alphaUserToken))
        .expect(200);
      const body = detail.body as ProjectDetail;
      expect(body.statusId).toBe(first.id);
      expect(body.statusSince).toBe(created.statusSince);

      const history = await server()
        .get(`/projects/${created.id}/status-history`)
        .set(auth(alphaUserToken))
        .expect(200);
      const events = history.body as ProjectStatusEvent[];
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        fromStatusId: null,
        toStatusId: first.id,
        enName: 'New',
        arName: 'جديد',
        color: 'grey',
        byUserEmail: alphaUser,
        at: body.statusSince,
      });
    });

    it('history keeps the name it had when the status is renamed later', async () => {
      const created = await newProject();
      const [first] = await statuses();
      await server()
        .patch(`/project-statuses/${first.id}`)
        .set(auth(alphaToken))
        .send({ enName: 'Lead' })
        .expect(200);
      try {
        const history = await server()
          .get(`/projects/${created.id}/status-history`)
          .set(auth(alphaToken))
          .expect(200);
        expect((history.body as ProjectStatusEvent[])[0].enName).toBe('New');
      } finally {
        await server()
          .patch(`/project-statuses/${first.id}`)
          .set(auth(alphaToken))
          .send({ enName: 'New' })
          .expect(200);
      }
    });

    it("another company's project history is a 404", async () => {
      const created = await newProject();
      await server()
        .get(`/projects/${created.id}/status-history`)
        .set(auth(betaToken))
        .expect(404);
    });
  });
});
