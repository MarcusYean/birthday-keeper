"""邮件通知（SMTP）。零成本、最通用，作为可选渠道。"""

import smtplib
from email.mime.text import MIMEText

from .result import NotificationResult


def send(title: str, content: str, cfg: dict, override_to: str | None = None) -> NotificationResult:
    e = cfg.get("email", {})
    if not e.get("enabled"):
        return NotificationResult(False, "邮件渠道未启用")
    to_addr = (override_to or "").strip() or e.get("to_addr")
    if not e.get("smtp_host") or not to_addr:
        return NotificationResult(False, "邮件未配置（缺少 smtp_host 或收件人）")
    try:
        msg = MIMEText(content, "plain", "utf-8")
        msg["Subject"] = title
        msg["From"] = e.get("from_addr") or e.get("smtp_user")
        msg["To"] = to_addr

        if e.get("use_tls"):
            with smtplib.SMTP_SSL(e["smtp_host"], int(e["smtp_port"])) as s:
                s.login(e["smtp_user"], e["smtp_pass"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(e["smtp_host"], int(e["smtp_port"])) as s:
                s.starttls()
                s.login(e["smtp_user"], e["smtp_pass"])
                s.send_message(msg)
        return NotificationResult(True, "已发送")
    except Exception as ex:  # noqa: BLE001
        return NotificationResult(False, f"发送失败：{ex}")
