/**
 * Token Routes
 * 
 * Handles ephemeral token generation for Gemini API access:
 * - POST /api/tokens/ephemeral - Generate new ephemeral token (1 hour)
 * - POST /api/tokens/verify - Verify token validity
 * - POST /api/tokens/revoke - Revoke a token
 * 
 * @module routes/tokens
 */

import { Hono } from 'hono';
import { auth, prisma } from '../lib/auth.js';
import {
  generateEphemeralToken,
  verifyEphemeralToken,
  revokeEphemeralToken,
  getGeminiApiKey,
  type SubscriptionPlan,
} from '../lib/tokens.js';
import type { AuthType } from '../lib/auth.js';

const router = new Hono<{ Variables: AuthType }>();

/**
 * Generate ephemeral token for Gemini API access
 * POST /api/tokens/ephemeral
 * 
 * Returns a JWT token valid for 1 hour.
 * Only available for Starter/Pro plans.
 * BYOK users should use their own API key.
 */
router.post('/ephemeral', async (c) => {
  // Validate session
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({
      success: false,
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    }, 401);
  }
  
  // Get user's subscription plan
  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });
  
  const plan: SubscriptionPlan = (subscription?.plan as SubscriptionPlan) || 'BYOK_FREE';
  
  // Get client info for logging
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const userAgent = c.req.header('user-agent') || 'unknown';
  
  // Generate token
  const result = await generateEphemeralToken(
    session.user.id,
    plan,
    ipAddress,
    userAgent
  );
  
  if (!result.success) {
    // Special handling for BYOK users
    if (result.code === 'BYOK_MODE') {
      return c.json({
        success: false,
        error: 'BYOK users should use their own API key',
        code: 'BYOK_MODE',
        message: 'Use your personal API key stored in the OS keyring',
      }, 400);
    }
    
    // Usage limit exceeded
    if (result.code === 'USAGE_LIMIT_EXCEEDED') {
      return c.json({
        success: false,
        error: 'Monthly usage limit exceeded',
        code: 'USAGE_LIMIT_EXCEEDED',
        message: 'Upgrade your plan or wait until next month',
      }, 429);
    }
    
    return c.json(result, 500);
  }
  
  return c.json(result);
});

/**
 * Verify ephemeral token validity
 * POST /api/tokens/verify
 * 
 * Body: { token: string }
 */
router.post('/verify', async (c) => {
  const body = await c.req.json<{ token?: string }>();
  
  if (!body.token) {
    return c.json({
      valid: false,
      error: 'Token required',
    }, 400);
  }
  
  const payload = await verifyEphemeralToken(body.token);
  
  if (!payload) {
    return c.json({
      valid: false,
      error: 'Invalid, expired, or revoked token',
    });
  }
  
  return c.json({
    valid: true,
    userId: payload.userId,
    plan: payload.plan,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });
});

/**
 * Revoke ephemeral token
 * POST /api/tokens/revoke
 * 
 * Body: { token: string }
 */
router.post('/revoke', async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const body = await c.req.json<{ token?: string }>();
  
  if (!body.token) {
    return c.json({ error: 'Token required' }, 400);
  }
  
  // Verify the token belongs to this user before revoking
  const payload = await verifyEphemeralToken(body.token);
  
  if (!payload || payload.userId !== session.user.id) {
    return c.json({ error: 'Invalid token or not authorized' }, 403);
  }
  
  await revokeEphemeralToken(body.token);
  
  return c.json({ success: true, message: 'Token revoked' });
});

/**
 * Get Gemini API key for current user
 * GET /api/tokens/gemini-key
 * 
 * Only available for Starter/Pro plans.
 * Returns the server's master Gemini API key.
 */
router.get('/gemini-key', async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Get user's subscription plan
  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });
  
  const plan: SubscriptionPlan = (subscription?.plan as SubscriptionPlan) || 'BYOK_FREE';
  
  if (plan === 'BYOK_FREE') {
    return c.json({
      success: false,
      error: 'BYOK users should use their own API key',
      code: 'BYOK_MODE',
    }, 400);
  }
  
  try {
    const apiKey = getGeminiApiKey(plan);
    
    return c.json({
      success: true,
      apiKey,
      expiresIn: 3600, // 1 hour recommended refresh
    });
  } catch (error) {
    return c.json({
      success: false,
      error: 'Server configuration error',
    }, 500);
  }
});

export default router;
