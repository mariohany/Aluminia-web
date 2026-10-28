import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// One email of a quotation or invoice (docs/subscriptions_planing.md §3e,
// §6b): who got it, and the provider's answer or error.
@Entity('billing_sends')
export class BillingSend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ type: 'text', array: true })
  to: string[];

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ name: 'copy_to_me', type: 'boolean', default: false })
  copyToMe: boolean;

  @Column({ name: 'sent_at', type: 'timestamptz', default: () => 'now()' })
  sentAt: Date;

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerMessageId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy: string | null;
}
