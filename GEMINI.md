# Traductor Auth Server - Gemini Context

## Resumen del Proyecto
Servidor de autenticación self-hosted para la aplicación de escritorio **Traductor Desktop**.
Usa Better Auth (alternativa open-source a Auth0/Clerk) con Hono como framework web.

## Stack Tecnológico
- **Runtime:** Node.js 20 (Docker Alpine)
- **Framework:** Hono
- **Auth:** Better Auth
- **Base de Datos:** Neon PostgreSQL (serverless)
- **Cache:** Upstash Redis (serverless)
- **ORM:** Prisma
- **Lenguaje:** TypeScript (ESM strict)

## URLs de Producción
```
Auth Server:    https://auth.niklauss.uk
Health Check:   https://auth.niklauss.uk/health
API Info:       https://auth.niklauss.uk/api
EC2 IP:         54.90.128.44 (interno, usar dominio)
```

## Arquitectura Hexagonal

El servidor usa arquitectura Ports & Adapters para migración fácil:
```
src/core/ports/      → IDatabasePort, ICachePort, IConfigPort
src/adapters/        → Prisma, Upstash/Redis, Env
```
Cambiar de AWS a Hetzner = solo variables de entorno.

## Estructura del Proyecto
```
src/
├── index.ts           # Servidor principal + middleware
├── core/              # Arquitectura hexagonal
│   ├── ports/         # Interfaces
│   └── container.ts   # Dependency injection
├── adapters/          # Implementaciones
│   ├── database/      # Prisma adapter
│   ├── cache/         # Upstash/Redis adapters
│   └── config/        # Env adapter
├── lib/
│   ├── auth.ts        # Configuración Better Auth
│   ├── redis.ts       # Cliente Upstash Redis
│   └── tokens.ts      # Servicio de tokens JWT efímeros
└── routes/
    ├── auth.ts        # Endpoints de autenticación
    ├── tokens.ts      # Endpoints de tokens Gemini
    └── usage.ts       # Tracking de uso
```

## Endpoints Principales

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/sign-up` | Registro |
| POST | `/api/auth/sign-in/email` | Login |
| POST | `/api/auth/sign-out` | Logout |
| GET | `/api/auth/session` | Sesión actual |

### Tokens Efímeros (para Gemini API)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/tokens/ephemeral` | Generar token (1 hora) |
| POST | `/api/tokens/verify` | Verificar token |
| POST | `/api/tokens/revoke` | Revocar token |
| GET | `/api/tokens/gemini-key` | Obtener API key |

### Uso
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/usage` | Stats del mes |
| POST | `/api/usage/record` | Registrar uso |
| GET | `/api/usage/history` | Historial |

## Planes de Suscripción

| Plan | Precio | Límite Mensual |
|------|--------|----------------|
| BYOK_FREE | Gratis | Sin límite (usa tu propia API key) |
| STARTER | $9.99/mes | 10 horas de audio |
| PRO | $19.99/mes | 30 horas de audio |

## Rate Limiting (Redis)

| Endpoint | Límite | Ventana |
|----------|--------|---------|
| `/api/auth/*` | 30 req | 1 min |
| `/api/tokens/*` | 10 req | 1 min |
| `/api/usage/*` | 60 req | 1 min |

## Comandos de Desarrollo
```bash
npm run dev          # Servidor de desarrollo
npm run build        # Compilar TypeScript
npx prisma studio    # GUI de base de datos
```

## Comandos de Producción (EC2)
```bash
ssh -i "traductor-auth-key.pem" ec2-user@54.90.128.44
sudo docker logs traductor-auth
sudo docker restart traductor-auth
```

## Variables de Entorno Requeridas
```env
DATABASE_URL=postgresql://...
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://auth.niklauss.uk
TRUSTED_ORIGINS=tauri://localhost,https://tu-app.com
GEMINI_MASTER_API_KEY=...
```

## Integrar Nueva Aplicación

### Client-side
```typescript
import { createAuthClient } from 'better-auth/client';

const authClient = createAuthClient({
  baseURL: 'https://auth.niklauss.uk',
});

// Login
await authClient.signIn.email({ email, password });

// Registro
await authClient.signUp.email({ email, password, name });

// Sesión
const session = await authClient.getSession();

// Logout
await authClient.signOut();
```

### Server-side (verificar token)
```typescript
const response = await fetch('https://auth.niklauss.uk/api/tokens/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
const { valid, user } = await response.json();
```

## Notas Importantes
1. Los imports ESM requieren extensión `.js`
2. Redis tiene fallback a memoria si no está disponible
3. El contenedor Docker corre en puerto 8080 (interno) → 3100 (externo)
4. CORS configurado para `tauri://localhost`
5. Sesiones expiran en 7 días

## Archivos Clave
- `src/index.ts` - Punto de entrada
- `src/lib/auth.ts` - Configuración de Better Auth
- `src/lib/tokens.ts` - Generación de JWT
- `prisma/schema.prisma` - Esquema de BD

## Propietario
Mauricio Quintero — niklaussmauricio@gmail.com
