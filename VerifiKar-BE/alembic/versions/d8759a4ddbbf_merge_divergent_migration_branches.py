"""Merge divergent migration branches

Revision ID: d8759a4ddbbf
Revises: a1b2c3d4e5f6, ac9f3d923fb1, b3c1d2e4f5a6
Create Date: 2026-05-02 18:54:27.638277

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8759a4ddbbf'
down_revision: Union[str, Sequence[str], None] = ('a1b2c3d4e5f6', 'ac9f3d923fb1', 'b3c1d2e4f5a6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
