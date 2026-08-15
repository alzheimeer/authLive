# 🚀 Deploy a AWS EC2 (Free Tier)

## Opción A: Deploy Manual Rápido

### 1. Crear EC2 Instance

```bash
# Crear key pair
aws ec2 create-key-pair --key-name traductor-auth-key --query 'KeyMaterial' --output text > traductor-auth-key.pem
chmod 400 traductor-auth-key.pem

# Crear security group
aws ec2 create-security-group --group-name traductor-auth-sg --description "Auth server security group"

# Permitir SSH y HTTP
aws ec2 authorize-security-group-ingress --group-name traductor-auth-sg --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name traductor-auth-sg --protocol tcp --port 3100 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name traductor-auth-sg --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name traductor-auth-sg --protocol tcp --port 443 --cidr 0.0.0.0/0

# Lanzar instancia t2.micro (free tier)
aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t2.micro \
  --key-name traductor-auth-key \
  --security-groups traductor-auth-sg \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=traductor-auth}]'
```

### 2. Conectar a la instancia

```bash
# Obtener IP pública
aws ec2 describe-instances --filters "Name=tag:Name,Values=traductor-auth" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text

# SSH a la instancia
ssh -i traductor-auth-key.pem ec2-user@<IP_PUBLICA>
```

### 3. Instalar Docker en EC2

```bash
sudo yum update -y
sudo yum install -y docker
sudo service docker start
sudo usermod -a -G docker ec2-user
# Logout y login de nuevo para aplicar cambios de grupo
```

### 4. Desplegar con Docker

```bash
# Clonar o copiar archivos
git clone <tu-repo> traductor-auth-server
cd traductor-auth-server

# Crear .env con las variables de producción
cat > .env << 'EOF'
NODE_ENV=production
PORT=3100
DATABASE_URL=postgresql://neondb_owner:npg_yBZSoGMD5L9P@ep-silent-unit-awmta6ax.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require
UPSTASH_REDIS_REST_URL=https://strong-pika-135975.upstash.io
UPSTASH_REDIS_REST_TOKEN=<tu-token>
BETTER_AUTH_SECRET=<genera-uno-con-openssl-rand-base64-32>
BETTER_AUTH_URL=http://<IP_PUBLICA>:3100
GOOGLE_CLIENT_ID=<tu-google-client-id>
GOOGLE_CLIENT_SECRET=<tu-google-secret>
GEMINI_MASTER_API_KEY=<tu-gemini-key>
EOF

# Build y run
docker build -t traductor-auth .
docker run -d --name traductor-auth -p 3100:8080 --env-file .env traductor-auth

# Ver logs
docker logs -f traductor-auth
```

### 5. Configurar Elastic IP (opcional, para IP fija)

```bash
# Crear y asociar Elastic IP
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id <INSTANCE_ID> --allocation-id <ALLOCATION_ID>
```

---

## Opción B: Con Lightsail (más simple, $3.50/mes)

Amazon Lightsail es más simple que EC2 y cuesta solo $3.50/mes para una instancia básica.

```bash
# Crear container service
aws lightsail create-container-service \
  --service-name traductor-auth \
  --power nano \
  --scale 1

# Deploy container
aws lightsail create-container-service-deployment \
  --service-name traductor-auth \
  --containers file://lightsail-containers.json \
  --public-endpoint containerName=auth,containerPort=8080,healthCheck={path=/health}
```

---

## URLs Finales

Una vez desplegado:
- **API**: http://<IP_PUBLICA>:3100
- **Health**: http://<IP_PUBLICA>:3100/health

Para HTTPS, necesitarás configurar un dominio y certificado (puedes usar CloudFlare gratis).
