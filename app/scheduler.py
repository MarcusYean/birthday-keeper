"""每日定时检查：扫描即将到来的生日并通过各渠道发送提醒。"""

import logging
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler

from . import db, lunar, config, notifiers
from .notifiers import messages

log = logging.getLogger("birthday")
_sched = None


def build_reminder(record: dict, days_until: int):
    name = record["name"]
    rel = record.get("relationship") or ""
    cal = "农历" if record["calendar_type"] == "lunar" else "公历"
    when = "今天是" if days_until == 0 else f"还有 {days_until} 天是"
    age = f"（{date.today().year - record['year']} 岁）" if record.get("year") else ""
    title = f"🎂 生日提醒：{name}"
    content = (
        f"{when}{name}的生日（{cal}{record['month']}月{record['day']}日）{age}\n"
        f"关系：{rel or '—'}\n备注：{record.get('note') or '—'}"
    )
    return title, content


def check_once(cfg=None) -> int:
    cfg = cfg or config.CONFIG
    today = date.today()
    sent = 0
    for r in db.get_all_birthdays():
        if not r.get("enabled", True):
            continue
        target = lunar.next_occurrence(
            r["calendar_type"], r["month"], r["day"], bool(r.get("is_leap"))
        )
        if not target:
            continue
        days_until = (target - today).days
        notify_days = r.get("notify_days") or cfg["notify"]["default_notify_days"]
        if days_until not in notify_days:
            continue
        key = (r["id"], target.year, days_until)
        if db.has_notified(*key):
            continue
        channels = r.get("channels") or cfg["notify"]["default_channels"]
        title, content = build_reminder(r, days_until)
        results = notifiers.send_all(channels, title, content, cfg)
        summary = "; ".join(
            f"{c}:{'ok' if res.ok else 'fail'}({res.message})" for c, res in results
        )
        db.mark_notified(*key, summary)
        sent += 1
        log.info("已通知 %s 通过 %s", r["name"], channels)
    return sent


def reschedule() -> None:
    """根据最新配置重排每日检查任务（管理员保存设置后调用）。"""
    if _sched is None:
        return
    cfg = config.CONFIG
    _sched.reschedule_job(
        "daily_check",
        trigger="cron",
        hour=int(cfg["notify"]["check_hour"]),
        minute=int(cfg["notify"]["check_minute"]),
    )
    log.info(
        "定时任务已更新：每天 %02d:%02d (%s)",
        int(cfg["notify"]["check_hour"]),
        int(cfg["notify"]["check_minute"]),
        cfg["app"]["timezone"],
    )


def start() -> BackgroundScheduler:
    global _sched
    cfg = config.CONFIG
    _sched = BackgroundScheduler(timezone=cfg["app"]["timezone"])
    _sched.add_job(
        check_once,
        "cron",
        hour=int(cfg["notify"]["check_hour"]),
        minute=int(cfg["notify"]["check_minute"]),
        id="daily_check",
    )
    _sched.start()
    log.info(
        "定时任务已启动：每天 %02d:%02d (%s) 检查",
        int(cfg["notify"]["check_hour"]),
        int(cfg["notify"]["check_minute"]),
        cfg["app"]["timezone"],
    )
    return _sched
