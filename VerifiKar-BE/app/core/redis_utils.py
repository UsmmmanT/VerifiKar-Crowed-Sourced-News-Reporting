"""Redis cache utilities for recommendations and user preferences."""

import json
from typing import Optional, List, Dict, Any
from arq import ArqRedis


async def get_cached_recommendations(
    redis_client: Optional[ArqRedis], user_id: str
) -> Optional[List[Dict[str, Any]]]:
    """
    Retrieve cached recommendations for a user.
    
    Args:
        redis_client: ArqRedis client (optional)
        user_id: User ID
    
    Returns:
        List of post recommendations or None if not cached/expired
    """
    if redis_client is None:
        return None
    
    try:
        cache_key = f"recommendations:{user_id}"
        cached_data = await redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
        return None
    except Exception:
        return None


async def set_cached_recommendations(
    redis_client: Optional[ArqRedis],
    user_id: str,
    posts: List[Dict[str, Any]],
    ttl: int = 300,
) -> bool:
    """
    Cache recommendations for a user.
    
    Args:
        redis_client: ArqRedis client (optional)
        user_id: User ID
        posts: List of post recommendations
        ttl: Time-to-live in seconds (default 300)
    
    Returns:
        True if cached successfully, False otherwise
    """
    if redis_client is None:
        return False
    
    try:
        cache_key = f"recommendations:{user_id}"
        await redis_client.set(cache_key, json.dumps(posts), ex=ttl)
        return True
    except Exception:
        return False


async def invalidate_recommendations_cache(
    redis_client: Optional[ArqRedis], user_id: str
) -> bool:
    """
    Invalidate cached recommendations for a user.
    
    Args:
        redis_client: ArqRedis client (optional)
        user_id: User ID
    
    Returns:
        True if invalidated successfully, False otherwise
    """
    if redis_client is None:
        return False
    
    try:
        cache_key = f"recommendations:{user_id}"
        await redis_client.delete(cache_key)
        return True
    except Exception:
        return False


async def get_user_preference_cache(
    redis_client: Optional[ArqRedis], user_id: str
) -> Optional[Dict[str, Any]]:
    """
    Retrieve cached user preferences.
    
    Args:
        redis_client: ArqRedis client (optional)
        user_id: User ID
    
    Returns:
        User preferences dict or None if not cached/expired
    """
    if redis_client is None:
        return None
    
    try:
        cache_key = f"user_prefs:{user_id}"
        cached_data = await redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
        return None
    except Exception:
        return None


async def set_user_preference_cache(
    redis_client: Optional[ArqRedis],
    user_id: str,
    prefs: Dict[str, Any],
    ttl: int = 60,
) -> bool:
    """
    Cache user preferences.
    
    Args:
        redis_client: ArqRedis client (optional)
        user_id: User ID
        prefs: User preferences dict
        ttl: Time-to-live in seconds (default 60)
    
    Returns:
        True if cached successfully, False otherwise
    """
    if redis_client is None:
        return False
    
    try:
        cache_key = f"user_prefs:{user_id}"
        await redis_client.set(cache_key, json.dumps(prefs), ex=ttl)
        return True
    except Exception:
        return False


async def invalidate_user_preference_cache(
    redis_client: Optional[ArqRedis], user_id: str
) -> bool:
    """
    Invalidate cached user preferences.
    
    Args:
        redis_client: ArqRedis client (optional)
        user_id: User ID
    
    Returns:
        True if invalidated successfully, False otherwise
    """
    if redis_client is None:
        return False
    
    try:
        cache_key = f"user_prefs:{user_id}"
        await redis_client.delete(cache_key)
        return True
    except Exception:
        return False


async def read_cached_json(
    redis_client: Optional[ArqRedis], cache_key: str
) -> Optional[Dict[str, Any]]:
    """
    Generic function to read cached JSON data.
    
    Args:
        redis_client: ArqRedis client (optional)
        cache_key: Cache key
    
    Returns:
        Cached JSON dict or None if not cached/expired
    """
    if redis_client is None:
        return None
    
    try:
        cached_data = await redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
        return None
    except Exception:
        return None


async def write_cached_json(
    redis_client: Optional[ArqRedis],
    cache_key: str,
    payload: Dict[str, Any],
    ttl: int = 300,
) -> bool:
    """
    Generic function to cache JSON data.
    
    Args:
        redis_client: ArqRedis client (optional)
        cache_key: Cache key
        payload: JSON-serializable dict
        ttl: Time-to-live in seconds (default 300)
    
    Returns:
        True if cached successfully, False otherwise
    """
    if redis_client is None:
        return False
    
    try:
        await redis_client.set(cache_key, json.dumps(payload), ex=ttl)
        return True
    except Exception:
        return False
