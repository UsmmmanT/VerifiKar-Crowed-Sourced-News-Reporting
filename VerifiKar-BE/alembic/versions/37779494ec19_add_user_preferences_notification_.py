"""Add user preferences, notification tokens, and notification logs tables

Revision ID: 37779494ec19
Revises: d8759a4ddbbf
Create Date: 2026-05-02 19:09:33.525905

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '37779494ec19'
down_revision: Union[str, Sequence[str], None] = 'd8759a4ddbbf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create notification_logs table
    op.create_table('notification_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('post_id', sa.Uuid(), nullable=True),
    sa.Column('cluster_id', sa.Uuid(), nullable=True),
    sa.Column('notification_type', sa.String(length=50), nullable=False),
    sa.Column('title', sa.Text(), nullable=True),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('data_payload', sa.JSON(), nullable=True),
    sa.Column('triggered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['cluster_id'], ['clusters.id'], ),
    sa.ForeignKeyConstraint(['post_id'], ['posts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_notification_user_triggered ON notification_logs (user_id, triggered_at)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_notification_logs_cluster_id ON notification_logs (cluster_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_notification_logs_notification_type ON notification_logs (notification_type)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_notification_logs_post_id ON notification_logs (post_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_notification_logs_status ON notification_logs (status)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_notification_logs_user_id ON notification_logs (user_id)"))
    
    # Create user_notification_tokens table
    op.create_table('user_notification_tokens',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('device_token', sa.String(length=2048), nullable=False),
    sa.Column('platform', sa.String(length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_notification_tokens_user_id ON user_notification_tokens (user_id)"))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_notification_tokens_device_token ON user_notification_tokens (device_token)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_user_active_tokens ON user_notification_tokens (user_id) WHERE is_active = true"))
    
    # Create user_preferences table
    op.create_table('user_preferences',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('category', sa.String(length=100), nullable=True),
    sa.Column('location', geoalchemy2.types.Geometry(geometry_type='POINT', srid=4326, dimension=2, from_text='ST_GeomFromEWKT', name='geometry'), nullable=True),
    sa.Column('preference_score', sa.Float(), nullable=False),
    sa.Column('last_interaction_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'category', 'location', name='uq_user_category_location')
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_user_preferences_user_id ON user_preferences (user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_user_pref_score ON user_preferences (user_id, preference_score)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS idx_user_preferences_location ON user_preferences USING gist (location)"))


def downgrade() -> None:
    """Downgrade schema."""
    # Drop all tables in reverse order
    op.drop_table('user_preferences')
    op.drop_table('user_notification_tokens')
    op.drop_table('notification_logs')
