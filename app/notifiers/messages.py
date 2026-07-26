"""提醒文案构造。

模板从 config.CONFIG['templates'] 读取，支持以下占位变量：
{name} {calendar_type} {month} {day} {year} {relationship} {note}
{days_until} {age} {years_together} {when} {zodiac} {chinese_zodiac} {next_date} {kind}
"""

from datetime import date

from .. import config


DEFAULT_TEMPLATES = {
    "birthday_title": "🎂 生日提醒：{name}",
    "birthday_body": "{when}{name}的生日（{calendar_type}{month}月{day}日）{age}\n关系：{relationship}\n备注：{note}",
    "anniversary_title": "📌 {kind}提醒：{name}",
    "anniversary_body": "{when}{name}的{kind}（{calendar_type}{month}月{day}日）{years_together}\n关系：{relationship}\n备注：{note}",
    "test_title": "🔔 测试通知：{name}",
    "test_body": "这是来自「生日管家」的测试消息。\n联系人：{name}\n若你收到这条消息，说明该渠道配置正确 ✅",
    "anniversary_test_title": "🔔 测试通知：{name}",
    "anniversary_test_body": "这是来自「生日管家」的纪念日测试消息。\n名称：{name}（{kind}）\n若你收到这条消息，说明该渠道配置正确 ✅",
}


class _SafeDict(dict):
    def __missing__(self, key: str):
        return "{" + key + "}"


def _template(key: str, ctx: dict) -> str:
    tmpl = config.CONFIG.get("templates", {}).get(key) or DEFAULT_TEMPLATES[key]
    return tmpl.format_map(_SafeDict(ctx))


def _calendar_text(calendar_type) -> str:
    return "农历" if calendar_type == "lunar" else "公历"


def _age_num(record: dict) -> int | None:
    if record.get("year"):
        try:
            return date.today().year - int(record["year"])
        except Exception:
            return None
    return None


def _age_text(record: dict) -> str:
    n = _age_num(record)
    return f"（{n} 岁）" if n is not None else ""


def _years_num(record: dict) -> int | None:
    if record.get("year"):
        try:
            return date.today().year - int(record["year"])
        except Exception:
            return None
    return None


def _years_text(record: dict) -> str:
    n = _years_num(record)
    return f"（第 {n} 周年）" if n is not None else ""


def _when_text(days_until: int) -> str:
    return "今天是" if days_until == 0 else f"还有 {days_until} 天是"


def _base_ctx(record: dict, days_until: int | None = None) -> dict:
    ctx = {
        "name": record.get("name") or "好友",
        "calendar_type": _calendar_text(record.get("calendar_type")),
        "month": record.get("month") or "",
        "day": record.get("day") or "",
        "year": record.get("year") or "",
        "relationship": record.get("relationship") or "—",
        "note": record.get("note") or "—",
        "zodiac": record.get("zodiac") or "—",
        "chinese_zodiac": record.get("chinese_zodiac") or "—",
        "next_date": record.get("next_date") or "—",
        "days_until": days_until if days_until is not None else "",
        "when": _when_text(days_until) if days_until is not None else "",
    }
    return ctx


def build_reminder(record: dict, days_until: int) -> tuple:
    ctx = _base_ctx(record, days_until)
    age = _age_num(record)
    ctx.update({
        "age": _age_text(record),
        "age_num": age if age is not None else "",
    })
    return _template("birthday_title", ctx), _template("birthday_body", ctx)


def build_anniversary_reminder(record: dict, days_until: int) -> tuple:
    ctx = _base_ctx(record, days_until)
    yrs = _years_num(record)
    ctx.update({
        "kind": record.get("kind") or "纪念日",
        "years_together": _years_text(record),
        "years_together_num": yrs if yrs is not None else "",
    })
    return _template("anniversary_title", ctx), _template("anniversary_body", ctx)


def build_test(record: dict) -> tuple:
    ctx = {
        "name": record.get("name") or "好友",
        "kind": record.get("kind") or "纪念日",
    }
    return _template("test_title", ctx), _template("test_body", ctx)


def build_anniversary_test(record: dict) -> tuple:
    ctx = {
        "name": record.get("name") or "纪念日",
        "kind": record.get("kind") or "纪念日",
    }
    return _template("anniversary_test_title", ctx), _template("anniversary_test_body", ctx)
