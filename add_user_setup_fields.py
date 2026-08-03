#!/usr/bin/env python3
"""
Add setup_done and last_checkin_date to user table.
Run on Pi: python3 add_user_setup_fields.py
"""

import sqlite3
import os

DB_PATH = os.path.expanduser("~/varv-server/varv.db")


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Check existing columns
    cur.execute("PRAGMA table_info(user)")
    cols = {row[1] for row in cur.fetchall()}

    added = 0
    for col, default in [
        ("setup_done", "0"),
        ("last_checkin_date", "NULL"),
    ]:
        if col not in cols:
            cur.execute(f"ALTER TABLE user ADD COLUMN {col} TEXT DEFAULT {default}")
            added += 1
            print(f"  + {col}")
        else:
            print(f"  = {col} (exists)")

    conn.commit()
    conn.close()
    print(f"\nDone. {added} column(s) added.")


if __name__ == "__main__":
    migrate()
