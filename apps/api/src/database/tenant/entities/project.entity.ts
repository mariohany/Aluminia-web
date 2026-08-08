import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Client } from './client.entity';

/**
 * A manufacturing job. Lives in the TENANT schema.
 *
 * Expected to grow — window designs and paperwork attach here in later
 * phases. What matters now are the relationships, not the column list.
 *
 * No lifecycle status column: a project is either here or deleted.
 * Archiving was considered and dropped — see docs/projects_planing.md's
 * decisions table.
 */
@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'en_name', type: 'varchar', length: 255 })
  enName: string;

  @Column({ name: 'ar_name', type: 'varchar', length: 255, nullable: true })
  arName: string | null;

  @Column({ name: 'en_address', type: 'text', nullable: true })
  enAddress: string | null;

  @Column({ name: 'ar_address', type: 'text', nullable: true })
  arAddress: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // The site contact for THIS job, not the client's general details —
  // the same client can run several projects with a different person to
  // call at each site.
  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Index()
  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  // ON DELETE CASCADE: deleting a client deletes its projects. Enforced
  // by Postgres rather than application code, so no path can forget it —
  // which is exactly why the API requires the client's name typed back
  // before it will issue the DELETE.
  @ManyToOne(() => Client, (client) => client.projects, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  /**
   * NO foreign key, deliberately.
   *
   * `users` lives in the control-plane (`public`) schema. A tenant table
   * FK'ing across into it would couple every tenant schema back to the
   * shared one and undermine the isolation model — the tenant search
   * path deliberately excludes `public` precisely so a tenant query can
   * never resolve to a control-plane table.
   *
   * So this stores the id and nothing more. Any display name is resolved
   * at the API layer. The same rule applies to every future tenant
   * table.
   */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
