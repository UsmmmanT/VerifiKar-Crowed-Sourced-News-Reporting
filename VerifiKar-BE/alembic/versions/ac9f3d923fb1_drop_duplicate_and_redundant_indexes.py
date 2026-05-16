"""drop_duplicate_and_redundant_indexes

Revision ID: ac9f3d923fb1
Revises: ac388c4e28cf
Create Date: 2025-11-25 18:13:07.327560

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ac9f3d923fb1'
down_revision: Union[str, Sequence[str], None] = 'ac388c4e28cf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop duplicate and redundant indexes.
    
    EXACT DUPLICATE (safe to drop):
    - idx_processed_event_category: Duplicate of ix_processed_reports_event_category
    
    REDUNDANT SINGLE-COLUMN INDEXES (covered by composite indexes):
    - ix_post_interactions_post_id: Covered by idx_interactions_post_type (post_id, interaction_type)
    - ix_posts_cluster_id: Covered by idx_posts_cluster_status (cluster_id, status)
    - ix_posts_created_at: Covered by idx_posts_created_status (created_at, status)
    - ix_processed_reports_cluster_id: Covered by idx_processed_cluster_post (cluster_id, post_id)
    
    PostgreSQL can use composite index (a, b) for queries filtering on just 'a',
    making the single-column indexes redundant.
    """
    # Drop exact duplicate
    op.drop_index('idx_processed_event_category', table_name='processed_reports')
    
    # Drop redundant single-column indexes (covered by composite indexes)
    op.drop_index('ix_post_interactions_post_id', table_name='post_interactions')
    op.drop_index('ix_posts_cluster_id', table_name='posts')
    op.drop_index('ix_posts_created_at', table_name='posts')
    op.drop_index('ix_processed_reports_cluster_id', table_name='processed_reports')


def downgrade() -> None:
    """Restore dropped indexes."""
    # Restore exact duplicate
    op.create_index('idx_processed_event_category', 'processed_reports', ['event_category'])
    
    # Restore redundant single-column indexes
    op.create_index('ix_post_interactions_post_id', 'post_interactions', ['post_id'])
    op.create_index('ix_posts_cluster_id', 'posts', ['cluster_id'])
    op.create_index('ix_posts_created_at', 'posts', ['created_at'])
    op.create_index('ix_processed_reports_cluster_id', 'processed_reports', ['cluster_id'])
