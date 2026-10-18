import { Column, Entity, PrimaryColumn } from 'typeorm';

// The bytes of a file, for the Postgres FileStorage driver only. Nothing
// but PostgresFileStorage reads or writes this table.
@Entity('stored_blobs')
export class StoredBlob {
  @PrimaryColumn({ type: 'varchar', length: 512 })
  key: string;

  @Column({ type: 'bytea', select: false })
  body: Buffer;
}
