"""calendar reminder emails

Revision ID: a1c3e5f70b21
Revises: 9bec6e078485
Create Date: 2026-11-12 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1c3e5f70b21'
down_revision: Union[str, Sequence[str], None] = '9bec6e078485'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('calendar_events') as batch:
        batch.add_column(sa.Column('reminded_at', sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('reminder_emails', sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.drop_column('reminder_emails')
    with op.batch_alter_table('calendar_events') as batch:
        batch.drop_column('reminded_at')
