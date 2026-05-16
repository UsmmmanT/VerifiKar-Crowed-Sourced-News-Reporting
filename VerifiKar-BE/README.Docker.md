# VerifiKar Backend - Docker Deployment Guide

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- `.env` file with all required environment variables

## Quick Start

### 1. Build and Start All Services

```bash
docker-compose up --build
```

### 2. Run in Background (Detached Mode)

```bash
docker-compose up -d
```

### 3. View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f model
```

### 4. Stop All Services

```bash
docker-compose down
```

### 5. Stop and Remove Volumes

```bash
docker-compose down -v
```

## Production Deployment

### Build Production Images

```bash
docker-compose build --no-cache
```

### Tag and Push to Registry (Example: Docker Hub)

```bash
# Tag images
docker tag verifikar-api:latest yourusername/verifikar-api:v1.0
docker tag verifikar-worker:latest yourusername/verifikar-worker:v1.0
docker tag verifikar-model:latest yourusername/verifikar-model:v1.0

# Push to registry
docker push yourusername/verifikar-api:v1.0
docker push yourusername/verifikar-worker:v1.0
docker push yourusername/verifikar-model:v1.0
```

## Service Details

### API Service

- **Port**: 8000
- **Health Check**: `http://localhost:8000/health`
- **Container Name**: `verifikar-api`

### Worker Service

- **Container Name**: `verifikar-worker`
- **Purpose**: Background task processing (ARQ)

### Model Server

- **Port**: 8001
- **Health Check**: `http://localhost:8001/health`
- **Container Name**: `verifikar-model`
- **Note**: Takes ~60s to start (loading CLIP + AI models)

## Useful Commands

### Access Container Shell

```bash
docker exec -it verifikar-api bash
docker exec -it verifikar-worker bash
docker exec -it verifikar-model bash
```

### View Resource Usage

```bash
docker stats
```

### Restart Specific Service

```bash
docker-compose restart api
docker-compose restart worker
docker-compose restart model
```

### Update Code and Restart

```bash
docker-compose up -d --build
```

## Environment Variables

Ensure your `.env` file contains:

- Database connection (Neon Postgres)
- Redis connection (Upstash)
- R2 storage credentials (Cloudflare)
- API keys (Gemini, etc.)
- JWT secrets

## Deployment Platforms

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway up
```

### AWS ECS/Fargate

- Push images to ECR
- Create task definitions for each service
- Configure load balancer for API/Model services

### Azure Container Apps

- Push to Azure Container Registry
- Deploy using Azure Portal or CLI

### DigitalOcean App Platform

- Connect GitHub repo
- Configure docker-compose deployment

## Troubleshooting

### Models Not Loading

- Check model server logs: `docker-compose logs model`
- Ensure sufficient memory (4GB+ recommended)

### Port Conflicts

- Change ports in `docker-compose.yml` if 8000/8001 are taken

### Worker Not Processing Tasks

- Verify Redis connection in `.env`
- Check worker logs: `docker-compose logs worker`

### Database Connection Issues

- Verify Neon Postgres connection string in `.env`
- Check if IP is whitelisted in Neon dashboard

## Performance Tips

1. **Model Caching**: First run downloads models (~500MB), subsequent runs use cache
2. **Memory**: Allocate at least 4GB RAM total (2GB for model service)
3. **CPU**: Multi-core recommended for parallel processing

## Security Notes

- Never commit `.env` file to Git
- Use secrets management in production
- Rotate credentials regularly
- Use HTTPS in production (add reverse proxy like Nginx/Traefik)
