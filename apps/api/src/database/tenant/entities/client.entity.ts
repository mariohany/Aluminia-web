import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from './project.entity';

/**
 * A manufacturer's customer. Lives in the TENANT schema — one set of
 * clients per company, invisible to every other company.
 *
 * Bilingual: `enName` is required, `arName` optional with a fallback to
 * English at render time. See docs/projects_planing.md's bilingual rule.
 *
 * Deliberately carries no contact columns — phone and email live on
 * `Project`, because the person to call is the site contact for a
 * particular job and can differ between two projects for the same
 * client.
 */
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'en_name', type: 'varchar', length: 255 })
  enName: string;

  @Column({ name: 'ar_name', type: 'varchar', length: 255, nullable: true })
  arName: string | null;

  // Not eager: the tree endpoint asks for this explicitly, and every
  // other read of a client would otherwise drag its whole project list
  // along for no reason.
  @OneToMany(() => Project, (project) => project.client)
  projects: Project[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
