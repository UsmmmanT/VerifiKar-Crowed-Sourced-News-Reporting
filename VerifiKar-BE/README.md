# VerifiKar Backend

FastAPI backend with background worker (ARQ) and a model server for the VerifiKar project.

## Get started

1. Create and activate a virtual environment

   ```bash
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

2. Install dependencies

   ```bash
   pip install -r requirements.txt
   ```

3. Start the services

   ```bash
   # API
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

   # Worker (background tasks)
   arq app.worker.WorkerSettings

   # Model server
   uvicorn app.services.model_server:app --host 0.0.0.0 --port 8001
   ```

## Health checks

- API: http://localhost:8000/health
- Model: http://localhost:8001/health

## Docker deployment

For Docker-based setup and production notes, see the Docker guide in [README.Docker.md](README.Docker.md).

## Environment variables

Create a `.env` file with the required configuration:

- Database connection (Neon Postgres)
- Redis connection (Upstash)
- R2 storage credentials (Cloudflare)
- API keys (Gemini, etc.)
- JWT secrets

## Troubleshooting

- If the model server takes a long time to start, wait ~60s for model downloads and warmup.
- If the worker does not process jobs, verify Redis credentials in `.env`.
- If ports 8000/8001 are in use, change them in your commands or `docker-compose.yml`.
