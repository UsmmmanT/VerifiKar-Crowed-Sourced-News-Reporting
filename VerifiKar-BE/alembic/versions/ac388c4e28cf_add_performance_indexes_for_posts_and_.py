"""add_performance_indexes_for_posts_and_interactions

Revision ID: ac388c4e28cf
Revises: f7a8b4c5d6e9
Create Date: 2025-11-25 17:49:24.185040

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ac388c4e28cf'
down_revision: Union[str, Sequence[str], None] = 'f7a8b4c5d6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add performance indexes for posts, post_interactions, and processed_reports."""
    
    # Posts table indexes
    # Index for filtering by created_at and status (feed queries)
    op.create_index(
        'idx_posts_created_status',
        'posts',
        ['created_at', 'status'],
        unique=False
    )
    
    # Index for filtering by cluster_id and status (cluster post lookups)
    op.create_index(
        'idx_posts_cluster_status',
        'posts',
        ['cluster_id', 'status'],
        unique=False
    )
    
    # Index for filtering by event_category (category filters)
    op.create_index(
        'idx_posts_event_category',
        'posts',
        ['event_category'],
        unique=False
    )
    
    # PostInteractions table index
    # Index for counting votes by post and interaction type
    op.create_index(
        'idx_interactions_post_type',
        'post_interactions',
        ['post_id', 'interaction_type'],
        unique=False
    )
    
    # ProcessedReports table indexes
    # Index for finding reports by cluster and post (post generation queries)
    op.create_index(
        'idx_processed_cluster_post',
        'processed_reports',
        ['cluster_id', 'post_id'],
        unique=False
    )
    
    # Index for filtering by event_category (category matching in clustering)
    op.create_index(
        'idx_processed_event_category',
        'processed_reports',
        ['event_category'],
        unique=False
    )


def downgrade() -> None:
    """Remove performance indexes."""
    
    # Drop indexes in reverse order
    op.drop_index('idx_processed_event_category', table_name='processed_reports')
    op.drop_index('idx_processed_cluster_post', table_name='processed_reports')
    op.drop_index('idx_interactions_post_type', table_name='post_interactions')
    op.drop_index('idx_posts_event_category', table_name='posts')
    op.drop_index('idx_posts_cluster_status', table_name='posts')
    op.drop_index('idx_posts_created_status', table_name='posts')
