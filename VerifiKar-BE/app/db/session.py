from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import event
from sqlalchemy.engine import Engine
import logging
import time
from app.core.config import settings

logger = logging.getLogger(__name__)

# Query timing tracking for slow query detection
query_times = {}

@event.listens_for(Engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """
    Record query start time for slow query logging.
    This runs synchronously before each query execution.
    """
    conn.info.setdefault('query_start_time', []).append(time.time())

@event.listens_for(Engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    """
    Log slow queries that exceed SLOW_QUERY_THRESHOLD_MS.
    Helps identify performance bottlenecks in production.
    DISABLED: Uncomment logger.warning below to enable slow query logging for debugging.
    """
    total_time = time.time() - conn.info['query_start_time'].pop(-1)
    total_time_ms = total_time * 1000
    
    # DISABLED - Comment back in for performance debugging
    # if total_time_ms > settings.SLOW_QUERY_THRESHOLD_MS:
    #     # Log slow query with details
    #     logger.warning(
    #         f"SLOW QUERY ({total_time_ms:.2f}ms): {statement[:200]}..."
    #         if len(statement) > 200 else
    #         f"SLOW QUERY ({total_time_ms:.2f}ms): {statement}"
    #     )

# This global engine is now safe to use because ARQ has a
# persistent event loop.
async_engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=13,              # Base pool connections (optimized for concurrent load)
    max_overflow=5,            # Additional overflow connections (total max: 18)
    pool_recycle=3600,         # Recycle connections after 1hr (prevents Neon idle timeout)
    pool_timeout=30,           # Wait max 30s for connection before raising error
    connect_args={
        "server_settings": {
            "statement_timeout": "30000",  # 30s query timeout (prevents runaway queries)
            "idle_in_transaction_session_timeout": "60000"  # 60s idle transaction timeout
        }
    },
    echo=settings.ENABLE_SQL_ECHO,  # Enable SQL logging in development (set in .env)
)

# This global factory is also safe and correct.
AsyncSessionFactory = async_sessionmaker(
    async_engine,
    autoflush=False,
    expire_on_commit=False,
    class_=AsyncSession,
)

# Dependency for FastAPI routes
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Provides an async SQLAlchemy session.
    Rolls back on exception and ensures proper cleanup.
    """
    async with AsyncSessionFactory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            # Add this to ensure the session is always closed
            # back to the pool.
            await session.close()