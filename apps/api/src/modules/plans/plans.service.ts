import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  PLAN_FEATURES,
  type PaidPlanInput,
  type PlanSummary,
} from '@repo/types/plans';
import { Plan } from '../../database/control-plane/entities/plan.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { rollbackQuietly } from '../../database/rollback';

// Fields compared to decide whether a plan changed (and logged as such).
const EDITABLE = [
  'nameEn',
  'nameAr',
  'seats',
  'monthlyEgp',
  'annualEgp',
] as const;

@Injectable()
export class PlansService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(): Promise<PlanSummary[]> {
    const plans = await this.plans.find({ order: { position: 'ASC' } });
    return plans.map(toPlanSummary);
  }

  /**
   * Saves the three paid plans in one transaction (the page has one
   * Save). Free is never in the input: the schema only accepts paid
   * keys. Each plan that actually changed gets its own `plan.updated`
   * entry with the before / after of what changed.
   */
  async updatePaid(
    input: PaidPlanInput[],
    actorId: string,
  ): Promise<PlanSummary[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;
      const rows = await manager.find(Plan, {
        where: { key: In(input.map((p) => p.key)) },
        lock: { mode: 'pessimistic_write' },
      });

      for (const next of input) {
        const plan = rows.find((row) => row.key === next.key);
        if (!plan) continue; // the four rows are seeded and never deleted
        const features = PLAN_FEATURES.filter((f) => next.features.includes(f));

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const field of EDITABLE) {
          if (plan[field] !== next[field]) {
            changes[field] = { from: plan[field], to: next[field] };
          }
        }
        if (features.join() !== plan.features.join()) {
          changes.features = { from: plan.features, to: features };
        }
        if (Object.keys(changes).length === 0) continue;

        Object.assign(plan, {
          nameEn: next.nameEn,
          nameAr: next.nameAr,
          seats: next.seats,
          monthlyEgp: next.monthlyEgp,
          annualEgp: next.annualEgp,
          features,
        });
        await manager.save(plan);
        await this.auditLog.record(manager, {
          actorUserId: actorId,
          action: 'plan.updated',
          targetType: 'plan',
          targetId: plan.id,
          metadata: { key: plan.key, name: plan.nameEn, changes },
        });
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await rollbackQuietly(queryRunner);
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.list();
  }
}

export function toPlanSummary(plan: Plan): PlanSummary {
  return {
    id: plan.id,
    key: plan.key,
    nameEn: plan.nameEn,
    nameAr: plan.nameAr,
    seats: plan.seats,
    monthlyEgp: plan.monthlyEgp,
    annualEgp: plan.annualEgp,
    features: plan.features,
    updatedAt: plan.updatedAt.toISOString(),
  };
}
