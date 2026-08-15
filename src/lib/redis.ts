/**
 * Redis Client for Upstash
 * 
 * Uses Upstash Redis (serverless) for:
 * - Rate limiting (sliding window)
 * - Session caching
 * - Token blacklist (for revocation)
 * - Usage counters
 * 
 * Falls back to in-memory if Redis unavailable.
 * 
 * @module lib/redis
 */

import { Redis } from '@upstash/redis';

// ============================================================================
// Redis Client Setup
// ============================================================================

let redis: Redis | null = null;
let isRedisAvailable = false;

/**
 * Initialize Redis connection
 * Uses Upstash REST API (works serverless without TCP connections)
 */
function initRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.warn('⚠️  Redis not configured - using in-memory fallback');
    console.warn('   Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for production');
    return null;
  }
  
  try {
    const client = new Redis({ url, token });
    console.log('✅ Redis connected (Upstash)');
    isRedisAvailable = true;
    return client;
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    return null;
  }
}

// Initialize on module load
redis = initRedis();

// In-memory fallback stores
const memoryRateLimit = new Map<string, { count: number; resetTime: number }>();
const memorySessionCache = new Map<string, { data: any; expiry: number }>();
const memoryTokenBlacklist = new Set<string>();

// ============================================================================
// Rate Limiting (Sliding Window)
// ============================================================================

/**
 * Check rate limit for a key
 * 
 * @param key - Rate limit key (e.g., "ratelimit:ip:127.0.0.1:auth")
 * @param limit - Max requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns { allowed: boolean, remaining: number, resetIn: number }
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (redis && isRedisAvailable) {
    try {
      // Use sorted set for sliding window
      const redisKey = `ratelimit:${key}`;
      
      // Remove old entries
      await redis.zremrangebyscore(redisKey, 0, windowStart);
      
      // Count current entries
      const count = await redis.zcard(redisKey);
      
      if (count >= limit) {
        // Get oldest entry to calculate reset time
        const oldest = await redis.zrange(redisKey, 0, 0, { withScores: true });
        const oldestScore = oldest.length > 0 && typeof oldest[0] === 'object' && oldest[0] !== null
          ? (oldest[0] as { score: number }).score
          : now;
        const resetIn = Math.max(0, oldestScore + windowMs - now);
        
        return { allowed: false, remaining: 0, resetIn };
      }
      
      // Add current request
      await redis.zadd(redisKey, { score: now, member: `${now}-${Math.random()}` });
      await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 1);
      
      return { allowed: true, remaining: limit - count - 1, resetIn: windowMs };
    } catch (error) {
      console.error('Redis rate limit error, falling back to memory:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback
  const record = memoryRateLimit.get(key);
  
  if (!record || now > record.resetTime) {
    memoryRateLimit.set(key, { count: 1, resetTime: now + windowMs });
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

/**
 * Cache session data
 * 
 * @param sessionToken - Session token
 * @param data - Session data to cache
 * @param ttlSeconds - TTL in seconds (default: 5 minutes)
 */
export async function cacheSession(
  sessionToken: string,
  data: any,
  ttlSeconds: number = 300
): Promise<void> {
  const key = `session:${sessionToken}`;
  
  if (redis && isRedisAvailable) {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
      return;
    } catch (error) {
      console.error('Redis cache session error:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback
  memorySessionCache.set(key, {
    data,
    expiry: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Get cached session data
 * 
 * @param sessionToken - Session token
 * @returns Session data or null if not cached/expired
 */
export async function getCachedSession(sessionToken: string): Promise<any | null> {
  const key = `session:${sessionToken}`;
  
  if (redis && isRedisAvailable) {
    try {
      const data = await redis.get(key);
      return data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
    } catch (error) {
      console.error('Redis get session error:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback
  const cached = memorySessionCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  memorySessionCache.delete(key);
  return null;
}

/**
 * Invalidate cached session
 * 
 * @param sessionToken - Session token
 */
export async function invalidateSession(sessionToken: string): Promise<void> {
  const key = `session:${sessionToken}`;
  
  if (redis && isRedisAvailable) {
    try {
      await redis.del(key);
      return;
    } catch (error) {
      console.error('Redis invalidate session error:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback
  memorySessionCache.delete(key);
}

// ============================================================================
// Token Blacklist (for revocation)
// ============================================================================

/**
 * Add token to blacklist
 * 
 * @param tokenHash - Hash of the token to blacklist
 * @param ttlSeconds - TTL in seconds (should match token expiry)
 */
export async function blacklistToken(
  tokenHash: string,
  ttlSeconds: number = 3600
): Promise<void> {
  const key = `blacklist:${tokenHash}`;
  
  if (redis && isRedisAvailable) {
    try {
      await redis.setex(key, ttlSeconds, '1');
      return;
    } catch (error) {
      console.error('Redis blacklist token error:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback
  memoryTokenBlacklist.add(tokenHash);
  // Clean up after TTL (approximate)
  setTimeout(() => memoryTokenBlacklist.delete(tokenHash), ttlSeconds * 1000);
}

/**
 * Check if token is blacklisted
 * 
 * @param tokenHash - Hash of the token to check
 * @returns true if blacklisted
 */
export async function isTokenBlacklisted(tokenHash: string): Promise<boolean> {
  const key = `blacklist:${tokenHash}`;
  
  if (redis && isRedisAvailable) {
    try {
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('Redis check blacklist error:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback
  return memoryTokenBlacklist.has(tokenHash);
}

// ============================================================================
// Usage Counters (atomic increments)
// ============================================================================

/**
 * Increment usage counter atomically
 * 
 * @param userId - User ID
 * @param field - Field to increment ('audioMinutes' or 'tokensGenerated')
 * @param amount - Amount to increment
 * @returns New total for today
 */
export async function incrementUsage(
  userId: string,
  field: 'audioMinutes' | 'tokensGenerated',
  amount: number
): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const key = `usage:${userId}:${today}:${field}`;
  
  if (redis && isRedisAvailable) {
    try {
      const newValue = await redis.incrbyfloat(key, amount);
      // Expire at end of day + 1 hour buffer
      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const ttl = Math.ceil((endOfDay.getTime() - now.getTime()) / 1000) + 3600;
      await redis.expire(key, ttl);
      return newValue;
    } catch (error) {
      console.error('Redis increment usage error:', error);
      isRedisAvailable = false;
    }
  }
  
  // In-memory fallback - returns 0 (actual tracking in DB)
  return 0;
}

/**
 * Get current usage from Redis (fast check before DB)
 * 
 * @param userId - User ID
 * @returns Cached usage or null if not in Redis
 */
export async function getUsageCache(
  userId: string
): Promise<{ audioMinutes: number; tokensGenerated: number } | null> {
  const today = new Date().toISOString().split('T')[0];
  
  if (redis && isRedisAvailable) {
    try {
      const [audioMinutes, tokensGenerated] = await Promise.all([
        redis.get(`usage:${userId}:${today}:audioMinutes`),
        redis.get(`usage:${userId}:${today}:tokensGenerated`),
      ]);
      
      if (audioMinutes !== null || tokensGenerated !== null) {
        return {
          audioMinutes: Number(audioMinutes) || 0,
          tokensGenerated: Number(tokensGenerated) || 0,
        };
      }
    } catch (error) {
      console.error('Redis get usage error:', error);
      isRedisAvailable = false;
    }
  }
  
  return null;
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check Redis health
 * 
 * @returns { connected: boolean, latency?: number }
 */
export async function checkRedisHealth(): Promise<{ connected: boolean; latency?: number }> {
  if (!redis) {
    return { connected: false };
  }
  
  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;
    isRedisAvailable = true;
    return { connected: true, latency };
  } catch (error) {
    isRedisAvailable = false;
    return { connected: false };
  }
}

// Export for direct access if needed
export { redis, isRedisAvailable };
