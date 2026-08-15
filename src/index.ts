/**
 * Traductor Auth Server
 * 
 * Self-hosted Better Auth server for Traductor Desktop.
 * 
 * Features:
 * - Email/password authentication
 * - Google OAuth
 * - Ephemeral token generation for Gemini API
 * - Usage tracking and rate limiting
 * - Subscription management
 * - Redis caching (Upstash)
 * 
 * Production Stack:
 * - Fly.io (App hosting)
 * - Neon (PostgreSQL serverless)
 * - Upstash (Redis serverless)
 * 
 * @module index
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import 'dotenv/config';

// Import routes
import authRoutes from './routes/auth.js';
import tokenRoutes from './routes/tokens.js';
import usageRoutes from './routes/usage.js';

// Import Redis for rate limiting
import { checkRateLimit, checkRedisHealth } from './lib/redis.js';

/**
 * Create Redis-backed rate limiter middleware
 * Falls back to in-memory if Redis unavailable
 */
function createRateLimiter(windowMs: number, limit: number, prefix: string = 'default') {
  return async (c: any, next: () => Promise<void>) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() 
      || c.req.header('x-real-ip') 
      || c.req.header('fly-client-ip')  // Fly.io header
      || 'unknown';
    
    const key = `${prefix}:${ip}`;
    const result = await checkRateLimit(key, limit, windowMs);
    
    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000 + result.resetIn / 1000)));
    
    if (!result.allowed) {
      return c.json({
        error: 'Too many requests',
        retryAfter: Math.ceil(result.resetIn / 1000),
      }, 429);
    }
    
    return next();
  };
}

// Create Hono app
const app = new Hono({
  strict: false,
});

// Parse trusted origins from environment
const trustedOrigins = (process.env.TRUSTED_ORIGINS || 'tauri://localhost')
  .split(',')
  .map(origin => origin.trim());

// ============================================================================
// Middleware
// ============================================================================

// Request logging
app.use('*', logger());

// Security headers
app.use('*', secureHeaders());

// CORS configuration for Tauri app and development
app.use('*', cors({
  origin: (origin) => {
    // Allow requests with no origin (like Tauri desktop app)
    if (!origin) return '*';
    
    // Check if origin is in trusted list
    if (trustedOrigins.includes(origin)) {
      return origin;
    }
    
    // Allow localhost for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
      return origin;
    }
    
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400,
}));

// Rate limiting for auth endpoints (Redis-backed)
app.use('/api/auth/*', createRateLimiter(60 * 1000, 30, 'auth')); // 30 requests per minute

// Rate limiting for token endpoints (Redis-backed)
app.use('/api/tokens/*', createRateLimiter(60 * 1000, 10, 'tokens')); // 10 requests per minute

// Rate limiting for usage endpoints
app.use('/api/usage/*', createRateLimiter(60 * 1000, 60, 'usage')); // 60 requests per minute

// ============================================================================
// Routes
// ============================================================================

// Health check endpoint (includes Redis status)
app.get('/health', async (c) => {
  const redisHealth = await checkRedisHealth();
  
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      redis: redisHealth.connected ? 'ok' : 'degraded',
      redisLatency: redisHealth.latency,
    },
  });
});

// API info endpoint
app.get('/api', (c) => {
  return c.json({
    name: 'Traductor Auth Server',
    version: '1.0.0',
    description: 'Better Auth server for Traductor Desktop',
    endpoints: {
      auth: '/api/auth/*',
      tokens: '/api/tokens/*',
      usage: '/api/usage/*',
      user: '/api/user/*',
    },
  });
});

// Mount routes
// Auth routes include /auth/* - mount at root for Better Auth compatibility
app.route('/', authRoutes);
app.route('/api/tokens', tokenRoutes);
app.route('/api/usage', usageRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    message: `Route ${c.req.method} ${c.req.path} not found`,
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  
  return c.json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  }, 500);
});

// ============================================================================
// Server Start
// ============================================================================

const port = parseInt(process.env.PORT || '3100', 10);

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   Traductor Auth Server                        ║
╠═══════════════════════════════════════════════════════════════╣
║  🔐 Better Auth + Hono                                        ║
║  📦 Neon PostgreSQL (Serverless)                              ║
║  ⚡ Upstash Redis (Rate Limiting + Caching)                   ║
║  🔑 Ephemeral Tokens for Gemini                               ║
║  🚀 Fly.io Ready                                              ║
╚═══════════════════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`✅ Server running at http://localhost:${info.port}`);
  console.log(`📝 API docs at http://localhost:${info.port}/api`);
  console.log(`💚 Health check at http://localhost:${info.port}/health`);
  console.log(`\n🌐 Trusted origins: ${trustedOrigins.join(', ')}`);
  console.log(`\n🚀 Ready to authenticate!`);
});
