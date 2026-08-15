/**
 * Better Auth Configuration
 * 
 * Self-hosted authentication for Traductor Desktop.
 * Supports email/password and Google OAuth.
 * 
 * @module lib/auth
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';

// Initialize Prisma client
const prisma = new PrismaClient();

// Parse trusted origins from environment
const trustedOrigins = (process.env.TRUSTED_ORIGINS || 'tauri://localhost')
  .split(',')
  .map(origin => origin.trim());

/**
 * Better Auth instance configured for Traductor
 * 
 * Features:
 * - Email/password authentication
 * - Google OAuth
 * - Session management with 7-day expiry
 * - PostgreSQL storage via Prisma
 */
export const auth = betterAuth({
  // Database adapter
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  
  // Base URL for auth endpoints
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3100',
  
  // Secret for signing tokens
  secret: process.env.BETTER_AUTH_SECRET,
  
  // Trusted origins (Tauri app and dev server)
  trustedOrigins,
  
  // Email and password authentication
  emailAndPassword: {
    enabled: true,
    // Password requirements
    minPasswordLength: 8,
    // Auto sign-in after registration
    autoSignIn: true,
  },
  
  // Social providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      // Scopes for user profile
      scope: ['openid', 'email', 'profile'],
    },
  },
  
  // Session configuration
  session: {
    // 7 days session duration (matching Requirement 9.6)
    expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
    // Update session on activity
    updateAge: 60 * 60 * 24, // 1 day
    // Cookie settings
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  
  // User configuration
  user: {
    // No additional fields needed - plan is stored in Subscription table
  },
  
  // Advanced options
  advanced: {
    // Generate secure session tokens - uses built-in secure generation
  },
});

// Export types for use in routes
export type AuthType = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

// Export prisma for use in other modules
export { prisma };
