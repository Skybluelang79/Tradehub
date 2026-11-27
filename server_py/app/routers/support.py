import json
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import db
from ..deps import require_admin, require_user
from ..notifications import notify

logger = logging.getLogger("tradehub")

router = APIRouter()
admin_router = APIRouter()

CATEGORIES = {"payment", "order", "listing", "account", "safety", "technical", "other"}
CONTEXTS = {"general", "payments", "orders", "listing", "account"}
BOT_ID = "support-bot"
BOT_NAME = "TradeHub Bot"

FAQS = [
    {
        "id": "escrow",
        "category": "payment",
        "question": "How does escrow protect my payment?",
        "answer": "Your payment is held by TradeHub until you confirm that you received the item as described. Only then is the money released to the seller. If something is wrong, open a dispute from Payments before confirming delivery.",
        "keywords": ["escrow", "hold", "held", "safe", "secure", "protection", "buyer protection"],
    },
    {
        "id": "release",
        "category": "order",
        "question": "How do I release payment to the seller?",
        "answer": "Open Payments, find the transaction in Transaction History, then tap Confirm Delivery. Funds are also released automatically after the escrow window if you do not report a problem.",
        "keywords": ["release", "confirm", "delivery", "received", "confirm delivery", "auto release"],
    },
    {
        "id": "payout",
        "category": "payment",
        "question": "When will I receive my payout?",
        "answer": "Payouts are reviewed before they are sent to your bank. You can track each request under Payments → Payouts. Identity verification and two-factor authentication may be required before the first payout.",
        "keywords": ["payout", "withdraw", "withdrawal", "bank", "money", "earnings", "cash out"],
    },
    {
        "id": "wallet",
        "category": "payment",
        "question": "What is store credit and how do I add it?",
        "answer": "Store credit comes from redeemed gift cards or approved refunds. Redeem a code from Payments → Gift Cards & Store Credit, then choose Store Credit at checkout. Credit is applied before any card payment.",
        "keywords": ["credit", "wallet", "gift card", "redeem", "balance", "voucher"],
    },
    {
        "id": "refund",
        "category": "payment",
        "question": "How do I request a refund?",
        "answer": "Open the transaction in Payments and use Refund if it is still in escrow. For completed orders, open a dispute or a return request so our team can review the case before funds move.",
        "keywords": ["refund", "money back", "cancel", "return", "chargeback"],
    },
    {
        "id": "dispute",
        "category": "safety",
        "question": "What should I do if the item is not as described?",
        "answer": "Do not confirm delivery. Open a dispute from the transaction in Payments and add photos or messages as evidence. Funds stay in escrow while our team reviews the case.",
        "keywords": ["dispute", "not as described", "wrong item", "damaged", "scam", "fake", "problem"],
    },
    {
        "id": "meetup",
        "category": "order",
        "question": "How do I arrange a meetup?",
        "answer": "Open the order in Payments and propose a date, time and meeting place under Meetup & Handoff. The other party can accept or decline, and you should confirm delivery only after the handoff is complete.",
        "keywords": ["meetup", "meeting", "handoff", "pickup", "location", "where"],
    },
    {
        "id": "card",
        "category": "technical",
        "question": "Why can't I add or use my card?",
        "answer": "Cards are verified through Paystack's secure popup. Check that card verification was completed, that you are online, and that the card supports online payments. You can also pay by bank transfer or store credit.",
        "keywords": ["card", "paystack", "payment failed", "declined", "add card", "bank transfer"],
    },
]


def faq_answer(text):
    normalized = (text or "").lower()
    best = None
    for faq in FAQS:
        score = sum(1 for keyword in faq["keywords"] if keyword in normalized)
        if score and (best is None or score > best[0]):
            best = (score, faq)
    return best[1] if best else None


def _thread(row, viewer="user"):
    thread = dict(row)
    last = db.get(
        "SELECT text, sender_role, created_at FROM support_messages "
        "WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (thread["id"],),
    )
    unread = db.get(
        "SELECT COUNT(*) as count FROM support_messages "
        "WHERE thread_id = ? AND read_at IS NULL AND sender_role != ?",
        (thread["id"], "user" if viewer == "user" else "admin"),
    )
    thread["last_message"] = last["text"] if last else thread.get("message") or ""
    thread["last_message_role"] = last["sender_role"] if last else "user"
    thread["last_message_at"] = last["created_at"] if last else thread.get("last_message_at")
    thread["unread_count"] = unread["count"] if unread else 0
    thread["handoff"] = bool(thread.get("handoff"))
    return thread


def _message(row):
    message = dict(row)
    message["is_bot"] = message["sender_role"] == "bot"
    if message["sender_role"] == "bot":
        message["sender_name"] = BOT_NAME
    if not message.get("sender_name"):
        message["sender_name"] = "TradeHub Support" if message["sender_role"] == "admin" else "You"
    return message


def _get_thread(thread_id):
    row = db.get(
        "SELECT t.*, u.name as user_name, u.avatar as user_avatar "
        "FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?",
        (thread_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Conversation not found"})
    return row


def _get_owned_thread(thread_id, user):
    thread = _get_thread(thread_id)
    if thread["user_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    return thread


def _messages_for(thread_id):
    rows = db.all(
        "SELECT m.*, u.name as sender_name, u.avatar as sender_avatar "
        "FROM support_messages m LEFT JOIN users u ON u.id = m.sender_id "
        "WHERE m.thread_id = ? ORDER BY m.created_at ASC, m.rowid ASC",
        (thread_id,),
    )
    return [_message(row) for row in rows]


def _touch(thread_id):
    db.run("UPDATE support_tickets SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (thread_id,))


def _insert_message(thread_id, sender_id, role, text):
    message_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO support_messages (id, thread_id, sender_id, sender_role, text) "
        "VALUES (?, ?, ?, ?, ?)",
        (message_id, thread_id, sender_id, role, text),
    )
    _touch(thread_id)
    row = db.get(
        "SELECT m.*, u.name as sender_name, u.avatar as sender_avatar "
        "FROM support_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?",
        (message_id,),
    )
    return _message(row)


def _has_admin_reply(thread_id):
    return bool(db.get("SELECT 1 FROM support_messages WHERE thread_id = ? AND sender_role = 'admin' LIMIT 1", (thread_id,)))


def _auto_reply(thread, text, is_first):
    if thread["handoff"] or _has_admin_reply(thread["id"]):
        return None
    match = faq_answer(text)
    if match:
        reply = f"{match['answer']}\n\nIf that does not solve it, reply and a support agent will take over."
    elif is_first:
        topics = ", ".join(faq["question"] for faq in FAQS[:3])
        reply = (
            "Hi! I'm TradeHub Bot. A support agent has been notified and will join this conversation shortly. "
            f"Common questions include: {topics}."
        )
    else:
        return None
    return _insert_message(thread["id"], BOT_ID, "bot", reply)


def _notify_admins(thread, text):
    try:
        admins = db.all("SELECT id FROM users WHERE is_admin = 1")
    except Exception:
        admins = []
    for admin in admins:
        notify(
            admin["id"],
            "support",
            "New support message",
            f"{thread.get('user_name') or 'A user'}: {text[:120]}",
            data=_json_data({"threadId": thread["id"]}),
        )


async def _broadcast(thread_id, message, event="support_message"):
    from ..realtime import sio

    await sio.emit(event, {"threadId": thread_id, "message": message}, room=f"support:{thread_id}")


def _json_data(value):
    return json.dumps(value)


@router.get("/faq")
def list_faq():
    return {
        "faqs": [
            {"id": f["id"], "category": f["category"], "question": f["question"], "answer": f["answer"]}
            for f in FAQS
        ]
    }


@router.post("/conversations", status_code=201)
async def create_conversation(user: dict = Depends(require_user), body: dict = Body(...)):
    category = str(body.get("category") or "payment").strip()
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail={"error": "Choose a valid category"})
    context = str(body.get("context") or "general").strip()
    if context not in CONTEXTS:
        context = "general"

    message = str(body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail={"error": "Message is required"})
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail={"error": "Message must be 2000 characters or fewer"})
    subject = str(body.get("subject") or "").strip() or f"Support request · {context}"
    if len(subject) > 200:
        raise HTTPException(status_code=400, detail={"error": "Subject must be 200 characters or fewer"})

    thread_id = str(uuid.uuid4())
    handoff = 1 if body.get("human") else 0
    db.run(
        "INSERT INTO support_tickets (id, user_id, category, subject, message, contact_email, status, context, handoff, last_message_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'))",
        (thread_id, user["id"], category, subject, message, user.get("email") or "", context, handoff),
    )
    first = _insert_message(thread_id, user["id"], "user", message)
    thread = _get_thread(thread_id)
    _notify_admins(thread, message)

    auto = None if handoff else _auto_reply(thread, message, True)
    if auto:
        await _broadcast(thread_id, auto)
    await _broadcast(thread_id, first)
    return {
        "conversation": _thread(_get_thread(thread_id)),
        "messages": [first] + ([auto] if auto else []),
    }


@router.get("/conversations")
def list_conversations(user: dict = Depends(require_user)):
    rows = db.all(
        "SELECT t.*, u.name as user_name, u.avatar as user_avatar FROM support_tickets t "
        "JOIN users u ON u.id = t.user_id WHERE t.user_id = ? "
        "ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 50",
        (user["id"],),
    )
    return {"conversations": [_thread(row) for row in rows]}


@router.get("/unread/count")
def unread_count(user: dict = Depends(require_user)):
    row = db.get(
        "SELECT COUNT(*) as count FROM support_messages m "
        "JOIN support_tickets t ON t.id = m.thread_id "
        "WHERE t.user_id = ? AND m.read_at IS NULL AND m.sender_role != 'user'",
        (user["id"],),
    )
    return {"count": row["count"] if row else 0}


@router.get("/conversations/{thread_id}/messages")
def get_messages(thread_id: str, user: dict = Depends(require_user)):
    _get_owned_thread(thread_id, user)
    db.run(
        "UPDATE support_messages SET read_at = datetime('now') "
        "WHERE thread_id = ? AND sender_role != 'user' AND read_at IS NULL",
        (thread_id,),
    )
    return {"messages": _messages_for(thread_id)}


@router.post("/conversations/{thread_id}/read")
def mark_read(thread_id: str, user: dict = Depends(require_user)):
    _get_owned_thread(thread_id, user)
    db.run(
        "UPDATE support_messages SET read_at = datetime('now') "
        "WHERE thread_id = ? AND sender_role != 'user' AND read_at IS NULL",
        (thread_id,),
    )
    return {"success": True}


@router.post("/conversations/{thread_id}/messages", status_code=201)
async def send_message(thread_id: str, user: dict = Depends(require_user), body: dict = Body(...)):
    thread = _get_owned_thread(thread_id, user)
    if thread["status"] == "closed":
        raise HTTPException(status_code=409, detail={"error": "This conversation is closed"})
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail={"error": "Message is required"})
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail={"error": "Message must be 2000 characters or fewer"})

    message = _insert_message(thread_id, user["id"], "user", text)
    _notify_admins(_get_thread(thread_id), text)
    await _broadcast(thread_id, message)

    auto = _auto_reply(_get_thread(thread_id), text, False)
    if auto:
        await _broadcast(thread_id, auto)
    return {"message": message, "autoReply": auto}


@router.post("/conversations/{thread_id}/handoff")
async def request_human(thread_id: str, user: dict = Depends(require_user)):
    thread = _get_owned_thread(thread_id, user)
    if thread["status"] == "closed":
        raise HTTPException(status_code=409, detail={"error": "This conversation is closed"})
    db.run("UPDATE support_tickets SET handoff = 1, updated_at = datetime('now') WHERE id = ?", (thread_id,))
    message = _insert_message(thread_id, BOT_ID, "bot", "You're in the queue for a support agent. We'll reply here as soon as we can.")
    _notify_admins(_get_thread(thread_id), "Human support requested")
    await _broadcast(thread_id, message)
    return {"message": message}


@admin_router.get("/conversations")
def admin_conversations(status: str = Query(default="all"), user: dict = Depends(require_admin)):
    where = ""
    params = []
    if status in ("open", "closed"):
        where = "WHERE t.status = ?"
        params.append(status)
    rows = db.all(
        "SELECT t.*, u.name as user_name, u.avatar as user_avatar FROM support_tickets t "
        "JOIN users u ON u.id = t.user_id " + where + " "
        "ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 100",
        tuple(params),
    )
    return {"conversations": [_thread(row, "admin") for row in rows]}


@admin_router.get("/stats")
def admin_stats(user: dict = Depends(require_admin)):
    open_count = db.get("SELECT COUNT(*) as count FROM support_tickets WHERE status = 'open'")
    unread = db.get(
        "SELECT COUNT(*) as count FROM support_messages m JOIN support_tickets t ON t.id = m.thread_id "
        "WHERE m.read_at IS NULL AND m.sender_role = 'user'"
    )
    return {"open": open_count["count"] if open_count else 0, "unread": unread["count"] if unread else 0}


@admin_router.get("/conversations/{thread_id}/messages")
def admin_messages(thread_id: str, user: dict = Depends(require_admin)):
    _get_thread(thread_id)
    db.run(
        "UPDATE support_messages SET read_at = datetime('now') "
        "WHERE thread_id = ? AND sender_role = 'user' AND read_at IS NULL",
        (thread_id,),
    )
    return {"messages": _messages_for(thread_id)}


@admin_router.post("/conversations/{thread_id}/messages", status_code=201)
async def admin_send(thread_id: str, user: dict = Depends(require_admin), body: dict = Body(...)):
    _get_thread(thread_id)
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail={"error": "Message is required"})
    if len(text) > 2000:
        raise HTTPException(status_code=400, detail={"error": "Message must be 2000 characters or fewer"})
    db.run(
        "UPDATE support_tickets SET assigned_admin_id = ?, status = 'open', updated_at = datetime('now') WHERE id = ?",
        (user["id"], thread_id),
    )
    message = _insert_message(thread_id, user["id"], "admin", text)
    await _broadcast(thread_id, message)
    row = db.get("SELECT user_id FROM support_tickets WHERE id = ?", (thread_id,))
    if row and row["user_id"] != user["id"]:
        notify(
            row["user_id"],
            "support",
            "Reply from TradeHub Support",
            text[:160],
            data=_json_data({"threadId": thread_id}),
        )
    return {"message": message}


@admin_router.put("/conversations/{thread_id}")
def admin_update(thread_id: str, user: dict = Depends(require_admin), body: dict = Body(...)):
    _get_thread(thread_id)
    status = body.get("status")
    if status not in ("open", "closed"):
        raise HTTPException(status_code=400, detail={"error": "Status must be open or closed"})
    db.run(
        "UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?",
        (status, thread_id),
    )
    return {"conversation": _thread(_get_thread(thread_id), "admin")}
