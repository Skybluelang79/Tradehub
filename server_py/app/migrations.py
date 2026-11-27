import logging
from pathlib import Path

from . import db

logger = logging.getLogger("tradehub")


def ensure_column(table, column, definition):
    cols = db.all(f"PRAGMA table_info({table})")
    if not any(col["name"] == column for col in cols):
        db.exec(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def ensure_unique_phone_index():
    for row in db.all(
        """
        SELECT phone FROM users
        WHERE phone IS NOT NULL AND phone != ''
        GROUP BY phone HAVING COUNT(*) > 1
        """
    ):
        phone = row["phone"]
        logger.warning(
            "Duplicate phone %s: keeping the oldest account, clearing the rest so phone sign-in stays unambiguous",
            phone,
        )
        db.exec(
            """
            UPDATE users SET phone = '', phone_verified = 0 WHERE phone = ? AND id NOT IN (
              SELECT id FROM users WHERE phone = ? ORDER BY created_at ASC, id ASC LIMIT 1
            )
            """,
            (phone, phone),
        )
    db.exec(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
        ON users(phone) WHERE phone IS NOT NULL AND phone != '';
        """
    )


def ensure_unique_store_slug_index():
    for row in db.all(
        """
        SELECT store_slug FROM users
        WHERE store_slug IS NOT NULL AND store_slug != ''
        GROUP BY store_slug HAVING COUNT(*) > 1
        """
    ):
        slug = row["store_slug"]
        logger.warning(
            "Duplicate store slug %s: keeping the oldest account, clearing the rest",
            slug,
        )
        db.exec(
            """
            UPDATE users SET store_slug = NULL WHERE store_slug = ? AND id NOT IN (
              SELECT id FROM users WHERE store_slug = ? ORDER BY created_at ASC, id ASC LIMIT 1
            )
            """,
            (slug, slug),
        )
    db.exec(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_store_slug_unique
        ON users(store_slug) WHERE store_slug IS NOT NULL AND store_slug != '';
        """
    )


def seed_platform_settings():
    defaults = {
        "site_name": "TradeHub",
        "support_email": "support@tradehub.app",
        "maintenance_mode": "0",
        "platform_fee_percent": "10",
        "tax_percent": "0",
        "tax_label": "VAT",
        "tax_inclusive": "0",
        "currency": "NGN",
        "terms_url": "",
        "privacy_url": "",
        "about_text": "",
        "ai_enabled": "1",
        "ai_provider": "openai",
        "ai_model": "gpt-4o-mini",
        "ai_base_url": "",
        "ai_api_key": "",
        "ai_prompt_listing": "",
        "ai_prompt_search": "",
        "ai_prompt_question": "",
    }
    for key, value in defaults.items():
        db.run("INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)", (key, value))


def apply():
    db.script(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))

    ensure_column("user_settings", "notif_messages", "INTEGER DEFAULT 1")
    ensure_column("user_settings", "notif_price_drops", "INTEGER DEFAULT 1")
    ensure_column("user_settings", "notif_followers", "INTEGER DEFAULT 1")
    ensure_column("user_settings", "notif_boosts", "INTEGER DEFAULT 1")
    ensure_column("user_settings", "currency", "TEXT DEFAULT 'NGN'")
    ensure_column("users", "avatar", "TEXT DEFAULT ''")
    ensure_column("users", "bio", "TEXT DEFAULT ''")
    ensure_column("users", "phone", "TEXT DEFAULT ''")
    ensure_column("users", "location_lat", "REAL")
    ensure_column("users", "location_lng", "REAL")
    ensure_column("users", "location_address", "TEXT DEFAULT ''")
    ensure_column("users", "is_admin", "INTEGER DEFAULT 0")
    ensure_column("transactions", "order_id", "TEXT")
    ensure_column("transactions", "method", "TEXT DEFAULT 'card'")
    ensure_column("transactions", "provider_ref", "TEXT DEFAULT ''")
    ensure_column("transactions", "fee_amount", "REAL DEFAULT 0")
    ensure_column("transactions", "net_amount", "REAL DEFAULT 0")
    ensure_column("gift_card_brands", "sellable", "INTEGER DEFAULT 0")
    ensure_column("gift_cards", "sold_to", "TEXT")
    ensure_column("gift_cards", "sold_at", "TEXT")
    ensure_column("gift_cards", "payment_reference", "TEXT")
    ensure_column("gift_cards", "brand_id", "TEXT")
    ensure_column("gift_cards", "card_type", "TEXT DEFAULT 'digital'")
    ensure_column("gift_cards", "purchase_cents", "INTEGER")
    ensure_column("gift_cards", "voided_at", "TEXT")
    ensure_column("gift_cards", "voided_by", "TEXT")
    ensure_column("returns", "transaction_id", "TEXT")
    ensure_column("returns", "resolution_note", "TEXT DEFAULT ''")
    ensure_column("returns", "updated_at", "TEXT DEFAULT (datetime('now'))")
    ensure_column("returns", "shipping_label_url", "TEXT DEFAULT ''")
    ensure_column("orders", "shipping_address_json", "TEXT DEFAULT '{}'")
    ensure_column("orders", "billing_address_json", "TEXT DEFAULT '{}'")
    ensure_column("orders", "payment_method", "TEXT DEFAULT ''")
    ensure_column("order_items", "item_title", "TEXT DEFAULT ''")
    ensure_column("order_items", "item_image", "TEXT DEFAULT ''")
    ensure_column("shipments", "updated_at", "TEXT DEFAULT (datetime('now'))")
    ensure_column("users", "status", "TEXT DEFAULT 'active'")
    ensure_column("users", "username", "TEXT DEFAULT ''")
    ensure_column("users", "banned_reason", "TEXT DEFAULT ''")
    ensure_column("transactions", "promo_code", "TEXT DEFAULT ''")
    ensure_column("transactions", "discount_amount", "REAL DEFAULT 0")
    ensure_column("transactions", "original_amount", "REAL DEFAULT 0")
    ensure_column("transactions", "credit_cents", "INTEGER DEFAULT 0")
    ensure_column("transactions", "currency", "TEXT DEFAULT 'NGN'")
    ensure_column("transactions", "paystack_reference", "TEXT")
    ensure_column("transactions", "transaction_reference", "TEXT")
    ensure_column("transactions", "bank_account_number", "TEXT")
    ensure_column("transactions", "bank_account_name", "TEXT")
    ensure_column("transactions", "bank_name", "TEXT")
    ensure_column("transactions", "bank_expires_at", "TEXT")

    ensure_column("payment_methods", "paystack_authorization_code", "TEXT")
    ensure_column("payment_methods", "card_type", "TEXT DEFAULT ''")

    ensure_column("payouts", "currency", "TEXT DEFAULT 'NGN'")
    ensure_column("payouts", "recipient_code", "TEXT")
    ensure_column("payouts", "transfer_code", "TEXT")
    ensure_column("favorites", "price_at_add", "REAL")
    ensure_column("items", "is_auction", "INTEGER DEFAULT 0")
    ensure_column("items", "starting_bid", "REAL")
    ensure_column("items", "min_increment", "REAL DEFAULT 1")
    ensure_column("items", "auction_ends_at", "TEXT")
    ensure_column("items", "auction_status", "TEXT DEFAULT 'pending'")
    ensure_column("items", "current_bid", "REAL")
    ensure_column("items", "current_bidder_id", "TEXT")
    ensure_column("items", "currency", "TEXT DEFAULT 'NGN'")
    ensure_column("items", "video_url", "TEXT")
    ensure_column("items", "expires_at", "TEXT")
    ensure_column("items", "expiry_warned_at", "TEXT")
    ensure_column("items", "is_distress", "INTEGER DEFAULT 0")
    ensure_column("items", "locked_at", "TEXT")
    ensure_column("items", "lock_reason", "TEXT")
    ensure_column("items", "shipping_fee_cents", "INTEGER DEFAULT 0")
    ensure_column("items", "free_shipping_threshold_cents", "INTEGER DEFAULT 0")
    ensure_column("items", "pickup_available", "INTEGER DEFAULT 1")
    ensure_column("items", "processing_days", "INTEGER DEFAULT 2")
    ensure_column("items", "shipping_notes", "TEXT DEFAULT ''")
    ensure_column("orders", "fulfillment_method", "TEXT DEFAULT 'shipping'")
    ensure_column("orders", "shipping_breakdown_json", "TEXT DEFAULT '[]'")
    ensure_column("orders", "tax_breakdown_json", "TEXT DEFAULT '[]'")
    ensure_column("orders", "tax_label", "TEXT DEFAULT ''")
    ensure_column("orders", "tax_rate", "REAL DEFAULT 0")
    ensure_column("orders", "refunded_cents", "INTEGER DEFAULT 0")
    ensure_column("orders", "cancelled_at", "TEXT")
    ensure_column("orders", "invoice_number", "TEXT DEFAULT ''")
    ensure_column("orders", "invoice_issued_at", "TEXT")
    ensure_column("order_items", "variant_option_id", "TEXT DEFAULT ''")
    ensure_column("order_items", "variant_label", "TEXT DEFAULT ''")
    ensure_column("order_items", "refunded_cents", "INTEGER DEFAULT 0")
    ensure_column("shipments", "label_url", "TEXT DEFAULT ''")
    ensure_column("shipments", "label_reference", "TEXT DEFAULT ''")
    ensure_column("transactions", "variant_option_id", "TEXT DEFAULT ''")
    ensure_column("transactions", "variant_label", "TEXT DEFAULT ''")
    ensure_column("transactions", "quantity", "INTEGER DEFAULT 1")
    ensure_column("transactions", "refunded_cents", "INTEGER DEFAULT 0")
    ensure_column("carts", "variant_option_id", "TEXT DEFAULT ''")

    ensure_column("users", "firebase_uid", "TEXT DEFAULT ''")
    ensure_column("users", "auth_provider", "TEXT DEFAULT 'local'")
    ensure_column("users", "paystack_customer_code", "TEXT DEFAULT ''")
    ensure_column("subscriptions", "paystack_reference", "TEXT")
    ensure_column("subscriptions", "pending_plan", "TEXT")
    ensure_column("subscriptions", "paystack_subscription_code", "TEXT")
    ensure_column("subscriptions", "paystack_email_token", "TEXT")
    ensure_column("user_settings", "fcm_token", "TEXT DEFAULT ''")
    ensure_column("items", "sold_to", "TEXT")
    ensure_column("users", "identity_verified", "INTEGER DEFAULT 0")
    ensure_column("users", "store_slug", "TEXT")
    ensure_column("users", "store_banner", "TEXT DEFAULT ''")
    ensure_column("users", "store_description", "TEXT DEFAULT ''")
    ensure_column("users", "referral_code", "TEXT DEFAULT ''")
    ensure_column("users", "public_key", "TEXT DEFAULT ''")
    ensure_column("messages", "type", "TEXT DEFAULT 'text'")
    ensure_column("messages", "delivered", "INTEGER DEFAULT 0")
    ensure_column("messages", "reply_to_id", "TEXT")
    ensure_column("messages", "deleted_for_sender", "INTEGER DEFAULT 0")
    ensure_column("conversations", "is_secure", "INTEGER DEFAULT 0")
    ensure_column("users", "phone_verified", "INTEGER DEFAULT 0")

    ensure_column("support_tickets", "context", "TEXT DEFAULT 'general'")
    ensure_column("support_tickets", "handoff", "INTEGER DEFAULT 0")
    ensure_column("support_tickets", "assigned_admin_id", "TEXT")
    ensure_column("support_tickets", "last_message_at", "TEXT")

    ensure_column("verification_requests", "ai_verdict", "TEXT DEFAULT ''")
    ensure_column("verification_requests", "ai_extracted", "TEXT DEFAULT ''")
    ensure_column("verification_requests", "ai_checks", "TEXT DEFAULT ''")
    ensure_column("saved_searches", "filters", "TEXT")

    db.exec(
        """
        UPDATE user_settings SET currency = 'NGN' WHERE currency IS NULL OR currency = '' OR currency = 'USD';
        UPDATE offers SET currency = 'NGN' WHERE currency IS NULL OR currency = '' OR currency = 'USD';
        UPDATE platform_settings SET value = 'NGN' WHERE key = 'currency' AND (value IS NULL OR value = '' OR value = 'USD');
        UPDATE platform_settings SET value = '10' WHERE key = 'platform_fee_percent' AND value IN ('4', '4.0');
        """
    )

    ensure_unique_phone_index()
    ensure_unique_store_slug_index()
    seed_platform_settings()

    from . import search

    search.ensure_index()
