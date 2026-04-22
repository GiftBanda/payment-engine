import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  name: string; // 'starter' | 'pro' | 'business' | 'enterprise'

  @Column({ type: 'bigint' })
  price: number; // in smallest unit

  @Column({ length: 10 })
  currency: string;

  @Column({ default: 'month' })
  interval: string; // 'month' | 'year'

  @Column({ type: 'int', default: 1 })
  intervalCount: number;

  @Column({ type: 'jsonb', nullable: true })
  features: string[];

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
