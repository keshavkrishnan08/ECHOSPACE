"""Record whether the live run matched its deterministic replay.

Revision ID: 0002
Revises: 0001
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("experiments") as batch:
        batch.add_column(sa.Column("live_run_reproducible", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("experiments") as batch:
        batch.drop_column("live_run_reproducible")
