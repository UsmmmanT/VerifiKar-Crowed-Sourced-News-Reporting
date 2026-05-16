import redis.asyncio as redis
from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from app.core.config import settings

def get_arq_redis_settings() -> RedisSettings:
    """
    Creates a RedisSettings object from our main .env settings.
    This tells arq how to connect to Upstash.
    """
    # Load the base settings (host, port, password, ssl) from the URL
    settings_obj = RedisSettings.from_dsn(settings.REDIS_URL)
    
    # --- THIS IS THE FIX ---
    # Now, we modify the object to add the keep_alive setting.
    settings_obj.keep_alive = 30  # Send a ping every 30 seconds
    # --- END OF FIX ---
    
    return settings_obj

async def get_arq_redis_pool() -> ArqRedis:
    """
    Creates and returns the ARQ Redis connection pool.
    """
    return await create_pool(get_arq_redis_settings())