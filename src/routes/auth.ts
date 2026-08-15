/**
 * Authentication Routes
 * 
 * Handles all Better Auth endpoints:
 * - POST /api/auth/sign-up
 * - POST /api/auth/sign-in
 * - POST /api/auth/sign-out
 * - GET  /api/auth/session
 * - GET  /api/auth/oauth/google (initiate OAuth)
 * - GET  /api/auth/callback/google (OAuth callback)
 * 
 * @module routes/auth
 */

import { Hono } from 'hono';
import { auth, prisma } from '../lib/auth.js';
import type { AuthType } from '../lib/auth.js';

const router = new Hono<{ Variables: AuthType }>({
  strict: false,
});

/**
 * Better Auth catch-all handler
 * Handles all authentication requests at /api/auth/*
 */
router.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  return auth.handler(c.req.raw);
});

/**
 * Custom endpoint: Get user profile with subscription info
 * GET /api/user/profile
 */
router.get('/api/user/profile', async (c) => {
  // Get session from Better Auth
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Get subscription info
  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });
  
  return c.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      emailVerified: session.user.emailVerified,
    },
    subscription: subscription ? {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    } : {
      plan: 'BYOK_FREE',
      status: 'ACTIVE',
    },
    session: {
      expiresAt: session.session.expiresAt,
    },
  });
});

/**
 * Custom endpoint: Create subscription on first login (default BYOK_FREE)
 * POST /api/user/init-subscription
 */
router.post('/api/user/init-subscription', async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Check if subscription exists
  const existing = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });
  
  if (existing) {
    return c.json({ subscription: existing });
  }
  
  // Create default BYOK_FREE subscription
  const subscription = await prisma.subscription.create({
    data: {
      userId: session.user.id,
      plan: 'BYOK_FREE',
      status: 'ACTIVE',
    },
  });
  
  return c.json({ subscription });
});

export default router;
