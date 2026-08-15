/**
 * Prisma Database Adapter
 * 
 * Implements IDatabasePort using Prisma ORM.
 * Works with any PostgreSQL provider (Neon, Local, Supabase, Railway).
 * 
 * @module adapters/database/prisma
 */

import { PrismaClient, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import type { 
  IDatabasePort, 
  UserEntity, 
  SubscriptionEntity, 
  UsageRecordEntity,
  DatabaseConfig 
} from '../../core/ports/database.port.js';

/**
 * Map Prisma subscription plan to domain model
 */
function mapPlan(plan: SubscriptionPlan): SubscriptionEntity['plan'] {
  return plan as SubscriptionEntity['plan'];
}

/**
 * Map Prisma subscription status to domain model
 */
function mapStatus(status: SubscriptionStatus): SubscriptionEntity['status'] {
  return status as SubscriptionEntity['status'];
}

/**
 * Prisma adapter for database operations
 */
export class PrismaDatabaseAdapter implements IDatabasePort {
  private client: PrismaClient | null = null;
  private config: DatabaseConfig;
  
  constructor(config: DatabaseConfig) {
    this.config = config;
  }
  
  // ============================================================================
  // Connection Management
  // ============================================================================
  
  async connect(): Promise<void> {
    if (this.client) {
      return; // Already connected
    }
    
    // Prisma uses DATABASE_URL from environment
    // We can override by setting it before creating the client
    if (this.config.url) {
      process.env.DATABASE_URL = this.config.url;
    }
    
    this.client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'error', 'warn'] 
        : ['error'],
    });
    
    await this.client.$connect();
    console.log(`✅ Database connected (${this.config.provider})`);
  }
  
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
      console.log('📴 Database disconnected');
    }
  }
  
  async healthCheck(): Promise<{ connected: boolean; latency?: number }> {
    if (!this.client) {
      return { connected: false };
    }
    
    try {
      const start = Date.now();
      await this.client.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      return { connected: true, latency };
    } catch (error) {
      console.error('Database health check failed:', error);
      return { connected: false };
    }
  }
  
  // ============================================================================
  // User Operations
  // ============================================================================
  
  async findUserById(id: string): Promise<UserEntity | null> {
    this.ensureConnected();
    
    const user = await this.client!.user.findUnique({
      where: { id },
    });
    
    if (!user) return null;
    
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
  
  async findUserByEmail(email: string): Promise<UserEntity | null> {
    this.ensureConnected();
    
    const user = await this.client!.user.findUnique({
      where: { email },
    });
    
    if (!user) return null;
    
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
  
  // ============================================================================
  // Subscription Operations
  // ============================================================================
  
  async findSubscriptionByUserId(userId: string): Promise<SubscriptionEntity | null> {
    this.ensureConnected();
    
    const sub = await this.client!.subscription.findUnique({
      where: { userId },
    });
    
    if (!sub) return null;
    
    return {
      id: sub.id,
      userId: sub.userId,
      plan: mapPlan(sub.plan),
      status: mapStatus(sub.status),
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }
  
  async createSubscription(
    userId: string, 
    plan: SubscriptionEntity['plan']
  ): Promise<SubscriptionEntity> {
    this.ensureConnected();
    
    const sub = await this.client!.subscription.create({
      data: {
        userId,
        plan: plan as SubscriptionPlan,
        status: 'ACTIVE',
      },
    });
    
    return {
      id: sub.id,
      userId: sub.userId,
      plan: mapPlan(sub.plan),
      status: mapStatus(sub.status),
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }
  
  async updateSubscription(
    userId: string, 
    data: Partial<SubscriptionEntity>
  ): Promise<SubscriptionEntity> {
    this.ensureConnected();
    
    const updateData: any = {};
    if (data.plan) updateData.plan = data.plan as SubscriptionPlan;
    if (data.status) updateData.status = data.status as SubscriptionStatus;
    if (data.currentPeriodEnd !== undefined) updateData.currentPeriodEnd = data.currentPeriodEnd;
    if (data.cancelAtPeriodEnd !== undefined) updateData.cancelAtPeriodEnd = data.cancelAtPeriodEnd;
    
    const sub = await this.client!.subscription.update({
      where: { userId },
      data: updateData,
    });
    
    return {
      id: sub.id,
      userId: sub.userId,
      plan: mapPlan(sub.plan),
      status: mapStatus(sub.status),
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }
  
  // ============================================================================
  // Usage Operations
  // ============================================================================
  
  async getMonthlyUsage(userId: string): Promise<{ audioMinutes: number; tokensGenerated: number }> {
    this.ensureConnected();
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const result = await this.client!.usageRecord.aggregate({
      where: {
        userId,
        date: { gte: startOfMonth },
      },
      _sum: {
        audioMinutes: true,
        tokensGenerated: true,
      },
    });
    
    return {
      audioMinutes: result._sum.audioMinutes || 0,
      tokensGenerated: result._sum.tokensGenerated || 0,
    };
  }
  
  async recordUsage(
    userId: string, 
    audioMinutes: number, 
    tokensGenerated: number
  ): Promise<void> {
    this.ensureConnected();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    await this.client!.usageRecord.upsert({
      where: {
        userId_date: { userId, date: today },
      },
      update: {
        audioMinutes: { increment: audioMinutes },
        tokensGenerated: { increment: tokensGenerated },
      },
      create: {
        userId,
        audioMinutes,
        tokensGenerated,
        date: today,
      },
    });
  }
  
  async getUsageHistory(userId: string, days: number): Promise<UsageRecordEntity[]> {
    this.ensureConnected();
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    
    const records = await this.client!.usageRecord.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      orderBy: { date: 'desc' },
    });
    
    return records.map(r => ({
      id: r.id,
      userId: r.userId,
      audioMinutes: r.audioMinutes,
      tokensGenerated: r.tokensGenerated,
      date: r.date,
    }));
  }
  
  // ============================================================================
  // Token Log Operations
  // ============================================================================
  
  async logTokenCreation(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    this.ensureConnected();
    
    await this.client!.ephemeralTokenLog.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }
  
  async markTokenRevoked(tokenHash: string): Promise<void> {
    this.ensureConnected();
    
    await this.client!.ephemeralTokenLog.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
  
  // ============================================================================
  // Raw Client Access
  // ============================================================================
  
  getRawClient(): PrismaClient {
    this.ensureConnected();
    return this.client!;
  }
  
  // ============================================================================
  // Private Helpers
  // ============================================================================
  
  private ensureConnected(): void {
    if (!this.client) {
      throw new Error('Database not connected. Call connect() first.');
    }
  }
}

/**
 * Create a Prisma database adapter
 */
export function createPrismaAdapter(config: DatabaseConfig): IDatabasePort {
  return new PrismaDatabaseAdapter(config);
}
