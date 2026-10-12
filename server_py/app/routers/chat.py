import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import db
from ..deps import require_user
from ..notifications import notify

router = APIRouter()


def _other_participant(conversation, user_id):
    return conversation["seller_id"] if conversation["buyer_id"] == user_id else conversation["buyer_id"]


def _is_blocked(user_a, user_b):
    row = db.get(
        "SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) "
        "OR (blocker_id = ? AND blocked_id = ?)",
        (user_a, user_b, user_b, user_a),
    )
    return bool(row)


def _message_preview(msg_type, text, encrypted, attachments):
    if msg_type == "file" and attachments:
        att = attachments[0]
        return f"📎 {att.get('filename') or 'Attachment'}"
    if msg_type == "call":
        return text or "Call"
    if encrypted:
        return "🔒 Encrypted message"
    return text or ""


def _ensure_access(conversation_id, user_id):
    conversation = db.get("SELECT * FROM conversations WHERE id = ?", (conversation_id,))
    if not conversation:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found"})
    if conversation["buyer_id"] != user_id and conversation["seller_id"] != user_id:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    return conversation


def _attachments_for(message_id):
    return db.all(
        "SELECT id, kind, url, filename, mime, size FROM message_attachments "
        "WHERE message_id = ? ORDER BY created_at ASC",
        (message_id,),
    )


def _row_to_message(m):
    m = dict(m)
    reply_to = None
    if m.get("reply_to_id"):
        r = db.get(
            "SELECT id, sender_id, text, type, encrypted FROM messages WHERE id = ?",
            (m["reply_to_id"],),
        )
        if r:
            if r["encrypted"]:
                rtext = "🔒 Encrypted message"
            elif r.get("type") == "file":
                rtext = "📎 Attachment"
            else:
                rtext = r["text"]
            reply_to = {"id": r["id"], "senderId": r["sender_id"], "text": rtext}
    return {
        "id": m["id"],
        "conversation_id": m["conversation_id"],
        "sender_id": m["sender_id"],
        "text": m["text"],
        "type": m.get("type") or "text",
        "encrypted": bool(m.get("encrypted")),
        "ciphertext": m.get("ciphertext"),
        "iv": m.get("iv"),
        "read": bool(m.get("read")),
        "delivered": bool(m.get("delivered")),
        "reply_to_id": m.get("reply_to_id"),
        "reply_to": reply_to,
        "created_at": m.get("created_at"),
        "sender_name": m.get("sender_name"),
        "sender_avatar": m.get("sender_avatar"),
        "attachments": _attachments_for(m["id"]),
    }


@router.get("")
def list_conversations(user: dict = Depends(require_user)):
    uid = user["id"]
    conversations = db.all(
        """
        SELECT c.*,
          i.title as item_title, i.price as item_price,
          (SELECT url FROM item_images WHERE item_id = c.item_id ORDER BY sort_order LIMIT 1) as item_image,
          CASE WHEN c.buyer_id = ? THEN u2.name ELSE u1.name END as other_name,
          CASE WHEN c.buyer_id = ? THEN u2.avatar ELSE u1.avatar END as other_avatar,
          CASE WHEN c.buyer_id = ? THEN u2.verified ELSE u1.verified END as other_verified,
          COALESCE(cs.pinned, 0) as pinned, COALESCE(cs.muted, 0) as muted,
          (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND read = 0) as unread_count
        FROM conversations c
        JOIN users u1 ON c.buyer_id = u1.id
        JOIN users u2 ON c.seller_id = u2.id
        JOIN items i ON c.item_id = i.id
        LEFT JOIN conversation_settings cs ON cs.conversation_id = c.id AND cs.user_id = ?
        WHERE c.buyer_id = ? OR c.seller_id = ?
        ORDER BY cs.pinned DESC, c.last_message_time DESC
        """,
        (uid, uid, uid, uid, uid, uid, uid),
    )
    return {"conversations": conversations}


@router.post("", status_code=201)
def create_conversation(user: dict = Depends(require_user), body: dict = Body(...)):
    item_id = body.get("itemId")
    seller_id = body.get("sellerId")

    if not item_id or not seller_id:
        raise HTTPException(status_code=400, detail={"error": "itemId and sellerId are required"})
    if seller_id == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Cannot chat with yourself"})
    if _is_blocked(user["id"], seller_id):
        raise HTTPException(status_code=403, detail={"error": "Unable to start a conversation with this user"})

    item = db.get("SELECT id, title, price, status FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})

    conversation = db.get(
        "SELECT * FROM conversations WHERE item_id = ? AND (buyer_id = ? OR buyer_id = ?)",
        (item_id, user["id"], seller_id),
    )
    if not conversation:
        conversation_id = str(uuid.uuid4())
        db.run(
            "INSERT INTO conversations (id, item_id, buyer_id, seller_id, last_message_time) "
            "VALUES (?, ?, ?, ?, datetime('now'))",
            (conversation_id, item_id, user["id"], seller_id),
        )
        conversation = db.get("SELECT * FROM conversations WHERE id = ?", (conversation_id,))

    other = db.get(
        "SELECT name, avatar, verified FROM users WHERE id = ?",
        (_other_participant(conversation, user["id"]),),
    )
    image = db.get(
        "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1", (item_id,)
    )
    settings = db.get(
        "SELECT pinned, muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?",
        (conversation["id"], user["id"]),
    )

    result = dict(conversation)
    result.update(
        {
            "item_title": item["title"],
            "item_price": item["price"],
            "item_image": image["url"] if image else None,
            "other_name": other["name"] if other else None,
            "other_avatar": other["avatar"] if other else None,
            "other_verified": other["verified"] if other else 0,
            "pinned": settings["pinned"] if settings else 0,
            "muted": settings["muted"] if settings else 0,
            "unread_count": 0,
        }
    )
    return {"conversation": result}


@router.get("/unread/count")
def unread_count(user: dict = Depends(require_user)):
    row = db.get(
        """
        SELECT COUNT(*) as count FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE (c.buyer_id = ? OR c.seller_id = ?) AND m.sender_id != ? AND m.read = 0
        """,
        (user["id"], user["id"], user["id"]),
    )
    return {"count": row["count"] if row else 0}


@router.put("/public-key")
def save_public_key(user: dict = Depends(require_user), body: dict = Body(...)):
    public_key = body.get("publicKey")
    if not public_key or not isinstance(public_key, str) or len(public_key) > 4096:
        raise HTTPException(status_code=400, detail={"error": "A valid public key is required"})
    db.run("UPDATE users SET public_key = ? WHERE id = ?", (public_key, user["id"]))
    return {"success": True}


@router.get("/search")
def search_messages(user: dict = Depends(require_user), q: str = Query(default="")):
    query = (q or "").strip()
    if not query:
        return {"results": []}
    like = f"%{query}%"
    results = db.all(
        """
        SELECT m.id, m.conversation_id, m.sender_id, m.text, m.type, m.encrypted, m.created_at,
          u.name as sender_name,
          CASE WHEN c.buyer_id = ? THEN s.name ELSE b.name END as other_name
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        JOIN users u ON m.sender_id = u.id
        JOIN users b ON c.buyer_id = b.id
        JOIN users s ON c.seller_id = s.id
        WHERE (c.buyer_id = ? OR c.seller_id = ?)
          AND m.encrypted = 0 AND m.type = 'text' AND m.text LIKE ?
        ORDER BY m.created_at DESC LIMIT 50
        """,
        (user["id"], user["id"], user["id"], like),
    )
    return {"results": results}


@router.get("/{conversation_id}/peer-public-key")
def peer_public_key(conversation_id: str, user: dict = Depends(require_user)):
    conversation = _ensure_access(conversation_id, user["id"])
    peer_id = _other_participant(conversation, user["id"])
    peer = db.get("SELECT public_key FROM users WHERE id = ?", (peer_id,))
    return {"publicKey": peer["public_key"] if peer else None, "peerId": peer_id}


@router.get("/{conversation_id}/messages")
def get_messages(conversation_id: str, user: dict = Depends(require_user)):
    _ensure_access(conversation_id, user["id"])
    rows = db.all(
        "SELECT m.*, u.name as sender_name, u.avatar as sender_avatar "
        "FROM messages m JOIN users u ON m.sender_id = u.id "
        "WHERE m.conversation_id = ? ORDER BY m.created_at ASC",
        (conversation_id,),
    )
    db.run(
        "UPDATE messages SET read = 1, delivered = 1 "
        "WHERE conversation_id = ? AND sender_id != ? AND read = 0",
        (conversation_id, user["id"]),
    )
    return {"messages": [_row_to_message(m) for m in rows]}


@router.post("/{conversation_id}/messages", status_code=201)
def send_message(conversation_id: str, user: dict = Depends(require_user), body: dict = Body(...)):
    text = body.get("text") or ""
    encrypted = bool(body.get("encrypted"))
    ciphertext = body.get("ciphertext")
    iv = body.get("iv")
    msg_type = body.get("type") or "text"
    attachments = body.get("attachments") or []
    reply_to = body.get("replyTo")

    is_file = msg_type == "file"
    is_call = msg_type == "call"

    if not is_call and not text and not is_file:
        raise HTTPException(status_code=400, detail={"error": "Message text required"})
    if is_file and (not isinstance(attachments, list) or len(attachments) == 0):
        raise HTTPException(status_code=400, detail={"error": "Attachments required for file messages"})
    if not isinstance(attachments, list) or len(attachments) > 6:
        raise HTTPException(status_code=400, detail={"error": "Too many attachments (max 6)"})

    conversation = _ensure_access(conversation_id, user["id"])
    if _is_blocked(user["id"], _other_participant(conversation, user["id"])):
        raise HTTPException(status_code=403, detail={"error": "Message blocked"})

    trimmed = (text or "").strip()
    message_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO messages (id, conversation_id, sender_id, text, encrypted, ciphertext, iv, type, reply_to_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            message_id, conversation_id, user["id"], "" if is_file else trimmed,
            1 if encrypted else 0, ciphertext or None, iv or None, msg_type, reply_to or None,
        ),
    )

    for att in attachments:
        url = att.get("url")
        if not url:
            continue
        db.run(
            "INSERT INTO message_attachments (id, message_id, conversation_id, sender_id, kind, url, filename, mime, size) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()), message_id, conversation_id, user["id"],
                att.get("kind") or "image", url,
                att.get("filename") or "Attachment", att.get("mime") or "",
                int(att.get("size") or 0),
            ),
        )

    preview = _message_preview(msg_type, trimmed, encrypted, attachments)
    db.run(
        "UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?",
        (preview, conversation_id),
    )

    recipient_id = _other_participant(conversation, user["id"])
    if not is_call:
        item = db.get("SELECT title FROM items WHERE id = ?", (conversation["item_id"],))
        notify(
            recipient_id, "message", "New Message",
            f"New message about \"{item['title'] if item else 'an item'}\"",
            data=_json_data({"conversationId": conversation_id}),
        )

    message = db.get(
        "SELECT m.*, u.name as sender_name, u.avatar as sender_avatar "
        "FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?",
        (message_id,),
    )
    return {"message": _row_to_message(message)}


@router.get("/{conversation_id}/attachments")
def conversation_attachments(conversation_id: str, user: dict = Depends(require_user)):
    _ensure_access(conversation_id, user["id"])
    attachments = db.all(
        "SELECT a.*, u.name as sender_name, m.created_at as message_time "
        "FROM message_attachments a "
        "JOIN messages m ON a.message_id = m.id "
        "JOIN users u ON a.sender_id = u.id "
        "WHERE a.conversation_id = ? ORDER BY a.created_at DESC",
        (conversation_id,),
    )
    return {"attachments": attachments}


@router.get("/{conversation_id}/search")
def search_in_conversation(conversation_id: str, user: dict = Depends(require_user), q: str = Query(default="")):
    _ensure_access(conversation_id, user["id"])
    query = (q or "").strip()
    if not query:
        return {"matches": []}
    like = f"%{query}%"
    matches = db.all(
        "SELECT id, conversation_id, sender_id, text, type, encrypted, created_at "
        "FROM messages WHERE conversation_id = ? AND encrypted = 0 AND type = 'text' AND text LIKE ? "
        "ORDER BY created_at ASC",
        (conversation_id, like),
    )
    return {"matches": matches}


@router.get("/{conversation_id}/export")
def export_conversation(conversation_id: str, user: dict = Depends(require_user)):
    _ensure_access(conversation_id, user["id"])
    rows = db.all(
        "SELECT m.*, u.name as sender_name FROM messages m "
        "JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? ORDER BY m.created_at ASC",
        (conversation_id,),
    )
    messages = [_row_to_message(r) for r in rows]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [f"TradeHub Chat Export — {stamp}", "=" * 60, ""]
    for m in messages:
        name = m.get("sender_name") or "Unknown"
        if m["type"] == "file":
            names = ", ".join(a.get("filename") or "Attachment" for a in m["attachments"]) or "Attachment"
            lines.append(f"[{m['created_at']}] {name}: 📎 {names}")
        elif m["type"] == "call":
            lines.append(f"[{m['created_at']}] {m['text']}")
        elif m["encrypted"]:
            lines.append(f"[{m['created_at']}] {name}: 🔒 Encrypted message")
        else:
            lines.append(f"[{m['created_at']}] {name}: {m['text']}")
    return {"text": "\n".join(lines), "messages": messages}


@router.get("/{conversation_id}/settings")
def get_settings(conversation_id: str, user: dict = Depends(require_user)):
    _ensure_access(conversation_id, user["id"])
    settings = db.get(
        "SELECT pinned, muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?",
        (conversation_id, user["id"]),
    )
    return {"settings": {"pinned": bool(settings["pinned"]) if settings else False,
                         "muted": bool(settings["muted"]) if settings else False}}


@router.put("/{conversation_id}/settings")
def update_settings(conversation_id: str, user: dict = Depends(require_user), body: dict = Body(...)):
    _ensure_access(conversation_id, user["id"])
    current = db.get(
        "SELECT pinned, muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?",
        (conversation_id, user["id"]),
    )
    pinned = int(body["pinned"]) if isinstance(body.get("pinned"), bool) else (current["pinned"] if current else 0)
    muted = int(body["muted"]) if isinstance(body.get("muted"), bool) else (current["muted"] if current else 0)
    db.run(
        "INSERT INTO conversation_settings (conversation_id, user_id, pinned, muted, updated_at) "
        "VALUES (?, ?, ?, ?, datetime('now')) "
        "ON CONFLICT(conversation_id, user_id) DO UPDATE SET pinned = excluded.pinned, "
        "muted = excluded.muted, updated_at = datetime('now')",
        (conversation_id, user["id"], pinned, muted),
    )
    return {"settings": {"pinned": bool(pinned), "muted": bool(muted)}}


@router.post("/{conversation_id}/unsend")
def unsend_message(conversation_id: str, user: dict = Depends(require_user), body: dict = Body(...)):
    message_id = body.get("messageId")
    if not message_id:
        raise HTTPException(status_code=400, detail={"error": "messageId is required"})
    _ensure_access(conversation_id, user["id"])
    message = db.get(
        "SELECT id, sender_id FROM messages WHERE id = ? AND conversation_id = ?",
        (message_id, conversation_id),
    )
    if not message:
        raise HTTPException(status_code=404, detail={"error": "Message not found"})
    if message["sender_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "You can only remove your own messages"})
    db.run("UPDATE messages SET deleted_for_sender = 1 WHERE id = ?", (message_id,))
    return {"success": True}


def _json_data(value):
    import json

    return json.dumps(value)
