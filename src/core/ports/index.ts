/**
 * Ports Index
 * 
 * Export all port interfaces for easy importing.
 * 
 * @module core/ports
 */

export type {
  IDatabasePort,
  UserEntity,
  SubscriptionEntity,
  UsageRecordEntity,
  DatabaseConfig,
} from './database.port.js';

export type {
  ICachePort,
  RateLimitResult,
  CacheHealthResult,
  CacheConfig,
} from './cache.port.js';

export type {
  IConfigPort,
  AppConfig,
  DatabaseConfigValues,
  CacheConfigValues,
  AuthConfigValues,
  ServerConfigValues,
  ApplicationConfigValues,
  GeminiConfigValues,
  RateLimitConfigValues,
} from './config.port.js';

export { ConfigValidationError } from './config.port.js';
