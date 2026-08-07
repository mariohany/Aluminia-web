import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A named build-up (a single-glazed unit is a one-item build-up). Its
// item list (GlassCombinationItem) carries the actual layers in order;
// totalThickness is deliberately not a column here — LookupsService
// computes it from the items so it can never drift from its own parts.
@Entity('glass_combination')
export class GlassCombination {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
