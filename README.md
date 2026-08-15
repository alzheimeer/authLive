# 🔐 Traductor Auth Server

Servidor de autenticación self-hosted para **Traductor Desktop** y otras aplicaciones.
Usa **Arquitectura Hexagonal** para fácil migración entre proveedores de infraestructura.

## 🌐 Producción Actual

| Recurso | URL/Valor |
|---------|-----------|
| **Auth Server** | `https://auth.niklauss.uk` |
| **Health Check** | `https://auth.niklauss.uk/health` |
| **API Info** | `https://auth.niklauss.uk/api` |
| **Instance ID** | `i-023dc1c463d273cb1` |
| **Region** | `us-east-1` |
| **IP (internal)** | `54.90.128.44` |

## 🏗️ Stack de Producción

| Servicio | Tecnología | Propósito | Costo |
|----------|------------|-----------|-------|
| **App** | Hono + Better Auth | API de autenticación | - |
| **Hosting** | AWS EC2 t3.micro | Servidor Docker | **Gratis** (Free Tier 6 meses) |
| **Database** | Neon PostgreSQL | Usuarios, sesiones, suscripciones | **Gratis** (Free Tier) |
| **Cache** | Upstash Redis | Rate limiting, session cache | **Gratis** (Free Tier 10K cmds/día) |

---

## 🔷 Arquitectura Hexagonal (Ports & Adapters)

El servidor implementa arquitectura hexagonal para permitir cambios de infraestructura sin modificar código de aplicación:

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
    ┌───┴───┐           ┌───┴───┐               │
    ▼       ▼           ▼       ▼               ▼
┌───────┐┌───────┐ ┌───────┐┌───────┐     ┌───────┐
│ Neon  ││ Local │ │Upstash││ Local │     │  Env  │
│Prisma ││Prisma │ │Redis  ││Redis  │     │Adapter│
└───────┘└───────┘ └───────┘└───────┘     └───────┘
   AWS      Hetzner    AWS     Hetzner
```

### Beneficios

| Beneficio | Descripción |
|-----------|-------------|
| **Zero-code migration** | Cambiar de Neon a PostgreSQL local = solo cambiar env vars |
| **Easy testing** | Mock los ports para unit tests |
| **Multi-tenant ready** | Schema soporta múltiples aplicaciones |
| **Vendor freedom** | No hay lock-in a ningún proveedor |

### Estructura de Ports

```
src/core/ports/
├── database.port.ts   # IDatabasePort - Prisma abstraction
├── cache.port.ts      # ICachePort - Redis abstraction  
├── config.port.ts     # IConfigPort - Environment config
└── index.ts

src/adapters/
├── database/
│   └── prisma.adapter.ts    # Works with Neon, Local, Supabase
├── cache/
│   ├── upstash.adapter.ts   # Serverless Redis (current)
│   └── redis.adapter.ts     # Local Redis (for Hetzner)
└── config/
    └── env.adapter.ts       # Environment variables
```

### Migración AWS → Hetzner

Cuando termine el free tier de AWS:

1. **Costo actual (AWS):** $0 → $37/mes post-free-tier
2. **Costo futuro (Hetzner):** ~$5/mes (todo incluido)

La migración es trivial gracias a la arquitectura:

```bash
# Solo cambiar variables de entorno:
# Antes (Neon + Upstash)
DATABASE_URL=postgresql://...@neon.tech/...
UPSTASH_REDIS_REST_URL=https://...upstash.io

# Después (Local PostgreSQL + Redis)
DATABASE_URL=postgresql://traductor:xxx@postgres:5432/auth
REDIS_URL=redis://redis:6379
```

Ver guía completa: [`docs/MIGRATION-HETZNER.md`](./docs/MIGRATION-HETZNER.md)

---

## 🧠 Arquitectura y Decisiones Técnicas

### ¿Por qué Hono + Better Auth?

#### Hono (Framework Web)

[Hono](https://hono.dev) es un framework web ultraligero y rápido para TypeScript. Lo elegimos sobre Express/Fastify por:

| Ventaja | Descripción |
|---------|-------------|
| **Ultraligero** | Solo 14KB vs 2MB de Express. Ideal para Docker. |
| **4x más rápido** | Benchmarks muestran 4x mejor performance que Express. |
| **TypeScript nativo** | Sin configuración adicional, tipos incluidos. |
| **Edge-ready** | Funciona en Node.js, Bun, Deno, Cloudflare Workers. |
| **Middleware moderno** | Async/await nativo, no callbacks. |
| **Web Standards** | Usa Fetch API, Request/Response estándar. |

**Cómo se usa en el proyecto:**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono();

// Middleware en cadena
app.use('*', logger());
app.use('*', cors({ origin: 'tauri://localhost' }));

// Endpoints simples y tipados
app.get('/health', (c) => c.json({ status: 'ok' }));
app.post('/api/auth/login', async (c) => {
  const body = await c.req.json();
  return c.json({ success: true });
});
```

#### Better Auth (Autenticación)

[Better Auth](https://better-auth.com) es una alternativa open-source y self-hosted a Auth0/Clerk. Lo elegimos por:

| Ventaja | Descripción |
|---------|-------------|
| **Self-hosted** | Tus datos, tu servidor. Sin vendor lock-in. |
| **Open Source** | MIT License, código auditable. |
| **Gratis** | Sin límites de usuarios ni costos mensuales. |
| **Prisma ready** | Integración directa con Prisma ORM. |
| **OAuth incluido** | Google, GitHub, etc. sin configuración extra. |
| **Sessions seguras** | JWT + refresh tokens automático. |

**Comparación de costos:**

| Servicio | 1,000 usuarios | 10,000 usuarios |
|----------|----------------|-----------------|
| Auth0 | $23/mes | $228/mes |
| Clerk | $25/mes | $100/mes |
| **Better Auth** | **$0** | **$0** |

**Cómo se integra con Hono:**

```typescript
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: { clientId: '...', clientSecret: '...' }
  },
  session: { expiresIn: 60 * 60 * 24 * 7 } // 7 días
});

// En las rutas, Better Auth maneja todo:
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
```

---

### ¿Por qué PostgreSQL (Neon)?

[Neon](https://neon.tech) es PostgreSQL serverless. Lo elegimos por:

| Ventaja | Descripción |
|---------|-------------|
| **Serverless** | Escala a cero cuando no hay tráfico. |
| **Free Tier generoso** | 0.5GB storage, 1 proyecto gratis. |
| **PostgreSQL real** | No es un wrapper, es Postgres nativo. |
| **Branching** | Crea copias de la BD para testing. |
| **Global** | Edge locations para baja latencia. |

**Qué almacenamos en PostgreSQL:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Neon PostgreSQL                          │
├─────────────────────────────────────────────────────────────┤
│  user              → Usuarios registrados                   │
│  account           → Cuentas OAuth vinculadas               │
│  session           → Sesiones activas (7 días)              │
│  verification      → Tokens de verificación email           │
│  subscription      → Plan del usuario (BYOK/STARTER/PRO)    │
│  usage_record      → Minutos de audio usados por día        │
│  ephemeral_token_log → Auditoría de tokens generados        │
└─────────────────────────────────────────────────────────────┘
```

**Por qué NO usar SQLite:**
- No soporta conexiones concurrentes bien
- No es serverless
- No tiene replicación

---

### ¿Por qué Redis (Upstash)?

[Upstash](https://upstash.com) es Redis serverless con API REST. Lo elegimos por:

| Ventaja | Descripción |
|---------|-------------|
| **REST API** | No necesita conexión TCP persistente. |
| **Serverless** | Pay-per-request, escala automáticamente. |
| **Free Tier** | 10,000 comandos/día gratis. |
| **Global** | Edge replication para baja latencia. |
| **Fallback** | El código tiene fallback a memoria si falla. |

**Qué almacenamos en Redis:**

```
┌─────────────────────────────────────────────────────────────┐
│                      Upstash Redis                          │
├─────────────────────────────────────────────────────────────┤
│  ratelimit:{ip}:{endpoint}  → Sliding window rate limiting  │
│  session:{token}            → Cache de sesiones (5 min TTL) │
│  blacklist:{tokenHash}      → Tokens revocados (1h TTL)     │
│  usage:{id}:{date}:{field}  → Contadores atómicos de uso    │
└─────────────────────────────────────────────────────────────┘
```

**Por qué Redis y no solo PostgreSQL:**

| Operación | PostgreSQL | Redis |
|-----------|------------|-------|
| Rate limit check | ~50ms | ~5ms |
| Session lookup | ~30ms | ~3ms |
| Token blacklist | ~20ms | ~2ms |
| Atomic increment | Lock requerido | Nativo |

**Redis = 10x más rápido para operaciones frecuentes.**

**Código con fallback:**

```typescript
// Si Redis falla, usa memoria local
export async function checkRateLimit(key: string, limit: number) {
  if (redis && isRedisAvailable) {
    try {
      return await redis.zcard(key);  // Redis
    } catch {
      isRedisAvailable = false;
    }
  }
  return memoryRateLimit.get(key);    // Fallback
}
```

---

### Diagrama de Flujo

```
┌──────────────────┐
│ Traductor Desktop│
│    (Tauri)       │
└────────┬─────────┘
         │ HTTP Request
         ▼
┌──────────────────────────────────────────────────────────┐
│                    Hono Middleware                        │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌────────────┐  │
│  │ Logger  │→ │  CORS    │→ │Headers │→ │Rate Limit  │  │
│  └─────────┘  └──────────┘  └────────┘  └─────┬──────┘  │
│                                               │         │
│                                         ┌─────▼─────┐   │
│                                         │  Upstash  │   │
│                                         │   Redis   │   │
│                                         └───────────┘   │
└──────────────────────────┬───────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Better Auth │    │   Tokens    │    │   Usage     │
│ /api/auth/* │    │/api/tokens/*│    │ /api/usage/*│
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │      Prisma     │
                 │       ORM       │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Neon PostgreSQL │
                 │   (Serverless)  │
                 └─────────────────┘
```

---

### Resumen de Beneficios

| Decisión | Beneficio Principal |
|----------|---------------------|
| **Hono** | 4x más rápido, 14KB bundle, TypeScript nativo |
| **Better Auth** | $0/mes vs $100+/mes en Auth0/Clerk |
| **Neon PostgreSQL** | Serverless, escala a cero, free tier |
| **Upstash Redis** | 10x más rápido para rate limiting, REST API |
| **Docker + EC2** | Control total, $0 con free tier |

**Costo total: $0/mes** (mientras dure el free tier de AWS)

---

## 🚀 Quick Start (Desarrollo Local)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Inicializar base de datos
npm run prisma:push

# 4. Ejecutar servidor
npm run dev
```

El servidor estará disponible en `http://localhost:3100`

## 📦 Despliegue a Producción

### AWS EC2 (Actual)

El servidor está corriendo en Docker en AWS EC2:

```bash
# SSH al servidor
ssh -i "traductor-auth-key.pem" ec2-user@54.90.128.44

# Ver logs del contenedor
sudo docker logs traductor-auth

# Reiniciar contenedor
sudo docker restart traductor-auth

# Ver estado
sudo docker ps
```

### Reconstruir y Redesplegar

```bash
# En EC2, dentro de ~/traductor-auth-server:
sudo docker stop traductor-auth
sudo docker rm traductor-auth
sudo docker build -t traductor-auth .
sudo docker run -d --name traductor-auth -p 3100:8080 --env-file .env --restart unless-stopped traductor-auth
```

### Alternativas de Hosting

Ver guía completa en: [`scripts/setup-services.md`](./scripts/setup-services.md)

**Fly.io** (requiere tarjeta de crédito):
```bash
fly secrets set DATABASE_URL="postgresql://..."
fly deploy
```

**Railway** (trial limitado):
```bash
railway up
```

## 🔑 Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Health check (incluye Redis status) |
| GET | `/api` | Info del API |
| POST | `/api/auth/*` | Better Auth endpoints |
| POST | `/api/tokens/ephemeral` | Generar token efímero (1h) |
| POST | `/api/tokens/verify` | Verificar token |
| POST | `/api/tokens/revoke` | Revocar token |
| GET | `/api/tokens/gemini-key` | Obtener API key (Starter/Pro) |
| GET | `/api/usage` | Stats de uso del mes |
| POST | `/api/usage/record` | Registrar uso |
| GET | `/api/usage/history` | Historial de uso |

## 💳 Planes de Suscripción

| Plan | Precio | Límite | Descripción |
|------|--------|--------|-------------|
| **BYOK_FREE** | Gratis | Sin límite | Usa tu propia API key |
| **STARTER** | $9.99/mes | 10 horas | API key del servidor |
| **PRO** | $19.99/mes | 30 horas | API key del servidor |

## 🔒 Seguridad

- **Rate Limiting**: Redis-backed sliding window
- **Tokens**: JWT con 1 hora de expiración
- **Blacklist**: Revocación instantánea via Redis
- **Sessions**: 7 días con refresh automático
- **CORS**: Configuración estricta por origins
- **Headers**: Secure headers via Hono middleware

## 📊 Monitoreo

```bash
# Health check remoto
curl https://auth.niklauss.uk/health

# Ver logs en EC2
ssh -i traductor-auth-key.pem ec2-user@54.90.128.44 "sudo docker logs -f traductor-auth"

# Ver estado del contenedor
ssh -i traductor-auth-key.pem ec2-user@54.90.128.44 "sudo docker ps"
```

Respuesta esperada del health check:

```json
{
  "status": "ok",
  "timestamp": "2026-08-11T05:17:20.299Z",
  "version": "1.0.0",
  "services": {
    "redis": "ok",
    "redisLatency": 17
  }
}
```

## 🛠️ Scripts

```bash
npm run dev          # Desarrollo con hot reload
npm run build        # Compilar TypeScript
npm run start        # Iniciar producción
npm run deploy       # Deploy a Fly.io
npm run logs         # Ver logs de Fly.io
npm run prisma:studio # GUI de base de datos
```

## 📁 Estructura

```
traductor-auth-server/
├── src/
│   ├── index.ts           # Entry point + middleware
│   ├── lib/
│   │   ├── auth.ts        # Better Auth config
│   │   ├── redis.ts       # Upstash Redis client
│   │   └── tokens.ts      # Ephemeral token service
│   └── routes/
│       ├── auth.ts        # Auth endpoints
│       ├── tokens.ts      # Token endpoints
│       └── usage.ts       # Usage tracking
├── prisma/
│   └── schema.prisma      # Database schema
├── scripts/
│   ├── setup-services.md  # Guía de configuración
│   └── deploy.sh          # Script de deploy
├── Dockerfile             # Multi-stage build
├── fly.toml               # Fly.io config
└── package.json
```

## 💰 Costos Estimados

### Configuración Actual (100% Gratis)

| Servicio | Plan | Límites | Costo |
|----------|------|---------|-------|
| **AWS EC2** | t3.micro Free Tier | 750h/mes (6 meses) | **$0** |
| **Neon PostgreSQL** | Free | 0.5GB storage, 1 proyecto | **$0** |
| **Upstash Redis** | Free | 10,000 cmds/día | **$0** |
| **Total** | - | - | **$0** |

### Post-Free Tier

| Servicio | Costo Estimado |
|----------|----------------|
| EC2 t3.micro | ~$8/mes |
| Neon | $0-19/mes |
| Upstash | $0-10/mes |
| **Total** | **$8-37/mes** |

Para <100 usuarios activos: el free tier debería ser suficiente indefinidamente (excepto EC2 después de 6 meses).

---

## 🔌 Integrar Nueva Aplicación

Este servidor de autenticación es **multi-tenant**, lo que significa que puede servir múltiples aplicaciones (Traductor Desktop, Walltrow, etc.).

### Paso 1: Configuración del Servidor

#### 1.1 Agregar origen permitido en CORS

Editar el archivo `.env` en el servidor y agregar el origen de tu app:

```bash
# Para Tauri apps
TRUSTED_ORIGINS=tauri://localhost,https://traductor.app,https://tu-nueva-app.com

# Para apps web en desarrollo
TRUSTED_ORIGINS=tauri://localhost,http://localhost:5173,http://localhost:3000
```

Reiniciar el contenedor:

```bash
sudo docker restart traductor-auth
```

#### 1.2 (Opcional) Registrar aplicación multi-tenant

Si `ENABLE_MULTI_TENANT=true`, crear registro en la base de datos:

```sql
INSERT INTO application (id, "clientId", "clientSecret", name, "allowedOrigins", "allowedRedirects")
VALUES (
  'app_walltrow',
  'walltrow-client',
  'hash-del-secret',
  'Walltrow',
  ARRAY['https://walltrow.app', 'tauri://localhost'],
  ARRAY['https://walltrow.app/callback']
);
```

### Paso 2: Configuración del Cliente

#### 2.1 Instalar Better Auth Client

```bash
npm install better-auth
```

#### 2.2 Crear cliente de autenticación

```typescript
// src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: 'https://auth.niklauss.uk', // URL del servidor de auth
});

// Exportar funciones de conveniencia
export const {
  signIn,
  signUp,
  signOut,
  getSession,
  useSession, // Para React
} = authClient;
```

### Paso 3: Integración en React/Next.js

#### 3.1 Provider de Sesión

```tsx
// src/providers/AuthProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import { authClient } from '../lib/auth-client';

type User = {
  id: string;
  email: string;
  name?: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Cargar sesión al inicio
    authClient.getSession().then((session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });
  }, []);

  const handleSignIn = async (email: string, password: string) => {
    const result = await authClient.signIn.email({ email, password });
    if (result.data?.user) {
      setUser(result.data.user);
    }
  };

  const handleSignUp = async (email: string, password: string, name?: string) => {
    const result = await authClient.signUp.email({ email, password, name });
    if (result.data?.user) {
      setUser(result.data.user);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      signIn: handleSignIn,
      signUp: handleSignUp,
      signOut: handleSignOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

#### 3.2 Componente de Login

```tsx
// src/components/LoginForm.tsx
import { useState } from 'react';
import { useAuth } from '../providers/AuthProvider';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { signIn, isLoading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    try {
      await signIn(email, password);
    } catch (err) {
      setError('Credenciales inválidas');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña"
        required
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Cargando...' : 'Iniciar Sesión'}
      </button>
    </form>
  );
}
```

### Paso 4: Integración en Tauri (Desktop)

#### 4.1 Configuración de Tauri

En `tauri.conf.json`, permitir acceso al servidor de auth:

```json
{
  "tauri": {
    "security": {
      "dangerousRemoteDomainIpcAccess": [
        {
          "domain": "auth.niklauss.uk",
          "enableTauriAPI": false,
          "windows": ["main"],
          "plugins": []
        }
      ]
    }
  }
}
```

#### 4.2 Cliente de Auth en Tauri

```typescript
// src/lib/auth.ts
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient({
  baseURL: 'https://auth.niklauss.uk',
  // Tauri maneja cookies automáticamente
});

// Función helper para obtener token de API
export async function getApiToken(): Promise<string | null> {
  const session = await authClient.getSession();
  if (!session?.user) return null;
  
  // Generar token efímero para APIs externas (Gemini, etc.)
  const response = await fetch('https://auth.niklauss.uk/api/tokens/ephemeral', {
    method: 'POST',
    credentials: 'include',
  });
  
  if (!response.ok) return null;
  const data = await response.json();
  return data.token;
}
```

### Paso 5: Autenticación de API (Server-to-Server)

Si tu backend necesita verificar tokens:

```typescript
// En tu backend
async function verifyUserToken(token: string): Promise<User | null> {
  const response = await fetch('https://auth.niklauss.uk/api/tokens/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  
  if (!response.ok) return null;
  const data = await response.json();
  return data.valid ? data.user : null;
}

// Middleware de autenticación
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  const user = await verifyUserToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  
  req.user = user;
  next();
}
```

### Ejemplo Completo: App React

```tsx
// App.tsx
import { AuthProvider, useAuth } from './providers/AuthProvider';
import { LoginForm } from './components/LoginForm';

function AppContent() {
  const { user, isLoading, signOut } = useAuth();
  
  if (isLoading) return <div>Cargando...</div>;
  
  if (!user) return <LoginForm />;
  
  return (
    <div>
      <h1>Bienvenido, {user.name || user.email}</h1>
      <button onClick={signOut}>Cerrar Sesión</button>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

---

## 📚 Documentación Relacionada

- [Better Auth Docs](https://www.better-auth.com/docs)
- [Better Auth Client](https://www.better-auth.com/docs/client)
- [Hono Docs](https://hono.dev)
- [Neon Docs](https://neon.tech/docs)
- [Upstash Redis Docs](https://upstash.com/docs/redis)

## 📚 Documentación para IA

Este proyecto incluye documentación específica para asistentes de IA:

| Archivo | IA Target |
|---------|-----------|
| `CLAUDE.md` | Claude (Anthropic) |
| `GEMINI.md` | Gemini (Google) |
| `AI.md` | Genérico (ChatGPT, Copilot) |
| `.cursorrules` | Cursor IDE |
| `.windsurfrules` | Windsurf IDE |

## 📄 Licencia

MIT - Ver [LICENSE](./LICENSE)
