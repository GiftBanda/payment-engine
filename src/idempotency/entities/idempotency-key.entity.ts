import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IDEMPOTENCY_STATUS } from '../../common/constants';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ length: 255 })
  key: string;

  @Column({
    type: 'enum',
    enum: Object.values(IDEMPOTENCY_STATUS),
    default: IDEMPOTENCY_STATUS.PROCESSING,
  })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, any> | null;

  @Column({ length: 100, nullable: true })
  requestPath: string;

  @Index()
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
