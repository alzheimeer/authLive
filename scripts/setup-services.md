# 🛠️ Guía de Configuración - Servicios Cloud

Esta guía te ayudará a configurar los 3 servicios necesarios para producción.
**Tiempo estimado: 15-20 minutos**

---

## 1️⃣ Neon PostgreSQL (Base de Datos)

### Crear cuenta y proyecto

1. Ve a **https://neon.tech** y crea cuenta (usa GitHub para login rápido)
2. Click **"Create Project"**
   - Nombre: `traductor-auth`
   - Región: `eu-central-1` (Frankfurt) o `us-east-1`
   - PostgreSQL version: 16 (más reciente)
3. Espera ~30 segundos a que se cree

### Obtener connection string

1. En el dashboard, ve a **Connection Details**
2. Copia el **Connection string** (el que dice "pooled")
   - Formato: `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`
3. Guárdalo como `DATABASE_URL`

### ✅ Checklist Neon
- [ ] Cuenta creada
- [ ] Proyecto "traductor-auth" creado
- [ ] Connection string copiado

---

## 2️⃣ Upstash Redis (Cache)

### Crear cuenta y database

1. Ve a **https://upstash.com** y crea cuenta
2. Click **"Create Database"**
   - Nombre: `traductor-cache`
   - Tipo: **Regional**
   - Región: `eu-west-1` (Ireland) o la más cercana a ti
3. Espera ~10 segundos

### Obtener credenciales REST

1. En el dashboard de tu database, ve a la pestaña **REST API**
2. Copia:
   - **UPSTASH_REDIS_REST_URL** (https://...)
   - **UPSTASH_REDIS_REST_TOKEN** (AX...)

### ✅ Checklist Upstash
- [ ] Cuenta creada
- [ ] Database "traductor-cache" creada
- [ ] REST URL y Token copiados

---

## 3️⃣ Fly.io (Hosting)

### Instalar CLI

**Windows (PowerShell como Admin):**
```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

**Mac/Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

### Crear cuenta y app

1. Crea cuenta:
   ```bash
   fly auth signup
   ```
   (o `fly auth login` si ya tienes cuenta)

2. Desde la carpeta `traductor-auth-server`:
   ```bash
   fly apps create traductor-auth
   ```

### Configurar secrets

Configura las variables de entorno sensibles:

```bash
# Base de datos (Neon)
fly secrets set DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Redis (Upstash)
fly secrets set UPSTASH_REDIS_REST_URL="https://your-redis.upstash.io"
fly secrets set UPSTASH_REDIS_REST_TOKEN="AXxxx..."

# Auth secrets
fly secrets set BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
fly secrets set BETTER_AUTH_URL="https://traductor-auth.fly.dev"

# Google OAuth (obtener en Google Cloud Console)
fly secrets set GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
fly secrets set GOOGLE_CLIENT_SECRET="xxx"

# Gemini API (obtener en AI Studio)
fly secrets set GEMINI_MASTER_API_KEY="xxx"

# Stripe (opcional, para pagos)
fly secrets set STRIPE_SECRET_KEY="sk_live_xxx"
fly secrets set STRIPE_WEBHOOK_SECRET="whsec_xxx"
```

### Primer deploy

```bash
fly deploy
```

### Verificar

```bash
# Ver status
fly status

# Ver logs
fly logs

# Abrir en navegador
fly open
```

### ✅ Checklist Fly.io
- [ ] CLI instalado
- [ ] Cuenta creada
- [ ] App "traductor-auth" creada
- [ ] Secrets configurados
- [ ] Deploy exitoso

---

## 4️⃣ Migrar Base de Datos

Después del deploy, ejecuta las migraciones de Prisma:

```bash
# Generar cliente y push schema
fly ssh console -C "npx prisma db push"
```

O localmente con la connection string de producción:

```bash
DATABASE_URL="postgresql://..." npx prisma db push
```

---

## 🎉 ¡Listo!

Tu servidor debería estar corriendo en:
**https://traductor-auth.fly.dev**

Endpoints disponibles:
- `GET /health` - Health check
- `GET /api` - Info del API
- `POST /api/auth/*` - Autenticación (Better Auth)
- `POST /api/tokens/*` - Tokens efímeros
- `GET /api/usage/*` - Estadísticas de uso

---

## 💰 Costos Estimados

| Servicio | Free Tier | Después |
|----------|-----------|---------|
| Neon | 0.5GB, 1 proyecto | $0-19/mes |
| Upstash | 10K cmds/día | $0-10/mes |
| Fly.io | 3 VMs compartidas | $0-5/mes |
| **Total** | **$0** | **$0-34/mes** |

Para tu volumen esperado (<100 usuarios), probablemente sea **$0/mes** indefinidamente.
