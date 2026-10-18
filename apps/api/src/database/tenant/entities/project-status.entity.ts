import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One step of the company's project pipeline
 * (docs/project_settings_planing.md §3). `position` is 1…n and unique
 * (DEFERRABLE, so a reorder rewrites every row in one transaction).
 *
 * `responsibleUserIds` are control-plane `users.id`s: no FK can cross the
 * two schemas, so `ProjectStatusesService` checks them on write and drops
 * any that are no longer active users of this company on read.
 */
@Entity('project_statuses')
export class ProjectStatusRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ name: 'en_name', type: 'varchar', length: 60 })
  enName: string;

  @Column({ name: 'ar_name', type: 'varchar', length: 60, nullable: true })
  arName: string | null;

  @Column({ type: 'varchar', length: 16 })
  color: string;

  @Column({
    name: 'responsible_user_ids',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  responsibleUserIds: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
