import { MigrationInterface, QueryRunner } from 'typeorm';

// Void asks for confirmation with an optional reason (Mario 2026-10-29),
// kept on the quotation and shown under its Void status.
export class AddBillingVoidReason1792800500000 implements MigrationInterface {
  name = 'AddBillingVoidReason1792800500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_documents" ADD "void_reason" varchar(200)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_documents" DROP COLUMN "void_reason"`,
    );
  }
}
