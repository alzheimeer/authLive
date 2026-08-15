/**
 * Dependency Injection Container
 * 
 * Central place to configure and retrieve all adapters.
 * This is the composition root of the hexagonal architecture.
 * 
 * Usage:
 * ```typescript
 * import { container, initializeContainer } from './core/container.js';
 * 
 * // At startup
 * await initializeContainer();
 * 
 * // Anywhere in the app
 * const db = container.database();
 * const cache = container.cache();
 * const config = container.config();
 * ```
 * 
 * @module core/container
 */

import type { IDatabasePort } from './ports/database.port.js';
import type { ICachePort } from './ports/cache.port.js';
import type { IConfigPort } from './ports/config.port.js';

// Adapters
import { createPrismaAdapter } from '../adapters/database/prisma.adapter.js';
import { createUpstashAdapter } from '../adapters/cache/upstash.adapter.js';
import { createLocalRedisAdapter } from '../adapters/cache/redis.adapter.js';
import { createEnvConfigAdapter } from '../adapters/config/env.adapter.js';

/**
 * Container interface
 */
export interface IContainer {
  config(): IConfigPort;
  database(): IDatabasePort;
  cache(): ICachePort;
  
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Concrete container implementation
 */
class Container implements IContainer {
  private _config: IConfigPort | null = null;
  private _database: IDatabasePort | null = null;
  private _cache: ICachePort | null = null;
  private _initialized = false;
  
  config(): IConfigPort {
    if (!this._config) {
      throw new Error('Container not initialized. Call initialize() first.');
    }
    return this._config;
  }
  
  database(): IDatabasePort {
    if (!this._database) {
      throw new Error('Container not initialized. Call initialize() first.');
    }
    return this._database;
  }
  
  cache(): ICachePort {
    if (!this._cache) {
      throw new Error('Container not initialized. Call initialize() first.');
    }
    return this._cache;
  }
  
  async initialize(): Promise<void> {
    if (this._initialized) {
      console.log('⚠️  Container already initialized');
      return;
    }
    
    console.log('🔧 Initializing dependency container...');
    
    // 1. Config first (other adapters depend on it)
    this._config = createEnvConfigAdapter();
    await this._config.load();
    this._config.validate();
    
    const configValues = this._config.getConfig();
    
    // 2. Database adapter based on config
    this._database = createPrismaAdapter({
      provider: configValues.database.provider,
      url: configValues.database.url,
      poolSize: configValues.database.poolSize,
      ssl: configValues.database.ssl,
    });
    await this._database.connect();
    
    // 3. Cache adapter based on config
    const cacheConfig = configValues.cache;
    
    if (cacheConfig.provider === 'upstash') {
      this._cache = createUpstashAdapter({
        provider: 'upstash',
        upstashUrl: cacheConfig.upstashUrl,
        upstashToken: cacheConfig.upstashToken,
        keyPrefix: 'traductor:',
      });
    } else if (cacheConfig.provider === 'redis') {
      this._cache = createLocalRedisAdapter({
        provider: 'redis',
        redisUrl: cacheConfig.redisUrl,
        redisPassword: cacheConfig.redisPassword,
        keyPrefix: 'traductor:',
      });
    } else {
      // Memory fallback - use Upstash adapter which has in-memory fallback built-in
      this._cache = createUpstashAdapter({
        provider: 'memory',
        keyPrefix: 'traductor:',
      });
    }
    
    await this._cache.connect();
    
    this._initialized = true;
    console.log('✅ Container initialized successfully');
  }
  
  async shutdown(): Promise<void> {
    console.log('🔌 Shutting down container...');
    
    if (this._cache) {
      await this._cache.disconnect();
    }
    
    if (this._database) {
      await this._database.disconnect();
    }
    
    this._initialized = false;
    console.log('👋 Container shut down');
  }
}

/**
 * Global container instance
 */
export const container: IContainer = new Container();

/**
 * Initialize the container
 * Call this at application startup
 */
export async function initializeContainer(): Promise<void> {
  await container.initialize();
}

/**
 * Shutdown the container
 * Call this before application exit
 */
export async function shutdownContainer(): Promise<void> {
  await container.shutdown();
}

/**
 * Helper to get typed adapters
 */
export const adapters = {
  get config() { return container.config(); },
  get database() { return container.database(); },
  get cache() { return container.cache(); },
};
