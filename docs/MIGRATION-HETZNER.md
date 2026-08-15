# Guía de Migración a Hetzner

Esta guía explica cómo migrar el servidor de autenticación desde AWS EC2 + Neon + Upstash hacia un VPS de Hetzner con PostgreSQL y Redis locales.

## ¿Por qué Hetzner?

| Proveedor | Especificaciones | Precio/mes |
|-----------|------------------|------------|
| **Hetzner CX22** | 2 vCPU, 4GB RAM, 40GB SSD | ~€4.35 (~$5) |
| DigitalOcean | 2 vCPU, 4GB RAM, 80GB SSD | $24 |
| Linode | 2 vCPU, 4GB RAM, 80GB SSD | $24 |
| AWS t3.small | 2 vCPU, 2GB RAM | ~$15 |

Hetzner es **4-5x más barato** con especificaciones similares o superiores.

## Pre-requisitos

1. **Dominio configurado**: Ej. `auth.niklauss.uk`
2. **Cuenta en Hetzner**: https://www.hetzner.com/cloud
3. **SSH key**: Para acceso al servidor

## Arquitectura Hexagonal - Por qué la migración es simple

Gracias a la arquitectura de ports & adapters:

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
│Adapter││Adapter│ │Adapter││Redis  │ │Adapter││Manager│
└───────┘└───────┘ └───────┘└───────┘ └───────┘└───────┘
   AWS      Hetzner    AWS     Hetzner
```

**Solo cambias los adapters, no el código de la aplicación.**

## Paso 1: Crear servidor en Hetzner

```bash
# 1. Crear VPS CX22 en Hetzner Cloud Console
# - Región: Nuremberg o Falkenstein (Europa)
# - OS: Ubuntu 24.04
# - SSH Key: Tu key pública

# 2. Configurar DNS
# En tu proveedor de DNS (Cloudflare, etc.):
# auth.niklauss.uk -> IP del servidor Hetzner
```

## Paso 2: Configurar servidor

```bash
# Conectar por SSH
ssh root@<ip-servidor>

# Actualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# Instalar Docker Compose
apt install docker-compose-plugin -y

# Crear usuario no-root
adduser traductor
usermod -aG docker traductor
su - traductor
```

## Paso 3: Desplegar aplicación

```bash
# Como usuario 'traductor'
mkdir -p ~/auth-server
cd ~/auth-server

# Copiar archivos necesarios desde tu máquina local:
# - docker-compose.yml
# - .env (configurado para local)
# - Dockerfile

# O clonar desde git:
git clone <tu-repo> .

# Crear archivo .env
cat > .env << 'EOF'
NODE_ENV=production
PORT=3100

# Auth
BETTER_AUTH_SECRET=<tu-secret-de-32-caracteres>
BETTER_AUTH_URL=https://auth.niklauss.uk
TRUSTED_ORIGINS=tauri://localhost,https://traductor.app,https://walltrow.app

# Database - Local PostgreSQL (docker-compose)
DATABASE_URL=postgresql://traductor:tu_password_seguro@postgres:5432/traductor_auth?schema=public

# Cache - Local Redis (docker-compose)
REDIS_URL=redis://redis:6379

# OAuth
GOOGLE_CLIENT_ID=<tu-client-id>
GOOGLE_CLIENT_SECRET=<tu-client-secret>

# Gemini
GEMINI_MASTER_API_KEY=<tu-api-key>
EOF

# Iniciar servicios
docker compose up -d postgres redis

# Esperar a que estén listos
sleep 10

# Correr migraciones
docker compose run --rm app npx prisma migrate deploy

# Iniciar aplicación
docker compose up -d app
```

## Paso 4: Configurar HTTPS con Caddy

```bash
# Instalar Caddy (reverse proxy con HTTPS automático)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install caddy

# Configurar Caddy
cat > /etc/caddy/Caddyfile << 'EOF'
auth.niklauss.uk {
    reverse_proxy localhost:3100
    
    # Headers de seguridad
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
}
EOF

# Reiniciar Caddy
systemctl restart caddy
```

## Paso 5: Migrar datos (si es necesario)

```bash
# Exportar datos de Neon
pg_dump $DATABASE_URL_NEON > backup.sql

# Importar a PostgreSQL local
docker compose exec -T postgres psql -U traductor -d traductor_auth < backup.sql
```

## Paso 6: Actualizar DNS

1. Cambiar el registro A de `auth.niklauss.uk` al IP de Hetzner
2. Esperar propagación DNS (hasta 24h, usualmente minutos)
3. Verificar: `curl https://auth.niklauss.uk/health`

## Migración sin downtime

Gracias a usar un dominio en lugar de IP:

1. **Mantén ambos servidores funcionando** (AWS y Hetzner)
2. **Usa el mismo JWT secret** en ambos
3. **Cambia DNS** → tráfico redirige gradualmente
4. **Las sesiones existentes siguen funcionando** (mismo secret)
5. **Apaga AWS** cuando todo esté estable

## Cambios en el código: NINGUNO

Solo cambian las variables de entorno:

```diff
# Antes (AWS + Neon + Upstash)
- DATABASE_URL=postgresql://...@ep-xxx.neon.tech/...
- UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
- UPSTASH_REDIS_REST_TOKEN=xxx

# Después (Hetzner local)
+ DATABASE_URL=postgresql://traductor:xxx@postgres:5432/traductor_auth
+ REDIS_URL=redis://redis:6379
```

El container de dependencias (`src/core/container.ts`) detecta automáticamente qué adapter usar basado en las variables de entorno.

## Monitoreo

```bash
# Ver logs
docker compose logs -f app

# Estado de servicios
docker compose ps

# Uso de recursos
docker stats

# Health check
curl https://auth.niklauss.uk/health
```

## Costos finales

| Componente | AWS (actual) | Hetzner (futuro) |
|------------|--------------|------------------|
| Servidor | $0 (free tier) → ~$8/mes | €4.35/mes (~$5) |
| Database | $0 (Neon free) → $19/mes | Incluido |
| Redis | $0 (Upstash free) → $10/mes | Incluido |
| **Total** | **$0** → **~$37/mes** | **~$5/mes** |

**Ahorro: ~$32/mes = ~$384/año** después del free tier de AWS.

## Troubleshooting

### La app no conecta a PostgreSQL
```bash
docker compose logs postgres
docker compose exec postgres psql -U traductor -d traductor_auth -c "SELECT 1"
```

### La app no conecta a Redis
```bash
docker compose logs redis
docker compose exec redis redis-cli ping
```

### Certificado SSL no funciona
```bash
# Ver logs de Caddy
journalctl -u caddy -f

# Verificar que el puerto 80 y 443 están abiertos
ufw allow 80
ufw allow 443
```
