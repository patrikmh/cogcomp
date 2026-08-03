"""One-time migration: add scheduled_date column to task table."""

import sqlite3
import sys

DB_PATH = "varv.db"


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if column already exists
    cursor.execute("PRAGMA table_info(task)")
    columns = [col[1] for col in cursor.fetchall()]

    if "scheduled_date" in columns:
        print("✓ scheduled_date column already exists")
        conn.close()
        return

    print("Adding scheduled_date column to task table...")
    cursor.execute("ALTER TABLE task ADD COLUMN scheduled_date TEXT DEFAULT NULL")
    conn.commit()
    conn.close()
    print("✓ Done")


if __name__ == "__main__":
    migrate()
