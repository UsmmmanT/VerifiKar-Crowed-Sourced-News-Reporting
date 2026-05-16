"""merge heads

Revision ID: b472a5e1ba3a
Revises: 37779494ec19, c9e1b7a2d6f3
Create Date: 2026-05-12 17:35:19.691014

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b472a5e1ba3a'
down_revision: Union[str, Sequence[str], None] = ('37779494ec19', 'c9e1b7a2d6f3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
