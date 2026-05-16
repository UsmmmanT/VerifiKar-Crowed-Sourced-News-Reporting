"""add area_name columns to clusters

Revision ID: b3c1d2e4f5a6
Revises: 2a3f2f454faf
Create Date: 2026-04-23 16:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3c1d2e4f5a6"
down_revision: Union[str, Sequence[str], None] = "2a3f2f454faf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("clusters", sa.Column("area_name", sa.String(length=255), nullable=True))
    op.add_column("clusters", sa.Column("area_name_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_clusters_area_name"), "clusters", ["area_name"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_clusters_area_name"), table_name="clusters")
    op.drop_column("clusters", "area_name_updated_at")
    op.drop_column("clusters", "area_name")
