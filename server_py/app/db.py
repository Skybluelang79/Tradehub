import sqlite3
import threading
from pathlib import Path

from . import config
from . import migrations

_conn = None
_lock = threading.RLock()


def connect():
    global _conn
    if _conn is None:
        Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        _conn = conn
        migrations.apply()
    return _conn


def get(sql, params=()):
    with _lock:
        row = connect().execute(sql, params).fetchone()
        return dict(row) if row else None


def all(sql, params=()):
    with _lock:
        rows = connect().execute(sql, params).fetchall()
        return [dict(row) for row in rows]


def run(sql, params=()):
    with _lock:
        conn = connect()
        cursor = conn.execute(sql, params)
        conn.commit()
        return {"changes": cursor.rowcount, "lastInsertRowid": cursor.lastrowid}


def exec(sql, params=()):
    with _lock:
        conn = connect()
        if not params:
            conn.executescript(sql)
        else:
            conn.execute(sql, params)
        conn.commit()


def script(sql):
    with _lock:
        conn = connect()
        conn.executescript(sql)
        conn.commit()