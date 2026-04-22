import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PAYMENT_STATUS } from '../../common/constants';
import { Subscription } from '../../billing/entities/subscription.entity';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 255 })
  idempotencyKey: string;

  @Index()
  @Column({ length: 100 })
  tenantId: string;

  @Column({ type: 'bigint' })
  // Amount in smallest currency unit (cents / ngwee)
  amount: number;

  @Column({ length: 10 })
  currency: string;

  @Column({
    type: 'enum',
    enum: Object.values(PAYMENT_STATUS),
    default: PAYMENT_STATUS.PENDING,
  })
  status: string;

  @Column({ length: 50 })
  provider: string; // 'lenco' | 'stripe'

  @Column({ length: 255, nullable: true })
  externalId: string; // provider's payment reference

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'int', default: 3 })
  maxRetries: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  providerResponse: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  failureReason: string;

  @Column({ nullable: true })
  subscriptionId: string;

  @ManyToOne(() => Subscription, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription: Subscription;

  @Index()
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
