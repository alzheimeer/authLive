# 🚀 Checklist de Deploy - Traductor Auth Server

## ✅ Código Completado

- [x] Redis client con Upstash (`src/lib/redis.ts`)
- [x] Rate limiting distribuido (sliding window)
- [x] Session caching
- [x] Token blacklist para revocación instantánea
- [x] Usage counters atómicos
- [x] Dockerfile multi-stage optimizado
- [x] Configuración de Fly.io (`fly.toml`)
- [x] Scripts de deploy
- [x] Documentación actualizada

---

## 📋 Lo que TÚ necesitas hacer

### Paso 1: Crear cuentas (5 minutos cada una)

1. **Neon PostgreSQL** - https://neon.tech
   - Crear proyecto "traductor-auth"
   - Copiar connection string

2. **Upstash Redis** - https://upstash.com
   - Crear database "traductor-cache"
   - Copiar REST URL y Token

3. **Fly.io** - https://fly.io
   - Instalar CLI: `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`
   - Crear cuenta: `fly auth signup`

### Paso 2: Configurar secrets en Fly.io

Desde la carpeta `traductor-auth-server`:

```powershell
# Crear la app
fly apps create traductor-auth

# Configurar secrets (reemplazar con tus valores)
fly secrets set DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
fly secrets set UPSTASH_REDIS_REST_URL="https://xxx.upstash.io"
fly secrets set UPSTASH_REDIS_REST_TOKEN="AXxxx"
fly secrets set BETTER_AUTH_SECRET="genera-uno-con-openssl-rand-base64-32"
fly secrets set BETTER_AUTH_URL="https://traductor-auth.fly.dev"
fly secrets set GOOGLE_CLIENT_ID="tu-client-id"
fly secrets set GOOGLE_CLIENT_SECRET="tu-secret"
fly secrets set GEMINI_MASTER_API_KEY="tu-gemini-key"
```

### Paso 3: Deploy

```powershell
fly deploy
```

### Paso 4: Migrar base de datos

```powershell
fly ssh console -C "npx prisma db push"
```

### Paso 5: Verificar

```powershell
# Abrir en navegador
fly open /health
```

---

## 🔗 URLs Finales

Después del deploy, tu servidor estará en:

- **API**: https://traductor-auth.fly.dev
- **Health**: https://traductor-auth.fly.dev/health
- **Docs**: https://traductor-auth.fly.dev/api

---

## 💰 Costo: $0/mes

Con el free tier de los 3 servicios, no pagarás nada mientras tu app tenga menos de:
- 0.5GB de datos en PostgreSQL
- 10,000 comandos Redis/día
- ~150 horas de uptime/mes (scale to zero)

---

## 🆘 Ayuda

Si tienes problemas:
```powershell
fly logs        # Ver errores
fly status      # Ver estado de la app
fly doctor      # Diagnóstico
```
