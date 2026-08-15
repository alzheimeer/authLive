/**
 * Local Redis Cache Adapter
 * 
 * Implements ICachePort using ioredis for local/self-hosted Redis.
 * Use this adapter when migrating to Hetzner or any VPS with local Redis.
 * 
 * @module adapters/cache/redis
 */

import { Redis } from 'ioredis';
import type { 
  ICachePort, 
  RateLimitResult, 
  CacheHealthResult,
  CacheConfig 
} from '../../core/ports/cache.port.js';

/**
 * Local Redis adapter using ioredis
 */
export class LocalRedisCacheAdapter implements ICachePort {
  private redis: Redis | null = null;
  private isAvailableFlag = false;
  private config: CacheConfig;
  
  // In-memory fallback stores (same as Upstash adapter)
  private memoryRateLimit = new Map<string, { count: number; resetTime: number }>();
  private memoryCache = new Map<string, { data: unknown; expiry: number }>();
  private memoryBlacklist = new Set<string>();
  private memoryUsage = new Map<string, number>();
  
  constructor(config: CacheConfig) {
    this.config = config;
  }
  
  // ============================================================================
  // Connection Management
  // ============================================================================
  
  async connect(): Promise<void> {
    const url = this.config.redisUrl || 'redis://localhost:6379';
    
    try {
      const client = new Redis(url, {
        password: this.config.redisPassword,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) {
            console.warn('⚠️  Redis connection failed, using in-memory fallback');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 1000);
        },
        lazyConnect: false,
      });
      
      // Test connection
      await client.ping();
      this.redis = client;
      this.isAvailableFlag = true;
      console.log('✅ Redis connected (local)');
      
      // Handle connection errors
      client.on('error', (err: Error) => {
        console.error('Redis error:', err);
        this.isAvailableFlag = false;
      });
      
      client.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
      });
      
      client.on('ready', () => {
        console.log('✅ Redis ready');
        this.isAvailableFlag = true;
      });
      
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      this.redis = null;
      this.isAvailableFlag = false;
    }
  }
  
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isAvailableFlag = false;
      console.log('📴 Redis disconnected');
    }
  }
  
  async healthCheck(): Promise<CacheHealthResult> {
    if (!this.redis) {
      return { connected: false, provider: 'redis' };
    }
    
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;
      this.isAvailableFlag = true;
      return { connected: true, latency, provider: 'redis' };
    } catch {
      this.isAvailableFlag = false;
      return { connected: false, provider: 'redis' };
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
        // Use Lua script for atomic rate limiting
        const luaScript = `
          local key = KEYS[1]
          local now = tonumber(ARGV[1])
          local windowStart = tonumber(ARGV[2])
          local limit = tonumber(ARGV[3])
          local windowMs = tonumber(ARGV[4])
          
          redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
          local count = redis.call('ZCARD', key)
          
          if count >= limit then
            local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
            local resetIn = 0
            if oldest[2] then
              resetIn = math.max(0, tonumber(oldest[2]) + windowMs - now)
            end
            return {0, 0, resetIn}
          end
          
          redis.call('ZADD', key, now, now .. '-' .. math.random())
          redis.call('PEXPIRE', key, windowMs + 1000)
          
          return {1, limit - count - 1, windowMs}
        `;
        
        const result = await this.redis.eval(
          luaScript,
          1,
          redisKey,
          now,
          windowStart,
          limit,
          windowMs
        ) as [number, number, number];
        
        return {
          allowed: result[0] === 1,
          remaining: result[1],
          resetIn: result[2],
        };
      } catch (error) {
        console.error('Redis rate limit error:', error);
        this.isAvailableFlag = false;
      }
    }
    
    // In-memory fallback
    return this.memoryRateLimitCheck(key, limit, windowMs);
  }
  
  private memoryRateLimitCheck(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
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
        return data ? JSON.parse(data) : null;
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
        console.error('Redis blacklist error:', error);
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
        const newValueStr = await this.redis.incrbyfloat(key, amount);
        const newValue = parseFloat(newValueStr);
        // Expire at end of day + 1 hour
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
        return await this.redis.get(fullKey);
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
 * Create a local Redis cache adapter
 */
export function createLocalRedisAdapter(config: CacheConfig): ICachePort {
  return new LocalRedisCacheAdapter(config);
}
