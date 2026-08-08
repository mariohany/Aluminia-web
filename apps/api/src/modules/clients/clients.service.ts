import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  ClientDetail,
  ClientSummary,
  ClientWithProjects,
  CreateClientInput,
  UpdateClientInput,
} from '@repo/types/clients';
import { Client } from '../../database/tenant/entities/client.entity';
import { Project } from '../../database/tenant/entities/project.entity';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * A manufacturer's clients, inside that manufacturer's own schema.
 *
 * Every method's body runs through `tenantContext.run()`. There is no
 * repository injected here and no schema name anywhere in this file —
 * the tenant context is the only door to this data, which is what makes
 * "did we scope this query correctly?" a question with one answer
 * instead of one per method.
 */
@Injectable()
export class ClientsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /**
   * The navigation tree: every client with its projects nested.
   *
   * One query rather than two-and-a-join-in-JS. At this product's
   * ceiling a manufacturer's whole client list is small; the point at
   * which this stops being true is a tenant with enough projects that
   * the tree itself is unusable, which needs lazy expansion rather than
   * a different query here.
   */
  listTree(): Promise<ClientWithProjects[]> {
    return this.tenantContext.run(async (manager) => {
      const clients = await manager.find(Client, {
        relations: { projects: true },
        order: { enName: 'ASC', projects: { enName: 'ASC' } },
      });

      return clients.map((client) => ({
        ...toSummary(client),
        projects: (client.projects ?? []).map((project) => ({
          id: project.id,
          enName: project.enName,
          arName: project.arName,
        })),
      }));
    });
  }

  detail(id: string): Promise<ClientDetail> {
    return this.tenantContext.run(async (manager) => {
      const client = await this.findOrFail(manager, id);
      // Counted rather than loaded: the delete dialog needs the number,
      // not the rows.
      const projectCount = await manager.count(Project, {
        where: { clientId: id },
      });
      return { ...toSummary(client), projectCount };
    });
  }

  create(input: CreateClientInput): Promise<ClientSummary> {
    return this.tenantContext.run(async (manager) => {
      const client = manager.create(Client, {
        enName: input.enName,
        arName: input.arName ?? null,
      });
      return toSummary(await manager.save(client));
    });
  }

  update(id: string, input: UpdateClientInput): Promise<ClientSummary> {
    return this.tenantContext.run(async (manager) => {
      const client = await this.findOrFail(manager, id);

      // Only keys actually present are applied. `undefined` means "not
      // in this request" and must leave the column alone, while an
      // explicit `null` means "clear the Arabic name" — collapsing the
      // two would make a rename silently wipe a translation.
      if (input.enName !== undefined) client.enName = input.enName;
      if (input.arName !== undefined) client.arName = input.arName;

      return toSummary(await manager.save(client));
    });
  }

  /**
   * Hard delete. Postgres cascades to this client's projects via
   * `FK_projects_client ON DELETE CASCADE`.
   *
   * `confirmName` is verified HERE, against the stored row, rather than
   * trusted from the browser — a client that asserts its own
   * correctness about an irreversible cascade is not a confirmation,
   * it's a formality.
   */
  remove(id: string, confirmName: string): Promise<void> {
    return this.tenantContext.run(async (manager) => {
      const client = await this.findOrFail(manager, id);

      if (confirmName.trim() !== client.enName) {
        throw new BadRequestException(
          'The typed name does not match this client.',
        );
      }

      await manager.remove(client);
    });
  }

  private async findOrFail(
    manager: EntityManager,
    id: string,
  ): Promise<Client> {
    const client = await manager.findOne(Client, { where: { id } });
    // A 404 rather than a 403 when the id belongs to another tenant:
    // the search_path makes another tenant's row simply invisible here,
    // so this is not a decision the service has to remember to make —
    // but it is the behaviour the isolation tests assert.
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }
}

function toSummary(client: Client): ClientSummary {
  return {
    id: client.id,
    enName: client.enName,
    arName: client.arName,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}
