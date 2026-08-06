import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AdminAuditLog } from '../../database/control-plane/entities/admin-audit-log.entity';

export interface AuditLogEntry {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Takes the caller's own EntityManager (typically a transactional
// queryRunner.manager) rather than holding a repository of its own, so
// the log entry commits or rolls back atomically with whatever mutation
// it's recording — an audit trail that outlives a failed operation is
// worse than no audit trail.
@Injectable()
export class AuditLogService {
  async record(manager: EntityManager, entry: AuditLogEntry): Promise<void> {
    const log = manager.create(AdminAuditLog, {
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
    });
    await manager.save(log);
  }
}
