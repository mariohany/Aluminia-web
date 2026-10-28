import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PlanFeature, PlanKey } from '@repo/types/plans';
import { decimalTransformer } from './decimal.transformer';

// One of the four fixed plans (docs/subscriptions_planing.md section 3a).
// Prices are EGP; Free has none.
@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  key: PlanKey;

  @Column({ name: 'name_en', type: 'varchar', length: 60 })
  nameEn: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 60 })
  nameAr: string;

  @Column({ type: 'int' })
  seats: number;

  @Column({
    name: 'monthly_egp',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  monthlyEgp: number | null;

  @Column({
    name: 'annual_egp',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  annualEgp: number | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  features: PlanFeature[];

  @Column({ type: 'int' })
  position: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
