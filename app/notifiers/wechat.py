"""微信推送：支持 Server酱 / PushPlus / Bark 三种。"""

import requests

from .result import NotificationResult


def send(title: str, content: str, cfg: dict, user_cfg: dict | None = None) -> NotificationResult:
    # 优先使用用户个人资料里配置的微信推送；未配置时回退全局
    w = user_cfg if (isinstance(user_cfg, dict) and user_cfg) else cfg.get("wechat", {})
    if not w.get("enabled"):
        return NotificationResult(False, "微信推送未启用")
    token = w.get("token")
    if not token:
        return NotificationResult(False, "微信推送 token 未配置")

    t = w.get("type", "serverchan")
    try:
        if t == "serverchan":
            url = f"https://sctapi.ftqq.com/{token}.send"
            r = requests.post(url, data={"title": title, "desp": content}, timeout=10)
            data = r.json()
            ok = r.status_code == 200 and data.get("code") == 0
            return NotificationResult(ok, data.get("message") or r.text[:200])
        elif t == "pushplus":
            url = "http://www.pushplus.plus/send"
            r = requests.post(
                url,
                json={"token": token, "title": title, "content": content},
                timeout=10,
            )
            data = r.json()
            ok = r.status_code == 200 and data.get("code") == 200
            return NotificationResult(ok, data.get("msg") or r.text[:200])
        elif t == "bark":
            base = (w.get("bark_server") or "https://api.day.app").rstrip("/")
            url = f"{base}/{token}/{title}/{content}"
            r = requests.get(url, timeout=10)
            return NotificationResult(r.status_code == 200, r.text[:200])
        else:
            return NotificationResult(False, f"未知的微信推送类型：{t}")
    except Exception as ex:  # noqa: BLE001
        return NotificationResult(False, f"发送失败：{ex}")
