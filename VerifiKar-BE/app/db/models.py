import datetime
import enum
from typing import List, Optional
from uuid import UUID

from geoalchemy2.types import Geometry
from pgvector.sqlalchemy import VECTOR
from sqlalchemy import (
    String,
    ForeignKey,
    DateTime,
    func,
    Index,
    Float,
    Boolean,
    CheckConstraint,
    Enum as PgEnum,
    Integer,
    Text,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    """
    Base class for all SQLAlchemy models.
    Includes a type annotation map for pgvector.
    """
    type_annotation_map = {
        VECTOR: VECTOR
    }


# --- Enums ---
# We define native PostgreSQL ENUMs for data integrity.

class ReportStatusEnum(enum.Enum):
    pending = "pending"
    processing = "processing"
    processed = "processed"
    failed = "failed"


class MediaTypeEnum(enum.Enum):
    image = "image"
    video = "video"


class ProcessedMediaStatusEnum(enum.Enum):
    processed = "processed"
    failed_embedding = "failed_embedding"
    failed_validation = "failed_validation"


class ClusterStatusEnum(enum.Enum):
    active = "active"
    inactive = "inactive"
    merged = "merged"


class PostStatusEnum(enum.Enum):
    active = "active"
    hidden = "hidden"
    archived = "archived"


class InteractionEnum(enum.Enum):
    upvote = "upvote"
    downvote = "downvote"
    flag = "flag"


class FlagReasonEnum(enum.Enum):
    inaccurate = "inaccurate"
    spam = "spam"
    resolved = "resolved"
    harmful = "harmful"


class EventStatusEnum(enum.Enum):
    live = "live"
    upcoming = "upcoming"
    watch = "watch"


# --- Tables ---

class User(Base):
    """
    Model for users. Stores reputation and auth info.
    """
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[Optional[str]] = mapped_column(String)
    google_id: Mapped[Optional[str]] = mapped_column(String, unique=True, index=True, nullable=True)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reputation_score: Mapped[float] = mapped_column(
        Float, default=0.7, nullable=False
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    reports: Mapped[List["RawReport"]] = relationship(back_populates="user")
    interactions: Mapped[List["PostInteraction"]] = relationship(back_populates="user")
    preferences: Mapped[List["UserPreference"]] = relationship(back_populates="user")
    notification_tokens: Mapped[List["UserNotificationToken"]] = relationship(back_populates="user")

    __table_args__ = (
        CheckConstraint('reputation_score >= 0.0 AND reputation_score <= 1.0', name='check_reputation_range'),
    )


class EmailVerifications(Base):
    """
    Manages temporary tokens for email verification.
    """
    __tablename__ = "email_verifications"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    token: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Cluster(Base):
    """
    Model for a single, distinct event cluster.
    """
    __tablename__ = "clusters"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())

    # Centroids
    text_centroid: Mapped[Optional[VECTOR]] = mapped_column(VECTOR(512))
    image_centroid: Mapped[Optional[VECTOR]] = mapped_column(VECTOR(512))
    video_centroid: Mapped[Optional[VECTOR]] = mapped_column(VECTOR(512))

    # Geospatial data
    avg_location: Mapped[Geometry] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    cluster_radius_meters: Mapped[float] = mapped_column(Float, default=1000.0, nullable=False)

    # Status
    report_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[ClusterStatusEnum] = mapped_column(
        PgEnum(ClusterStatusEnum), default=ClusterStatusEnum.active, nullable=False, index=True
    )
    first_report_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_report_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # Link to the *last* post in the thread for this cluster
    last_post_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("posts.id", use_alter=True), nullable=True
    )

    # Aggregate metadata
    dominant_category: Mapped[Optional[str]] = mapped_column(String(100))
    avg_credibility: Mapped[Optional[float]] = mapped_column(Float)
    area_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    area_name_updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Track which cluster this was merged into
    merged_into_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("clusters.id"),
        nullable=True,
        index=True
    )

    # Relationship to track merge history
    merged_into: Mapped[Optional["Cluster"]] = relationship(
        "Cluster",
        remote_side=[id],
        foreign_keys=[merged_into_id],
        back_populates="merged_from"
    )

    # Reverse relationship: clusters that were merged into this one
    merged_from: Mapped[List["Cluster"]] = relationship(
        "Cluster",
        remote_side=[merged_into_id],
        foreign_keys=[merged_into_id],
        back_populates="merged_into"
    )

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    posts: Mapped[List["Post"]] = relationship(
        back_populates="cluster", foreign_keys="Post.cluster_id"
    )
    last_post: Mapped[Optional["Post"]] = relationship(foreign_keys=[last_post_id])
    processed_reports: Mapped[List["ProcessedReport"]] = relationship(
        back_populates="cluster"
    )

    __table_args__ = (
        # GiST index on location
        Index("idx_clusters_avg_location", avg_location, postgresql_using="gist"),
        # Partial GiST index - active clusters only
        Index(
            "idx_clusters_location_active", avg_location,
            postgresql_using="gist",
            postgresql_where="status = 'active'::clusterstatusenum"
        ),
        # HNSW vector indexes for fast ANN search (active clusters only)
        Index(
            "idx_clusters_text_centroid_hnsw", text_centroid,
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"text_centroid": "vector_cosine_ops"},
            postgresql_where="text_centroid IS NOT NULL AND status = 'active'::clusterstatusenum"
        ),
        Index(
            "idx_clusters_image_centroid_hnsw", image_centroid,
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"image_centroid": "vector_cosine_ops"},
            postgresql_where="image_centroid IS NOT NULL AND status = 'active'::clusterstatusenum"
        ),
        Index(
            "idx_clusters_video_centroid_hnsw", video_centroid,
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"video_centroid": "vector_cosine_ops"},
            postgresql_where="video_centroid IS NOT NULL AND status = 'active'::clusterstatusenum"
        ),
        # Composite indexes for common query patterns
        Index(
            "idx_clusters_active_category", "status", "dominant_category",
            postgresql_where="status = 'active'::clusterstatusenum"
        ),
        Index(
            "idx_clusters_category_status", "dominant_category", "status",
            postgresql_where="status = 'active'::clusterstatusenum"
        ),
        Index(
            "idx_clusters_last_report_status", "last_report_at", "status",
            postgresql_where="status = 'active'::clusterstatusenum"
        ),
        Index("idx_clusters_first_report_at", "first_report_at"),
        # Partial index on merged_into_id (only rows that are actually merged)
        Index(
            "idx_clusters_merged_into", "merged_into_id",
            postgresql_where="merged_into_id IS NOT NULL"
        ),
    )


class Event(Base):
    """
    Model for curated events shown in the Discover/Events section.
    """
    __tablename__ = "events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subtitle: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[Optional[str]] = mapped_column(String(100), index=True)
    status: Mapped[EventStatusEnum] = mapped_column(
        PgEnum(EventStatusEnum), default=EventStatusEnum.upcoming, nullable=False, index=True
    )
    start_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(timezone=True))
    location_name: Mapped[Optional[str]] = mapped_column(String(255))
    location: Mapped[Optional[Geometry]] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326)
    )
    attendee_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_events_location", "location", postgresql_using="gist"),
        Index("idx_events_status_start", "status", "start_at"),
    )


class Post(Base):
    """
    Model for an immutable, user-facing post. Part of a thread.
    """
    __tablename__ = "posts"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    content: Mapped[str] = mapped_column(Text, nullable=False)
    credibility_score: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    location: Mapped[Geometry] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    event_category: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[PostStatusEnum] = mapped_column(
        PgEnum(PostStatusEnum), default=PostStatusEnum.active, nullable=False
    )
    embedding: Mapped[Optional[VECTOR]] = mapped_column(VECTOR(768), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # Foreign Keys for threading/linking
    cluster_id: Mapped[UUID] = mapped_column(
        ForeignKey("clusters.id", use_alter=True), index=True, nullable=False
    )
    parent_post_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("posts.id"), nullable=True, index=True
    )

    # Relationships
    cluster: Mapped["Cluster"] = relationship(
        foreign_keys=[cluster_id], back_populates="posts"
    )
    parent_post: Mapped[Optional["Post"]] = relationship(
        "Post", remote_side=[id], back_populates="replies"
    )
    replies: Mapped[List["Post"]] = relationship(
        "Post", back_populates="parent_post"
    )
    interactions: Mapped[List["PostInteraction"]] = relationship(
        back_populates="post"
    )
    contributors: Mapped[List["PostReportContributor"]] = relationship(
        back_populates="post"
    )
    media_items: Mapped[List["PostMedia"]] = relationship(
        back_populates="post"
    )

    __table_args__ = (
        # GiST index on location
        Index("idx_posts_location", location, postgresql_using="gist"),
        # IVFFlat vector index for embedding similarity search
        Index(
            "idx_posts_embedding", "embedding",
            postgresql_using="ivfflat",
            postgresql_with={"lists": 100},
            postgresql_ops={"embedding": "vector_cosine_ops"}
        ),
        # Composite indexes for common query patterns
        Index("idx_posts_cluster_status", "cluster_id", "status"),
        Index("idx_posts_created_status", "created_at", "status"),
        Index("idx_posts_event_category", "event_category"),
    )


class RawReport(Base):
    """
    Model for the initial, unprocessed report as it comes from the user.
    """
    __tablename__ = "raw_reports"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    user_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("users.id"), index=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[Geometry] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    status: Mapped[ReportStatusEnum] = mapped_column(
        PgEnum(ReportStatusEnum), default=ReportStatusEnum.pending, nullable=False, index=True
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    user: Mapped[Optional["User"]] = relationship(back_populates="reports")
    raw_media: Mapped[List["RawMedia"]] = relationship(back_populates="raw_report")
    processed_report: Mapped[Optional["ProcessedReport"]] = relationship(
        back_populates="raw_report"
    )

    __table_args__ = (
        Index("idx_raw_reports_location", location, postgresql_using="gist"),
    )


class RawMedia(Base):
    """
    Links multiple raw media files to a single RawReport.
    """
    __tablename__ = "raw_media"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    raw_report_id: Mapped[UUID] = mapped_column(ForeignKey("raw_reports.id"), index=True, nullable=False)
    media_type: Mapped[MediaTypeEnum] = mapped_column(PgEnum(MediaTypeEnum), nullable=False)
    storage_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    raw_report: Mapped["RawReport"] = relationship(back_populates="raw_media")
    processed_media_item: Mapped[Optional["ProcessedMedia"]] = relationship(
        back_populates="raw_media_item"
    )


class ProcessedReport(Base):
    """
    Model for the enriched, validated, and embedded report.
    This is the "golden source" for clustering.
    """
    __tablename__ = "processed_reports"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    raw_report_id: Mapped[UUID] = mapped_column(ForeignKey("raw_reports.id"), unique=True, nullable=False)
    user_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("users.id"), index=True)
    cluster_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("clusters.id"), index=True
    )
    post_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("posts.id"), nullable=True, index=True
    )

    cleaned_text: Mapped[Optional[str]] = mapped_column(Text)
    event_category: Mapped[Optional[str]] = mapped_column(String(100), index=True)
    credibility_score: Mapped[float] = mapped_column(Float, index=True, nullable=False)
    text_embedding: Mapped[Optional[VECTOR]] = mapped_column(VECTOR(512))

    # Aggregate scores from text + all processed media
    avg_spam_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    avg_ai_media_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    consistency_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Copied from raw report for faster clustering
    location: Mapped[Geometry] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    report_created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    processed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    raw_report: Mapped["RawReport"] = relationship(back_populates="processed_report")
    cluster: Mapped[Optional["Cluster"]] = relationship(
        back_populates="processed_reports"
    )
    processed_media: Mapped[List["ProcessedMedia"]] = relationship(
        back_populates="processed_report"
    )
    contribution: Mapped[Optional["PostReportContributor"]] = relationship(
        back_populates="report"
    )

    __table_args__ = (
        CheckConstraint('credibility_score >= 0.0 AND credibility_score <= 1.0', name='check_credibility_range'),
        CheckConstraint('avg_spam_score >= 0.0 AND avg_spam_score <= 1.0', name='check_spam_range'),
        CheckConstraint('avg_ai_media_score >= 0.0 AND avg_ai_media_score <= 1.0', name='check_ai_range'),
        CheckConstraint('consistency_score >= 0.0 AND consistency_score <= 1.0', name='check_consistency_range'),
        # GiST index on location
        Index("idx_processed_reports_location", location, postgresql_using="gist"),
        # HNSW vector index for text embedding similarity search
        Index(
            "idx_processed_reports_text_embedding_hnsw", "text_embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"text_embedding": "vector_cosine_ops"}
        ),
        # Composite index for cluster+post lookups
        Index("idx_processed_cluster_post", "cluster_id", "post_id"),
        # Partial index - only assigned reports
        Index(
            "idx_processed_reports_post_id", "post_id",
            postgresql_where="post_id IS NOT NULL"
        ),
    )


class ProcessedMedia(Base):
    """
    Stores embeddings and validation scores for individual media items.
    """
    __tablename__ = "processed_media"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    processed_report_id: Mapped[UUID] = mapped_column(ForeignKey("processed_reports.id"), index=True, nullable=False)
    raw_media_id: Mapped[UUID] = mapped_column(ForeignKey("raw_media.id"), nullable=False)

    media_type: Mapped[MediaTypeEnum] = mapped_column(PgEnum(MediaTypeEnum), nullable=False)
    embedding: Mapped[Optional[VECTOR]] = mapped_column(VECTOR(512))
    spam_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    ai_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[ProcessedMediaStatusEnum] = mapped_column(
        PgEnum(ProcessedMediaStatusEnum), default=ProcessedMediaStatusEnum.processed, nullable=False
    )
    processed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    processed_report: Mapped["ProcessedReport"] = relationship(
        back_populates="processed_media"
    )
    raw_media_item: Mapped["RawMedia"] = relationship(
        back_populates="processed_media_item"
    )
    post_links: Mapped[List["PostMedia"]] = relationship(
        back_populates="processed_media_item"
    )

    __table_args__ = (
        # HNSW vector index for media embedding similarity search
        Index(
            "idx_processed_media_embedding_hnsw", "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"}
        ),
    )


class PostMedia(Base):
    """
    Links selected, validated ProcessedMedia items to a Post.
    """
    __tablename__ = "post_media"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    post_id: Mapped[UUID] = mapped_column(ForeignKey("posts.id"), index=True, nullable=False)
    processed_media_id: Mapped[UUID] = mapped_column(ForeignKey("processed_media.id"), index=True, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    post: Mapped["Post"] = relationship(back_populates="media_items")
    processed_media_item: Mapped["ProcessedMedia"] = relationship(
        back_populates="post_links"
    )


class PostReportContributor(Base):
    """
    Join table linking Posts to the ProcessedReports that created them.
    Stores the calculated contribution weight for reputation distribution.
    """
    __tablename__ = "post_report_contributors"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    post_id: Mapped[UUID] = mapped_column(ForeignKey("posts.id"), index=True, nullable=False)
    report_id: Mapped[UUID] = mapped_column(ForeignKey("processed_reports.id"), index=True, nullable=False)
    contribution_score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    post: Mapped["Post"] = relationship(back_populates="contributors")
    report: Mapped["ProcessedReport"] = relationship(back_populates="contribution")


class PostInteraction(Base):
    """
    Records user votes and flags on posts.
    """
    __tablename__ = "post_interactions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    post_id: Mapped[UUID] = mapped_column(ForeignKey("posts.id"), index=True, nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)

    interaction_type: Mapped[InteractionEnum] = mapped_column(
        PgEnum(InteractionEnum), index=True, nullable=False
    )
    # Reason text for 'downvote'
    reason: Mapped[Optional[str]] = mapped_column(Text)
    # Specific reason for 'flag'
    flag_reason: Mapped[Optional[FlagReasonEnum]] = mapped_column(
        PgEnum(FlagReasonEnum), nullable=True
    )

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    post: Mapped["Post"] = relationship(back_populates="interactions")
    user: Mapped["User"] = relationship(back_populates="interactions")

    __table_args__ = (
        # Prevent duplicate interactions of the same type by the same user on the same post
        UniqueConstraint("post_id", "user_id", "interaction_type", name="idx_post_interactions_unique"),
        # Composite index for fetching all interactions of a given type on a post
        Index("idx_interactions_post_type", "post_id", "interaction_type"),
    )


class AuditLog(Base):
    """
    Model for logging important system actions for transparency.
    """
    __tablename__ = "audit_logs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    action: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    user_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("users.id"))
    target_type: Mapped[Optional[str]] = mapped_column(String(50), index=True)
    target_id: Mapped[Optional[UUID]] = mapped_column(index=True)
    details: Mapped[Optional[dict]] = mapped_column(Text)  # Storing as Text for simplicity, can be JSONB


class UserPreference(Base):
    """
    Model for storing user category and location preferences with preference scores.
    Real-time preferences based on user interactions (upvotes, downvotes, flags).
    """
    __tablename__ = "user_preferences"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    category: Mapped[Optional[str]] = mapped_column(String(100))
    location: Mapped[Optional[Geometry]] = mapped_column(Geometry(geometry_type="POINT", srid=4326))
    preference_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_interaction_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="preferences")

    __table_args__ = (
        UniqueConstraint("user_id", "category", "location", name="uq_user_category_location"),
        Index("idx_user_pref_score", "user_id", "preference_score"),
        Index("idx_user_preferences_location", "location", postgresql_using="gist"),
    )


class UserNotificationToken(Base):
    """
    Model for storing user device tokens for push notifications.
    """
    __tablename__ = "user_notification_tokens"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    device_token: Mapped[str] = mapped_column(String(2048), nullable=False, unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)  # "android" or "ios"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_used_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True)
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="notification_tokens")

    __table_args__ = (
        Index("idx_user_active_tokens", "user_id", postgresql_where=Text("is_active = true")),
    )


class NotificationLog(Base):
    """
    Model for logging notifications sent to users.
    Audit trail for trending posts and high-engagement notifications.
    """
    __tablename__ = "notification_logs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=func.gen_random_uuid())
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    post_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("posts.id"), index=True)
    cluster_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("clusters.id"), index=True)
    notification_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # "trending_category", "trending_location", "high_engagement"
    title: Mapped[Optional[str]] = mapped_column(Text)
    body: Mapped[Optional[str]] = mapped_column(Text)
    data_payload: Mapped[Optional[dict]] = mapped_column(JSON)
    triggered_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    sent_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # "pending", "sent", "failed"
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_notification_user_triggered", "user_id", "triggered_at"),
    )