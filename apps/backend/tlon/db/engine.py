"""Connection pool and migrations.

Migrations are plain .sql files applied in filename order and recorded in a table.
Alembic would be the reach for a schema that changes often; this one changes by ADR.
"""

from pathlib import Path

import asyncpg

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


async def create_pool(database_url: str) -> asyncpg.Pool:
    # asyncpg wants postgresql://, but postgres:// is what everything else writes.
    dsn = database_url.replace("postgres://", "postgresql://", 1)
    return await asyncpg.create_pool(dsn, min_size=1, max_size=10, command_timeout=30)


async def run_migrations(pool: asyncpg.Pool) -> list[str]:
    """Apply any migration not yet recorded. Returns the ones applied this run."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name       TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        applied = {row["name"] for row in await conn.fetch("SELECT name FROM schema_migrations")}

        newly_applied: list[str] = []
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            # Each migration and its bookkeeping row commit together, so a crash
            # mid-migration cannot leave it recorded but unapplied.
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute("INSERT INTO schema_migrations (name) VALUES ($1)", path.name)
            newly_applied.append(path.name)

        return newly_applied
