"""
Recommendation Service

Computes personalized post recommendations based on user preferences and trending posts.
Uses preference aggregation, trending detection, and similarity scoring.
"""

import datetime
import logging
from typing import Dict, List, Optional, Tuple
from uuid import UUID
from collections import defaultdict

import numpy as np
from geoalchemy2.shape import to_shape
from sqlalchemy import func, select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import crud
from app.db.models import (
    User,
    Post,
    Cluster,
    ClusterStatusEnum,
    PostInteraction,
    UserPreference,
    PostStatusEnum,
)
from app.services.preference_aggregation import bin_location

logger = logging.getLogger(__name__)

# Recommendation constants
DEFAULT_RECOMMENDATION_LIMIT = 20
TRENDING_POSTS_LOOKBACK_HOURS = 24
CREDIBILITY_THRESHOLD = 0.3  # Minimum credibility score
LOCATION_SEARCH_RADIUS_KM = 50.0  # Search within 50km of user's location (matches /feed endpoint)
RECOMMENDATION_SCORE_WEIGHTS = {
    "preference_match": 0.40,      # 40% - matches user preferences
    "trending": 0.25,             # 25% - is trending
    "credibility": 0.20,          # 20% - high credibility
    "recency": 0.10,              # 10% - recent posts
    "engagement": 0.05,           # 5% - high engagement
}


async def _get_trending_posts(
    db: AsyncSession,
    hours_lookback: int = TRENDING_POSTS_LOOKBACK_HOURS,
    limit: int = 100,
) -> List[Post]:
    """
    Get trending posts based on cluster activity and engagement.
    
    Trending criteria:
    1. Posted within last N hours
    2. From active clusters
    3. High engagement (upvotes, views)
    4. High credibility score
    
    Args:
        db: Database session
        hours_lookback: Only consider posts from last N hours
        limit: Maximum number of trending posts to return
    
    Returns:
        List of trending Post objects, ordered by trending score descending
    """
    try:
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours_lookback)
        logger.info(f"_get_trending_posts: cutoff_time={cutoff_time}, hours_lookback={hours_lookback}, CREDIBILITY_THRESHOLD={CREDIBILITY_THRESHOLD}")
        
        # First, try a simple query without the complex ordering to see if posts are returned
        simple_query = (
            select(Post)
            .where(
                Post.created_at >= cutoff_time,
                Post.status == PostStatusEnum.active,
                Post.credibility_score >= CREDIBILITY_THRESHOLD,
            )
            .order_by(Post.created_at.desc())
            .limit(limit)
        )
        
        result = await db.execute(simple_query)
        posts = result.scalars().all()
        logger.info(f"_get_trending_posts: simple query returned {len(posts)} posts")
        
        if not posts:
            logger.warning(f"_get_trending_posts: No posts found with filters. Checking individual conditions...")
            # Debug: check each condition
            all_active = await db.execute(select(func.count(Post.id)).where(Post.status == PostStatusEnum.active))
            logger.info(f"  Total active posts: {all_active.scalar()}")
            
            recent = await db.execute(select(func.count(Post.id)).where(Post.created_at >= cutoff_time))
            logger.info(f"  Posts within {hours_lookback}h: {recent.scalar()}")
            
            credible = await db.execute(select(func.count(Post.id)).where(Post.credibility_score >= CREDIBILITY_THRESHOLD))
            logger.info(f"  Posts with credibility >= {CREDIBILITY_THRESHOLD}: {credible.scalar()}")
        
        return posts
    except Exception as e:
        logger.error(f"Error in _get_trending_posts: {e}", exc_info=True)
        return []


async def _apply_filters(
    posts: List[Post],
    user: User,
    user_location: Optional[str] = None,
    category_filter: Optional[str] = None,
    min_credibility: float = CREDIBILITY_THRESHOLD,
    exclude_interacted: bool = True,
    db: Optional[AsyncSession] = None,
) -> List[Post]:
    """
    Apply filters to posts to refine recommendations.
    
    Filters:
    1. Category matching (if specified)
    2. Location proximity (if user location available)
    3. Credibility threshold
    4. Exclude already interacted posts (optional)
    
    Args:
        posts: List of Post objects to filter
        user: User object
        user_location: User's current location as WKT string
        category_filter: Only include this category (if specified)
        min_credibility: Minimum credibility score
        exclude_interacted: Exclude posts user already interacted with
        db: Database session (required if exclude_interacted=True)
    
    Returns:
        Filtered list of Post objects
    """
    filtered_posts = []
    
    # If excluding interacted posts, fetch user's interactions
    user_post_ids = set()
    if exclude_interacted and db:
        query = select(PostInteraction.post_id).where(
            PostInteraction.user_id == user.id
        )
        result = await db.execute(query)
        user_post_ids = set(result.scalars().all())
    
    # Apply filters
    for post in posts:
        # Skip posts user already interacted with
        if exclude_interacted and post.id in user_post_ids:
            continue
        
        # Check credibility threshold
        if post.credibility_score < min_credibility:
            continue
        
        # Check category filter
        if category_filter and post.event_category and post.event_category.lower() != category_filter.lower():
            continue
        
        # Check location proximity
        if user_location:
            try:
                user_shape = to_shape(user_location)
                post_shape = to_shape(post.location)
                
                # Rough distance calculation using Haversine (simplified)
                # In production, use PostGIS ST_Distance for accuracy
                from math import radians, cos, sin, asin, sqrt
                
                lon1, lat1 = user_shape.x, user_shape.y
                lon2, lat2 = post_shape.x, post_shape.y
                
                lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
                dlon = lon2 - lon1
                dlat = lat2 - lat1
                a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
                c = 2 * asin(sqrt(a))
                r = 6371  # Earth radius in km
                distance_km = c * r
                
                if distance_km > LOCATION_SEARCH_RADIUS_KM:
                    continue
            except Exception as e:
                logger.warning(f"Failed to calculate location distance: {e}")
                # Continue anyway if distance calculation fails
        
        filtered_posts.append(post)
    
    return filtered_posts


async def _compute_recommendations(
    db: AsyncSession,
    user_id: UUID,
    user_preferences: Dict[str, float],
    trending_posts: List[Post],
    exclude_interacted: bool = True,
) -> List[Tuple[Post, float]]:
    """
    Score posts and compute recommendation ranking.
    
    Scoring algorithm:
    1. Preference match score (0-1): how well post matches user preferences
    2. Trending score (0-1): how trending is the post
    3. Credibility score (0-1): post's inherent credibility
    4. Recency score (0-1): how recent is the post (exponential decay)
    5. Engagement score (0-1): upvote ratio
    
    Final score = weighted combination of above scores
    
    Args:
        db: Database session
        user_id: User ID
        user_preferences: Dict of preferences from aggregate_user_preferences()
        trending_posts: List of trending posts
        exclude_interacted: Skip posts user already interacted with
    
    Returns:
        List of (Post, score) tuples, sorted by score descending
    """
    if not trending_posts:
        return []
    
    # Fetch user's interactions
    user_post_ids = set()
    if exclude_interacted:
        query = select(PostInteraction.post_id).where(
            PostInteraction.user_id == user_id
        )
        result = await db.execute(query)
        user_post_ids = set(result.scalars().all())
    
    scored_posts = []
    now = datetime.datetime.now(datetime.timezone.utc)
    
    for post in trending_posts:
        # Skip if user already interacted
        if exclude_interacted and post.id in user_post_ids:
            continue
        
        # 1. Preference match score
        preference_score = 0.0
        if post.event_category:
            category_key = f"cat:{post.event_category.lower()}"
            preference_score += user_preferences.get(category_key, 0.0)
        
        if post.location:
            location_key = f"loc:{bin_location(post.location)}"
            preference_score += user_preferences.get(location_key, 0.0)
        
        preference_score = min(1.0, preference_score / 2.0)  # Average and clamp
        
        # 2. Trending score
        # Posts with more upvotes and higher credibility are more trending
        trending_score = post.credibility_score  # Base on credibility
        
        # 3. Credibility score
        credibility_score = post.credibility_score
        
        # 4. Recency score (exponential decay, half-life 24 hours)
        hours_old = (now - post.created_at).total_seconds() / 3600.0
        recency_score = np.exp(-hours_old / 24.0)
        
        # 5. Engagement score (upvotes in last 24 hours)
        cutoff_time = now - datetime.timedelta(hours=24)
        engagement_query = select(func.count(PostInteraction.id)).where(
            PostInteraction.post_id == post.id,
            PostInteraction.interaction_type.in_(["upvote"]),
            PostInteraction.created_at >= cutoff_time
        )
        engagement_result = await db.execute(engagement_query)
        upvote_count = engagement_result.scalar() or 0
        engagement_score = min(1.0, upvote_count / 10.0)  # Normalize: 10+ upvotes = 1.0
        
        # Compute weighted final score
        final_score = (
            RECOMMENDATION_SCORE_WEIGHTS["preference_match"] * preference_score +
            RECOMMENDATION_SCORE_WEIGHTS["trending"] * trending_score +
            RECOMMENDATION_SCORE_WEIGHTS["credibility"] * credibility_score +
            RECOMMENDATION_SCORE_WEIGHTS["recency"] * recency_score +
            RECOMMENDATION_SCORE_WEIGHTS["engagement"] * engagement_score
        )
        
        scored_posts.append((post, final_score))
    
    # Sort by score descending
    scored_posts.sort(key=lambda x: x[1], reverse=True)
    
    return scored_posts


async def get_recommendations(
    db: AsyncSession,
    user_id: Optional[UUID] = None,
    limit: int = DEFAULT_RECOMMENDATION_LIMIT,
    user_location: Optional[str] = None,
    category_filter: Optional[str] = None,
    exclude_interacted: bool = True,
    hours_lookback: int = TRENDING_POSTS_LOOKBACK_HOURS,
) -> List[Dict]:
    """
    Get personalized recommendations for a user.
    
    Main entry point for recommendations. Pipeline:
    1. Fetch user preferences (aggregated from interactions) - optional
    2. Get trending posts (recent, high engagement)
    3. Score posts using preference matching + trending signals (if user authenticated)
    4. Apply filters (location, category, credibility)
    5. Return top N recommendations
    
    Args:
        db: Database session
        user_id: User ID (optional - None for anonymous users returns trending posts)
        limit: Number of recommendations to return
        user_location: User's current location (optional, for location-based filtering)
        category_filter: Filter by category (optional)
        exclude_interacted: Don't recommend posts user already interacted with
        hours_lookback: How many hours back to look for trending posts (default 24)
    
    Returns:
        List of recommendation dicts with:
        {
            "post_id": UUID,
            "content": str,
            "category": str,
            "score": float,
            "reason": str,  # Why this post was recommended
            ...
        }
    """
    try:
        logger.info(f"Computing recommendations for user {user_id if user_id else 'anonymous'}")
        logger.info(f"  user_location: {user_location}")
        logger.info(f"  category_filter: {category_filter}")
        logger.info(f"  hours_lookback: {hours_lookback}")
        logger.info(f"  exclude_interacted: {exclude_interacted}")
        
        # For anonymous users, return trending posts directly
        if not user_id:
            logger.info("Anonymous user - returning trending posts")
            trending_posts = await _get_trending_posts(db, hours_lookback=hours_lookback, limit=limit * 5)
            
            if not trending_posts:
                logger.warning("No trending posts found")
                return []
            
            # Convert trending posts to recommendations (minimal scoring for anonymous)
            recommendations = []
            for post in trending_posts[:limit]:
                recommendations.append({
                    "post_id": str(post.id),
                    "content": post.content,
                    "category": post.event_category,
                    "credibility_score": round(post.credibility_score, 2),
                    "score": 0.5,  # Neutral score for anonymous
                    "reason": "Trending now",
                    "created_at": post.created_at.isoformat() if hasattr(post.created_at, 'isoformat') else str(post.created_at),
                })
            logger.info(f"Generated {len(recommendations)} trending posts for anonymous user")
            return recommendations
        
        # Step 1: Get user
        user = await crud.get_user_by_id(db, str(user_id))
        if not user:
            logger.warning(f"User {user_id} not found")
            return []
        
        # Step 2: Get user preferences
        user_prefs = await crud.get_user_all_preferences(db, user_id)
        preference_dict = {
            f"cat:{p.category.lower()}" if p.category else f"loc:{p.location}": p.preference_score
            for p in user_prefs
        }
        
        if not preference_dict:
            logger.info(f"No preferences found for user {user_id}, using trending posts only")
        
        # Step 3: Get trending posts
        trending_posts = await _get_trending_posts(db, hours_lookback=hours_lookback, limit=limit * 5)
        
        if not trending_posts:
            logger.warning(f"No trending posts found for user {user_id}")
            return []
        
        # Step 4: Compute recommendation scores
        scored_posts = await _compute_recommendations(
            db=db,
            user_id=user_id,
            user_preferences=preference_dict,
            trending_posts=trending_posts,
            exclude_interacted=exclude_interacted,
        )
        
        # Step 5: Apply filters using _apply_filters()
        posts_to_recommend = [post for post, score in scored_posts]
        filtered_posts = await _apply_filters(
            posts=posts_to_recommend,
            user=user,
            user_location=user_location,
            category_filter=category_filter,
            min_credibility=CREDIBILITY_THRESHOLD,
            exclude_interacted=exclude_interacted,
            db=db,
        )
        
        # Pair filtered posts back with their scores
        filtered_post_ids = {p.id for p in filtered_posts}
        filtered_posts_tuples = [
            (post, score) for post, score in scored_posts 
            if post.id in filtered_post_ids
        ]
        
        # Step 6: Take top N and format response
        recommendations = []
        for post, score in filtered_posts_tuples[:limit]:
            # Determine recommendation reason
            reasons = []
            if post.event_category:
                cat_key = f"cat:{post.event_category.lower()}"
                if cat_key in preference_dict:
                    reasons.append(f"Matches your interest in {post.event_category}")
            
            if post.credibility_score > 0.8:
                reasons.append("Highly credible")
            
            if score > 0.8:
                reasons.append("Trending now")
            
            reason = " • ".join(reasons) if reasons else "Popular in your area"
            
            recommendations.append({
                "post_id": str(post.id),
                "content": post.content,
                "category": post.event_category,
                "credibility_score": round(post.credibility_score, 2),
                "score": round(score, 3),
                "reason": reason,
                "created_at": post.created_at.isoformat(),
            })
        
        logger.info(f"Generated {len(recommendations)} recommendations for user {user_id}")
        return recommendations
    
    except Exception as e:
        logger.error(f"Failed to compute recommendations for user {user_id}: {e}")
        return []
