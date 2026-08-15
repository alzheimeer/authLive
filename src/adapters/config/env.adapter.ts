/**
 * Environment Variables Config Adapter
 * 
 * Implements IConfigPort using environment variables.
 * Supports .env files via dotenv.
 * 
 * @module adapters/config/env
 */

import 'dotenv/config';
import type { 
  IConfigPort, 
  AppConfig,
  DatabaseConfigValues,
  CacheConfigValues,
  AuthConfigValues,
  ServerConfigValues,
  ApplicationConfigValues,
  GeminiConfigValues,
  RateLimitConfigValues,
  ConfigValidationError 
} from '../../core/ports/config.port.js';
import { ConfigValidationError as ConfigError } from '../../core/ports/config.port.js';

/**
 * Environment variables config adapter
 */
export class EnvConfigAdapter implements IConfigPort {
  private config: AppConfig | null = null;
  
  async load(): Promise<void> {
    this.config = this.buildConfig();
  }
  
  async reload(): Promise<void> {
    // Re-read from environment
    this.config = this.buildConfig();
  }
  
  private buildConfig(): AppConfig {
    return {
      database: this.buildDatabaseConfig(),
      cache: this.buildCacheConfig(),
      auth: this.buildAuthConfig(),
      server: this.buildServerConfig(),
      application: this.buildApplicationConfig(),
      gemini: this.buildGeminiConfig(),
      rateLimit: this.buildRateLimitConfig(),
    };
  }
  
  private buildDatabaseConfig(): DatabaseConfigValues {
    const url = process.env.DATABASE_URL || '';
    let provider: DatabaseConfigValues['provider'] = 'local';
    
    // Detect provider from URL
    if (url.includes('neon.tech') || url.includes('neon.')) {
      provider = 'neon';
    } else if (url.includes('supabase')) {
      provider = 'supabase';
    } else if (url.includes('railway')) {
      provider = 'railway';
    }
    
    return {
      provider,
      url,
      poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
      ssl: process.env.DATABASE_SSL !== 'false',
    };
  }
  
  private buildCacheConfig(): CacheConfigValues {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisUrl = process.env.REDIS_URL;
    
    let provider: CacheConfigValues['provider'] = 'memory';
    
    if (upstashUrl) {
      provider = 'upstash';
    } else if (redisUrl) {
      provider = 'redis';
    }
    
    return {
      provider,
      upstashUrl,
      upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN,
      redisUrl,
      redisPassword: process.env.REDIS_PASSWORD,
    };
  }
  
  private buildAuthConfig(): AuthConfigValues {
    return {
      secret: process.env.BETTER_AUTH_SECRET || '',
      baseUrl: process.env.BETTER_AUTH_URL || 'http://localhost:3100',
      trustedOrigins: (process.env.TRUSTED_ORIGINS || 'tauri://localhost')
        .split(',')
        .map(o => o.trim()),
      sessionExpiryDays: parseInt(process.env.SESSION_EXPIRY_DAYS || '7', 10),
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  
  private buildServerConfig(): ServerConfigValues {
    const env = process.env.NODE_ENV || 'development';
    
    return {
      port: parseInt(process.env.PORT || '3100', 10),
      environment: env as ServerConfigValues['environment'],
      logLevel: (process.env.LOG_LEVEL || 'info') as ServerConfigValues['logLevel'],
    };
  }
  
  private buildApplicationConfig(): ApplicationConfigValues {
    return {
      enableMultiTenant: process.env.ENABLE_MULTI_TENANT === 'true',
      defaultAppId: process.env.DEFAULT_APP_ID,
    };
  }
  
  private buildGeminiConfig(): GeminiConfigValues {
    return {
      masterApiKey: process.env.GEMINI_MASTER_API_KEY,
      tokenExpiryHours: parseInt(process.env.TOKEN_EXPIRY_HOURS || '1', 10),
    };
  }
  
  private buildRateLimitConfig(): RateLimitConfigValues {
    return {
      auth: {
        windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '30', 10),
      },
      tokens: {
        windowMs: parseInt(process.env.RATE_LIMIT_TOKENS_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_TOKENS_MAX || '10', 10),
      },
      usage: {
        windowMs: parseInt(process.env.RATE_LIMIT_USAGE_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_USAGE_MAX || '60', 10),
      },
    };
  }
  
  // ============================================================================
  // Getters
  // ============================================================================
  
  getConfig(): AppConfig {
    this.ensureLoaded();
    return this.config!;
  }
  
  getDatabaseConfig(): DatabaseConfigValues {
    this.ensureLoaded();
    return this.config!.database;
  }
  
  getCacheConfig(): CacheConfigValues {
    this.ensureLoaded();
    return this.config!.cache;
  }
  
  getAuthConfig(): AuthConfigValues {
    this.ensureLoaded();
    return this.config!.auth;
  }
  
  getServerConfig(): ServerConfigValues {
    this.ensureLoaded();
    return this.config!.server;
  }
  
  getApplicationConfig(): ApplicationConfigValues {
    this.ensureLoaded();
    return this.config!.application;
  }
  
  getGeminiConfig(): GeminiConfigValues {
    this.ensureLoaded();
    return this.config!.gemini;
  }
  
  getRateLimitConfig(): RateLimitConfigValues {
    this.ensureLoaded();
    return this.config!.rateLimit;
  }
  
  getEnv(key: string, defaultValue?: string): string | undefined {
    return process.env[key] ?? defaultValue;
  }
  
  isProduction(): boolean {
    this.ensureLoaded();
    return this.config!.server.environment === 'production';
  }
  
  isDevelopment(): boolean {
    this.ensureLoaded();
    return this.config!.server.environment === 'development';
  }
  
  // ============================================================================
  // Validation
  // ============================================================================
  
  validate(): void {
    this.ensureLoaded();
    
    const missingKeys: string[] = [];
    const invalidKeys: Record<string, string> = {};
    
    // Required fields
    if (!this.config!.database.url) {
      missingKeys.push('DATABASE_URL');
    }
    
    if (!this.config!.auth.secret) {
      missingKeys.push('BETTER_AUTH_SECRET');
    }
    
    // Validation rules
    if (this.config!.auth.secret && this.config!.auth.secret.length < 32) {
      invalidKeys['BETTER_AUTH_SECRET'] = 'Must be at least 32 characters';
    }
    
    if (this.config!.server.port < 1 || this.config!.server.port > 65535) {
      invalidKeys['PORT'] = 'Must be between 1 and 65535';
    }
    
    // Production-specific validation
    if (this.isProduction()) {
      if (this.config!.cache.provider === 'memory') {
        console.warn('⚠️  Using in-memory cache in production is not recommended');
      }
      
      if (!this.config!.auth.baseUrl.startsWith('https://')) {
        console.warn('⚠️  BETTER_AUTH_URL should use HTTPS in production');
      }
    }
    
    if (missingKeys.length > 0 || Object.keys(invalidKeys).length > 0) {
      throw new ConfigError(missingKeys, invalidKeys);
    }
  }
  
  // ============================================================================
  // Private Helpers
  // ============================================================================
  
  private ensureLoaded(): void {
    if (!this.config) {
      // Auto-load if not loaded
      this.config = this.buildConfig();
    }
  }
}

/**
 * Create an environment config adapter
 */
export function createEnvConfigAdapter(): IConfigPort {
  return new EnvConfigAdapter();
}

/**
 * Singleton instance for convenience
 */
let defaultInstance: IConfigPort | null = null;

export function getConfigAdapter(): IConfigPort {
  if (!defaultInstance) {
    defaultInstance = createEnvConfigAdapter();
  }
  return defaultInstance;
}
