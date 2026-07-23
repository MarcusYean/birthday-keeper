"""SQLite 数据层：生日表 + 通知去重日志 + 用户/会话表。

每个调用各自打开连接，避免 FastAPI 线程池下的「跨线程使用 SQLite 对象」错误。
"""

import os
import json
import sqlite3
import threading
from datetime import datetime, date, timezone

from . import auth

DB_PATH = os.environ.get("DB_PATH", "/app/data/birthday.db")
_lock = threading.Lock()

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS birthdays (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        relationship  TEXT,
        calendar_type TEXT NOT NULL DEFAULT 'solar',
        month         INTEGER NOT NULL,
        day           INTEGER NOT NULL,
        year          INTEGER,
        is_leap       INTEGER DEFAULT 0,
        notify_days   TEXT,
        channels      TEXT,
        note          TEXT,
        enabled       INTEGER DEFAULT 1,
        created_at    TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notify_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id   INTEGER,
        target_year INTEGER,
        offset_days INTEGER,
        detail      TEXT,
        sent_at     TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'user',
        created_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        expires_at TEXT NOT NULL
    )
    """,
]


def _get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema():
    conn = _get_conn()
    for stmt in _SCHEMA:
        conn.execute(stmt)
    conn.commit()
    conn.close()


_ensure_schema()


# ---------- 生日 ----------

def _row_to_dict(r) -> dict:
    d = dict(r)
    d["notify_days"] = json.loads(d["notify_days"]) if d.get("notify_days") else []
    d["channels"] = json.loads(d["channels"]) if d.get("channels") else []
    d["is_leap"] = bool(d["is_leap"])
    d["enabled"] = bool(d["enabled"])
    return d


def get_all_birthdays() -> list:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT * FROM birthdays ORDER BY month, day")
        return [_row_to_dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def get_birthday(bid: int) -> dict | None:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT * FROM birthdays WHERE id=?", (bid,))
        r = cur.fetchone()
        return _row_to_dict(r) if r else None
    finally:
        conn.close()


def create_birthday(data: dict) -> dict:
    data.setdefault("created_at", datetime.now().isoformat())
    data.setdefault("enabled", True)
    conn = _get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO birthdays
              (name, relationship, calendar_type, month, day, year, is_leap,
               notify_days, channels, note, enabled, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                data.get("name"),
                data.get("relationship"),
                data.get("calendar_type", "solar"),
                data.get("month"),
                data.get("day"),
                data.get("year"),
                int(bool(data.get("is_leap", False))),
                json.dumps(data.get("notify_days") or [], ensure_ascii=False),
                json.dumps(data.get("channels") or [], ensure_ascii=False),
                data.get("note"),
                int(bool(data.get("enabled", True))),
                data.get("created_at"),
            ),
        )
        conn.commit()
        return get_birthday(cur.lastrowid)
    finally:
        conn.close()


def update_birthday(bid: int, data: dict) -> dict | None:
    if not get_birthday(bid):
        return None
    conn = _get_conn()
    try:
        conn.execute(
            """
            UPDATE birthdays SET
              name=?, relationship=?, calendar_type=?, month=?, day=?, year=?,
              is_leap=?, notify_days=?, channels=?, note=?, enabled=?
            WHERE id=?
            """,
            (
                data.get("name"),
                data.get("relationship"),
                data.get("calendar_type", "solar"),
                data.get("month"),
                data.get("day"),
                data.get("year"),
                int(bool(data.get("is_leap", False))),
                json.dumps(data.get("notify_days") or [], ensure_ascii=False),
                json.dumps(data.get("channels") or [], ensure_ascii=False),
                data.get("note"),
                int(bool(data.get("enabled", True))),
                bid,
            ),
        )
        conn.commit()
        return get_birthday(bid)
    finally:
        conn.close()


def delete_birthday(bid: int) -> None:
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM birthdays WHERE id=?", (bid,))
        conn.execute("DELETE FROM notify_log WHERE record_id=?", (bid,))
        conn.commit()
    finally:
        conn.close()


def has_notified(bid: int, target_year: int, offset: int) -> bool:
    conn = _get_conn()
    try:
        cur = conn.execute(
            "SELECT 1 FROM notify_log WHERE record_id=? AND target_year=? AND offset_days=?",
            (bid, target_year, offset),
        )
        return cur.fetchone() is not None
    finally:
        conn.close()


def mark_notified(bid: int, target_year: int, offset: int, detail: str) -> None:
    conn = _get_conn()
    try:
        with _lock:
            conn.execute(
                "INSERT OR IGNORE INTO notify_log (record_id, target_year, offset_days, detail, sent_at) VALUES (?,?,?,?,?)",
                (bid, target_year, offset, detail, datetime.now().isoformat()),
            )
            conn.commit()
    finally:
        conn.close()


def upcoming(days: int = 30) -> list:
    from . import lunar  # 延迟导入避免循环

    today = date.today()
    out = []
    for r in get_all_birthdays():
        if not r.get("enabled", True):
            continue
        target = lunar.next_occurrence(
            r["calendar_type"], r["month"], r["day"], bool(r.get("is_leap"))
        )
        if not target:
            continue
        delta = (target - today).days
        if 0 <= delta <= days:
            item = dict(r)
            item["next_date"] = target.isoformat()
            item["days_until"] = delta
            out.append(item)
    out.sort(key=lambda x: x["days_until"])
    return out


# ---------- 用户 & 会话 ----------

def count_users() -> int:
    conn = _get_conn()
    try:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        conn.close()


def create_user(username: str, password: str, role: str = "user") -> int:
    conn = _get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO users(username, password, role, created_at) VALUES(?,?,?,?)",
            (username, auth.hash_password(password), role, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_user_by_username(username: str) -> dict | None:
    conn = _get_conn()
    try:
        r = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def get_user_by_id(uid: int) -> dict | None:
    conn = _get_conn()
    try:
        r = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def list_users() -> list:
    conn = _get_conn()
    try:
        rows = conn.execute("SELECT id, username, role, created_at FROM users ORDER BY id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_user(uid: int) -> None:
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
        conn.commit()
    finally:
        conn.close()


def verify_login(username: str, password: str) -> dict | None:
    u = get_user_by_username(username)
    if not u:
        return None
    if not auth.verify_password(password, u["password"]):
        return None
    return u


def create_session(token: str, user_id: int, expires_at: str) -> None:
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO sessions(token, user_id, expires_at) VALUES(?,?,?)",
            (token, user_id, expires_at),
        )
        conn.commit()
    finally:
        conn.close()


def delete_session(token: str) -> None:
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
        conn.commit()
    finally:
        conn.close()


def get_user_from_token(token: str) -> dict | None:
    if not token:
        return None
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT user_id, expires_at FROM sessions WHERE token=?", (token,)
        ).fetchone()
        if not row:
            return None
        exp = datetime.fromisoformat(row["expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            return None
        return get_user_by_id(row["user_id"])
    finally:
        conn.close()
