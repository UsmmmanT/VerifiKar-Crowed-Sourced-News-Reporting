from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError, jwt
from pydantic import ValidationError

from app.core.config import settings
from app.db import crud
from app.db.models import User
from app.db.session import get_db_session
from app.schemas import TokenData
from arq.connections import ArqRedis

# This tells FastAPI that our token URL is at /auth/login
# It's used for the automatic /docs page
reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl="/auth/login", 
    auto_error=False  # Set to False to make the token optional
)

async def get_optional_current_user(
    db: AsyncSession = Depends(get_db_session), 
    token: str | None = Depends(reusable_oauth2)
) -> User | None:
    """
    Dependency to get the current user from a JWT token.
    Returns the User object or None if the token is invalid or not provided.
    """
    print(f"[AUTH DEBUG] Token received: {token[:50] if token else 'None'}...")
    
    if not token:
        print("[AUTH DEBUG] No token provided")
        return None

    try:
        # 1. Decode the JWT token
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        print(f"[AUTH DEBUG] Token decoded successfully, payload: {payload}")
        
        # 2. Extract the user ID (from the "sub" claim)
        token_data = TokenData(user_id=payload.get("sub"))
        if token_data.user_id is None:
            print("[AUTH DEBUG] No user_id in token")
            return None
        
    except (JWTError, ValidationError) as e:
        # Token is invalid (expired, wrong signature, etc.)
        print(f"[AUTH DEBUG] Token decode error: {type(e).__name__}: {e}")
        return None

    # 3. Get the user from the database
    user = await crud.get_user_by_id(db, user_id=token_data.user_id)
    print(f"[AUTH DEBUG] User lookup result: {user.id if user else 'None'}")
    
    if not user or user.is_deleted:
        return None
        
    return user


async def get_current_user(
    current_user: User | None = Depends(get_optional_current_user),
) -> User:
    """Dependency that enforces authentication and returns the current user."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"success": False, "details": {"message": "Authentication required"}},
        )
    return current_user


async def get_redis(request: Request) -> ArqRedis | None:
    """
    Dependency to get the Redis client from app state.
    Returns ArqRedis client or None if not available.
    
    Usage in endpoints:
        @app.get("/recommendations")
        async def get_recommendations(
            current_user: User = Depends(get_current_user),
            redis_client: ArqRedis | None = Depends(get_redis)
        ):
            ...
    """
    return request.app.state.redis