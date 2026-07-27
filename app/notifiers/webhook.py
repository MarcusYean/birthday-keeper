"""通用 Webhook 通知：将标题与正文以 JSON POST 到用户自定义的 URL。

仅当用户在个人提醒设置中填写了 webhook_url 时才会被调用。
"""

import json
import urllib.request
import urllib.error

from .result import NotificationResult


def send(title: str, content: str, cfg: dict, url: str | None = None) -> NotificationResult:
    if not url:
        return NotificationResult(False, "未配置 Webhook 地址")
    payload = json.dumps({"title": title, "content": content}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return NotificationResult(True, f"已发送（HTTP {resp.status}）")
    except urllib.error.HTTPError as ex:
        return NotificationResult(False, f"HTTP 错误 {ex.code}")
    except Exception as ex:  # noqa: BLE001
        return NotificationResult(False, f"发送失败：{ex}")
