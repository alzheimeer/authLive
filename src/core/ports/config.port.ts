/**
 * Config Port - Abstraction Layer
 * 
 * Hexagonal Architecture: This port defines the interface for configuration.
 * The application core depends on this interface, not on specific implementations.
 * 
 * Adapters can implement this for:
 * - Environment variables (current)
 * - AWS Secrets Manager
 * - HashiCorp Vault
 * - .env files
 * - JSON/YAML config files
 * 
 * @module core/ports/config
 */

/**
 * Database configuration
 */
export interface DatabaseConfigValues {
  provider: 'neon' | 'local' | 'supabase' | 'railway';
  url: string;
  poolSize?: number;
  ssl?: boolean;
}

/**
 * Cache configuration
 */
export interface CacheConfigValues {
  provider: 'upstash' | 'redis' | 'memory';
  upstashUrl?: string;
  upstashToken?: string;
  redisUrl?: string;
  redisPassword?: string;
}

/**
 * Auth configuration
 */
export interface AuthConfigValues {
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
  sessionExpiryDays: number;
  googleClientId?: string;
  googleClientSecret?: string;
}

/**
 * Server configuration
 */
export interface ServerConfigValues {
  port: number;
  environment: 'development' | 'staging' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Multi-tenant application configuration
 */
export interface ApplicationConfigValues {
  enableMultiTenant: boolean;
  defaultAppId?: string;
}

/**
 * Gemini API configuration
 */
export interface GeminiConfigValues {
  masterApiKey?: string;
  tokenExpiryHours: number;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfigValues {
  auth: {
    windowMs: number;
    maxRequests: number;
  };
  tokens: {
    windowMs: number;
    maxRequests: number;
  };
  usage: {
    windowMs: number;
    maxRequests: number;
  };
}

/**
 * Full configuration interface
 */
export interface AppConfig {
  database: DatabaseConfigValues;
  cache: CacheConfigValues;
  auth: AuthConfigValues;
  server: ServerConfigValues;
  application: ApplicationConfigValues;
  gemini: GeminiConfigValues;
  rateLimit: RateLimitConfigValues;
}

/**
 * Config Port Interface
 * 
 * All configuration access goes through this interface.
 * This allows swapping configuration sources without changing application code.
 */
export interface IConfigPort {
  /**
   * Load configuration from source
   * Should be called once at startup
   */
  load(): Promise<void>;
  
  /**
   * Reload configuration (for hot-reload scenarios)
   */
  reload(): Promise<void>;
  
  /**
   * Get full configuration
   */
  getConfig(): AppConfig;
  
  /**
   * Get database configuration
   */
  getDatabaseConfig(): DatabaseConfigValues;
  
  /**
   * Get cache configuration
   */
  getCacheConfig(): CacheConfigValues;
  
  /**
   * Get auth configuration
   */
  getAuthConfig(): AuthConfigValues;
  
  /**
   * Get server configuration
   */
  getServerConfig(): ServerConfigValues;
  
  /**
   * Get application configuration
   */
  getApplicationConfig(): ApplicationConfigValues;
  
  /**
   * Get Gemini configuration
   */
  getGeminiConfig(): GeminiConfigValues;
  
  /**
   * Get rate limit configuration
   */
  getRateLimitConfig(): RateLimitConfigValues;
  
  /**
   * Get a specific environment variable (escape hatch)
   * 
   * @param key - Environment variable name
   * @param defaultValue - Default value if not found
   */
  getEnv(key: string, defaultValue?: string): string | undefined;
  
  /**
   * Check if running in production
   */
  isProduction(): boolean;
  
  /**
   * Check if running in development
   */
  isDevelopment(): boolean;
  
  /**
   * Validate configuration
   * Throws if required values are missing
   */
  validate(): void;
}

/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
  constructor(
    public readonly missingKeys: string[],
    public readonly invalidKeys: Record<string, string>
  ) {
    const missingMsg = missingKeys.length > 0 
      ? `Missing: ${missingKeys.join(', ')}` 
      : '';
    const invalidMsg = Object.keys(invalidKeys).length > 0
      ? `Invalid: ${Object.entries(invalidKeys).map(([k, v]) => `${k} (${v})`).join(', ')}`
      : '';
    
    super(`Configuration validation failed. ${missingMsg} ${invalidMsg}`.trim());
    this.name = 'ConfigValidationError';
  }
}
