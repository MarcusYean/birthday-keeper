"""每日定时检查：扫描即将到来的生日并通过各渠道发送提醒。"""

import logging
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler

from . import db, lunar, config, notifiers
from .notifiers import messages

log = logging.getLogger("birthday")
_sched = None


def _process_records(records, kind, cfg, today, sent):
    for r in records:
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
        builder = messages.build_reminder if kind == "birthday" else messages.build_anniversary_reminder
        title, content = builder(r, days_until)
        results = notifiers.send_all(channels, title, content, cfg)
        summary = "; ".join(
            f"{c}:{'ok' if res.ok else 'fail'}({res.message})" for c, res in results
        )
        db.mark_notified(*key, summary)
        sent += 1
        log.info("已通知 %s(%s) 通过 %s", r["name"], kind, channels)
    return sent


def check_once(cfg=None) -> int:
    """按「每条记录 × 其可见用户」逐人发送提醒。

    每个用户拥有独立的提醒偏好（渠道 / 提前天数 / 自定义内容），
    互不影响；去重以 (用户, 记录, 年, 天数) 为键，确保每人每年每档只提醒一次。
    """
    cfg = cfg or config.CONFIG
    today = date.today()
    sent = 0

    jobs = db.get_notification_jobs()          # [(record, [viewer_user_id,...]), ...]
    prefs_cache: dict = {}                     # user_id -> prefs

    for r, viewer_ids in jobs:
        if not r.get("enabled", True):
            continue
        target = lunar.next_occurrence(
            r["calendar_type"], r["month"], r["day"], bool(r.get("is_leap"))
        )
        if not target:
            continue
        days_until = (target - today).days
        is_anni = "kind" in r and bool(r.get("kind"))   # 纪念日表有 kind 字段；生日表没有
        builder = messages.build_anniversary_reminder if is_anni else messages.build_reminder

        for uid in viewer_ids:
            prefs = prefs_cache.get(uid)
            if prefs is None:
                prefs = db.get_user_prefs(uid)
                prefs_cache[uid] = prefs
            if not prefs.get("enabled"):
                continue
            if days_until not in (prefs.get("advance_days") or []):
                continue
            if db.has_notified_user(uid, r["id"], target.year, days_until):
                continue

            title, content = builder(r, days_until, prefs.get("template_body"))
            channels = list(prefs.get("channels") or ["inapp"])

            # 站内信：写入该用户的收件箱
            if "inapp" in channels:
                db.insert_notification(
                    uid, title, content, r["id"],
                    "anniversary" if is_anni else "birthday",
                )

            external = [c for c in channels if c != "inapp"]
            summary = "未选择外部渠道"
            if external:
                results = notifiers.send_all(external, title, content, cfg, user_prefs=prefs)
                summary = "; ".join(
                    f"{c}:{'ok' if res.ok else 'fail'}({res.message})" for c, res in results
                )
            db.mark_notified_user(uid, r["id"], target.year, days_until, summary)
            sent += 1
            log.info("已为用户 %s 通知 %s(%s) 通过 %s", uid, r["name"], "纪念日" if is_anni else "生日", channels)
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
