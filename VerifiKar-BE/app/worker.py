from arq.cron import cron
from app.core.config import settings
from arq.connections import RedisSettings
from app.core.logging_config import setup_logging, get_logger

# Initialize logging for worker
setup_logging(
    level=settings.LOG_LEVEL,
    format_type=settings.LOG_FORMAT,
    log_file=settings.LOG_FILE
)

logger = get_logger(__name__)

# Import all the functions you want to be tasks
from app.tasks.tasks import (
    task_1_preprocess,
    task_2_embed,
    task_3_cluster,
    task_4_check_significance,
    task_5_generate_post,
    task_run_significance_checks, # <-- Import the new manager task
    task_6_update_reputation,  # <-- ADD THIS
    task_age_clusters,        # NEW
    task_merge_clusters,      # NEW
    task_warm_trending_cache,
    task_recompute_user_preferences,  # Phase 14: Notification tasks
    task_check_trending_events,  # Phase 14: Notification tasks
    task_notify_high_engagement_posts,  # Phase 14: Notification tasks
)

def get_arq_redis_settings() -> RedisSettings:
    """
    Creates a RedisSettings object from our main .env settings.
    """
    # Load the base settings (host, port, password) from the URL
    settings_obj = RedisSettings.from_dsn(settings.REDIS_URL)
    
    # --- THIS IS THE FIX ---
    
    # Explicitly tell it to use SSL. 
    # The 'rediss://' DSN should do this, but we'll be 100% sure.
    settings_obj.ssl = True
    
    # This is the critical part. We are telling the SSL connection
    # to not require/verify a certificate. This is the step
    # that fails on many systems and causes the TimeoutError.
    # This is safe for Upstash as auth is handled by the password.
    settings_obj.ssl_cert_reqs = None
    
    # --- END OF FIX ---
    
    # Your original keep_alive setting is smart, keep it.
    settings_obj.keep_alive = 30  # Send a ping every 30 seconds
    
    return settings_obj

# This is the main worker configuration class.
class WorkerSettings:
    """
    Defines the settings for the ARQ worker.
    """
    
    # This list tells the worker which functions to listen for.
    functions = [
        task_1_preprocess,
        task_2_embed,
        task_3_cluster,
        task_4_check_significance,
        task_5_generate_post,
        task_6_update_reputation,  # <-- ADD THIS
        task_run_significance_checks,
        task_age_clusters,        # NEW
        task_merge_clusters,      # NEW
        task_warm_trending_cache,
        task_recompute_user_preferences,  # Phase 14: Notification tasks
        task_check_trending_events,  # Phase 14: Notification tasks
        task_notify_high_engagement_posts,  # Phase 14: Notification tasks
    ]
    
    # Redis connection settings
    redis_settings = get_arq_redis_settings()
    
    # Add a 5-minute timeout to all jobs
    job_timeout = 300

    # --- NEW CRON JOBS ---
    # This tells the worker to run our manager task every minute
    cron_jobs = [
        # Safety net: Check for any missed significance checks (changed from every 2 min to hourly)
        cron(task_run_significance_checks, minute=0),  # CHANGED: was minute={0, 2, 4, ...}
        
        # NEW: Mark old clusters as inactive
        cron(task_age_clusters, minute=0),  # Every hour, at :00
        
        # NEW: Merge duplicate clusters
        cron(task_merge_clusters, hour=3, minute=0),  # Daily at 3:00 AM

        # Warm discover trending cache every 5 minutes.
        cron(task_warm_trending_cache, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
        
        # === PHASE 14: NOTIFICATION BACKGROUND JOBS ===
        
        # Recompute user preferences weekly (every Sunday at 3:00 AM)
        # Note: weekday 0=Monday, 1=Tuesday, ..., 6=Sunday
        cron(task_recompute_user_preferences, weekday=6, hour=3, minute=0),
        
        # Check for trending events every 60 minutes
        cron(task_check_trending_events, minute=0),
        
        # Notify about high engagement posts every 30 minutes
        cron(task_notify_high_engagement_posts, minute={0, 30}),
    ]

    async def startup(self, ctx):
        """
        Called automatically when the ARQ worker starts up.
        Runs maintenance tasks immediately.
        """
        logger.info("ARQ Worker starting up...")
        
        redis = ctx['redis']
        await redis.enqueue_job('task_age_clusters')
        await redis.enqueue_job('task_merge_clusters')
        
        logger.info("Enqueued startup tasks: aging and merging")
        logger.info("ARQ Worker startup complete")
    

    # --- END NEW CRON JOBS ---