import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Plan } from './plan.entity';
import { SUBSCRIPTION_STATUS } from '../../common/constants';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 100 })
  tenantId: string;

  @Column()
  planId: string;

  @ManyToOne(() => Plan, { eager: true })
  @JoinColumn({ name: 'planId' })
  plan: Plan;

  @Column({
    type: 'enum',
    enum: Object.values(SUBSCRIPTION_STATUS),
    default: SUBSCRIPTION_STATUS.ACTIVE,
  })
  status: string;

  @Column({ length: 50 })
  paymentProvider: string;

  @Column({ type: 'jsonb', nullable: true })
  paymentMetadata: Record<string, any>; // account/card info for renewals

  @Index()
  @Column({ type: 'timestamp' })
  currentPeriodStart: Date;

  @Index()
  @Column({ type: 'timestamp' })
  currentPeriodEnd: Date;

  @Column({ type: 'int', default: 0 })
  failedPaymentCount: number;

  @Column({ nullable: true })
  cancelledAt: Date;

  @Column({ nullable: true, type: 'text' })
  cancellationReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
