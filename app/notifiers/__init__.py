"""通知分发：按渠道列表逐个发送。

user_prefs（可选）用于按用户个性化：
- email: 用该用户的邮箱作为收件人（覆盖系统默认 to_addr）
- webhook: 用该用户自定义的 webhook_url
其它渠道（wechat/feishu）使用系统全局配置。
"""

from .result import NotificationResult
from . import email as email_mod
from . import wechat as wechat_mod
from . import feishu as feishu_mod
from . import webhook as webhook_mod

_DISPATCH = {
    "email": email_mod,
    "wechat": wechat_mod,
    "feishu": feishu_mod,
    "webhook": webhook_mod,
}


def send_all(channels: list, title: str, content: str, cfg: dict, user_prefs: dict | None = None) -> list:
    """返回 [(channel, NotificationResult), ...]"""
    results = []
    up = user_prefs or {}
    for ch in channels or []:
        if ch == "email":
            results.append((ch, email_mod.send(title, content, cfg, override_to=up.get("email"))))
        elif ch == "webhook":
            results.append((ch, webhook_mod.send(title, content, cfg, url=up.get("webhook_url"))))
        else:
            mod = _DISPATCH.get(ch)
            if mod is None:
                results.append((ch, NotificationResult(False, f"未知渠道：{ch}")))
                continue
            results.append((ch, mod.send(title, content, cfg)))
    return results
