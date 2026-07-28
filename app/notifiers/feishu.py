"""飞书（Lark）自定义机器人：支持签名校验。"""

import time
import hmac
import hashlib
import base64
import requests

from .result import NotificationResult


def _sign(secret: str, timestamp: str) -> str:
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256
    ).digest()
    return base64.b64encode(hmac_code).decode("utf-8")


def send(title: str, content: str, cfg: dict, user_cfg: dict | None = None) -> NotificationResult:
    # 优先使用用户个人资料里配置的飞书机器人；未配置时回退全局
    f = user_cfg if (isinstance(user_cfg, dict) and user_cfg) else cfg.get("feishu", {})
    if not f.get("enabled"):
        return NotificationResult(False, "飞书未启用")
    url = f.get("webhook")
    if not url:
        return NotificationResult(False, "飞书 webhook 未配置")

    card = {
        "msg_type": "markdown",
        "content": {"text": f"**{title}**\n\n{content}"},
    }

    if f.get("secret"):
        timestamp = str(int(time.time()))
        sign = _sign(f["secret"], timestamp)
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}timestamp={timestamp}&sign={sign}"

    try:
        r = requests.post(url, json=card, timeout=10)
        data = r.json()
        ok = r.status_code == 200 and data.get("code") == 0
        return NotificationResult(ok, data.get("msg") or r.text[:200])
    except Exception as ex:  # noqa: BLE001
        return NotificationResult(False, f"发送失败：{ex}")
