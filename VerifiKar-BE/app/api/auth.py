from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated
from jose import JWTError, jwt
import logging

# Our internal modules
from app.db.session import get_db_session
from app.db import crud
from app.schemas import (
    UserCreate,
    UserPublic,
    ApiResponse,
    Token,
    ChangePasswordRequest,
    RefreshTokenRequest,
    NotificationTokenCreate,
    NotificationTokenResponse,
)
from app.core.security import create_access_token, create_refresh_token, verify_password
from app.core.dependencies import get_optional_current_user, get_current_user
from app.core.config import settings
from app.db.models import User
from app.services.notification_service import send_notification_to_user

logger = logging.getLogger(__name__)

# Create a new router for authentication endpoints
router = APIRouter()

@router.post(
    "/signup",
    response_model=ApiResponse[UserPublic],  # Use our custom response model
    status_code=status.HTTP_201_CREATED,
    summary="Create new user"
)
async def signup(
    user_in: UserCreate,  # FastAPI validates the request body using this schema
    db: AsyncSession = Depends(get_db_session)  # Dependency injection for DB session
):
    """
    Handle new user registration:
    1. Check if user already exists.
    2. If not, create the new user.
    3. Return the new user's public data.
    """
    # 1. Check if user already exists
    existing_user = await crud.get_user_by_email(db, email=user_in.email)
    if existing_user:
        # We return our custom error response
        # Note: We return a 201 status code here even on error
        # to avoid revealing that the email is already registered (a minor security practice).
        # A 409 Conflict is also common. Let's return a 409 for clarity.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"success": False, "details": "An account with this email already exists."}
        )
        
    # 2. Create the new user
    # We will add email verification logic here later.
    # For now, we create the user directly.
    user = await crud.create_user(db, user_in)
    
    # 3. Return the success response
    return {
        "success": True,
        "details": user  # Pydantic will automatically format this using UserPublic
    }

@router.post(
    "/login",
    response_model=ApiResponse[Token],
    summary="User login"
)
async def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db_session)
):
    """
    Handle user login using OAuth2 password flow:
    1. Find the user by email (form_data.username).
    2. Verify the password.
    3. Create and return a JWT access token.
    """
    
    # Note: FastAPI's OAuth2 standard requires using "username" in the form data.
    # We will treat 'username' as the user's email address.
    
    # 1. Find the user
    user = await crud.get_user_by_email(db, email=form_data.username)
    
    # 2. Verify the password
    if not user or not verify_password(form_data.password, user.hashed_password):
        # ✅ FIX: Use HTTPException instead of return
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "details": {"message": "Incorrect email or password."}
            }
        )
    
    # Optional: Check if email is verified
    # if not user.is_email_verified:
    #     raise HTTPException(
    #         status_code=status.HTTP_403_FORBIDDEN,
    #         detail={
    #             "success": False,
    #             "details": {"message": "Please verify your email address before logging in."}
    #         }
    #     )

    # 3. Create the JWT token
    # We store the user's ID in the token's "sub" (subject) claim
    access_token = create_access_token(
        data={"sub": str(user.id)}  # "sub" is the standard claim for user ID
    )
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    
    return {
        "success": True,
        "details": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer"
        }
    }


@router.post(
    "/refresh",
    response_model=ApiResponse[Token],
    summary="Refresh access token"
)
async def refresh_token(
    payload: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Refresh an access token using a valid refresh token.
    """
    try:
        decoded = jwt.decode(
            payload.refresh_token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "details": {"message": "Invalid refresh token."}},
        )

    if decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "details": {"message": "Invalid token type."}},
        )

    user_id = decoded.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "details": {"message": "Invalid refresh token."}},
        )

    user = await crud.get_user_by_id(db, user_id=user_id)
    if not user or user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "details": {"message": "User not found."}},
        )

    new_access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})

    return {
        "success": True,
        "details": {
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
        },
    }


@router.post(
    "/change-password",
    response_model=ApiResponse[dict],
    summary="Change current user's password"
)
async def change_password(
    payload: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: User | None = Depends(get_optional_current_user)
):
    """Change password for authenticated user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "details": "Authentication required."}
        )

    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "details": "Current password is incorrect."}
        )

    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"success": False, "details": "New password must be different."}
        )

    await crud.update_user_password(db, current_user, payload.new_password)

    return {
        "success": True,
        "details": {"message": "Password changed successfully."}
    }


@router.post(
    "/register-device-token",
    response_model=ApiResponse[NotificationTokenResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Register device token for push notifications"
)
async def register_device_token(
    token_data: NotificationTokenCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user)
):
    """
    Register a device token for receiving push notifications.
    
    **Authentication Required:** Yes
    
    **Features:**
    - Stores device tokens for FCM push notifications
    - Supports both Android and iOS
    - Optional expiration date for token rotation
    - Replaces duplicate tokens automatically
    
    **Request Body:**
    - device_token: The FCM device token from mobile app
    - platform: "android" or "ios"
    - expires_at: Optional timestamp when token expires
    
    **Response:**
    - Returns token_id for tracking purposes
    """
    try:
        # Create or update notification token
        token = await crud.create_notification_token(
            db=db,
            user_id=current_user.id,
            device_token=token_data.device_token,
            platform=token_data.platform,
            expires_at=token_data.expires_at,
        )
        
        return {
            "success": True,
            "details": NotificationTokenResponse(
                message=f"Device token registered successfully for {token_data.platform}",
                token_id=token.id,
            )
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "success": False,
                "details": {"message": f"Failed to register device token: {str(e)}"}
            }
        )


@router.post(
    "/notifications/test-send",
    response_model=ApiResponse[dict],
    status_code=status.HTTP_200_OK,
    summary="Send test notification via Firebase"
)
async def send_test_notification(
    db: AsyncSession = Depends(get_db_session),
    current_user: User = Depends(get_current_user)
):
    """
    Send a test notification via Firebase to verify the notification system works end-to-end.
    
    **Authentication Required:** Yes (must be logged in)
    
    **Purpose:**
    - Verify Firebase is properly configured
    - Test device tokens are valid
    - Confirm notifications reach the user's phone
    - Debug notification delivery issues
    
    **Response:**
    - Returns success status and notification details
    - Includes device_token used, notification_id from Firebase, and timestamp
    
    **Usage:**
    ```
    POST /auth/notifications/test-send
    Authorization: Bearer {JWT_TOKEN}
    Content-Type: application/json
    ```
    """
    try:
        logger.info(f"[Test Notification] Request from user: {current_user.id}")
        
        # Get user's active device tokens
        active_tokens = await crud.get_active_user_tokens(db, current_user.id)
        
        if not active_tokens:
            logger.warning(f"[Test Notification] No active device tokens for user: {current_user.id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "success": False,
                    "details": {
                        "message": "No active device tokens found. Please register a device first.",
                        "action": "Call /auth/register-device-token with your device token"
                    }
                }
            )
        
        # Send test notification to all active tokens
        results = []
        for token_record in active_tokens:
            try:
                logger.info(f"[Test Notification] Sending to token: {token_record.device_token[:30]}...")
                
                # Send notification via Firebase
                result = await send_notification_to_user(
                    db=db,
                    user_id=current_user.id,
                    title="✅ VerifiKar Test Notification",
                    body="Your notification system is working! 🎉",
                    data={
                        "test": "true",
                        "notification_type": "test",
                        "timestamp": str(__import__('datetime').datetime.utcnow())
                    }
                )
                
                logger.info(f"[Test Notification] Successfully sent to {token_record.platform}")
                results.append({
                    "status": "success",
                    "platform": token_record.platform,
                    "device_token": token_record.device_token[:30] + "...",
                    "notification_id": result.get("notification_id", "N/A") if result else "N/A"
                })
                
            except Exception as e:
                logger.error(f"[Test Notification] Failed to send to {token_record.platform}: {str(e)}")
                results.append({
                    "status": "failed",
                    "platform": token_record.platform,
                    "error": str(e)
                })
        
        # Log notification in database
        try:
            from app.db.models import NotificationLog, NotificationStatusEnum
            notification_log = NotificationLog(
                user_id=current_user.id,
                notification_type="test",
                title="Test Notification",
                body="Test notification from backend",
                status=NotificationStatusEnum.sent if any(r["status"] == "success" for r in results) else NotificationStatusEnum.failed,
                sent_at=__import__('datetime').datetime.utcnow()
            )
            db.add(notification_log)
            await db.commit()
            logger.info(f"[Test Notification] Logged to database")
        except Exception as e:
            logger.warning(f"[Test Notification] Failed to log: {str(e)}")
        
        return {
            "success": True,
            "details": {
                "message": "Test notification sent successfully! Check your phone for the notification.",
                "results": results,
                "total_tokens": len(active_tokens),
                "successful_sends": len([r for r in results if r["status"] == "success"]),
                "failed_sends": len([r for r in results if r["status"] == "failed"]),
                "next_steps": [
                    "1. Check your phone for the notification",
                    "2. If received: Your notification system is working! 🎉",
                    "3. If not received: Check device notification settings in Settings > Apps > Expo Go"
                ]
            }
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"[Test Notification] Unexpected error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "details": {
                    "message": f"Failed to send test notification: {str(e)}",
                    "error_type": type(e).__name__
                }
            }
        )

