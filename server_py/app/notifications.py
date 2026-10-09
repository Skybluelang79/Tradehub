import uuid

from . import db


def notify(user_id, ntype, title, body, data=None):
    values = (str(uuid.uuid4()), user_id, ntype, title, body)
    if data is not None:
        db.run(
            "INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)",
            values + (data,),
        )
    else:
        db.run(
            "INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)",
            values,
        )