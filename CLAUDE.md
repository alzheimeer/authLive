# Traductor Auth Server - Claude Context

## Project Overview
Self-hosted authentication server for **Traductor Desktop** and other applications.
Uses **Hexagonal Architecture** (Ports & Adapters) for easy infrastructure swapping.
Currently running in production on AWS EC2, designed for future migration to Hetzner.

## Tech Stack
- **Runtime:** Node.js 20 (Alpine Docker)
- **Framework:** Hono (fast, lightweight)
- **Auth:** Better Auth (self-hosted, open-source)
- **Database:** Neon PostgreSQL (serverless) → swappable via adapter
- **Cache:** Upstash Redis (serverless) → swappable via adapter
- **ORM:** Prisma
- **Language:** TypeScript (ESM, NodeNext)
- **Architecture:** Hexagonal (Ports & Adapters)

## Production Environment

| Resource | Value |
|----------|-------|
| **Server URL** | `https://auth.niklauss.uk` |
| **Health Check** | `https://auth.niklauss.uk/health` |
| **EC2 Instance** | `i-023dc1c463d273cb1` (t3.micro) |
| **Region** | us-east-1 |
| **IP (internal)** | `54.90.128.44` |
| **Docker Container** | `traductor-auth` |

## Hexagonal Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Core                         │
│  (auth.ts, tokens.ts, routes/*, index.ts)                  │
│                                                             │
│  Solo usa INTERFACES (ports), no implementaciones          │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ IDatabasePort │   │  ICachePort   │   │  IConfigPort  │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
    ┌───┴───┐           ┌───┴───┐           ┌───┴───┐
    ▼       ▼           ▼       ▼           ▼       ▼
┌───────┐┌───────┐ ┌───────┐┌───────┐ ┌───────┐┌───────┐
│ Neon  ││ Local │ │Upstash││ Local │ │  Env  ││Secrets│
│Prisma ││Prisma │ │Adapter││Redis  │ │Adapter││Manager│
└───────┘└───────┘ └───────┘└───────┘ └───────┘└───────┘
   AWS      Hetzner    AWS     Hetzner
```

**Benefits:**
- Swap database providers without changing application code
- Swap cache providers without changing application code
- Easy migration between cloud providers (AWS → Hetzner)
- Testable - mock ports for unit tests

## Project Structure
```
traductor-auth-server/
├── src/
│   ├── index.ts              # Entry point, middleware, routes
│   ├── core/                 # Hexagonal core
│   │   ├── ports/            # Interface definitions
│   │   │   ├── database.port.ts   # IDatabasePort
│   │   │   ├── cache.port.ts      # ICachePort
│   │   │   ├── config.port.ts     # IConfigPort
│   │   │   └── index.ts
│   │   ├── container.ts      # Dependency injection container
│   │   └── index.ts
│   ├── adapters/             # Port implementations
│   │   ├── database/
│   │   │   └── prisma.adapter.ts  # Prisma (Neon/Local)
│   │   ├── cache/
│   │   │   ├── upstash.adapter.ts # Upstash Redis
│   │   │   └── redis.adapter.ts   # Local Redis (ioredis)
│   │   ├── config/
│   │   │   └── env.adapter.ts     # Environment variables
│   │   └── index.ts
│   ├── lib/
│   │   ├── auth.ts           # Better Auth configuration
│   │   ├── redis.ts          # Legacy Redis (to be refactored)
│   │   └── tokens.ts         # Ephemeral JWT tokens
│   └── routes/
│       ├── auth.ts           # /api/auth/* (Better Auth)
│       ├── tokens.ts         # /api/tokens/* (ephemeral)
│       └── usage.ts          # /api/usage/* (tracking)
├── prisma/
│   └── schema.prisma         # Database schema
├── docs/
│   └── MIGRATION-HETZNER.md  # Migration guide
├── docker-compose.yml        # Local development & Hetzner
├── Dockerfile               
└── package.json
```

## Ports (Interfaces)

### IDatabasePort (`src/core/ports/database.port.ts`)
```typescript
interface IDatabasePort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ connected: boolean; latency?: number }>;
  
  findUserById(id: string): Promise<UserEntity | null>;
  findUserByEmail(email: string): Promise<UserEntity | null>;
  findSubscriptionByUserId(userId: string): Promise<SubscriptionEntity | null>;
  getMonthlyUsage(userId: string): Promise<{ audioMinutes: number; tokensGenerated: number }>;
  // ... more methods
}
```

### ICachePort (`src/core/ports/cache.port.ts`)
```typescript
interface ICachePort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<CacheHealthResult>;
  
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  cacheSession(sessionToken: string, data: unknown, ttlSeconds: number): Promise<void>;
  blacklistToken(tokenHash: string, ttlSeconds: number): Promise<void>;
  incrementUsage(userId: string, field: string, amount: number): Promise<number>;
  // ... more methods
}
```

### IConfigPort (`src/core/ports/config.port.ts`)
```typescript
interface IConfigPort {
  load(): Promise<void>;
  getConfig(): AppConfig;
  getDatabaseConfig(): DatabaseConfigValues;
  getCacheConfig(): CacheConfigValues;
  getAuthConfig(): AuthConfigValues;
  isProduction(): boolean;
  validate(): void;
}
```

## Multi-Tenant Support

The schema supports multiple applications using this auth server:

```prisma
model Application {
  id              String   @id
  clientId        String   @unique  // Public app identifier
  clientSecret    String            // Server-to-server auth
  name            String
  allowedOrigins  String[]          // CORS origins
  allowedRedirects String[]         // OAuth redirects
}

model UserApplication {
  userId    String
  appId     String
  metadata  Json?                   // App-specific user data
}
```

Enable with: `ENABLE_MULTI_TENANT=true`

## API Endpoints

### Authentication (Better Auth)
- `POST /api/auth/sign-up` - Register new user
- `POST /api/auth/sign-in/email` - Login with email/password
- `POST /api/auth/sign-out` - Logout
- `GET /api/auth/session` - Get current session
- `GET /api/auth/oauth/google` - Initiate Google OAuth

### User
- `GET /api/user/profile` - Get profile with subscription
- `POST /api/user/init-subscription` - Initialize subscription

### Tokens (Ephemeral for Gemini API)
- `POST /api/tokens/ephemeral` - Generate 1-hour JWT token
- `POST /api/tokens/verify` - Verify token validity
- `POST /api/tokens/revoke` - Revoke token

### Usage Tracking
- `GET /api/usage` - Current month usage stats
- `POST /api/usage/record` - Record audio minutes used

### System
- `GET /health` - Health check (includes Redis status)

## Subscription Plans

| Plan | Price | Limit |
|------|-------|-------|
| `BYOK_FREE` | Free | Unlimited (user's own API key) |
| `STARTER` | $9.99/mo | 10 hours audio |
| `PRO` | $19.99/mo | 30 hours audio |

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth/*` | 30 req | 1 min |
| `/api/tokens/*` | 10 req | 1 min |
| `/api/usage/*` | 60 req | 1 min |

## Development Commands
```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 3100)
npm run build        # Compile TypeScript
npm run start        # Start production
npx prisma studio    # Database GUI
npx prisma db push   # Push schema to DB

# Local development with Docker
docker-compose up -d postgres redis  # Start local infra
docker-compose --profile dev up -d   # Include admin UIs
```

## Production Commands (EC2)
```bash
# SSH to server
ssh -i "traductor-auth-key.pem" ec2-user@54.90.128.44

# View logs
sudo docker logs traductor-auth
sudo docker logs -f traductor-auth  # Follow mode

# Restart
sudo docker restart traductor-auth

# Rebuild & Deploy
sudo docker stop traductor-auth
sudo docker rm traductor-auth
sudo docker build -t traductor-auth .
sudo docker run -d --name traductor-auth -p 3100:8080 --env-file .env --restart unless-stopped traductor-auth
```

## Key Files to Read

### Core Architecture
1. `src/core/ports/*.ts` - Interface definitions (READ FIRST)
2. `src/core/container.ts` - Dependency injection setup
3. `src/adapters/**/*.ts` - Implementations

### Application Logic
4. `src/index.ts` - Server setup, middleware, routing
5. `src/lib/auth.ts` - Better Auth configuration
6. `src/lib/tokens.ts` - JWT token generation/verification
7. `src/routes/*.ts` - API endpoints

### Infrastructure
8. `prisma/schema.prisma` - Database schema
9. `docker-compose.yml` - Local/Hetzner deployment
10. `docs/MIGRATION-HETZNER.md` - Migration guide

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - JWT signing secret (32+ chars)
- `BETTER_AUTH_URL` - Public URL of auth server

### Cache (choose one)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` - Upstash
- `REDIS_URL` - Local Redis

### Optional
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth
- `GEMINI_MASTER_API_KEY` - For Starter/Pro users
- `ENABLE_MULTI_TENANT` - Enable multi-app support

## Important Notes
- ESM imports require `.js` extension (NodeNext resolution)
- All adapters have in-memory fallback if service unavailable
- Container auto-detects which adapter to use from env vars
- Docker container runs on port 8080 internally, mapped to 3100
- CORS allows `tauri://localhost` for desktop app
- Sessions expire after 7 days with daily refresh

## Migration Path

**Current (AWS Free Tier):** EC2 + Neon + Upstash
**Future (Hetzner ~$5/mo):** VPS + Local PostgreSQL + Local Redis

Migration is seamless:
1. Set up Hetzner with docker-compose.yml
2. Export data from Neon
3. Update DNS (use domain, not IP!)
4. Keep same JWT secret = sessions survive

See: `docs/MIGRATION-HETZNER.md`

## Related Projects
- `traductor-desktop/` - Tauri desktop client
- `walltrow/` - Future app using this auth

## Integrating New Applications

### Server-side Setup
1. Add origin to `TRUSTED_ORIGINS` in `.env`:
   ```bash
   TRUSTED_ORIGINS=tauri://localhost,https://tu-nueva-app.com
   ```
2. Restart container:
   ```bash
   sudo docker restart traductor-auth
   ```
3. (Optional) If `ENABLE_MULTI_TENANT=true`, create Application record in DB.

### Client-side Setup
```typescript
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: 'https://auth.niklauss.uk',
});

// Login
await authClient.signIn.email({ email, password });

// Register
await authClient.signUp.email({ email, password, name });

// Get session
const session = await authClient.getSession();
// session.user contains { id, email, name }

// Logout
await authClient.signOut();
```

### Server-to-Server Token Verification
```typescript
async function verifyToken(token: string) {
  const response = await fetch('https://auth.niklauss.uk/api/tokens/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await response.json();
  return data.valid ? data.user : null;
}
```

See `README.md` section "Integrar Nueva Aplicación" for complete examples.

## Owner
Mauricio Quintero — niklaussmauricio@gmail.com
