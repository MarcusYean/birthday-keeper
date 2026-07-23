"""通知分发：按渠道列表逐个发送。"""

from .result import NotificationResult
from . import email as email_mod
from . import wechat as wechat_mod
from . import feishu as feishu_mod

_DISPATCH = {
    "email": email_mod,
    "wechat": wechat_mod,
    "feishu": feishu_mod,
}


def send_all(channels: list, title: str, content: str, cfg: dict) -> list:
    """返回 [(channel, NotificationResult), ...]"""
    results = []
    for ch in channels or []:
        mod = _DISPATCH.get(ch)
        if mod is None:
            results.append((ch, NotificationResult(False, f"未知渠道：{ch}")))
            continue
        results.append((ch, mod.send(title, content, cfg)))
    return results
