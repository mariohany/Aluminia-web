import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// A request-a-quote submission from the public landing page. Control
// plane, not tenant-scoped — the visitor has no company yet.
@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_name', type: 'varchar', length: 120 })
  companyName: string;

  @Column({ name: 'requester_name', type: 'varchar', length: 120 })
  requesterName: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  // Set once, the moment an admin clicks the phone number to call this
  // lead — see LeadsService.markContacted. Null means never called.
  @Column({ name: 'contacted_at', type: 'timestamptz', nullable: true })
  contactedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
