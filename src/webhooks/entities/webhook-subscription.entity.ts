import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('webhook_subscriptions')
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 100 })
  tenantId: string;

  @Column({ length: 500 })
  url: string;

  @Column({ type: 'simple-array' })
  events: string[]; // ['payment.success', 'payment.failed', 'subscription.renewed']

  @Column({ length: 255 })
  secret: string; // HMAC signing secret

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
