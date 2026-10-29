import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// The platform's seller details on quotations and invoices
// (docs/subscriptions_planing.md §3e, B17). One row, id 1, created by the
// first save of Billing › Billing profile.
@Entity('billing_profile')
export class BillingProfileRow {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ name: 'legal_name_en', type: 'varchar', length: 255 })
  legalNameEn: string;

  @Column({ name: 'legal_name_ar', type: 'varchar', length: 255 })
  legalNameAr: string;

  @Column({ name: 'address_en', type: 'varchar', length: 500 })
  addressEn: string;

  @Column({ name: 'address_ar', type: 'varchar', length: 500 })
  addressAr: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 60 })
  taxId: string;

  @Column({ name: 'commercial_register', type: 'varchar', length: 60 })
  commercialRegister: string;

  @Column({ name: 'billing_email', type: 'varchar', length: 255 })
  billingEmail: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ name: 'bank_account', type: 'varchar', length: 255 })
  bankAccount: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  instapay: string | null;

  @Column({ name: 'logo_file_id', type: 'uuid', nullable: true })
  logoFileId: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
