"""Add HNSW indexes for vector similarity searches

Revision ID: e5f8a9b3c1d2
Revises: 2a3f2f454faf
Create Date: 2025-11-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f8a9b3c1d2'
down_revision: Union[str, Sequence[str], None] = '2a3f2f454faf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    """
    Add HNSW (Hierarchical Navigable Small World) indexes for fast vector similarity searches.
    
    HNSW is the recommended index type for pgvector as it provides:
    - O(log n) approximate nearest neighbor search instead of O(n) sequential scan
    - Better recall than IVFFlat for most use cases
    - No need for training data (unlike IVFFlat)
    
    Parameters:
    - m=16: Number of bi-directional links per element (default, good balance)
    - ef_construction=64: Size of dynamic candidate list during construction (default)
    
    These indexes will dramatically speed up similarity searches in:
    1. Clustering (task_3) - finding similar clusters for report assignment
    2. Merging (task_merge_clusters) - finding duplicate clusters
    """
    
    # Index on processed_reports.text_embedding
    # Used when: Finding similar reports or comparing text similarity
    op.execute("""
        CREATE INDEX idx_processed_reports_text_embedding_hnsw 
        ON processed_reports 
        USING hnsw (text_embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)
    
    # Index on processed_media.embedding
    # Used when: Finding similar media (images/videos) for deduplication
    op.execute("""
        CREATE INDEX idx_processed_media_embedding_hnsw 
        ON processed_media 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)
    
    # Indexes on clusters centroids
    # Used when: Matching new reports to existing clusters, finding duplicate clusters
    
    # Text centroid index
    op.execute("""
        CREATE INDEX idx_clusters_text_centroid_hnsw 
        ON clusters 
        USING hnsw (text_centroid vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE text_centroid IS NOT NULL AND status = 'active'
    """)
    
    # Image centroid index
    op.execute("""
        CREATE INDEX idx_clusters_image_centroid_hnsw 
        ON clusters 
        USING hnsw (image_centroid vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE image_centroid IS NOT NULL AND status = 'active'
    """)
    
    # Video centroid index
    op.execute("""
        CREATE INDEX idx_clusters_video_centroid_hnsw 
        ON clusters 
        USING hnsw (video_centroid vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE video_centroid IS NOT NULL AND status = 'active'
    """)
    
    print("✓ HNSW indexes created successfully")
    print("Note: Index building may take time on large datasets")


def downgrade():
    """Remove HNSW indexes"""
    op.drop_index('idx_processed_reports_text_embedding_hnsw', table_name='processed_reports')
    op.drop_index('idx_processed_media_embedding_hnsw', table_name='processed_media')
    op.drop_index('idx_clusters_text_centroid_hnsw', table_name='clusters')
    op.drop_index('idx_clusters_image_centroid_hnsw', table_name='clusters')
    op.drop_index('idx_clusters_video_centroid_hnsw', table_name='clusters')
    print("✓ HNSW indexes removed")
