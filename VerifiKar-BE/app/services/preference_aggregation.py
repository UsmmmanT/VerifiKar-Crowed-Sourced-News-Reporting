"""
Preference Aggregation Service

Aggregates user preferences based on their interactions with posts.
Implements time-decay weighting and location binning for efficient preference storage.
"""

import datetime
import logging
from typing import Dict, List, Optional, Tuple
from uuid import UUID
from collections import defaultdict

import numpy as np
from geoalchemy2.shape import to_shape, from_shape
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import crud
from app.db.models import (
    User,
    Post,
    PostInteraction,
    InteractionEnum,
    UserPreference
)

logger = logging.getLogger(__name__)


def time_decay_weight(days_old: float) -> float:
    """
    Calculate exponential decay weight for an interaction based on its age.
    
    Recent interactions have higher weight, older interactions have lower weight.
    Uses exponential decay: weight = exp(-days_old / half_life)
    
    Args:
        days_old: Number of days since interaction
    
    Returns:
        Weight between 0 and 1, where 1 = today, 0 = ancient history
    
    Examples:
        - 0 days old → weight ≈ 1.0
        - 7 days old → weight ≈ 0.5 (half-life = 7 days)
        - 14 days old → weight ≈ 0.25
        - 30 days old → weight ≈ 0.06
    """
    half_life_days = 7.0  # Preferences decay by half every 7 days
    
    if days_old < 0:
        days_old = 0
    
    weight = np.exp(-days_old / half_life_days)
    return float(weight)


def bin_location(point_wkt: str, radius_km: float = 5.0) -> str:
    """
    Bin a location point to prevent too many unique location preferences.
    
    Groups nearby locations (within radius_km) to a single grid cell center.
    This prevents having thousands of slightly different location preferences.
    
    Uses a simple grid-based binning approach:
    - Converts point to lat/lon
    - Rounds to grid cells (each cell is radius_km x radius_km)
    - Returns center of the grid cell as WKT
    
    Args:
        point_wkt: Point location in WKT format, e.g. "SRID=4326;POINT(67.12 24.92)"
        radius_km: Size of each grid cell in kilometers (default 5 km)
    
    Returns:
        Binned point as WKT string
    
    Examples:
        Input: "SRID=4326;POINT(67.1234 24.9234)", radius_km=5.0
        Output: "SRID=4326;POINT(67.12 24.92)"  (rounded to grid cell center)
    """
    try:
        # Parse WKT to shapely geometry
        shape = to_shape(point_wkt)
        lon, lat = shape.x, shape.y
        
        # Convert radius_km to degrees (approximate)
        # 1 degree ≈ 111 km at equator, varies with latitude
        km_per_degree_lon = 111.0 * np.cos(np.radians(lat))
        km_per_degree_lat = 111.0
        
        degree_step_lon = radius_km / km_per_degree_lon
        degree_step_lat = radius_km / km_per_degree_lat
        
        # Round to grid cell
        binned_lon = np.round(lon / degree_step_lon) * degree_step_lon
        binned_lat = np.round(lat / degree_step_lat) * degree_step_lat
        
        # Return as WKT with SRID
        binned_point = from_shape(
            __import__('shapely').geometry.Point(binned_lon, binned_lat),
            srid=4326
        )
        return f"SRID=4326;POINT({binned_lon} {binned_lat})"
    
    except Exception as e:
        logger.warning(f"Failed to bin location {point_wkt}: {e}")
        return point_wkt  # Return original if binning fails


async def aggregate_user_preferences(
    db: AsyncSession,
    user_id: UUID,
    days_lookback: int = 90
) -> Dict[str, float]:
    """
    Aggregate user preferences from their post interactions.
    
    Computes category and location preferences based on:
    1. Interaction type (upvote > downvote > flag)
    2. Recency (time decay weight)
    3. Interaction count (more interactions = stronger preference)
    
    Args:
        db: Database session
        user_id: User ID to aggregate preferences for
        days_lookback: Only consider interactions from last N days (default 90)
    
    Returns:
        Dictionary mapping preference keys to scores (0.0 to 1.0):
        {
            "cat:fire": 0.85,
            "cat:accident": 0.45,
            "loc:67.12_24.92": 0.60,
            ...
        }
    """
    cutoff_date = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days_lookback)
    
    # Fetch all interactions for this user in the lookback period
    query = select(PostInteraction).where(
        PostInteraction.user_id == user_id,
        PostInteraction.created_at >= cutoff_date,
        PostInteraction.is_deleted == False
    ).order_by(PostInteraction.created_at.desc())
    
    result = await db.execute(query)
    interactions = result.scalars().all()
    
    if not interactions:
        logger.info(f"No interactions found for user {user_id} in last {days_lookback} days")
        return {}
    
    # Prefetch all posts for these interactions
    post_ids = [i.post_id for i in interactions]
    posts_query = select(Post).where(Post.id.in_(post_ids))
    posts_result = await db.execute(posts_query)
    posts_map = {p.id: p for p in posts_result.scalars().all()}
    
    # Aggregate preferences
    preference_scores = defaultdict(lambda: {"upvote": 0.0, "downvote": 0.0, "flag": 0.0})
    now = datetime.datetime.now(datetime.timezone.utc)
    
    for interaction in interactions:
        post = posts_map.get(interaction.post_id)
        if not post:
            continue
        
        # Calculate days old
        days_old = (now - interaction.created_at).total_seconds() / 86400.0
        weight = time_decay_weight(days_old)
        
        # Process category preference
        if post.event_category:
            category_key = f"cat:{post.event_category.lower()}"
            if interaction.interaction_type == InteractionEnum.upvote:
                preference_scores[category_key]["upvote"] += weight
            elif interaction.interaction_type == InteractionEnum.downvote:
                preference_scores[category_key]["downvote"] += weight
            elif interaction.interaction_type == InteractionEnum.flag:
                preference_scores[category_key]["flag"] += weight
        
        # Process location preference
        if post.location:
            binned_location = bin_location(post.location, radius_km=5.0)
            location_key = f"loc:{binned_location}"
            if interaction.interaction_type == InteractionEnum.upvote:
                preference_scores[location_key]["upvote"] += weight
            elif interaction.interaction_type == InteractionEnum.downvote:
                preference_scores[location_key]["downvote"] += weight
            elif interaction.interaction_type == InteractionEnum.flag:
                preference_scores[location_key]["flag"] += weight
    
    # Convert weighted scores to normalized preference scores (0.0 to 1.0)
    final_preferences = {}
    
    for pref_key, interaction_counts in preference_scores.items():
        upvotes = interaction_counts["upvote"]
        downvotes = interaction_counts["downvote"]
        flags = interaction_counts["flag"]
        
        # Calculate preference score:
        # - Upvotes increase preference
        # - Downvotes slightly decrease
        # - Flags significantly decrease
        total_weight = upvotes + downvotes + flags
        
        if total_weight == 0:
            continue
        
        # Score = (upvotes - 0.5*downvotes - 1.5*flags) / total_weight
        # Normalized to 0-1 range
        raw_score = (upvotes - 0.5 * downvotes - 1.5 * flags) / total_weight
        
        # Sigmoid to map to 0-1 range (with bias towards 0.5)
        normalized_score = 1.0 / (1.0 + np.exp(-raw_score))
        
        # Clamp to 0-1
        normalized_score = max(0.0, min(1.0, normalized_score))
        
        final_preferences[pref_key] = normalized_score
    
    logger.info(
        f"Aggregated {len(final_preferences)} preferences for user {user_id} "
        f"from {len(interactions)} interactions"
    )
    
    return final_preferences


async def recompute_all_user_preferences(
    db: AsyncSession,
    batch_size: int = 100
) -> int:
    """
    Recompute preferences for all users.
    
    This is an expensive operation - meant to be run periodically (e.g., weekly).
    Fetches all users and recomputes their aggregated preferences.
    
    Args:
        db: Database session
        batch_size: Process users in batches to avoid memory issues
    
    Returns:
        Number of users processed
    
    Note:
        This function should be called from a background job (Phase 14).
        Use in worker.py or schedule with APScheduler.
    """
    # Get total user count
    count_query = select(func.count(User.id))
    count_result = await db.execute(count_query)
    total_users = count_result.scalar()
    
    logger.info(f"Starting preference recomputation for {total_users} users")
    
    processed = 0
    offset = 0
    
    while offset < total_users:
        # Fetch batch of users
        users_query = (
            select(User.id)
            .where(User.is_deleted == False)
            .order_by(User.created_at)
            .limit(batch_size)
            .offset(offset)
        )
        users_result = await db.execute(users_query)
        user_ids = users_result.scalars().all()
        
        if not user_ids:
            break
        
        # Process each user
        for user_id in user_ids:
            try:
                # Aggregate preferences
                agg_prefs = await aggregate_user_preferences(db, user_id)
                
                # Clear old preferences and write new ones
                delete_query = select(UserPreference).where(
                    UserPreference.user_id == user_id
                )
                delete_result = await db.execute(delete_query)
                old_prefs = delete_result.scalars().all()
                
                for pref in old_prefs:
                    await db.delete(pref)
                
                # Write new preferences
                for pref_key, score in agg_prefs.items():
                    # Parse preference key
                    if pref_key.startswith("cat:"):
                        category = pref_key[4:]
                        location = None
                    elif pref_key.startswith("loc:"):
                        category = None
                        location = pref_key[4:]
                    else:
                        continue
                    
                    # Create and save preference
                    await crud.create_or_update_user_preference(
                        db=db,
                        user_id=user_id,
                        category=category,
                        location=location,
                        preference_score=score
                    )
                
                processed += 1
                
                if processed % 10 == 0:
                    logger.info(f"Recomputed preferences for {processed}/{total_users} users")
            
            except Exception as e:
                logger.error(f"Failed to recompute preferences for user {user_id}: {e}")
        
        offset += batch_size
        await db.commit()
    
    logger.info(f"Completed preference recomputation for {processed} users")
    return processed


async def get_user_category_preferences(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 10
) -> List[Tuple[str, float]]:
    """
    Get user's top category preferences.
    
    Args:
        db: Database session
        user_id: User ID
        limit: Number of top preferences to return
    
    Returns:
        List of (category, score) tuples, ordered by score descending
    """
    prefs = await crud.get_user_top_preferences(db, user_id, limit=limit * 2)
    
    categories = []
    for pref in prefs:
        if pref.category:
            categories.append((pref.category, pref.preference_score))
        if len(categories) >= limit:
            break
    
    return categories


async def get_user_location_preferences(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 5
) -> List[Tuple[str, float]]:
    """
    Get user's top location preferences.
    
    Args:
        db: Database session
        user_id: User ID
        limit: Number of top preferences to return
    
    Returns:
        List of (location_wkt, score) tuples, ordered by score descending
    """
    prefs = await crud.get_user_top_preferences(db, user_id, limit=limit * 2)
    
    locations = []
    for pref in prefs:
        if pref.location:
            location_wkt = str(pref.location)
            locations.append((location_wkt, pref.preference_score))
        if len(locations) >= limit:
            break
    
    return locations
