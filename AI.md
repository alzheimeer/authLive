# Traductor Auth Server - AI Context

> Este archivo provee contexto para asistentes de IA (Claude, Gemini, ChatGPT, Copilot, etc.)

## 🎯 Resumen Ejecutivo

Servidor de autenticación **self-hosted** para la aplicación de escritorio **Traductor Desktop**.
Implementa Better Auth como alternativa open-source a Auth0/Clerk.

**Estado:** ✅ En producción

## 🌐 URLs de Producción

| Recurso | URL |
|---------|-----|
| Auth Server | `https://auth.niklauss.uk` |
| Health Check | `https://auth.niklauss.uk/health` |
| API Info | `https://auth.niklauss.uk/api` |
| EC2 IP (interno) | `54.90.128.44` |

## 🏗️ Arquitectura Hexagonal

El servidor implementa arquitectura hexagonal (Ports & Adapters) para migración fácil entre proveedores:

```
src/core/ports/           # Interfaces (IDatabasePort, ICachePort, IConfigPort)
src/adapters/database/    # Prisma adapter (Neon/Local)
src/adapters/cache/       # Upstash o Redis local
src/adapters/config/      # Variables de entorno
```

**Beneficio:** Cambiar de AWS a Hetzner = solo cambiar variables de entorno.

## 🏗️ Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Runtime | Node.js 20 (Alpine Docker) |
| Framework | Hono |
| Auth | Better Auth |
| Database | Neon PostgreSQL (serverless) |
| Cache | Upstash Redis (serverless) |
| ORM | Prisma |
| Language | TypeScript (ESM strict) |
| Hosting | AWS EC2 t3.micro |

## 📁 Estructura del Proyecto

```
traductor-auth-server/
├── src/
│   ├── index.ts              # 🔴 Entry point principal
│   ├── core/                 # 🟡 Arquitectura hexagonal
│   │   ├── ports/            # Interfaces (database, cache, config)
│   │   └── container.ts      # Dependency injection
│   ├── adapters/             # 🟡 Implementaciones de ports
│   │   ├── database/         # Prisma adapter
│   │   ├── cache/            # Upstash/Redis adapters
│   │   └── config/           # Env adapter
│   ├── lib/
│   │   ├── auth.ts           # 🟡 Configuración Better Auth
│   │   ├── redis.ts          # 🟡 Cliente Upstash Redis
│   │   └── tokens.ts         # 🟡 Servicio de tokens JWT
│   └── routes/
│       ├── auth.ts           # Endpoints /api/auth/*
│       ├── tokens.ts         # Endpoints /api/tokens/*
│       └── usage.ts          # Endpoints /api/usage/*
├── prisma/
│   └── schema.prisma         # 🔴 Esquema de base de datos
├── docs/
│   └── MIGRATION-HETZNER.md  # Guía de migración
├── Dockerfile                # Build de producción
├── docker-compose.yml        # Para Hetzner/local
└── package.json
```

## 🔑 Archivos Críticos (Leer Primero)

1. **`src/index.ts`** - Punto de entrada, middleware, rutas
2. **`src/lib/auth.ts`** - Configuración de Better Auth
3. **`prisma/schema.prisma`** - Esquema de BD
4. **`src/lib/tokens.ts`** - Generación de JWT efímeros

## 🚨 Regla Crítica: Imports ESM

**TypeScript usa `NodeNext` module resolution. Los imports DEBEN tener extensión `.js`:**

```typescript
// ✅ CORRECTO
import { auth } from './lib/auth.js';
import { checkRateLimit } from './lib/redis.js';

// ❌ INCORRECTO - causará error en runtime
import { auth } from './lib/auth';
```

## 📡 API Endpoints

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/sign-up` | Registro |
| POST | `/api/auth/sign-in/email` | Login |
| POST | `/api/auth/sign-out` | Logout |
| GET | `/api/auth/session` | Sesión actual |
| GET | `/api/user/profile` | Perfil + suscripción |

### Tokens (para Gemini API)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/tokens/ephemeral` | Generar token (1h) |
| POST | `/api/tokens/verify` | Verificar token |
| POST | `/api/tokens/revoke` | Revocar token |
| GET | `/api/tokens/gemini-key` | API key (Starter/Pro) |

### Uso
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/usage` | Stats del mes |
| POST | `/api/usage/record` | Registrar uso |
| GET | `/api/usage/history` | Historial |

## 💳 Planes de Suscripción

| Plan | Precio | Límite |
|------|--------|--------|
| `BYOK_FREE` | Gratis | Sin límite (tu propia API key) |
| `STARTER` | $9.99/mes | 10 horas audio |
| `PRO` | $19.99/mes | 30 horas audio |

## 🛡️ Rate Limiting (Redis)

| Endpoint | Límite | Ventana |
|----------|--------|---------|
| `/api/auth/*` | 30 req | 1 min |
| `/api/tokens/*` | 10 req | 1 min |
| `/api/usage/*` | 60 req | 1 min |

## 🖥️ Comandos

### Desarrollo
```bash
npm run dev          # Servidor local (3100)
npm run build        # Compilar TypeScript
npx prisma studio    # GUI de base de datos
npx prisma db push   # Sincronizar schema
```

### Producción (EC2)
```bash
# Conectar
ssh -i "traductor-auth-key.pem" ec2-user@54.90.128.44

# Logs
sudo docker logs traductor-auth
sudo docker logs -f traductor-auth  # Tiempo real

# Reiniciar
sudo docker restart traductor-auth

# Rebuild completo
sudo docker stop traductor-auth
sudo docker rm traductor-auth
sudo docker build -t traductor-auth .
sudo docker run -d --name traductor-auth -p 3100:8080 --env-file .env --restart unless-stopped traductor-auth
```

## 🔒 Seguridad

- Tokens se almacenan como hash SHA-256 (nunca en texto plano)
- Rate limiting con sliding window en Redis
- Sesiones expiran en 7 días con refresh diario
- CORS configurado para `tauri://localhost`
- Secure headers via Hono middleware

## ⚠️ No Hacer

- ❌ Usar `require()` (CommonJS)
- ❌ Omitir extensión `.js` en imports
- ❌ Almacenar tokens sin hashear
- ❌ Exponer variables de entorno en responses
- ❌ Usar `import *`
- ❌ Ignorar manejo de errores async

## 📚 Documentación Relacionada

- `CLAUDE.md` - Contexto para Claude
- `GEMINI.md` - Contexto para Gemini
- `.cursorrules` - Reglas para Cursor
- `.kiro/steering/project-context.md` - Contexto para Kiro
- `.trae/rules.md` - Reglas para Trae
- `.windsurfrules` - Reglas para Windsurf
- `../ARCHITECTURE.md` - Arquitectura completa del sistema

## 🔌 Integrar Nueva Aplicación

### Server-side
1. Agregar origen a `TRUSTED_ORIGINS` en `.env`
2. (Opcional) Crear registro en tabla `application` si `ENABLE_MULTI_TENANT=true`
3. Reiniciar contenedor: `sudo docker restart traductor-auth`

### Client-side (React/Tauri)
```typescript
// src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: 'https://auth.niklauss.uk',
});

// Uso
await authClient.signIn.email({ email, password });
await authClient.signUp.email({ email, password, name });
await authClient.signOut();
const session = await authClient.getSession();
```

### Verificar tokens (Server-to-Server)
```typescript
const response = await fetch('https://auth.niklauss.uk/api/tokens/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
const { valid, user } = await response.json();
```

Ver guía completa en `README.md` sección "Integrar Nueva Aplicación".

## 👤 Propietario

Mauricio Quintero — niklaussmauricio@gmail.com — Colombia
