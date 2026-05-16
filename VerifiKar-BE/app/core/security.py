from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from jose import JWTError, jwt
from app.core.config import settings
from passlib.context import CryptContext
from passlib.handlers.bcrypt import bcrypt

# Configure bcrypt with explicit settings
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
    bcrypt__ident="2b"
)

# ...rest of your existing code...

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain password against its hashed version.
    
    NOTE: We must apply the same 72-byte truncation
    to the password being checked.
    """
    password_bytes = plain_password.encode('utf-8')[:72]
    return pwd_context.verify(password_bytes, hashed_password)

def get_password_hash(password: str) -> str:
    """
    Hashes a plain password.
    
    NOTE: bcrypt has a 72-byte limit. We must encode to UTF-8
    and truncate to 72 bytes *before* hashing.
    """
    password_bytes = password.encode('utf-8')[:72]
    return pwd_context.hash(password_bytes)


# 2. Setup JWT Access Token Creation
def create_access_token(data: Dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """
    Creates a new JWT access token.
    'data' will be our payload, e.g., {"user_id": "..."}
    """
    to_encode = data.copy()

    # Mark token type for validation downstream
    to_encode.update({"type": "access"})
    
    # Set the token expiration time
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        # Use the default expiration time from our config file
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    
    to_encode.update({"exp": expire})
    
    # Encode the token using our secret key and algorithm
    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )
    
    return encoded_jwt


def create_refresh_token(data: Dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """
    Creates a new JWT refresh token.
    Refresh tokens live longer than access tokens and are used to renew sessions.
    """
    to_encode = data.copy()
    to_encode.update({"type": "refresh"})

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            days=settings.REFRESH_TOKEN_EXPIRE_DAYS
        )

    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )

    return encoded_jwt