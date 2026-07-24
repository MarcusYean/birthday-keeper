"""SQLite 数据层：生日表 + 通知去重日志 + 用户/会话表。

每个调用各自打开连接，避免 FastAPI 线程池下的「跨线程使用 SQLite 对象」错误。
"""

import json
import os
import sqlite3
import threading
from datetime import date, datetime, timezone

from . import auth

DB_PATH = os.environ.get("DB_PATH", "/app/data/birthday.db")
_lock = threading.Lock()

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS birthdays (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        relationship  TEXT,
        gender        TEXT,
        birth_time    TEXT,
        zodiac        TEXT,
        hobbies       TEXT,
        avatar        TEXT,
        mbti          TEXT,
        blood_type    TEXT,
        avatar_path   TEXT,
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
    CREATE TABLE IF NOT EXISTS anniversaries (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        relationship  TEXT,
        kind          TEXT DEFAULT '纪念日',
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

# v2.1 新增列（兼容旧数据库）
_MIGRATIONS = [
    "ALTER TABLE birthdays ADD COLUMN gender TEXT",
    "ALTER TABLE birthdays ADD COLUMN birth_time TEXT",
    "ALTER TABLE birthdays ADD COLUMN zodiac TEXT",
    "ALTER TABLE birthdays ADD COLUMN hobbies TEXT",
    "ALTER TABLE birthdays ADD COLUMN avatar TEXT",
    "ALTER TABLE birthdays ADD COLUMN mbti TEXT",
    "ALTER TABLE birthdays ADD COLUMN blood_type TEXT",
    "ALTER TABLE birthdays ADD COLUMN avatar_path TEXT",
]


def _get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema():
    conn = _get_conn()
    try:
        for stmt in _SCHEMA:
            conn.execute(stmt)
        for stmt in _MIGRATIONS:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as e:
                # 列已存在则忽略
                if "duplicate column name" in str(e).lower():
                    continue
                raise
        conn.commit()
    finally:
        conn.close()


_ensure_schema()


# ---------- 生日计算辅助 ----------

def _zodiac_sign(month: int, day: int) -> str:
    """西方星座（按公历月日）。"""
    boundaries = [
        (1, 20, "水瓶座"), (2, 19, "双鱼座"), (3, 21, "白羊座"),
        (4, 20, "金牛座"), (5, 21, "双子座"), (6, 22, "巨蟹座"),
        (7, 23, "狮子座"), (8, 23, "处女座"), (9, 23, "天秤座"),
        (10, 24, "天蝎座"), (11, 23, "射手座"), (12, 22, "摩羯座"),
    ]
    for m, d, sign in boundaries:
        if (month, day) < (m, d):
            return sign
    return "摩羯座"  # 12.22 以后仍归摩羯


_ZODIAC_ANIMALS = ["猴", "鸡", "狗", "猪", "鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊"]


def _chinese_zodiac(year: int | None) -> str | None:
    if year is None:
        return None
    return _ZODIAC_ANIMALS[year % 12]


def _birthday_stats(r: dict, today: date | None = None) -> dict:
    """为生日记录计算 next_date / days_until / age / days_lived / zodiac / is_today 等。"""
    from . import lunar  # 延迟导入避免循环

    if today is None:
        today = date.today()

    item = dict(r)
    # 派生字段
    target = lunar.next_occurrence(
        item["calendar_type"], item["month"], item["day"], item["is_leap"]
    )
    item["next_date"] = target.isoformat() if target else None
    item["days_until"] = (target - today).days if target else None
    item["is_today"] = item["days_until"] == 0 if target else False
    item["is_passed"] = item["days_until"] is None or item["days_until"] < 0

    # 西方星座：使用生日的公历月日（如果是农历，用当年的公历对应月日）
    z_month, z_day = item["month"], item["day"]
    if target and item["calendar_type"] == "lunar":
        z_month, z_day = target.month, target.day
    item["zodiac"] = item.get("zodiac") or _zodiac_sign(z_month, z_day)

    # 生肖与年龄/已活天数依赖 year
    year = item.get("year")
    item["chinese_zodiac"] = _chinese_zodiac(year)

    if year:
        # 精确出生日期：农历优先按农历年月日转换回公历
        if item["calendar_type"] == "lunar":
            birth_date = lunar._lunar_to_solar(year, item["month"], item["day"], item["is_leap"])
        else:
            birth_date = date(year, item["month"], item["day"])
        if birth_date:
            days_lived = (today - birth_date).days
            item["days_lived"] = max(0, days_lived)
            # 周岁：到今年生日（公历）是否已过
            try:
                this_year_birth = date(today.year, item["month"], item["day"])
            except ValueError:
                this_year_birth = date(today.year, item["month"] + 1, 1)
            age = today.year - year - (1 if today < this_year_birth else 0)
            item["age"] = max(0, age)
            # 下一个生日时的周岁
            item["age_on_next"] = item["age"] + (1 if item["days_until"] is not None and item["days_until"] > 0 else 0)
    else:
        item["days_lived"] = None
        item["age"] = None
        item["age_on_next"] = None

    return item


def _row_to_dict(r) -> dict:
    d = dict(r)
    # 兼容旧数据，JSON 列留空时给空列表
    d["notify_days"] = json.loads(d["notify_days"]) if d.get("notify_days") else []
    d["channels"] = json.loads(d["channels"]) if d.get("channels") else []
    d["is_leap"] = bool(d["is_leap"])
    d["enabled"] = bool(d["enabled"])
    return d


def get_all_birthdays() -> list:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT * FROM birthdays ORDER BY month, day")
        return [_birthday_stats(_row_to_dict(r)) for r in cur.fetchall()]
    finally:
        conn.close()


def get_birthday(bid: int) -> dict | None:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT * FROM birthdays WHERE id=?", (bid,))
        r = cur.fetchone()
        return _birthday_stats(_row_to_dict(r)) if r else None
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
              (name, relationship, gender, birth_time, zodiac, hobbies, avatar,
               mbti, blood_type, avatar_path,
               calendar_type, month, day, year, is_leap,
               notify_days, channels, note, enabled, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                data.get("name"),
                data.get("relationship"),
                data.get("gender"),
                data.get("birth_time"),
                data.get("zodiac"),
                data.get("hobbies"),
                data.get("avatar"),
                data.get("mbti"),
                data.get("blood_type"),
                data.get("avatar_path"),
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
              name=?, relationship=?, gender=?, birth_time=?, zodiac=?, hobbies=?, avatar=?,
              mbti=?, blood_type=?, avatar_path=?,
              calendar_type=?, month=?, day=?, year=?,
              is_leap=?, notify_days=?, channels=?, note=?, enabled=?
            WHERE id=?
            """,
            (
                data.get("name"),
                data.get("relationship"),
                data.get("gender"),
                data.get("birth_time"),
                data.get("zodiac"),
                data.get("hobbies"),
                data.get("avatar"),
                data.get("mbti"),
                data.get("blood_type"),
                data.get("avatar_path"),
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
            item["is_today"] = delta == 0
            out.append(item)
    out.sort(key=lambda x: x["days_until"])
    return out


# ---------- 纪念日 ----------

def _anniversary_stats(r: dict, today: date | None = None) -> dict:
    """为纪念日计算 next_date / days_until / years_passed / is_today 等。"""
    from . import lunar  # 延迟导入避免循环

    if today is None:
        today = date.today()
    item = dict(r)
    target = lunar.next_occurrence(
        item["calendar_type"], item["month"], item["day"], bool(item.get("is_leap"))
    )
    item["next_date"] = target.isoformat() if target else None
    item["days_until"] = (target - today).days if target else None
    item["is_today"] = item["days_until"] == 0 if target else False
    item["is_passed"] = item["days_until"] is None or item["days_until"] < 0

    year = item.get("year")
    if year:
        item["years_passed"] = today.year - year - (1 if (target and today > target) else 0)
        item["years_on_next"] = item["years_passed"] + (1 if item["days_until"] is not None and item["days_until"] > 0 else 0)
    else:
        item["years_passed"] = None
        item["years_on_next"] = None
    return item


def get_all_anniversaries() -> list:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT * FROM anniversaries ORDER BY month, day")
        return [_anniversary_stats(_row_to_dict(r)) for r in cur.fetchall()]
    finally:
        conn.close()


def get_anniversary(aid: int) -> dict | None:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT * FROM anniversaries WHERE id=?", (aid,))
        r = cur.fetchone()
        return _anniversary_stats(_row_to_dict(r)) if r else None
    finally:
        conn.close()


def create_anniversary(data: dict) -> dict:
    data.setdefault("created_at", datetime.now().isoformat())
    data.setdefault("enabled", True)
    data.setdefault("kind", "纪念日")
    conn = _get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO anniversaries
              (name, relationship, kind, calendar_type, month, day, year, is_leap,
               notify_days, channels, note, enabled, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                data.get("name"),
                data.get("relationship"),
                data.get("kind"),
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
        return get_anniversary(cur.lastrowid)
    finally:
        conn.close()


def update_anniversary(aid: int, data: dict) -> dict | None:
    if not get_anniversary(aid):
        return None
    conn = _get_conn()
    try:
        conn.execute(
            """
            UPDATE anniversaries SET
              name=?, relationship=?, kind=?, calendar_type=?, month=?, day=?, year=?,
              is_leap=?, notify_days=?, channels=?, note=?, enabled=?
            WHERE id=?
            """,
            (
                data.get("name"),
                data.get("relationship"),
                data.get("kind"),
                data.get("calendar_type", "solar"),
                data.get("month"),
                data.get("day"),
                data.get("year"),
                int(bool(data.get("is_leap", False))),
                json.dumps(data.get("notify_days") or [], ensure_ascii=False),
                json.dumps(data.get("channels") or [], ensure_ascii=False),
                data.get("note"),
                int(bool(data.get("enabled", True))),
                aid,
            ),
        )
        conn.commit()
        return get_anniversary(aid)
    finally:
        conn.close()


def delete_anniversary(aid: int) -> None:
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM anniversaries WHERE id=?", (aid,))
        conn.commit()
    finally:
        conn.close()


def upcoming_anniversaries(days: int = 60) -> list:
    from . import lunar  # 延迟导入避免循环

    today = date.today()
    out = []
    for r in get_all_anniversaries():
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
            item["is_today"] = delta == 0
            out.append(item)
    out.sort(key=lambda x: x["days_until"])
    return out


def upcoming_combined(days: int = 60) -> list:
    """即将到来：合并生日 + 纪念日，并标注 kind。"""
    b = [dict(x, kind="birthday") for x in upcoming(days)]
    a = [dict(x, kind="anniversary") for x in upcoming_anniversaries(days)]
    out = b + a
    out.sort(key=lambda x: (x["days_until"] if x["days_until"] is not None else 9999))
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
