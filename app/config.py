"""配置加载与持久化。

- 启动时从 /app/data/config.yaml（或仓库内示例路径）合并默认配置。
- 管理员在前台保存设置时调用 save_config() 写回 YAML 并热更新内存中的 CONFIG。
"""

import os
import yaml
from copy import deepcopy

DEFAULT_CONFIG = {
    "app": {
        "port": 8000,
        "timezone": "Asia/Shanghai",
    },
    "notify": {
        "check_hour": 8,
        "check_minute": 0,
        "default_channels": ["wechat", "feishu"],
        "default_notify_days": [1, 3, 7],
    },
    "email": {
        "enabled": False,
        "smtp_host": "",
        "smtp_port": 465,
        "smtp_user": "",
        "smtp_pass": "",
        "use_tls": True,
        "from_addr": "",
        "to_addr": "",
    },
    "wechat": {
        "enabled": False,
        "type": "serverchan",  # serverchan | pushplus | bark
        "token": "",
        "bark_server": "https://api.day.app",
    },
    "feishu": {
        "enabled": False,
        "webhook": "",
        "secret": "",  # 可选：签名校验密钥
    },
}

# 依次查找可写配置路径（容器里挂载在 /app/data）
CONFIG_PATHS = [
    "/app/data/config.yaml",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.yaml"),
]


def _merge(base: dict, override: dict) -> dict:
    out = deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config() -> dict:
    cfg = deepcopy(DEFAULT_CONFIG)
    for p in CONFIG_PATHS:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    user = yaml.safe_load(f) or {}
                cfg = _merge(cfg, user)
            except Exception:
                pass
            break
    return cfg


def _writable_path() -> str:
    d = os.path.dirname(CONFIG_PATHS[0])
    os.makedirs(d, exist_ok=True)
    return CONFIG_PATHS[0]


def save_config(cfg: dict) -> None:
    path = _writable_path()
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)
    reload_config()


def reload_config() -> dict:
    global CONFIG
    CONFIG = load_config()
    return CONFIG


CONFIG = load_config()
