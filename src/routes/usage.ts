/**
 * Usage Routes
 * 
 * Handles usage tracking for billing and rate limiting:
 * - GET  /api/usage - Get current usage stats
 * - POST /api/usage/record - Record usage from desktop app
 * - GET  /api/usage/history - Get usage history
 * 
 * @module routes/usage
 */

import { Hono } from 'hono';
import { auth, prisma } from '../lib/auth.js';
import { recordUsage, type SubscriptionPlan } from '../lib/tokens.js';
import type { AuthType } from '../lib/auth.js';
import { z } from 'zod';

const router = new Hono<{ Variables: AuthType }>();

// Validation schema for recording usage
const recordUsageSchema = z.object({
  audioMinutes: z.number().min(0).max(60), // Max 60 minutes per record
  tokensGenerated: z.number().int().min(0).optional(),
  sessionId: z.string().optional(),
});

/**
 * Get current usage stats
 * GET /api/usage
 */
router.get('/', async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Get subscription for plan limits
  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });
  
  const plan: SubscriptionPlan = (subscription?.plan as SubscriptionPlan) || 'BYOK_FREE';
  
  // Get usage for current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const usage = await prisma.usageRecord.aggregate({
    where: {
      userId: session.user.id,
      date: {
        gte: startOfMonth,
      },
    },
    _sum: {
      audioMinutes: true,
      tokensGenerated: true,
    },
  });
  
  // Plan limits (in minutes per month)
  const limits: Record<SubscriptionPlan, number | null> = {
    BYOK_FREE: null, // No limit (user manages their own key)
    STARTER: 600,    // 10 hours
    PRO: 1800,       // 30 hours
  };
  
  const totalMinutes = usage._sum.audioMinutes || 0;
  const limit = limits[plan];
  
  return c.json({
    plan,
    currentPeriod: {
      start: startOfMonth.toISOString(),
      end: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 0).toISOString(),
    },
    usage: {
      audioMinutes: totalMinutes,
      audioHours: Math.round(totalMinutes / 6) / 10, // Round to 1 decimal
      tokensGenerated: usage._sum.tokensGenerated || 0,
    },
    limits: {
      audioMinutes: limit,
      audioHours: limit ? limit / 60 : null,
      remaining: limit ? Math.max(0, limit - totalMinutes) : null,
      percentage: limit ? Math.round((totalMinutes / limit) * 100) : null,
    },
  });
});

/**
 * Record usage from desktop app
 * POST /api/usage/record
 */
router.post('/record', async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Parse and validate body
  const body = await c.req.json();
  const result = recordUsageSchema.safeParse(body);
  
  if (!result.success) {
    return c.json({
      error: 'Invalid request body',
      details: result.error.issues,
    }, 400);
  }
  
  const { audioMinutes, tokensGenerated } = result.data;
  
  // Record the usage
  await recordUsage(session.user.id, audioMinutes, tokensGenerated || 0);
  
  return c.json({
    success: true,
    recorded: {
      audioMinutes,
      tokensGenerated: tokensGenerated || 0,
    },
  });
});

/**
 * Get usage history
 * GET /api/usage/history
 * 
 * Query params:
 * - days: Number of days to include (default: 30, max: 90)
 */
router.get('/history', async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Parse days parameter
  const daysParam = c.req.query('days');
  const days = Math.min(Math.max(parseInt(daysParam || '30', 10), 1), 90);
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  
  const records = await prisma.usageRecord.findMany({
    where: {
      userId: session.user.id,
      date: {
        gte: startDate,
      },
    },
    orderBy: {
      date: 'desc',
    },
    select: {
      date: true,
      audioMinutes: true,
      tokensGenerated: true,
    },
  });
  
  // Calculate totals
  const totals = records.reduce(
    (acc, record) => ({
      audioMinutes: acc.audioMinutes + record.audioMinutes,
      tokensGenerated: acc.tokensGenerated + record.tokensGenerated,
    }),
    { audioMinutes: 0, tokensGenerated: 0 }
  );
  
  return c.json({
    period: {
      start: startDate.toISOString(),
      end: new Date().toISOString(),
      days,
    },
    records: records.map(r => ({
      date: r.date.toISOString().split('T')[0],
      audioMinutes: r.audioMinutes,
      tokensGenerated: r.tokensGenerated,
    })),
    totals: {
      audioMinutes: totals.audioMinutes,
      audioHours: Math.round(totals.audioMinutes / 6) / 10,
      tokensGenerated: totals.tokensGenerated,
    },
  });
});

export default router;
