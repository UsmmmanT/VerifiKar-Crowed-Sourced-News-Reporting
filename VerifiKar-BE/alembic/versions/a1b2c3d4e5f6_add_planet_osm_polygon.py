"""Add planet_osm_polygon table for administrative boundaries.

Revision ID: a1b2c3d4e5f6
Revises: f7a8b4c5d6e9
Create Date: 2026-05-02 17:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geometry


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f7a8b4c5d6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create planet_osm_polygon table with required columns for trending locations."""
    # Check if table already exists
    op.execute("""
        CREATE TABLE IF NOT EXISTS planet_osm_polygon (
            id BIGSERIAL PRIMARY KEY,
            osm_id BIGINT UNIQUE NOT NULL,
            name VARCHAR(255),
            boundary VARCHAR(50),
            admin_level VARCHAR(10),
            way geometry(POLYGON, 3857) NOT NULL,
            tags JSON,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )
    """)
    
    # Create spatial index for performance (if not exists)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way 
        ON planet_osm_polygon USING GIST (way)
    """)
    
    # Create basic indexes
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_name 
        ON planet_osm_polygon (name)
    """)
    
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_boundary 
        ON planet_osm_polygon (boundary)
    """)
    
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_admin_level 
        ON planet_osm_polygon (admin_level)
    """)
    
    # Create composite index for trending location queries
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_admin_lookup 
        ON planet_osm_polygon (boundary, admin_level, name)
        WHERE boundary = 'administrative' AND admin_level IN ('8', '9', '10')
    """)


def downgrade() -> None:
    """Drop planet_osm_polygon table."""
    op.execute("DROP INDEX IF EXISTS idx_planet_osm_polygon_admin_lookup")
    op.execute("DROP INDEX IF EXISTS idx_planet_osm_polygon_admin_level")
    op.execute("DROP INDEX IF EXISTS idx_planet_osm_polygon_boundary")
    op.execute("DROP INDEX IF EXISTS idx_planet_osm_polygon_name")
    op.execute("DROP INDEX IF EXISTS idx_planet_osm_polygon_way")
    op.execute("DROP TABLE IF EXISTS planet_osm_polygon")
