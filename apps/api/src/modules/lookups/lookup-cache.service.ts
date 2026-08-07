import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type Redis from 'ioredis';
import {
  LOOKUP_SLICE_ENTITIES,
  type LookupEntity,
  type LookupSlice,
  type LookupVersion,
} from '@repo/types/lookups';
import { REDIS_CLIENT } from '../../common/redis.module';
import { LookupMeta } from '../../database/control-plane/entities/lookup-meta.entity';

const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Cache-aside, keyed on the versions of whichever entities feed a given
// slice: a write bumps only its own entity's row (the
// bump_lookup_version() trigger is parametrized per table — see the
// migration), so a colour edit no longer retires the systems slice's
// cache the way one global counter would have. The TTL is pure garbage
// collection for keys that a version bump has already retired;
// correctness never depends on it.
@Injectable()
export class LookupCacheService {
  constructor(
    @InjectRepository(LookupMeta) private readonly meta: Repository<LookupMeta>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getVersions(): Promise<LookupVersion> {
    const rows = await this.meta.find();
    return Object.fromEntries(
      rows.map((row) => [row.id, row.version]),
    ) as LookupVersion;
  }

  private async getVersionsFor(
    entities: LookupEntity[],
  ): Promise<Partial<LookupVersion>> {
    const rows = await this.meta.findBy({ id: In(entities) });
    return Object.fromEntries(rows.map((row) => [row.id, row.version]));
  }

  async getSlice<T>(
    slice: LookupSlice,
    load: () => Promise<T>,
  ): Promise<{ versions: Partial<LookupVersion>; data: T }> {
    const entities = LOOKUP_SLICE_ENTITIES[slice];
    const versions = await this.getVersionsFor(entities);
    const key = `lookups:v${entities.map((entity) => versions[entity]).join('-')}:${slice}`;

    const cached = await this.redis.get(key);
    if (cached) return { versions, data: JSON.parse(cached) as T };

    const data = await load();
    await this.redis.set(key, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS);
    return { versions, data };
  }
}
