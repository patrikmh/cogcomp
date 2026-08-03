#!/usr/bin/env python3
"""Idempotent migration: add note/image/tags columns to task + idea tables."""

import sqlite3
import sys
from pathlib import Path

DB_PATH = Path("~/varv-server/varv.db").expanduser()

ADDITIONS = {
    "task": [("note", "TEXT"), ("image", "TEXT")],
    "idea": [("image", "TEXT"), ("tags", "TEXT")],
}


def main():
    if not DB_PATH.exists():
        print(f"ERROR: db not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    for table, cols in ADDITIONS.items():
        cur.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in cur.fetchall()}
        for col, coltype in cols:
            if col in existing:
                print(f"  [{table}] {col} already exists — skip")
                continue
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
            print(f"  [{table}] added {col} {coltype}")
    conn.commit()
    conn.close()
    print("done")


if __name__ == "__main__":
    main()
