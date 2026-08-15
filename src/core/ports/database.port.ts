/**
 * Database Port - Abstraction Layer
 * 
 * Hexagonal Architecture: This port defines the interface for database operations.
 * The application core depends on this interface, not on specific implementations.
 * 
 * Adapters can implement this for:
 * - Prisma + Neon (current)
 * - Prisma + Local PostgreSQL
 * - Prisma + Supabase
 * - Drizzle + Any PostgreSQL
 * - Even MongoDB if needed
 * 
 * @module core/ports/database
 */

import type { PrismaClient } from '@prisma/client';

/**
 * User entity (domain model)
 */
export interface UserEntity {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Subscription entity (domain model)
 */
export interface SubscriptionEntity {
  id: string;
  userId: string;
  plan: 'BYOK_FREE' | 'STARTER' | 'PRO';
  status: 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'TRIALING';
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Usage record entity (domain model)
 */
export interface UsageRecordEntity {
  id: string;
  userId: string;
  audioMinutes: number;
  tokensGenerated: number;
  date: Date;
}

/**
 * Database Port Interface
 * 
 * All database operations go through this interface.
 * This allows swapping database providers without changing application code.
 */
export interface IDatabasePort {
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ connected: boolean; latency?: number }>;
  
  // User operations
  findUserById(id: string): Promise<UserEntity | null>;
  findUserByEmail(email: string): Promise<UserEntity | null>;
  
  // Subscription operations
  findSubscriptionByUserId(userId: string): Promise<SubscriptionEntity | null>;
  createSubscription(userId: string, plan: SubscriptionEntity['plan']): Promise<SubscriptionEntity>;
  updateSubscription(userId: string, data: Partial<SubscriptionEntity>): Promise<SubscriptionEntity>;
  
  // Usage operations
  getMonthlyUsage(userId: string): Promise<{ audioMinutes: number; tokensGenerated: number }>;
  recordUsage(userId: string, audioMinutes: number, tokensGenerated: number): Promise<void>;
  getUsageHistory(userId: string, days: number): Promise<UsageRecordEntity[]>;
  
  // Token log operations
  logTokenCreation(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void>;
  markTokenRevoked(tokenHash: string): Promise<void>;
  
  // Raw client access (for Better Auth adapter)
  getRawClient(): PrismaClient;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  provider: 'neon' | 'local' | 'supabase' | 'railway';
  url: string;
  poolSize?: number;
  ssl?: boolean;
}
