from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from datetime import datetime
from app.core.config import settings
from app.api.router import api_router
# --- NEW IMPORTS ---
from app.core.arq_pool import get_arq_redis_pool
from arq.connections import ArqRedis
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.core.logging_config import setup_logging, get_logger
from app.services.notification_service import initialize_firebase

# Initialize logging
setup_logging(
    level=settings.LOG_LEVEL,
    format_type=settings.LOG_FORMAT,
    log_file=settings.LOG_FILE
)

logger = get_logger(__name__)

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)


# Create the main FastAPI app instance
app = FastAPI(
    title="VerifiKar API",
    description="API for crowd-sourced incident reporting and verification.",
    version="0.1.0"
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
async def on_startup():
    """
    Runs when the application starts up.
    """
    logger.info("FastAPI application is starting up...")
    
    # --- NEW: Create the ARQ Redis Pool ---
    # We create the pool and store it in the app's 'state'
    # so our API endpoints can access it.
    app.state.redis = await get_arq_redis_pool()
    
    # --- NEW: Initialize Firebase for notifications ---
    firebase_initialized = initialize_firebase()
    if firebase_initialized:
        logger.info("Firebase Admin SDK initialized successfully")
    else:
        logger.warning("Firebase not configured - notifications will be logged only")
    
    if settings.DATABASE_URL and settings.JWT_SECRET_KEY:
        logger.info("Configuration and secrets loaded successfully")
        logger.info("ARQ Redis pool created and connected to Upstash")
    else:
        logger.error("Environment variables not loaded. Check your .env file")


@app.on_event("shutdown")
async def on_shutdown():
    """
    Runs when the application shuts down.
    """
    logger.info("FastAPI application is shutting down...")
    
    # --- NEW: Close the ARQ Redis Pool ---
    if app.state.redis:
        await app.state.redis.close()
        logger.info("ARQ Redis pool closed")


@app.get("/health", tags=["Health"])
async def health_check():
    """
    Simple health check endpoint to confirm the server is live.
    """
    return {"status": "ok", "message": "VerifiKar API is running."}


@app.get("/health/detailed", tags=["Health"])
async def detailed_health_check():
    """
    Comprehensive health check that verifies all critical dependencies.
    Returns status of: Redis, Postgres, R2 Storage, and Gemini API.
    """
    from app.db.session import AsyncSessionFactory
    from sqlalchemy import text
    import boto3
    from botocore.exceptions import ClientError
    import google.generativeai as genai
    
    health_status = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "services": {}
    }
    
    # Check PostgreSQL
    try:
        async with AsyncSessionFactory() as db:
            await db.execute(text("SELECT 1"))
        health_status["services"]["postgres"] = {"status": "healthy"}
    except Exception as e:
        health_status["status"] = "unhealthy"
        health_status["services"]["postgres"] = {"status": "unhealthy", "error": str(e)}
    
    # Check Redis (ARQ)
    try:
        if app.state.redis:
            await app.state.redis.ping()
            health_status["services"]["redis"] = {"status": "healthy"}
        else:
            health_status["services"]["redis"] = {"status": "not_initialized"}
    except Exception as e:
        health_status["status"] = "unhealthy"
        health_status["services"]["redis"] = {"status": "unhealthy", "error": str(e)}
    
    # Check R2 Storage (Cloudflare)
    try:
        from app.core.config import settings
        s3_client = boto3.client(
            's3',
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        )
        # Try to list objects (lightweight operation)
        s3_client.list_objects_v2(Bucket=settings.R2_BUCKET_NAME, MaxKeys=1)
        health_status["services"]["r2_storage"] = {"status": "healthy"}
    except ClientError as e:
        health_status["status"] = "unhealthy"
        health_status["services"]["r2_storage"] = {"status": "unhealthy", "error": str(e)}
    except Exception as e:
        health_status["status"] = "unhealthy"
        health_status["services"]["r2_storage"] = {"status": "unhealthy", "error": str(e)}
    
    # Check Gemini API
    try:
        from app.core.config import settings
        # Try to list models (lightweight operation)
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        list(genai.list_models())  # This will fail if API key is invalid
        health_status["services"]["gemini_api"] = {"status": "healthy"}
    except Exception as e:
        health_status["status"] = "degraded"  # Not critical for read operations
        health_status["services"]["gemini_api"] = {"status": "unhealthy", "error": str(e)}
    
    return health_status


# Include the main router
app.include_router(api_router)


if __name__ == "__main__":
    """
    Allows running the app directly from Python for debugging.
    e.g., python app/main.py
    """
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)