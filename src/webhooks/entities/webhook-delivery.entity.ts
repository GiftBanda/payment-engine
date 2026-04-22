import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { WEBHOOK_STATUS } from '../../common/constants';

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  webhookSubscriptionId: string;

  @Index()
  @Column()
  resourceId: string; // paymentId or subscriptionId

  @Column({ length: 100 })
  event: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({
    type: 'enum',
    enum: Object.values(WEBHOOK_STATUS),
    default: WEBHOOK_STATUS.PENDING,
  })
  status: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', nullable: true })
  lastHttpStatus: number;

  @Column({ type: 'text', nullable: true })
  lastError: string;

  @Column({ nullable: true })
  deliveredAt: Date;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
