/**
 * Cache Port - Abstraction Layer
 * 
 * Hexagonal Architecture: This port defines the interface for cache operations.
 * The application core depends on this interface, not on specific implementations.
 * 
 * Adapters can implement this for:
 * - Upstash Redis (current - serverless)
 * - Local Redis (for Hetzner migration)
 * - ioredis + Redis Cluster
 * - In-memory cache (development/testing)
 * - Memcached
 * 
 * @module core/ports/cache
 */

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // milliseconds
}

/**
 * Health check result
 */
export interface CacheHealthResult {
  connected: boolean;
  latency?: number; // milliseconds
  provider?: string;
}

/**
 * Cache Port Interface
 * 
 * All cache operations go through this interface.
 * This allows swapping cache providers without changing application code.
 */
export interface ICachePort {
  // ============================================================================
  // Connection Management
  // ============================================================================
  
  /**
   * Initialize the cache connection
   * Should be idempotent (safe to call multiple times)
   */
  connect(): Promise<void>;
  
  /**
   * Close the cache connection gracefully
   */
  disconnect(): Promise<void>;
  
  /**
   * Check cache health
   */
  healthCheck(): Promise<CacheHealthResult>;
  
  /**
   * Check if cache is available (may have failed over to fallback)
   */
  isAvailable(): boolean;
  
  // ============================================================================
  // Rate Limiting (Sliding Window)
  // ============================================================================
  
  /**
   * Check and record rate limit
   * 
   * @param key - Rate limit key (e.g., "auth:ip:127.0.0.1")
   * @param limit - Max requests allowed in window
   * @param windowMs - Time window in milliseconds
   */
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  
  // ============================================================================
  // Session Caching
  // ============================================================================
  
  /**
   * Cache session data
   * 
   * @param sessionToken - Session identifier
   * @param data - Session data to cache
   * @param ttlSeconds - Time to live in seconds
   */
  cacheSession(sessionToken: string, data: unknown, ttlSeconds: number): Promise<void>;
  
  /**
   * Get cached session data
   * 
   * @param sessionToken - Session identifier
   * @returns Cached data or null if not found/expired
   */
  getCachedSession(sessionToken: string): Promise<unknown | null>;
  
  /**
   * Invalidate cached session
   * 
   * @param sessionToken - Session identifier
   */
  invalidateSession(sessionToken: string): Promise<void>;
  
  // ============================================================================
  // Token Blacklist (for revocation)
  // ============================================================================
  
  /**
   * Add token to blacklist
   * 
   * @param tokenHash - Hash of the token to blacklist
   * @param ttlSeconds - TTL (should match token expiry)
   */
  blacklistToken(tokenHash: string, ttlSeconds: number): Promise<void>;
  
  /**
   * Check if token is blacklisted
   * 
   * @param tokenHash - Hash of the token to check
   */
  isTokenBlacklisted(tokenHash: string): Promise<boolean>;
  
  // ============================================================================
  // Usage Counters (atomic operations)
  // ============================================================================
  
  /**
   * Increment usage counter atomically
   * 
   * @param userId - User ID
   * @param field - Field to increment
   * @param amount - Amount to add
   * @returns New total value
   */
  incrementUsage(
    userId: string,
    field: 'audioMinutes' | 'tokensGenerated',
    amount: number
  ): Promise<number>;
  
  /**
   * Get cached usage for today
   * 
   * @param userId - User ID
   * @returns Cached usage or null if not in cache
   */
  getUsageCache(userId: string): Promise<{
    audioMinutes: number;
    tokensGenerated: number;
  } | null>;
  
  // ============================================================================
  // Generic Key-Value Operations
  // ============================================================================
  
  /**
   * Set a value with optional expiry
   * 
   * @param key - Cache key
   * @param value - Value to store
   * @param ttlSeconds - Optional TTL in seconds
   */
  set(key: string, value: string | number, ttlSeconds?: number): Promise<void>;
  
  /**
   * Get a value
   * 
   * @param key - Cache key
   * @returns Value or null if not found
   */
  get(key: string): Promise<string | null>;
  
  /**
   * Delete a key
   * 
   * @param key - Cache key
   */
  delete(key: string): Promise<void>;
  
  /**
   * Check if a key exists
   * 
   * @param key - Cache key
   */
  exists(key: string): Promise<boolean>;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  provider: 'upstash' | 'redis' | 'memory';
  
  // For Upstash
  upstashUrl?: string;
  upstashToken?: string;
  
  // For local Redis
  redisUrl?: string;
  redisPassword?: string;
  
  // Common options
  keyPrefix?: string;
  defaultTtlSeconds?: number;
}
