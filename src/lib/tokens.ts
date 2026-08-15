/**
 * Ephemeral Token Service
 * 
 * Generates short-lived tokens (1 hour) for Gemini API access.
 * Users with Starter/Pro plans get tokens from server-managed API key.
 * BYOK users use their own keys directly.
 * 
 * Now with Redis caching for:
 * - Token blacklist (instant revocation)
 * - Usage counters (fast limit checks)
 * 
 * @module lib/tokens
 */

import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { prisma } from './auth.js';
import { blacklistToken, isTokenBlacklisted, incrementUsage, getUsageCache } from './redis.js';

// Token configuration
const TOKEN_EXPIRY_HOURS = 1;
const TOKEN_SECRET = process.env.BETTER_AUTH_SECRET || 'fallback-secret';

/**
 * Subscription plan types
 */
export type SubscriptionPlan = 'BYOK_FREE' | 'STARTER' | 'PRO';

/**
 * Ephemeral token payload
 */
export interface EphemeralTokenPayload {
  userId: string;
  plan: SubscriptionPlan;
  iat: number;
  exp: number;
  jti: string; // Unique token ID
}

/**
 * Ephemeral token response
 */
export interface EphemeralTokenResponse {
  success: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
  code?: string;
}

/**
 * Generate SHA-256 hash of a token (for logging without storing actual token)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Check if user has exceeded their usage limits
 * Uses Redis cache first, falls back to DB
 */
async function checkUsageLimits(userId: string, plan: SubscriptionPlan): Promise<boolean> {
  // BYOK users have no server-side limits (they manage their own key)
  if (plan === 'BYOK_FREE') {
    return true;
  }
  
  // Plan limits (in minutes per month)
  const limits: Record<SubscriptionPlan, number> = {
    BYOK_FREE: Infinity,
    STARTER: 600,  // 10 hours
    PRO: 1800,     // 30 hours
  };
  
  // Try Redis cache first (fast)
  const cachedUsage = await getUsageCache(userId);
  if (cachedUsage !== null) {
    return cachedUsage.audioMinutes < limits[plan];
  }
  
  // Fall back to DB
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const usage = await prisma.usageRecord.aggregate({
    where: {
      userId,
      date: {
        gte: startOfMonth,
      },
    },
    _sum: {
      audioMinutes: true,
    },
  });
  
  const totalMinutes = usage._sum.audioMinutes || 0;
  
  return totalMinutes < limits[plan];
}

/**
 * Generate an ephemeral token for Gemini API access
 * 
 * @param userId - User ID from session
 * @param plan - User's subscription plan
 * @param ipAddress - Client IP for logging
 * @param userAgent - Client user agent for logging
 * @returns Token response with token and expiration
 */
export async function generateEphemeralToken(
  userId: string,
  plan: SubscriptionPlan,
  ipAddress?: string,
  userAgent?: string
): Promise<EphemeralTokenResponse> {
  // Validate plan allows token generation
  if (plan === 'BYOK_FREE') {
    return {
      success: false,
      error: 'BYOK users should use their own API key',
      code: 'BYOK_MODE',
    };
  }
  
  // Check usage limits
  const withinLimits = await checkUsageLimits(userId, plan);
  if (!withinLimits) {
    return {
      success: false,
      error: 'Monthly usage limit exceeded',
      code: 'USAGE_LIMIT_EXCEEDED',
    };
  }
  
  // Generate unique token ID
  const jti = randomBytes(16).toString('hex');
  
  // Calculate expiration
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + TOKEN_EXPIRY_HOURS * 3600) * 1000);
  
  // Create token payload
  const payload: EphemeralTokenPayload = {
    userId,
    plan,
    iat: now,
    exp: now + TOKEN_EXPIRY_HOURS * 3600,
    jti,
  };
  
  // Sign the token
  const token = jwt.sign(payload, TOKEN_SECRET, {
    algorithm: 'HS256',
  });
  
  // Log token creation (hash only, never actual token)
  await prisma.ephemeralTokenLog.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress,
      userAgent,
    },
  });
  
  return {
    success: true,
    token,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Verify an ephemeral token
 * Checks Redis blacklist for revoked tokens
 * 
 * @param token - Token to verify
 * @returns Token payload if valid, null if invalid or revoked
 */
export async function verifyEphemeralToken(token: string): Promise<EphemeralTokenPayload | null> {
  try {
    // First verify JWT signature and expiration
    const payload = jwt.verify(token, TOKEN_SECRET, {
      algorithms: ['HS256'],
    }) as EphemeralTokenPayload;
    
    // Check if token is blacklisted (revoked)
    const tokenHash = hashToken(token);
    const blacklisted = await isTokenBlacklisted(tokenHash);
    
    if (blacklisted) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * Revoke an ephemeral token (for security purposes)
 * Uses Redis blacklist for instant revocation
 * 
 * @param token - Token to revoke
 */
export async function revokeEphemeralToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  
  // Add to Redis blacklist (expires when token would expire)
  await blacklistToken(tokenHash, TOKEN_EXPIRY_HOURS * 3600);
  
  // Also update DB for audit trail
  await prisma.ephemeralTokenLog.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

/**
 * Get the Gemini API key for a user based on their plan
 * 
 * For BYOK users: Returns null (they use their own key from keyring)
 * For Starter/Pro: Returns the server's master Gemini API key
 * 
 * @param plan - User's subscription plan
 * @returns Gemini API key or null for BYOK
 */
export function getGeminiApiKey(plan: SubscriptionPlan): string | null {
  if (plan === 'BYOK_FREE') {
    return null;
  }
  
  const masterKey = process.env.GEMINI_MASTER_API_KEY;
  if (!masterKey) {
    throw new Error('GEMINI_MASTER_API_KEY not configured');
  }
  
  return masterKey;
}

/**
 * Record usage for a translation session
 * Updates both Redis (fast) and DB (persistent)
 * 
 * @param userId - User ID
 * @param audioMinutes - Audio minutes used
 * @param tokensGenerated - Tokens generated (for billing)
 */
export async function recordUsage(
  userId: string,
  audioMinutes: number,
  tokensGenerated: number = 0
): Promise<void> {
  // Update Redis counters (fast, for rate limiting)
  await Promise.all([
    incrementUsage(userId, 'audioMinutes', audioMinutes),
    incrementUsage(userId, 'tokensGenerated', tokensGenerated),
  ]);
  
  // Update DB (persistent, for billing)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  await prisma.usageRecord.upsert({
    where: {
      userId_date: {
        userId,
        date: today,
      },
    },
    update: {
      audioMinutes: {
        increment: audioMinutes,
      },
      tokensGenerated: {
        increment: tokensGenerated,
      },
    },
    create: {
      userId,
      audioMinutes,
      tokensGenerated,
      date: today,
    },
  });
}
