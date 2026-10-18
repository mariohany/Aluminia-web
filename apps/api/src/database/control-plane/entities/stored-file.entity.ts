import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { FilePurpose } from '@repo/types/files';

// One uploaded file (docs/company_profile_planing.md §3b): what it is
// and who owns it. The bytes live in FileStorage under `storageKey`,
// which never leaves the server: clients only ever see `id`.
@Entity('files')
export class StoredFile {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 30 })
  purpose: FilePurpose;

  @Column({ name: 'storage_key', type: 'varchar', length: 512, unique: true })
  storageKey: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalName: string | null;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Null = pending: uploaded but not used by anything yet. Swept after
  // 24 h (FilesService).
  @Column({ name: 'attached_at', type: 'timestamptz', nullable: true })
  attachedAt: Date | null;
}
