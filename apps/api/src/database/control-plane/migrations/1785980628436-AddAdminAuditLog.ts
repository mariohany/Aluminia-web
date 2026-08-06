import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAuditLog1785980628436 implements MigrationInterface {
  name = 'AddAdminAuditLog1785980628436';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_audit_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_user_id" uuid NOT NULL,
        "action" varchar(100) NOT NULL,
        "target_type" varchar(50) NOT NULL,
        "target_id" uuid,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_admin_audit_log_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    // No FK on target_id: it points at whatever got acted on (a company,
    // a user), which a later action in the same log might delete. The
    // log has to outlive what it describes, so it's a bare uuid plus a
    // metadata snapshot, not a reference that would either cascade away
    // the audit trail or block the deletion it's meant to record.
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_audit_log_target" ON "admin_audit_log" ("target_type", "target_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_audit_log_created_at" ON "admin_audit_log" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_admin_audit_log_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_admin_audit_log_target"`);
    await queryRunner.query(`DROP TABLE "admin_audit_log"`);
  }
}
