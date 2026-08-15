# Traductor Auth Server - Trae Rules

## Project
Self-hosted Better Auth server for Traductor Desktop.
Production: http://54.90.128.44:3100

## Stack
- Node.js 20 + TypeScript ESM
- Hono + Better Auth
- Prisma + Neon PostgreSQL
- Upstash Redis

## Code Rules

### ESM Imports (CRITICAL)
Always use `.js` extension:
```typescript
import { auth } from './lib/auth.js';  // ✅
import { auth } from './lib/auth';     // ❌
```

### API Responses
```typescript
return c.json({ success: true, data });     // Success
return c.json({ error: 'msg', code }, 400); // Error
```

### Error Handling
- Always catch async errors
- Log errors in development
- Return structured error objects

## Structure
```
src/
├── index.ts       # Server + middleware
├── lib/           # Utilities
│   ├── auth.ts    # Better Auth
│   ├── redis.ts   # Upstash
│   └── tokens.ts  # JWT
└── routes/        # API routes
```

## Commands
```bash
npm run dev        # Dev server
npm run build      # Build
npx prisma studio  # DB GUI
```

## Production (EC2)
```bash
ssh -i "traductor-auth-key.pem" ec2-user@54.90.128.44
sudo docker logs traductor-auth
sudo docker restart traductor-auth
```

## Key Files
1. src/index.ts
2. src/lib/auth.ts
3. prisma/schema.prisma
4. Dockerfile

## Don't
- Use CommonJS require()
- Store plain text tokens
- Skip error handling
- Use * imports
