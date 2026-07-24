"""提醒文案构造。"""

from datetime import date


def _age_text(record: dict) -> str:
    if record.get("year"):
        try:
            return f"（{date.today().year - int(record['year'])} 岁）"
        except Exception:
            return ""
    return ""


def build_reminder(record: dict, days_until: int) -> tuple:
    name = record.get("name", "好友")
    cal = "农历" if record.get("calendar_type") == "lunar" else "公历"
    rel = record.get("relationship") or "—"
    note = record.get("note") or "—"
    age = _age_text(record)

    if days_until == 0:
        when = "今天是"
    else:
        when = f"还有 {days_until} 天就是"

    title = f"🎂 生日提醒：{name}"
    content = (
        f"{when}{name}的生日啦{age}\n"
        f"日期：{cal}{record.get('month')}月{record.get('day')}日\n"
        f"关系：{rel}\n"
        f"备注：{note}"
    )
    return title, content


def build_test(record: dict) -> tuple:
    name = record.get("name", "好友")
    title = f"🔔 测试通知：{name}"
    content = (
        f"这是来自「生日管家」的测试消息。\n"
        f"联系人：{name}\n"
        f"若你收到这条消息，说明该渠道配置正确 ✅"
    )
    return title, content


def build_anniversary_test(record: dict) -> tuple:
    name = record.get("name", "纪念日")
    kind = record.get("kind") or "纪念日"
    title = f"🔔 测试通知：{name}"
    content = (
        f"这是来自「生日管家」的纪念日测试消息。\n"
        f"名称：{name}（{kind}）\n"
        f"若你收到这条消息，说明该渠道配置正确 ✅"
    )
    return title, content
