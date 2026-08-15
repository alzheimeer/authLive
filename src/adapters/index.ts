/**
 * Adapters Index
 * 
 * Export all adapter implementations for easy importing.
 * 
 * @module adapters
 */

// Database adapters
export { 
  PrismaDatabaseAdapter, 
  createPrismaAdapter 
} from './database/prisma.adapter.js';

// Cache adapters
export { 
  UpstashCacheAdapter, 
  createUpstashAdapter 
} from './cache/upstash.adapter.js';

export { 
  LocalRedisCacheAdapter, 
  createLocalRedisAdapter 
} from './cache/redis.adapter.js';

// Config adapters
export { 
  EnvConfigAdapter, 
  createEnvConfigAdapter,
  getConfigAdapter 
} from './config/env.adapter.js';
