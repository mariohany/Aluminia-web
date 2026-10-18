import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A project's status history (docs/project_settings_planing.md S10). For
 * now only the "created" event (`fromStatusId` null); moving between
 * statuses is a later plan and adds rows here.
 *
 * The status name, colour and user email are snapshots taken when the
 * event happened: the status may later be renamed or deleted (its ids go
 * NULL) and the user removed, and the history must still read right.
 */
@Entity('project_status_events')
@Index(['projectId', 'at'])
export class ProjectStatusEventRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'from_status_id', type: 'uuid', nullable: true })
  fromStatusId: string | null;

  @Column({ name: 'to_status_id', type: 'uuid', nullable: true })
  toStatusId: string | null;

  @Column({ name: 'to_en_name', type: 'varchar', length: 60 })
  toEnName: string;

  @Column({ name: 'to_ar_name', type: 'varchar', length: 60, nullable: true })
  toArName: string | null;

  @Column({ name: 'to_color', type: 'varchar', length: 16 })
  toColor: string;

  @Column({ name: 'by_user_id', type: 'uuid', nullable: true })
  byUserId: string | null;

  @Column({
    name: 'by_user_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  byUserEmail: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  at: Date;
}
