import { MigrationInterface, QueryRunner } from 'typeorm';

// One upload API for every file (docs/company_profile_planing.md §3).
// `files` says what a file is and who owns it, whatever the storage
// driver; `stored_blobs` holds the bytes for the Postgres driver only
// (with S3 the bytes live in the bucket under the same key).
//
// `uploaded_by_user_id` is SET NULL, not RESTRICT: deleting a company
// deletes its users before the company row, and a file must not block
// that. The company FK cascades, so a company's file rows go with it;
// its blobs are cleared by key prefix after the commit.
export class AddFiles1792251500000 implements MigrationInterface {
  name = 'AddFiles1792251500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stored_blobs" (
        "key" character varying(512) NOT NULL,
        "body" bytea NOT NULL,
        CONSTRAINT "PK_stored_blobs" PRIMARY KEY ("key")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "files" (
        "id" uuid NOT NULL,
        "company_id" uuid NOT NULL,
        "purpose" character varying(30) NOT NULL,
        "storage_key" character varying(512) NOT NULL,
        "content_type" character varying(100) NOT NULL,
        "size_bytes" integer NOT NULL,
        "original_name" character varying(255),
        "uploaded_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "attached_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_files" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_files_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "CK_files_size_bytes" CHECK ("size_bytes" >= 0),
        CONSTRAINT "FK_files_company" FOREIGN KEY ("company_id")
          REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_files_uploaded_by" FOREIGN KEY ("uploaded_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    // The 24 h sweep of pending uploads looks these up per company.
    await queryRunner.query(
      `CREATE INDEX "IDX_files_pending" ON "files" ("company_id", "created_at")
        WHERE "attached_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "files"`);
    await queryRunner.query(`DROP TABLE "stored_blobs"`);
  }
}
