/**
 * Upstash Redis Cache Adapter
 * 
 * Implements ICachePort using Upstash Redis (serverless).
 * Falls back to in-memory cache if Redis is unavailable.
 * 
 * @module adapters/cache/upstash
 */

import { Redis } from '@upstash/redis';
import type { 
  ICachePort, 
  RateLimitResult, 
  CacheHealthResult,
  CacheConfig 
} from '../../core/ports/cache.port.js';

/**
 * Upstash Redis adapter with in-memory fallback
 */
export class UpstashCacheAdapter implements ICachePort {
  private redis: Redis | null = null;
  private isAvailableFlag = false;
  private config: CacheConfig;
  
  // In-memory fallback stores
  private memoryRateLimit = new Map<string, { count: number; resetTime: number }>();
  private memoryCache = new Map<string, { data: any; expiry: number }>();
  private memoryBlacklist = new Set<string>();
  private memoryUsage = new Map<string, number>();
  
  constructor(config: CacheConfig) {
    this.config = config;
  }
  
  // ============================================================================
  // Connection Management
  // ============================================================================
  
  async connect(): Promise<void> {
    const url = this.config.upstashUrl;
    const token = this.config.upstashToken;
    
    if (!url || !token) {
      console.warn('⚠️  Upstash Redis not configured - using in-memory fallback');
      console.warn('   Set upstashUrl and upstashToken for production');
      return;
    }
    
    try {
      this.redis = new Redis({ url, token });
      // Test connection
      await this.redis.ping();
      this.isAvailableFlag = true;
      console.log('✅ Redis connected (Upstash)');
    } catch (error) {
      console.error('❌ Upstash connection failed:', error);
      this.redis = null;
      this.isAvailableFlag = false;
    }
  }
  
  async disconnect(): Promise<void> {
    // Upstash REST client doesn't need explicit disconnect
    this.redis = null;
    this.isAvailableFlag = false;
    console.log('📴 Redis disconnected');
  }
  
  async healthCheck(): Promise<CacheHealthResult> {
    if (!this.redis) {
      return { connected: false, provider: 'upstash' };
    }
    
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;
      this.isAvailableFlag = true;
      return { connected: true, latency, provider: 'upstash' };
    } catch {
      this.isAvailableFlag = false;
      return { connected: false, provider: 'upstash' };
    }
  }
  
  isAvailable(): boolean {
    return this.isAvailableFlag;
  }
  
  // ============================================================================
  // Rate Limiting
  // ============================================================================
  
  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `${this.config.keyPrefix || ''}ratelimit:${key}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        // Use sorted set for sliding window
        await this.redis.zremrangebyscore(redisKey, 0, windowStart);
        const count = await this.redis.zcard(redisKey);
        
        if (count >= limit) {
          const oldest = await this.redis.zrange(redisKey, 0, 0, { withScores: true });
          const oldestScore = oldest.length > 0 && typeof oldest[0] === 'object' && oldest[0] !== null
            ? (oldest[0] as { score: number }).score
            : now;
          const resetIn = Math.max(0, oldestScore + windowMs - now);
          
          return { allowed: false, remaining: 0, resetIn };
        }
        
        await this.redis.zadd(redisKey, { score: now, member: `${now}-${Math.random()}` });
        await this.redis.expire(redisKey, Math.ceil(windowMs / 1000) + 1);
        
        return { allowed: true, remaining: limit - count - 1, resetIn: windowMs };
      } catch (error) {
        console.error('Redis rate limit error, falling back to memory:', error);
        this.isAvailableFlag = false;
      }
    }
    
    // In-memory fallback
    const record = this.memoryRateLimit.get(key);
    
    if (!record || now > record.resetTime) {
      this.memoryRateLimit.set(key, { count: 1, resetTime: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetIn: windowMs };
    }
    
    if (record.count >= limit) {
      return { allowed: false, remaining: 0, resetIn: record.resetTime - now };
    }
    
    record.count++;
    return { allowed: true, remaining: limit - record.count, resetIn: record.resetTime - now };
  }
  
  // ============================================================================
  // Session Caching
  // ============================================================================
  
  async cacheSession(sessionToken: string, data: unknown, ttlSeconds: number): Promise<void> {
    const key = `${this.config.keyPrefix || ''}session:${sessionToken}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(data));
        return;
      } catch (error) {
        console.error('Redis cache session error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    this.memoryCache.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }
  
  async getCachedSession(sessionToken: string): Promise<unknown | null> {
    const key = `${this.config.keyPrefix || ''}session:${sessionToken}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        const data = await this.redis.get(key);
        return data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
      } catch (error) {
        console.error('Redis get session error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    const cached = this.memoryCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
    this.memoryCache.delete(key);
    return null;
  }
  
  async invalidateSession(sessionToken: string): Promise<void> {
    const key = `${this.config.keyPrefix || ''}session:${sessionToken}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        await this.redis.del(key);
        return;
      } catch (error) {
        console.error('Redis invalidate session error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    this.memoryCache.delete(key);
  }
  
  // ============================================================================
  // Token Blacklist
  // ============================================================================
  
  async blacklistToken(tokenHash: string, ttlSeconds: number): Promise<void> {
    const key = `${this.config.keyPrefix || ''}blacklist:${tokenHash}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        await this.redis.setex(key, ttlSeconds, '1');
        return;
      } catch (error) {
        console.error('Redis blacklist token error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    this.memoryBlacklist.add(tokenHash);
    setTimeout(() => this.memoryBlacklist.delete(tokenHash), ttlSeconds * 1000);
  }
  
  async isTokenBlacklisted(tokenHash: string): Promise<boolean> {
    const key = `${this.config.keyPrefix || ''}blacklist:${tokenHash}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        const exists = await this.redis.exists(key);
        return exists === 1;
      } catch (error) {
        console.error('Redis check blacklist error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    return this.memoryBlacklist.has(tokenHash);
  }
  
  // ============================================================================
  // Usage Counters
  // ============================================================================
  
  async incrementUsage(
    userId: string,
    field: 'audioMinutes' | 'tokensGenerated',
    amount: number
  ): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `${this.config.keyPrefix || ''}usage:${userId}:${today}:${field}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        const newValue = await this.redis.incrbyfloat(key, amount);
        // Expire at end of day + 1 hour buffer
        const now = new Date();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const ttl = Math.ceil((endOfDay.getTime() - now.getTime()) / 1000) + 3600;
        await this.redis.expire(key, ttl);
        return newValue;
      } catch (error) {
        console.error('Redis increment usage error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    // In-memory fallback
    const current = this.memoryUsage.get(key) || 0;
    const newValue = current + amount;
    this.memoryUsage.set(key, newValue);
    return newValue;
  }
  
  async getUsageCache(userId: string): Promise<{
    audioMinutes: number;
    tokensGenerated: number;
  } | null> {
    const today = new Date().toISOString().split('T')[0];
    const prefix = this.config.keyPrefix || '';
    
    if (this.redis && this.isAvailableFlag) {
      try {
        const [audioMinutes, tokensGenerated] = await Promise.all([
          this.redis.get(`${prefix}usage:${userId}:${today}:audioMinutes`),
          this.redis.get(`${prefix}usage:${userId}:${today}:tokensGenerated`),
        ]);
        
        if (audioMinutes !== null || tokensGenerated !== null) {
          return {
            audioMinutes: Number(audioMinutes) || 0,
            tokensGenerated: Number(tokensGenerated) || 0,
          };
        }
      } catch (error) {
        console.error('Redis get usage error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    // Check memory fallback
    const audioKey = `${prefix}usage:${userId}:${today}:audioMinutes`;
    const tokensKey = `${prefix}usage:${userId}:${today}:tokensGenerated`;
    
    if (this.memoryUsage.has(audioKey) || this.memoryUsage.has(tokensKey)) {
      return {
        audioMinutes: this.memoryUsage.get(audioKey) || 0,
        tokensGenerated: this.memoryUsage.get(tokensKey) || 0,
      };
    }
    
    return null;
  }
  
  // ============================================================================
  // Generic Key-Value Operations
  // ============================================================================
  
  async set(key: string, value: string | number, ttlSeconds?: number): Promise<void> {
    const fullKey = `${this.config.keyPrefix || ''}${key}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        if (ttlSeconds) {
          await this.redis.setex(fullKey, ttlSeconds, String(value));
        } else {
          await this.redis.set(fullKey, String(value));
        }
        return;
      } catch (error) {
        console.error('Redis set error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    this.memoryCache.set(fullKey, {
      data: value,
      expiry: ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity,
    });
  }
  
  async get(key: string): Promise<string | null> {
    const fullKey = `${this.config.keyPrefix || ''}${key}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        const value = await this.redis.get(fullKey);
        return value ? String(value) : null;
      } catch (error) {
        console.error('Redis get error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    const cached = this.memoryCache.get(fullKey);
    if (cached && cached.expiry > Date.now()) {
      return String(cached.data);
    }
    this.memoryCache.delete(fullKey);
    return null;
  }
  
  async delete(key: string): Promise<void> {
    const fullKey = `${this.config.keyPrefix || ''}${key}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        await this.redis.del(fullKey);
        return;
      } catch (error) {
        console.error('Redis delete error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    this.memoryCache.delete(fullKey);
  }
  
  async exists(key: string): Promise<boolean> {
    const fullKey = `${this.config.keyPrefix || ''}${key}`;
    
    if (this.redis && this.isAvailableFlag) {
      try {
        const result = await this.redis.exists(fullKey);
        return result === 1;
      } catch (error) {
        console.error('Redis exists error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    const cached = this.memoryCache.get(fullKey);
    return cached !== undefined && cached.expiry > Date.now();
  }
}

/**
 * Create an Upstash cache adapter
 */
export function createUpstashAdapter(config: CacheConfig): ICachePort {
  return new UpstashCacheAdapter(config);
}
