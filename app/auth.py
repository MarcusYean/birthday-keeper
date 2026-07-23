"""鉴权工具：密码哈希（pbkdf2，零额外依赖）与令牌会话。"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone


def hash_password(pw: str) -> str:
    """返回 pbkdf2_sha256$iterations$salt_hex$hash_hex。"""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 100_000)
    return f"pbkdf2_sha256$100000${salt.hex()}${dk.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, int(iters))
        return secrets.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def create_token() -> str:
    return secrets.token_urlsafe(32)


def session_expiry(days: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
