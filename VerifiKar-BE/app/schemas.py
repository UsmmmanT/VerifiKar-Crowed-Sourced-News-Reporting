from pydantic import BaseModel, EmailStr, ConfigDict, field_validator, Field
from typing import Generic, TypeVar, Optional, List
from uuid import UUID
from datetime import datetime
from app.db.models import MediaTypeEnum, InteractionEnum

# This is a generic TypeVar that we can use for our response model
T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    """
    Generic API response model to enforce the structure:
    {"success": true, "details": ...}
    
    This allows us to type-hint responses like:
    ApiResponse[UserPublic]
    ApiResponse[str]
    """
    success: bool
    details: T | str  # 'T' will be the data, 'str' can be an error message


# --- Token Schemas ---

class Token(BaseModel):
    """
    Response model for a successful login.
    This will be nested inside ApiResponse[Token]
    """
    access_token: str
    token_type: str
    refresh_token: str | None = None


class RefreshTokenRequest(BaseModel):
    """Schema for refresh token requests."""
    refresh_token: str

class TokenData(BaseModel):
    """
    Data payload that we will store inside the JWT.
    """
    user_id: str | None = None


# --- User Schemas ---

class UserBase(BaseModel):
    """
    Base User schema (shared properties)
    """
    email: EmailStr

class UserCreate(UserBase):
    """
    Schema for creating a new user (signup).
    Validates the incoming request body for POST /auth/signup
    """
    password: str

class ChangePasswordRequest(BaseModel):
    """Schema for authenticated password change."""
    current_password: str
    new_password: str = Field(..., min_length=8)

class UserPublic(UserBase):
    """
    Public-facing user data (response model).
    This is what we send back to the user *instead* of the
    full database model (which would include the hashed_password).
    """
    id: UUID
    reputation_score: float
    is_email_verified: bool
    
    # This tells Pydantic it's OK to read data from ORM models
    # (e.g., user_db_object.id)
    model_config = ConfigDict(from_attributes=True)

# --- Report Schemas ---

class ReportLocation(BaseModel):
    """
    Schema for the location JSON object we expect from the frontend.
    e.g., {"lat": 34.0522, "lon": -118.2437}
    
    Validates that:
    - Latitude is between -90 and 90 degrees
    - Longitude is between -180 and 180 degrees
    """
    lat: float
    lon: float
    
    @field_validator('lat')
    @classmethod
    def validate_latitude(cls, v: float) -> float:
        if not -90 <= v <= 90:
            raise ValueError(f'Latitude must be between -90 and 90, got {v}')
        return v
    
    @field_validator('lon')
    @classmethod
    def validate_longitude(cls, v: float) -> float:
        if not -180 <= v <= 180:
            raise ValueError(f'Longitude must be between -180 and 180, got {v}')
        return v

class RawReportCreateResponse(BaseModel):
    """
    The "details" part of the successful response for a new report.
    This will be nested inside ApiResponse[RawReportCreateResponse]
    """
    message: str
    raw_report_id: UUID

# --- Post Schemas ---

class PostMedia(BaseModel):
    id: UUID
    media_url: str
    media_type: MediaTypeEnum

    model_config = ConfigDict(from_attributes=True)

class PostContributor(BaseModel):
    user_id: UUID | None
    contribution_score: float

    model_config = ConfigDict(from_attributes=True)

class Post(BaseModel):
    id: UUID
    content: str
    credibility_score: float
    event_category: str | None
    location_lat: float
    location_lon: float
    created_at: datetime
    
    # --- NEW FIELDS ---
    media_items: List[PostMedia] = []  # A post can have media
    upvotes: int = 0
    downvotes: int = 0
    # --- END NEW ---

    model_config = ConfigDict(from_attributes=True)

class PostWithDetails(Post):
    # This schema now inherits the new fields from Post
    
    contributors: List[PostContributor]
    replies: List[Post]
    
    # --- NEW FIELD ---
    parent_post: Optional['Post'] = None # For the thread context
    # --- END NEW ---
    """
    Detailed schema for the GET /posts/{post_id} response.
    Includes everything from the base Post, plus related items.
    """
    media_items: List[PostMedia]
    contributors: List[PostContributor]
    replies: List[Post]  # For the post thread

# --- POST INTERACTION SCHEMAS ---

class PostInteractionCreate(BaseModel):
    interaction_type: InteractionEnum  # upvote, downvote, or flag

class PostInteractionResponse(BaseModel):
    message: str
    new_upvotes: int
    new_downvotes: int
    new_flags: int

# --- WRAPPER SCHEMAS FOR API RESPONSES ---
# These allow us to use ApiResponse[T] pattern

class PostListResponse(BaseModel):
    """Wrapper for list of posts in feed"""
    posts: List[Post]

class PostDetailsResponse(BaseModel):
    """Wrapper for single post with details"""
    post: PostWithDetails


class PostCommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class PostCommentResponse(BaseModel):
    message: str
    reply: Post


class UserSubmissionItem(BaseModel):
    id: UUID
    raw_text: str
    status: str
    created_at: datetime


class UserApprovedPostItem(BaseModel):
    id: UUID
    content: str
    event_category: str | None
    credibility_score: float
    created_at: datetime


class ProfileOverviewResponse(BaseModel):
    submissions: List[UserSubmissionItem]
    approved_posts: List[UserApprovedPostItem]


class DiscoverFilterChip(BaseModel):
    key: str
    label: str
    dot: str


class DiscoverTopicItem(BaseModel):
    key: str
    name: str
    subtitle: str
    reports: int
    emoji: str
    colors: List[str]


class DiscoverLocationItem(BaseModel):
    name: str
    top_label: str
    emoji: str
    posts: int
    tags: str
    colors: List[str]


class DiscoverEventItem(BaseModel):
    category: str
    label: str
    day: str
    month: str
    title: str
    location: str
    attending: str
    status: str
    status_bg: str
    status_color: str
    emoji: str
    colors: List[str]


class DiscoverOverviewResponse(BaseModel):
    filter_chips: List[DiscoverFilterChip]
    topics: List[DiscoverTopicItem]
    locations: List[DiscoverLocationItem]
    events: List[DiscoverEventItem]


class DiscoverSectionPostItem(BaseModel):
    id: UUID
    content: str
    event_category: str | None
    credibility_score: float
    created_at: datetime
    area: str
    distance_km: float
    upvotes: int
    downvotes: int


class DiscoverSectionPostsResponse(BaseModel):
    posts: List[DiscoverSectionPostItem]


# --- RECOMMENDATION SCHEMAS ---

class RecommendedPost(BaseModel):
    """A recommended post with ranking info"""
    id: UUID
    content: str
    event_category: str | None
    credibility_score: float
    location_lat: float
    location_lon: float
    created_at: datetime
    upvotes: int
    downvotes: int
    recommendation_score: float  # 0-1 score
    reason: str  # Why recommended (e.g., "matches your interests in Fire")


class RecommendationsResponse(BaseModel):
    """Wrapper for recommendations list"""
    recommendations: List[RecommendedPost]
    total_count: int


# --- NOTIFICATION TOKEN SCHEMAS ---

class NotificationTokenCreate(BaseModel):
    """Schema for registering a device notification token"""
    device_token: str
    platform: str = "android"  # "android" or "ios"
    expires_at: Optional[datetime] = None


class NotificationTokenResponse(BaseModel):
    """Response when device token is registered"""
    message: str
    token_id: UUID


class NotificationLogItem(BaseModel):
    """A single notification log entry"""
    id: UUID
    notification_type: str
    title: str
    body: str
    status: str  # "sent", "failed", "delivered", etc.
    sent_at: Optional[datetime]
    created_at: datetime
    post_id: Optional[UUID] = None
    cluster_id: Optional[UUID] = None


class NotificationsResponse(BaseModel):
    """Wrapper for notification logs"""
    notifications: List[NotificationLogItem]
    total_count: int

