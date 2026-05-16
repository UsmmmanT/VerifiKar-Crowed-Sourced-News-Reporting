"""Add performance indexes for clustering and merging

Revision ID: 2a3f2f454faf
Revises: 66aacac24eef
Create Date: 2025-11-18 16:34:26.895273

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a3f2f454faf'
down_revision: Union[str, Sequence[str], None] = '66aacac24eef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    # Index for spatial queries on active clusters (used in clustering & merging)
    op.execute("""
        CREATE INDEX idx_clusters_location_active 
        ON clusters USING GIST (avg_location) 
        WHERE status = 'active'
    """)
    
    # Index for category filtering on active clusters
    op.execute("""
        CREATE INDEX idx_clusters_category_status 
        ON clusters (dominant_category, status) 
        WHERE status = 'active'
    """)
    
    # Index for aging queries (finding old clusters)
    op.execute("""
        CREATE INDEX idx_clusters_last_report_status 
        ON clusters (last_report_at, status) 
        WHERE status = 'active'
    """)
    
    # Index for temporal comparisons in merging
    op.create_index(
        'idx_clusters_first_report_at',
        'clusters',
        ['first_report_at']
    )


def downgrade():
    op.drop_index('idx_clusters_location_active', table_name='clusters')
    op.drop_index('idx_clusters_category_status', table_name='clusters')
    op.drop_index('idx_clusters_last_report_status', table_name='clusters')
    op.drop_index('idx_clusters_first_report_at', table_name='clusters')
