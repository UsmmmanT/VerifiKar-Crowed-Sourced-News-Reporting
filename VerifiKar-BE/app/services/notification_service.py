"""
Notification Service

Handles sending push notifications to users via Firebase Cloud Messaging (FCM).
Integrates with user notification tokens stored in the database.
"""

import asyncio
import json
import logging
from typing import Dict, List, Optional, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db import crud

logger = logging.getLogger(__name__)

# Firebase Admin SDK imports (optional)
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False
    logger.warning("Firebase Admin SDK not installed. Notifications will be logged but not sent.")


# Initialize Firebase app (done at startup)
_firebase_initialized = False


def initialize_firebase() -> bool:
    """
    Initialize Firebase Admin SDK with service account credentials.
    
    This should be called once at application startup.
    If Firebase is not configured, notifications will be logged but not sent.
    
    Returns:
        True if Firebase initialized successfully, False otherwise
    """
    global _firebase_initialized
    
    if _firebase_initialized:
        return True
    
    if not FIREBASE_AVAILABLE:
        logger.warning("Firebase Admin SDK not installed")
        return False
    
    try:
        if not settings.FIREBASE_CREDENTIALS_PATH:
            logger.warning("FIREBASE_CREDENTIALS_PATH not set. Notifications will be logged but not sent.")
            return False
        
        # Initialize Firebase with service account
        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred)
        
        _firebase_initialized = True
        logger.info("Firebase Admin SDK initialized successfully")
        return True
    
    except Exception as e:
        logger.error(f"Failed to initialize Firebase: {e}")
        return False


async def send_notification_to_user(
    db: AsyncSession,
    user_id: UUID,
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
    notification_log_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    """
    Send a notification to a specific user via all their active devices.
    
    Sends the same notification to all active device tokens registered for the user.
    Updates notification log with success/failure status.
    
    Args:
        db: Database session
        user_id: User ID to send notification to
        title: Notification title
        body: Notification body text
        data: Optional dict of custom data to include in notification
        notification_log_id: Optional log entry ID to update status
    
    Returns:
        Dict with status info:
        {
            "success": bool,
            "tokens_sent": int,
            "tokens_failed": int,
            "error": str or None,
            "message_ids": [str, ...],
        }
    """
    try:
        # Get user's active notification tokens
        tokens = await crud.get_active_user_tokens(db, user_id)
        
        if not tokens:
            logger.warning(f"No active notification tokens for user {user_id}")
            
            # Update log if provided
            if notification_log_id:
                await crud.update_notification_status(
                    db=db,
                    log_id=notification_log_id,
                    status="failed",
                    error_message="No active device tokens registered"
                )
            
            return {
                "success": False,
                "tokens_sent": 0,
                "tokens_failed": 0,
                "error": "No active device tokens",
                "message_ids": [],
            }
        
        result = {
            "success": True,
            "tokens_sent": 0,
            "tokens_failed": 0,
            "error": None,
            "message_ids": [],
        }
        
        # If Firebase is not available, just log
        if not FIREBASE_AVAILABLE or not _firebase_initialized:
            logger.info(
                f"Would send notification to user {user_id}: "
                f"title='{title}', body='{body}' (Firebase not available)"
            )
            
            result["tokens_sent"] = len(tokens)
            result["message_ids"] = [f"logged_only_{i}" for i in range(len(tokens))]
            
            # Update log as sent (since we logged it)
            if notification_log_id:
                import datetime
                await crud.update_notification_status(
                    db=db,
                    log_id=notification_log_id,
                    status="sent",
                    sent_at=datetime.datetime.now(datetime.timezone.utc)
                )
            
            return result
        
        # Send via Firebase to each token
        for token in tokens:
            try:
                # Build FCM message
                message = messaging.MulticastMessage(
                    tokens=[token.device_token],
                    notification=messaging.Notification(
                        title=title,
                        body=body,
                    ),
                    data=data or {},
                    android=messaging.AndroidConfig(
                        priority="high",
                        notification=messaging.AndroidNotification(
                            sound="default",
                        ),
                    ),
                    apns=messaging.APNSConfig(
                        headers={"apns-priority": "10"},
                    ),
                )
                
                # Send using single-token message for better error handling
                message = messaging.Message(
                    token=token.device_token,
                    notification=messaging.Notification(
                        title=title,
                        body=body,
                    ),
                    data=data or {},
                )
                
                message_id = messaging.send(message)
                
                # Update token's last used timestamp
                await crud.update_token_last_used(db, token.id)
                
                result["tokens_sent"] += 1
                result["message_ids"].append(message_id)
                
                logger.info(f"Sent notification to user {user_id}, token {token.device_token[:20]}... → {message_id}")
            
            except messaging.InvalidArgumentError as e:
                logger.warning(f"Invalid token for user {user_id}: {e}")
                
                # Mark token as inactive
                await crud.deactivate_notification_token(db, token.id)
                result["tokens_failed"] += 1
            
            except Exception as e:
                logger.error(f"Failed to send notification to user {user_id}: {e}")
                result["tokens_failed"] += 1
        
        # Update notification log
        if notification_log_id:
            import datetime
            status = "sent" if result["tokens_sent"] > 0 else "failed"
            error_msg = f"Sent to {result['tokens_sent']}, failed {result['tokens_failed']}"
            
            await crud.update_notification_status(
                db=db,
                log_id=notification_log_id,
                status=status,
                sent_at=datetime.datetime.now(datetime.timezone.utc),
                error_message=error_msg if result["tokens_failed"] > 0 else None
            )
        
        return result
    
    except Exception as e:
        logger.error(f"Failed to send notification to user {user_id}: {e}")
        
        # Update log with error
        if notification_log_id:
            await crud.update_notification_status(
                db=db,
                log_id=notification_log_id,
                status="failed",
                error_message=str(e)
            )
        
        return {
            "success": False,
            "tokens_sent": 0,
            "tokens_failed": 0,
            "error": str(e),
            "message_ids": [],
        }


async def send_batch_notifications(
    db: AsyncSession,
    notifications: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Send multiple notifications efficiently.
    
    Sends notifications to multiple users concurrently using asyncio.gather.
    
    Args:
        db: Database session
        notifications: List of notification dicts, each containing:
        {
            "user_id": UUID or str,
            "title": str,
            "body": str,
            "data": dict (optional),
            "log_id": UUID (optional),
        }
    
    Returns:
        Dict with aggregated results:
        {
            "total": int,
            "successful": int,
            "failed": int,
            "results": [
                {
                    "user_id": UUID,
                    "success": bool,
                    "tokens_sent": int,
                    "error": str,
                }
            ]
        }
    """
    if not notifications:
        return {
            "total": 0,
            "successful": 0,
            "failed": 0,
            "results": [],
        }
    
    logger.info(f"Sending {len(notifications)} batch notifications")
    
    # Create tasks for all notifications
    tasks = []
    for notif in notifications:
        user_id = notif.get("user_id")
        title = notif.get("title", "VerifiKar")
        body = notif.get("body", "")
        data = notif.get("data", {})
        log_id = notif.get("log_id")
        
        if not user_id:
            logger.warning("Notification missing user_id, skipping")
            continue
        
        # Convert to UUID if string
        if isinstance(user_id, str):
            try:
                from uuid import UUID
                user_id = UUID(user_id)
            except ValueError:
                logger.warning(f"Invalid user_id format: {user_id}")
                continue
        
        task = send_notification_to_user(
            db=db,
            user_id=user_id,
            title=title,
            body=body,
            data=data,
            notification_log_id=log_id,
        )
        tasks.append((user_id, task))
    
    # Send all concurrently
    results_list = []
    successful = 0
    failed = 0
    
    try:
        # Run all tasks concurrently
        results = await asyncio.gather(
            *[task for _, task in tasks],
            return_exceptions=True
        )
        
        for (user_id, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                logger.error(f"Exception sending to user {user_id}: {result}")
                results_list.append({
                    "user_id": str(user_id),
                    "success": False,
                    "tokens_sent": 0,
                    "error": str(result),
                })
                failed += 1
            else:
                success = result.get("success", False)
                if success:
                    successful += 1
                else:
                    failed += 1
                
                results_list.append({
                    "user_id": str(user_id),
                    "success": success,
                    "tokens_sent": result.get("tokens_sent", 0),
                    "error": result.get("error"),
                })
    
    except Exception as e:
        logger.error(f"Batch notification failed: {e}")
        return {
            "total": len(notifications),
            "successful": 0,
            "failed": len(notifications),
            "error": str(e),
            "results": [],
        }
    
    logger.info(f"Batch notification complete: {successful}/{len(notifications)} successful")
    
    return {
        "total": len(notifications),
        "successful": successful,
        "failed": failed,
        "results": results_list,
    }


async def send_notifications_to_category_subscribers(
    db: AsyncSession,
    category: str,
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
    min_preference_score: float = 0.5,
) -> Dict[str, Any]:
    """
    Send notification to all users interested in a category.
    
    Fetches users with preference score ≥ min_preference_score for the category,
    then sends to all of them.
    
    Args:
        db: Database session
        category: Category name (e.g., "Fire", "Accident")
        title: Notification title
        body: Notification body
        data: Optional custom data
        min_preference_score: Only send to users with this preference level or higher
    
    Returns:
        Batch notification result dict
    """
    logger.info(f"Sending notification to users interested in {category}")
    
    # Query for users with this preference
    from sqlalchemy import select
    from app.db.models import UserPreference
    
    query = select(UserPreference.user_id).where(
        UserPreference.category == category,
        UserPreference.preference_score >= min_preference_score
    ).distinct()
    
    result = await db.execute(query)
    user_ids = result.scalars().all()
    
    if not user_ids:
        logger.warning(f"No users found interested in {category}")
        return {
            "total": 0,
            "successful": 0,
            "failed": 0,
            "results": [],
        }
    
    # Build notification list
    notifications = [
        {
            "user_id": str(user_id),
            "title": title,
            "body": body,
            "data": data or {},
        }
        for user_id in user_ids
    ]
    
    # Send batch
    return await send_batch_notifications(db, notifications)


async def send_notifications_by_location(
    db: AsyncSession,
    location_wkt: str,
    radius_km: float,
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Send notification to users interested in a specific location.
    
    Args:
        db: Database session
        location_wkt: Location point in WKT format
        radius_km: Search radius in kilometers
        title: Notification title
        body: Notification body
        data: Optional custom data
    
    Returns:
        Batch notification result dict
    """
    logger.info(f"Sending notification to users in location {location_wkt} (radius: {radius_km}km)")
    
    # Query for users with location preferences near this point
    from sqlalchemy import select, func, text
    from app.db.models import UserPreference
    from geoalchemy2.types import Geometry
    
    # Use PostGIS ST_DWithin for location search
    query = select(UserPreference.user_id).distinct().where(
        UserPreference.location.isnot(None),
        func.ST_DWithin(
            UserPreference.location,
            text(f"ST_GeomFromText('POINT(...)', 4326)"),  # Would need proper WKT parsing
            radius_km * 1000  # Convert to meters
        )
    )
    
    result = await db.execute(query)
    user_ids = result.scalars().all()
    
    if not user_ids:
        logger.warning(f"No users found interested in location {location_wkt}")
        return {
            "total": 0,
            "successful": 0,
            "failed": 0,
            "results": [],
        }
    
    # Build notification list
    notifications = [
        {
            "user_id": str(user_id),
            "title": title,
            "body": body,
            "data": data or {},
        }
        for user_id in user_ids
    ]
    
    # Send batch
    return await send_batch_notifications(db, notifications)
