import json
import uuid
from datetime import datetime

import socketio

from . import config, db
from .security import decode_token
from .routers.chat import (
    _row_to_message,
    _message_preview,
    _attachments_for,
    _other_participant,
    _is_blocked,
)

online_users = {}
active_calls = {}

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=config.allowed_origins() or "*",
)


def _is_conversation_member(conversation_id, user_id):
    conv = db.get(
        "SELECT buyer_id, seller_id FROM conversations WHERE id = ?",
        (conversation_id,),
    )
    return bool(conv) and (conv["buyer_id"] == user_id or conv["seller_id"] == user_id)


def _is_recipient_in_room(conversation_id, recipient_id):
    socket_id = online_users.get(recipient_id)
    if not socket_id:
        return False
    try:
        return f"conv:{conversation_id}" in sio.rooms(socket_id)
    except Exception:
        return False


async def _current_user(sid):
    session = await sio.get_session(sid)
    return session.get("user")


async def _emit_to_call_participants(call_id, event, payload):
    call = active_calls.get(call_id)
    if not call:
        return
    caller_socket = online_users.get(call["callerId"])
    callee_socket = online_users.get(call["calleeId"])
    if caller_socket:
        await sio.emit(event, payload, to=caller_socket)
    if callee_socket:
        await sio.emit(event, payload, to=callee_socket)


def _format_call_summary(kind, status, duration_seconds):
    label = "Video call" if kind == "video" else "Voice call"
    if status == "missed" or (status == "rejected" and not duration_seconds):
        return f"{label} · missed"
    if status == "cancelled":
        return f"{label} · cancelled"
    if duration_seconds:
        mins = duration_seconds // 60
        secs = duration_seconds % 60
        return f"{label} · {mins}m {secs}s"
    return f"{label} · ended"


def _insert_system_call_message(conversation, caller_id, text):
    message_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO messages (id, conversation_id, sender_id, text, type) "
        "VALUES (?, ?, ?, ?, 'call')",
        (message_id, conversation["id"], caller_id, text),
    )
    db.run(
        "UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?",
        (f"📞 {text}", conversation["id"]),
    )
    raw = db.get(
        "SELECT m.*, u.name as sender_name, u.avatar as sender_avatar "
        "FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?",
        (message_id,),
    )
    return _row_to_message(raw)


async def connect(sid, environ, auth):
    token = (auth or {}).get("token")
    if not token:
        raise socketio.exceptions.ConnectionRefusedError("Authentication required")
    try:
        decoded = decode_token(token)
        user = db.get(
            "SELECT id, name, avatar FROM users WHERE id = ?",
            (decoded.get("userId"),),
        )
        if not user:
            raise socketio.exceptions.ConnectionRefusedError("User not found")
    except socketio.exceptions.ConnectionRefusedError:
        raise
    except Exception:
        raise socketio.exceptions.ConnectionRefusedError("Invalid token")

    await sio.save_session(sid, {"user": user})
    online_users[user["id"]] = sid
    await sio.emit("online_users", list(online_users.keys()))


async def _join_conversation(sid, conversation_id):
    user = await _current_user(sid)
    if not _is_conversation_member(conversation_id, user["id"]):
        await sio.emit(
            "conversation_error",
            {"error": "Not authorized to join this conversation"},
            to=sid,
        )
        return
    await sio.enter_room(sid, f"conv:{conversation_id}")
    db.run(
        "UPDATE messages SET delivered = 1 "
        "WHERE conversation_id = ? AND sender_id != ? AND delivered = 0",
        (conversation_id, user["id"]),
    )
    await sio.emit(
        "messages_delivered",
        {"conversationId": conversation_id, "userId": user["id"]},
        room=f"conv:{conversation_id}",
        skip_sid=sid,
    )


async def _leave_conversation(sid, conversation_id):
    await sio.leave_room(sid, f"conv:{conversation_id}")


async def _send_message(sid, data):
    data = data or {}
    conversation_id = data.get("conversationId")
    text = data.get("text")
    encrypted = data.get("encrypted")
    ciphertext = data.get("ciphertext")
    iv = data.get("iv")
    msg_type = data.get("type") or "text"
    attachments = data.get("attachments") or []
    reply_to = data.get("replyTo")

    is_file = msg_type == "file"
    if not is_file and not (text and text.strip()):
        return

    conversation = db.get(
        "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not conversation:
        await sio.emit("conversation_error", {"error": "Conversation not found"}, to=sid)
        return

    user = await _current_user(sid)
    if not _is_conversation_member(conversation_id, user["id"]):
        await sio.emit(
            "conversation_error",
            {"error": "Not authorized to send messages here"},
            to=sid,
        )
        return

    recipient_id = _other_participant(conversation, user["id"])
    if _is_blocked(user["id"], recipient_id):
        await sio.emit("conversation_error", {"error": "Message blocked"}, to=sid)
        return
    if not is_file and len(text.strip()) > 5000:
        await sio.emit("conversation_error", {"error": "Message too long"}, to=sid)
        return
    if attachments and len(attachments) > 6:
        await sio.emit(
            "conversation_error", {"error": "Too many attachments (max 6)"}, to=sid
        )
        return

    message_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO messages (id, conversation_id, sender_id, text, encrypted, ciphertext, iv, type, reply_to_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            message_id,
            conversation_id,
            user["id"],
            "" if is_file else text.strip(),
            1 if encrypted else 0,
            ciphertext or None,
            iv or None,
            msg_type,
            reply_to or None,
        ),
    )

    for att in attachments or []:
        if not att.get("url"):
            continue
        db.run(
            "INSERT INTO message_attachments (id, message_id, conversation_id, sender_id, kind, url, filename, mime, size) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                message_id,
                conversation_id,
                user["id"],
                att.get("kind") or "image",
                att["url"],
                att.get("filename") or "Attachment",
                att.get("mime") or "",
                int(att.get("size") or 0),
            ),
        )

    preview = _message_preview(msg_type, (text or "").strip(), bool(encrypted), attachments)
    db.run(
        "UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?",
        (preview, conversation_id),
    )

    raw = db.get(
        "SELECT m.*, u.name as sender_name, u.avatar as sender_avatar "
        "FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?",
        (message_id,),
    )

    delivered = _is_recipient_in_room(conversation_id, recipient_id)
    if delivered:
        db.run("UPDATE messages SET delivered = 1 WHERE id = ?", (message_id,))
        raw["delivered"] = 1

    message = _row_to_message(raw)
    await sio.emit("new_message", message, room=f"conv:{conversation_id}")

    if msg_type != "call":
        item = db.get(
            "SELECT title FROM items WHERE id = ?", (conversation["item_id"],)
        )
        recipient_socket = online_users.get(recipient_id)
        if recipient_socket:
            await sio.emit(
                "message_notification",
                {"conversationId": conversation_id, "message": message},
                to=recipient_socket,
            )
        db.run(
            "INSERT INTO notifications (id, user_id, type, title, body, data) "
            "VALUES (?, ?, 'message', 'New Message', ?, ?)",
            (
                str(uuid.uuid4()),
                recipient_id,
                f'New message about "{item["title"] if item else "undefined"}"',
                json.dumps({"conversationId": conversation_id}),
            ),
        )


async def _block_user(sid, data):
    data = data or {}
    conversation_id = data.get("conversationId")
    user = await _current_user(sid)

    if not _is_conversation_member(conversation_id, user["id"]):
        return
    conversation = db.get(
        "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not conversation:
        return
    blocked_id = data.get("userId") or _other_participant(conversation, user["id"])
    if not _is_conversation_member(conversation_id, blocked_id):
        return
    existing = db.get(
        "SELECT * FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?",
        (user["id"], blocked_id),
    )
    if existing:
        return
    db.run(
        "INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)",
        (user["id"], blocked_id),
    )
    db.run(
        "INSERT INTO notifications (id, user_id, type, title, body, data) "
        "VALUES (?, ?, 'system', 'User blocked', 'You blocked this user', ?)",
        (str(uuid.uuid4()), user["id"], json.dumps({"userId": blocked_id})),
    )
    await sio.emit(
        "block_success",
        {"conversationId": conversation_id, "userId": blocked_id},
        to=sid,
    )


async def _report_user(sid, data):
    data = data or {}
    conversation_id = data.get("conversationId")
    reason = data.get("reason")
    description = data.get("description") or ""

    user = await _current_user(sid)
    if not _is_conversation_member(conversation_id, user["id"]):
        return
    if not reason or len(reason.strip()) < 2:
        await sio.emit("conversation_error", {"error": "A reason is required"}, to=sid)
        return
    conversation = db.get(
        "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not conversation:
        return
    reported_id = _other_participant(conversation, user["id"])
    if not _is_conversation_member(conversation_id, reported_id):
        return
    report_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO user_reports (id, reported_user_id, reporter_id, reason, description, status) "
        "VALUES (?, ?, ?, ?, ?, 'pending')",
        (
            report_id,
            reported_id,
            user["id"],
            reason.strip(),
            (description or "").strip(),
        ),
    )
    await sio.emit(
        "report_success", {"reportId": report_id, "userId": reported_id}, to=sid
    )


async def _typing_start(sid, conversation_id):
    user = await _current_user(sid)
    if not _is_conversation_member(conversation_id, user["id"]):
        return
    await sio.emit(
        "user_typing",
        {"userId": user["id"], "name": user["name"]},
        room=f"conv:{conversation_id}",
        skip_sid=sid,
    )


async def _typing_stop(sid, conversation_id):
    user = await _current_user(sid)
    if not _is_conversation_member(conversation_id, user["id"]):
        return
    await sio.emit(
        "user_stop_typing",
        {"userId": user["id"]},
        room=f"conv:{conversation_id}",
        skip_sid=sid,
    )


async def _mark_read(sid, conversation_id):
    user = await _current_user(sid)
    if not _is_conversation_member(conversation_id, user["id"]):
        return
    db.run(
        "UPDATE messages SET read = 1, delivered = 1 "
        "WHERE conversation_id = ? AND sender_id != ? AND read = 0",
        (conversation_id, user["id"]),
    )
    await sio.emit(
        "messages_read",
        {"userId": user["id"]},
        room=f"conv:{conversation_id}",
    )


async def _call_user(sid, data):
    data = data or {}
    conversation_id = data.get("conversationId")
    kind = data.get("kind") or "audio"
    call_id = data.get("callId")
    if not call_id:
        return

    user = await _current_user(sid)
    conversation = db.get(
        "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
    )
    if not conversation or not _is_conversation_member(conversation_id, user["id"]):
        await sio.emit("conversation_error", {"error": "Conversation not found"}, to=sid)
        return
    callee_id = _other_participant(conversation, user["id"])
    if _is_blocked(user["id"], callee_id):
        await sio.emit("conversation_error", {"error": "Call blocked"}, to=sid)
        return
    callee_socket = online_users.get(callee_id)
    if not callee_socket:
        await sio.emit(
            "call_unavailable", {"callId": call_id, "reason": "User offline"}, to=sid
        )
        return

    active_calls[call_id] = {
        "conversationId": conversation_id,
        "callerId": user["id"],
        "calleeId": callee_id,
        "kind": kind,
    }
    db.run(
        "INSERT INTO call_logs (id, conversation_id, caller_id, callee_id, kind, status, started_at) "
        "VALUES (?, ?, ?, ?, ?, 'ringing', datetime('now'))",
        (call_id, conversation_id, user["id"], callee_id, kind),
    )
    item = db.get("SELECT title FROM items WHERE id = ?", (conversation["item_id"],))
    await sio.emit(
        "incoming_call",
        {
            "callId": call_id,
            "conversationId": conversation_id,
            "kind": kind,
            "callerId": user["id"],
            "callerName": user["name"],
            "callerAvatar": user.get("avatar"),
            "itemTitle": item["title"] if item else None,
        },
        to=callee_socket,
    )


async def _call_accept(sid, data):
    data = data or {}
    call_id = data.get("callId")
    call = active_calls.get(call_id)
    if not call:
        return
    user = await _current_user(sid)
    if user["id"] != call["calleeId"]:
        return
    db.run(
        "UPDATE call_logs SET status = 'active', answered_at = datetime('now') WHERE id = ?",
        (call_id,),
    )
    await _emit_to_call_participants(call_id, "call_accepted", {"callId": call_id})


async def _call_reject(sid, data):
    data = data or {}
    call_id = data.get("callId")
    call = active_calls.get(call_id)
    if not call:
        return
    user = await _current_user(sid)
    if user["id"] != call["calleeId"]:
        return
    db.run(
        "UPDATE call_logs SET status = 'rejected', ended_at = datetime('now') WHERE id = ?",
        (call_id,),
    )
    conversation = db.get(
        "SELECT * FROM conversations WHERE id = ?", (call["conversationId"],)
    )
    if conversation:
        sys = _insert_system_call_message(
            conversation,
            call["callerId"],
            _format_call_summary(call["kind"], "rejected", 0),
        )
        await sio.emit("new_message", sys, room=f"conv:{call['conversationId']}")
    await _emit_to_call_participants(call_id, "call_rejected", {"callId": call_id})
    active_calls.pop(call_id, None)


async def _call_cancel(sid, data):
    data = data or {}
    call_id = data.get("callId")
    call = active_calls.get(call_id)
    if not call:
        return
    user = await _current_user(sid)
    if user["id"] != call["callerId"]:
        return
    db.run(
        "UPDATE call_logs SET status = 'cancelled', ended_at = datetime('now') WHERE id = ?",
        (call_id,),
    )
    await _emit_to_call_participants(call_id, "call_cancelled", {"callId": call_id})
    active_calls.pop(call_id, None)


async def _call_end(sid, data):
    data = data or {}
    call_id = data.get("callId")
    call = active_calls.get(call_id)
    if not call:
        return

    status = "completed"
    duration_seconds = 0
    row = db.get("SELECT * FROM call_logs WHERE id = ?", (call_id,))
    if row:
        answered_at = row.get("answered_at")
        if answered_at:
            try:
                answered = datetime.strptime(answered_at, "%Y-%m-%d %H:%M:%S")
                elapsed = (datetime.utcnow() - answered).total_seconds()
                duration_seconds = max(1, int(elapsed + 0.5))
            except Exception:
                duration_seconds = 0
        else:
            status = "missed"
        db.run(
            "UPDATE call_logs SET status = ?, ended_at = datetime('now'), duration_seconds = ? WHERE id = ?",
            (status, duration_seconds, call_id),
        )

    conversation = db.get(
        "SELECT * FROM conversations WHERE id = ?", (call["conversationId"],)
    )
    if conversation:
        sys = _insert_system_call_message(
            conversation,
            call["callerId"],
            _format_call_summary(call["kind"], status, duration_seconds),
        )
        await sio.emit("new_message", sys, room=f"conv:{call['conversationId']}")

    await _emit_to_call_participants(
        call_id,
        "call_ended",
        {"callId": call_id, "status": status, "durationSeconds": duration_seconds},
    )
    active_calls.pop(call_id, None)


async def _relay_to_peer(sid, payload, event_name):
    payload = payload or {}
    call_id = payload.get("callId")
    if not call_id:
        return
    call = active_calls.get(call_id)
    if not call:
        return
    user = await _current_user(sid)
    peer_id = (
        call["calleeId"] if user["id"] == call["callerId"] else call["callerId"]
    )
    peer_socket = online_users.get(peer_id)
    if peer_socket:
        await sio.emit(event_name, payload, to=peer_socket)


async def _rtc_offer(sid, payload):
    await _relay_to_peer(sid, payload, "rtc_offer")


async def _rtc_answer(sid, payload):
    await _relay_to_peer(sid, payload, "rtc_answer")


async def _rtc_ice(sid, payload):
    await _relay_to_peer(sid, payload, "rtc_ice")


async def disconnect(sid, reason=None):
    try:
        user = await _current_user(sid)
    except Exception:
        user = None
    if not user:
        return

    user_id = user["id"]
    for call_id, call in list(active_calls.items()):
        if call["callerId"] == user_id or call["calleeId"] == user_id:
            await _emit_to_call_participants(
                call_id,
                "call_ended",
                {"callId": call_id, "status": "disconnected", "durationSeconds": 0},
            )
            active_calls.pop(call_id, None)

    online_users.pop(user_id, None)
    await sio.emit("online_users", list(online_users.keys()))


def register_handlers():
    sio.on("connect", connect)
    sio.on("disconnect", disconnect)

    sio.on("join_conversation", _join_conversation)
    sio.on("leave_conversation", _leave_conversation)
    sio.on("send_message", _send_message)
    sio.on("block_user", _block_user)
    sio.on("report_user", _report_user)
    sio.on("typing_start", _typing_start)
    sio.on("typing_stop", _typing_stop)
    sio.on("mark_read", _mark_read)

    sio.on("call_user", _call_user)
    sio.on("call_accept", _call_accept)
    sio.on("call_reject", _call_reject)
    sio.on("call_cancel", _call_cancel)
    sio.on("call_end", _call_end)

    sio.on("rtc_offer", _rtc_offer)
    sio.on("rtc_answer", _rtc_answer)
    sio.on("rtc_ice", _rtc_ice)


def wrap(asgi_app):
    return socketio.ASGIApp(sio, other_asgi_app=asgi_app)


register_handlers()
