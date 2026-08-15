# Traductor Auth Server - Kiro Context

## Descripción
Servidor de autenticación self-hosted para Traductor Desktop usando Better Auth + Hono.

## Producción
- **URL:** `http://54.90.128.44:3100`
- **Health:** `http://54.90.128.44:3100/health`
- **EC2:** `i-023dc1c463d273cb1` (t3.micro, us-east-1)

## Stack
- Node.js 20 + TypeScript (ESM NodeNext)
- Hono (framework web)
- Better Auth (autenticación)
- Prisma + Neon PostgreSQL
- Upstash Redis

## Estructura
```
src/
├── index.ts       # Entry point
├── lib/
│   ├── auth.ts    # Better Auth config
│   ├── redis.ts   # Upstash client
│   └── tokens.ts  # JWT service
└── routes/
    ├── auth.ts    # /api/auth/*
    ├── tokens.ts  # /api/tokens/*
    └── usage.ts   # /api/usage/*
```

## Reglas de Código

### Imports ESM
Los imports DEBEN tener extensión `.js`:
```typescript
// ✅ Correcto
import { auth } from './lib/auth.js';

// ❌ Incorrecto
import { auth } from './lib/auth';
```

### Responses API
```typescript
// Éxito
return c.json({ success: true, data: ... });

// Error
return c.json({ error: 'Message', code: 'CODE' }, 400);
```

## Comandos
```bash
npm run dev          # Desarrollo (puerto 3100)
npm run build        # Compilar
npx prisma studio    # GUI de BD
npx prisma db push   # Sincronizar schema
```

## SSH a Producción
```bash
ssh -i "traductor-auth-key.pem" ec2-user@54.90.128.44
sudo docker logs traductor-auth
sudo docker restart traductor-auth
```

## Archivos Importantes
1. `src/index.ts` - Servidor principal
2. `src/lib/auth.ts` - Configuración Better Auth
3. `prisma/schema.prisma` - Schema de BD
4. `Dockerfile` - Build de producción
5. `.env.production` - Variables de entorno

## No Hacer
- No usar CommonJS `require()`
- No almacenar tokens en texto plano
- No exponer variables de entorno sensibles
- No omitir manejo de errores
