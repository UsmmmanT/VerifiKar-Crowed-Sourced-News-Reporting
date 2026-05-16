"""
Notification Triggers

Automatically triggers notifications based on post trending status and engagement.
Designed to be called from background jobs and cron tasks.
"""

import datetime
import logging
from typing import Dict, Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Post,
    PostInteraction,
    InteractionEnum,
)
from app.services.notification_service import (
    send_notifications_to_category_subscribers,
    send_notifications_by_location,
    send_batch_notifications,
)
from app.services.recommendation_service import _get_trending_posts

logger = logging.getLogger(__name__)

# Notification trigger thresholds
TRENDING_CATEGORY_THRESHOLD = 10  # Minimum upvotes to trigger category notification
TRENDING_CATEGORY_SCORE = 0.7  # Minimum credibility score for trending
HIGH_ENGAGEMENT_UPVOTE_THRESHOLD = 20  # Minimum upvotes for high engagement
HIGH_ENGAGEMENT_CREDIBILITY = 0.75  # Minimum credibility for high engagement
TRENDING_CHECK_HOURS = 24  # Check posts from last 24 hours
TRENDING_CHECK_INTERVAL_MINUTES = 60  # Run cron every 60 minutes


async def is_category_trending(
    db: AsyncSession,
    category: str,
    hours_lookback: int = 24,
) -> Dict[str, Any]:
    """
    Check if a category is currently trending.
    
    Trending criteria:
    1. Multiple posts in category from last N hours
    2. High engagement (upvotes) on those posts
    3. High average credibility
    
    Args:
        db: Database session
        category: Category name (e.g., "Fire", "Accident")
        hours_lookback: Check posts from last N hours
    
    Returns:
        Dict with trending info:
        {
            "is_trending": bool,
            "post_count": int,
            "avg_credibility": float,
            "total_upvotes": int,
            "trending_score": float,  # 0-1
        }
    """
    cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours_lookback)
    
    # Count posts in this category
    posts_query = select(func.count(Post.id)).where(
        Post.event_category == category,
        Post.created_at >= cutoff_time,
    )
    posts_result = await db.execute(posts_query)
    post_count = posts_result.scalar() or 0
    
    if post_count == 0:
        return {
            "is_trending": False,
            "post_count": 0,
            "avg_credibility": 0.0,
            "total_upvotes": 0,
            "trending_score": 0.0,
        }
    
    # Get stats on those posts
    posts = await _get_trending_posts(db, hours_lookback=hours_lookback, limit=1000)
    category_posts = [p for p in posts if p.event_category == category]
    
    if not category_posts:
        return {
            "is_trending": False,
            "post_count": 0,
            "avg_credibility": 0.0,
            "total_upvotes": 0,
            "trending_score": 0.0,
        }
    
    avg_credibility = sum(p.credibility_score for p in category_posts) / len(category_posts)
    
    # Count total upvotes
    upvote_query = select(func.count(PostInteraction.id)).where(
        PostInteraction.interaction_type == InteractionEnum.upvote,
        PostInteraction.post_id.in_([p.id for p in category_posts]),
        PostInteraction.created_at >= cutoff_time,
    )
    upvotes_result = await db.execute(upvote_query)
    total_upvotes = upvotes_result.scalar() or 0
    
    # Calculate trending score (0-1)
    # Consider: post count, upvotes, credibility
    trending_score = (
        min(1.0, post_count / 10.0) * 0.4 +  # 40% on post count (trending if 10+)
        min(1.0, total_upvotes / 50.0) * 0.4 +  # 40% on upvotes (trending if 50+)
        avg_credibility * 0.2  # 20% on credibility
    )
    
    is_trending = trending_score >= 0.6  # Threshold: 60% score
    
    return {
        "is_trending": is_trending,
        "post_count": post_count,
        "avg_credibility": round(avg_credibility, 2),
        "total_upvotes": total_upvotes,
        "trending_score": round(trending_score, 2),
    }


async def trigger_trending_category_notification(
    db: AsyncSession,
    post: Post,
) -> Dict[str, Any]:
    """
    Send notification to users interested in a trending category.
    
    Called when:
    1. A new post is created in a category
    2. A post reaches certain engagement threshold
    3. A category becomes trending
    
    Args:
        db: Database session
        post: Post object
    
    Returns:
        Notification result dict
    """
    if not post.event_category:
        logger.warning(f"Post {post.id} has no category")
        return {"sent": 0, "error": "No category"}
    
    try:
        logger.info(f"Checking if category '{post.event_category}' is trending for post {post.id}")
        
        # Check if category is trending
        trending_info = await is_category_trending(db, post.event_category)
        
        if not trending_info["is_trending"]:
            logger.info(f"Category '{post.event_category}' not trending yet")
            return {"sent": 0, "trending": False}
        
        logger.info(
            f"Category '{post.event_category}' is trending! "
            f"(score: {trending_info['trending_score']}, posts: {trending_info['post_count']})"
        )
        
        # Send notification to category subscribers
        title = f"🔥 Trending: {post.event_category}"
        body = post.content[:100] + "..." if len(post.content) > 100 else post.content
        data = {
            "post_id": str(post.id),
            "category": post.event_category,
            "notification_type": "trending_category",
        }
        
        result = await send_notifications_to_category_subscribers(
            db=db,
            category=post.event_category,
            title=title,
            body=body,
            data=data,
            min_preference_score=0.4,  # Send to users with any interest
        )
        
        logger.info(
            f"Sent {result.get('successful', 0)} trending category notifications for {post.event_category}"
        )
        
        return {
            "sent": result.get("successful", 0),
            "trending": True,
            "category": post.event_category,
            "trending_score": trending_info["trending_score"],
        }
    
    except Exception as e:
        logger.error(f"Failed to send trending category notification for post {post.id}: {e}")
        return {"sent": 0, "error": str(e)}


async def trigger_high_engagement_notification(
    db: AsyncSession,
    post: Post,
) -> Dict[str, Any]:
    """
    Send notification when a post reaches high engagement.
    
    Called when post reaches:
    1. 20+ upvotes
    2. High credibility (0.75+)
    3. Active cluster
    
    Args:
        db: Database session
        post: Post object
    
    Returns:
        Notification result dict
    """
    try:
        logger.info(f"Checking engagement for post {post.id}")
        
        # Count upvotes in last 24 hours
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)
        
        upvote_query = select(func.count(PostInteraction.id)).where(
            PostInteraction.post_id == post.id,
            PostInteraction.interaction_type == InteractionEnum.upvote,
            PostInteraction.created_at >= cutoff_time,
        )
        upvotes_result = await db.execute(upvote_query)
        upvote_count = upvotes_result.scalar() or 0
        
        # Check criteria
        if upvote_count < HIGH_ENGAGEMENT_UPVOTE_THRESHOLD:
            logger.debug(f"Post {post.id} not enough upvotes: {upvote_count}/{HIGH_ENGAGEMENT_UPVOTE_THRESHOLD}")
            return {"sent": 0, "high_engagement": False, "reason": "not_enough_upvotes"}
        
        if post.credibility_score < HIGH_ENGAGEMENT_CREDIBILITY:
            logger.debug(f"Post {post.id} low credibility: {post.credibility_score}/{HIGH_ENGAGEMENT_CREDIBILITY}")
            return {"sent": 0, "high_engagement": False, "reason": "low_credibility"}
        
        logger.info(
            f"Post {post.id} has high engagement! "
            f"(upvotes: {upvote_count}, credibility: {post.credibility_score})"
        )
        
        # Send notification to users interested in this area
        title = f"🚨 High Engagement Alert"
        body = f"A {post.event_category or 'post'} is getting lot of attention"
        data = {
            "post_id": str(post.id),
            "notification_type": "high_engagement",
            "upvote_count": str(upvote_count),
        }
        
        # Send to location subscribers if location available
        if post.location:
            result = await send_notifications_by_location(
                db=db,
                location_wkt=str(post.location),
                radius_km=10.0,  # 10km radius
                title=title,
                body=body,
                data=data,
            )
        else:
            # Fall back to category subscribers
            if post.event_category:
                result = await send_notifications_to_category_subscribers(
                    db=db,
                    category=post.event_category,
                    title=title,
                    body=body,
                    data=data,
                    min_preference_score=0.5,
                )
            else:
                logger.warning(f"Post {post.id} has no location or category")
                return {"sent": 0, "error": "No location or category"}
        
        logger.info(f"Sent {result.get('successful', 0)} high engagement notifications")
        
        return {
            "sent": result.get("successful", 0),
            "high_engagement": True,
            "upvote_count": upvote_count,
            "credibility": post.credibility_score,
        }
    
    except Exception as e:
        logger.error(f"Failed to send high engagement notification for post {post.id}: {e}")
        return {"sent": 0, "error": str(e)}


async def check_trending_events_cron(
    db: AsyncSession,
    hours_lookback: int = TRENDING_CHECK_HOURS,
) -> Dict[str, Any]:
    """
    Periodic cron job to check for trending events and send notifications.
    
    Should be scheduled to run every N minutes (e.g., 60 minutes).
    
    Steps:
    1. Get all active clusters
    2. For each cluster, check if becoming trending
    3. Send batch notifications to interested users
    4. Log results
    
    Args:
        db: Database session
        hours_lookback: Only check posts from last N hours
    
    Returns:
        Summary dict with notification stats
    
    Note:
        Schedule in Phase 14 using APScheduler or similar:
        scheduler.add_job(
            check_trending_events_cron,
            'interval',
            minutes=TRENDING_CHECK_INTERVAL_MINUTES
        )
    """
    try:
        logger.info("Starting trending events cron job")
        
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours_lookback)
        
        # Get all categories with posts in last N hours
        categories_query = select(Post.event_category).where(
            Post.event_category.isnot(None),
            Post.created_at >= cutoff_time,
        ).distinct()
        
        categories_result = await db.execute(categories_query)
        categories = categories_result.scalars().all()
        
        if not categories:
            logger.info("No posts found in recent period")
            return {"categories_checked": 0, "trending_found": 0, "notifications_sent": 0}
        
        logger.info(f"Checking {len(categories)} categories for trending status")
        
        trending_categories = []
        total_notifications_sent = 0
        
        # Check each category
        for category in categories:
            try:
                trending_info = await is_category_trending(db, category, hours_lookback=hours_lookback)
                
                if trending_info["is_trending"]:
                    logger.info(
                        f"✓ Category '{category}' is trending! "
                        f"(score: {trending_info['trending_score']}, posts: {trending_info['post_count']})"
                    )
                    trending_categories.append((category, trending_info))
            
            except Exception as e:
                logger.error(f"Error checking category {category}: {e}")
                continue
        
        # Send batch notifications for each trending category
        for category, trending_info in trending_categories:
            try:
                # Get top recent post in this category
                top_post_query = (
                    select(Post)
                    .where(
                        Post.event_category == category,
                        Post.created_at >= cutoff_time,
                    )
                    .order_by(Post.credibility_score.desc())
                    .limit(1)
                )
                
                top_post_result = await db.execute(top_post_query)
                top_post = top_post_result.scalar_one_or_none()
                
                if top_post:
                    title = f"🔥 Trending Now: {category}"
                    body = f"{trending_info['total_upvotes']} people are discussing {category}"
                    data = {
                        "notification_type": "trending_event",
                        "category": category,
                        "post_id": str(top_post.id),
                    }
                    
                    result = await send_notifications_to_category_subscribers(
                        db=db,
                        category=category,
                        title=title,
                        body=body,
                        data=data,
                        min_preference_score=0.3,  # Even low preference gets notified
                    )
                    
                    sent = result.get("successful", 0)
                    total_notifications_sent += sent
                    
                    logger.info(f"Sent {sent} notifications for trending category '{category}'")
            
            except Exception as e:
                logger.error(f"Error sending notifications for category {category}: {e}")
                continue
        
        summary = {
            "categories_checked": len(categories),
            "trending_found": len(trending_categories),
            "notifications_sent": total_notifications_sent,
            "trending_categories": [cat for cat, _ in trending_categories],
        }
        
        logger.info(f"Trending events cron completed: {summary}")
        return summary
    
    except Exception as e:
        logger.error(f"Trending events cron job failed: {e}")
        return {
            "categories_checked": 0,
            "trending_found": 0,
            "notifications_sent": 0,
            "error": str(e),
        }


async def notify_high_engagement_posts(
    db: AsyncSession,
    hours_lookback: int = 24,
) -> Dict[str, Any]:
    """
    Find and notify about high engagement posts.
    
    Can be called periodically (e.g., every 30 minutes) to check for posts
    that have recently reached high engagement threshold.
    
    Args:
        db: Database session
        hours_lookback: Check posts created in last N hours
    
    Returns:
        Summary of notifications sent
    """
    try:
        logger.info("Checking for high engagement posts")
        
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours_lookback)
        
        # Get recent posts with high engagement
        posts_query = select(Post).where(
            Post.created_at >= cutoff_time,
        ).order_by(Post.credibility_score.desc())
        
        posts_result = await db.execute(posts_query)
        recent_posts = posts_result.scalars().all()
        
        if not recent_posts:
            logger.info("No recent posts found")
            return {"posts_checked": 0, "high_engagement_found": 0, "notifications_sent": 0}
        
        logger.info(f"Checking {len(recent_posts)} recent posts for high engagement")
        
        high_engagement_posts = []
        total_notifications_sent = 0
        
        # Check each post
        for post in recent_posts:
            # Count upvotes in last 24 hours
            upvote_query = select(func.count(PostInteraction.id)).where(
                PostInteraction.post_id == post.id,
                PostInteraction.interaction_type == InteractionEnum.upvote,
                PostInteraction.created_at >= cutoff_time,
            )
            upvotes_result = await db.execute(upvote_query)
            upvote_count = upvotes_result.scalar() or 0
            
            # Check if meets high engagement criteria
            if (upvote_count >= HIGH_ENGAGEMENT_UPVOTE_THRESHOLD and
                post.credibility_score >= HIGH_ENGAGEMENT_CREDIBILITY):
                
                logger.info(f"Post {post.id} is high engagement: {upvote_count} upvotes")
                high_engagement_posts.append(post)
        
        logger.info(f"Found {len(high_engagement_posts)} high engagement posts")
        
        # Send notifications for each
        for post in high_engagement_posts:
            try:
                result = await trigger_high_engagement_notification(db, post)
                total_notifications_sent += result.get("sent", 0)
            except Exception as e:
                logger.error(f"Error sending notification for post {post.id}: {e}")
        
        return {
            "posts_checked": len(recent_posts),
            "high_engagement_found": len(high_engagement_posts),
            "notifications_sent": total_notifications_sent,
        }
    
    except Exception as e:
        logger.error(f"High engagement check failed: {e}")
        return {
            "posts_checked": 0,
            "high_engagement_found": 0,
            "notifications_sent": 0,
            "error": str(e),
        }
