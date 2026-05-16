"""Add events table

Revision ID: c9e1b7a2d6f3
Revises: f7a8b4c5d6e9
Create Date: 2026-05-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import geoalchemy2
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9e1b7a2d6f3"
down_revision: Union[str, Sequence[str], None] = "f7a8b4c5d6e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "events" not in inspector.get_table_names():
        op.create_table(
            "events",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("subtitle", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column(
                "status",
                sa.Enum("live", "upcoming", "watch", name="eventstatusenum"),
                server_default=sa.text("'upcoming'::eventstatusenum"),
                nullable=False,
            ),
            sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("location_name", sa.String(length=255), nullable=True),
            sa.Column(
                "location",
                geoalchemy2.types.Geometry(
                    geometry_type="POINT",
                    srid=4326,
                    dimension=2,
                    from_text="ST_GeomFromEWKT",
                    name="geometry",
                    nullable=True,
                ),
                nullable=True,
            ),
            sa.Column("attendee_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("events")}
    if op.f("ix_events_category") not in existing_indexes:
        op.create_index(op.f("ix_events_category"), "events", ["category"], unique=False)
    if op.f("ix_events_start_at") not in existing_indexes:
        op.create_index(op.f("ix_events_start_at"), "events", ["start_at"], unique=False)
    if op.f("ix_events_status") not in existing_indexes:
        op.create_index(op.f("ix_events_status"), "events", ["status"], unique=False)
    if "idx_events_location" not in existing_indexes:
        op.create_index(
            "idx_events_location",
            "events",
            ["location"],
            unique=False,
            postgresql_using="gist",
        )
    if "idx_events_status_start" not in existing_indexes:
        op.create_index(
            "idx_events_status_start",
            "events",
            ["status", "start_at"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_events_status_start", table_name="events")
    op.drop_index("idx_events_location", table_name="events")
    op.drop_index(op.f("ix_events_status"), table_name="events")
    op.drop_index(op.f("ix_events_start_at"), table_name="events")
    op.drop_index(op.f("ix_events_category"), table_name="events")
    op.drop_table("events")
