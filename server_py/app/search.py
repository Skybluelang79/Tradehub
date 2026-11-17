import logging
import re

from . import db

logger = logging.getLogger("tradehub")

MAX_SEARCH_TERMS = 8


def ensure_index():
    try:
        existing = db.get(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'item_fts'"
        )
        db.script(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS item_fts USING fts5(
              title,
              description,
              category,
              content='items',
              content_rowid='rowid',
              tokenize='unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS item_fts_insert AFTER INSERT ON items BEGIN
              INSERT INTO item_fts(rowid, title, description, category)
              VALUES (new.rowid, new.title, new.description, new.category);
            END;

            CREATE TRIGGER IF NOT EXISTS item_fts_delete AFTER DELETE ON items BEGIN
              INSERT INTO item_fts(item_fts, rowid, title, description, category)
              VALUES ('delete', old.rowid, old.title, old.description, old.category);
            END;

            CREATE TRIGGER IF NOT EXISTS item_fts_update AFTER UPDATE OF title, description, category ON items BEGIN
              INSERT INTO item_fts(item_fts, rowid, title, description, category)
              VALUES ('delete', old.rowid, old.title, old.description, old.category);
              INSERT INTO item_fts(rowid, title, description, category)
              VALUES (new.rowid, new.title, new.description, new.category);
            END;
            """
        )
        if not existing:
            db.run("INSERT INTO item_fts(item_fts) VALUES ('rebuild')")
    except Exception:
        logger.exception("Could not initialize item full-text search index")


def _terms(value):
    return [term.lower() for term in re.findall(r"[^\W_]+", str(value or ""), re.UNICODE)][
        :MAX_SEARCH_TERMS
    ]


def match(search):
    terms = _terms(search)
    if not terms:
        return None
    try:
        exists = db.get(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'item_fts'"
        )
    except Exception:
        exists = None
    if not exists:
        return None
    query = " AND ".join(f'"{term}"*' for term in terms)
    return {
        "join": " JOIN item_fts ON item_fts.rowid = i.rowid ",
        "where": "item_fts MATCH ?",
        "params": [query],
        "rank": "bm25(item_fts)",
    }
