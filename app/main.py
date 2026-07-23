"""FastAPI 主应用：鉴权 + 生日管理 + 管理员设置/用户管理 + 静态前台。"""

import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import db, config, scheduler, notifiers
from .notifiers import messages
from . import auth as auth_mod

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("birthday")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="生日管家 Birthday Keeper", version="2.0.0")


# ---------- 鉴权依赖 ----------

def get_current_user(authorization: str | None = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.split(" ", 1)[1]
    u = db.get_user_from_token(token)
    if not u:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    return u


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


# ---------- 请求模型 ----------

class LoginIn(BaseModel):
    username: str
    password: str


class SetupIn(BaseModel):
    username: str
    password: str


class UserIn(BaseModel):
    username: str
    password: str
    role: str = "user"  # 'admin' | 'user'


class BirthdayIn(BaseModel):
    name: str
    relationship: str | None = None
    calendar_type: str = "solar"  # 'solar' | 'lunar'
    month: int
    day: int
    year: int | None = None
    is_leap: bool = False
    notify_days: list[int] | None = None
    channels: list[str] | None = None
    note: str | None = None
    enabled: bool = True


# ---------- 系统 ----------

@app.on_event("startup")
def _startup():
    scheduler.start()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/setup/status")
def setup_status():
    return {"initialized": db.count_users() > 0}


# ---------- 认证 ----------

@app.post("/api/setup")
def setup(body: SetupIn):
    if db.count_users() > 0:
        raise HTTPException(status_code=400, detail="已完成初始化")
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    uid = db.create_user(body.username, body.password, role="admin")
    token = auth_mod.create_token()
    db.create_session(token, uid, auth_mod.session_expiry())
    return {"token": token, "username": body.username, "role": "admin"}


@app.post("/api/login")
def login(body: LoginIn):
    u = db.verify_login(body.username, body.password)
    if not u:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = auth_mod.create_token()
    db.create_session(token, u["id"], auth_mod.session_expiry())
    return {"token": token, "username": u["username"], "role": u["role"]}


@app.post("/api/logout")
def logout(authorization: str | None = Header(None), user: dict = Depends(get_current_user)):
    if authorization and authorization.startswith("Bearer "):
        db.delete_session(authorization.split(" ", 1)[1])
    return {"ok": True}


@app.get("/api/me")
def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"], "role": user["role"]}


# ---------- 生日（需登录） ----------

@app.get("/api/birthdays")
def list_birthdays(user: dict = Depends(get_current_user)):
    return db.get_all_birthdays()


@app.post("/api/birthdays")
def create_birthday(b: BirthdayIn, user: dict = Depends(get_current_user)):
    return db.create_birthday(b.dict())


@app.put("/api/birthdays/{bid}")
def update_birthday(bid: int, b: BirthdayIn, user: dict = Depends(get_current_user)):
    row = db.update_birthday(bid, b.dict())
    if not row:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    return row


@app.delete("/api/birthdays/{bid}")
def delete_birthday(bid: int, user: dict = Depends(get_current_user)):
    db.delete_birthday(bid)
    return {"ok": True}


@app.post("/api/birthdays/{bid}/test")
def test_birthday(bid: int, user: dict = Depends(get_current_user)):
    r = db.get_birthday(bid)
    if not r:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    cfg = config.CONFIG
    channels = r.get("channels") or cfg["notify"]["default_channels"]
    title, content = messages.build_test(r)
    results = notifiers.send_all(channels, title, content, cfg)
    return {
        "results": [
            {"channel": c, "ok": res.ok, "message": res.message} for c, res in results
        ]
    }


@app.get("/api/upcoming")
def upcoming(days: int = 30, user: dict = Depends(get_current_user)):
    return db.upcoming(days)


@app.post("/api/check")
def manual_check(user: dict = Depends(require_admin)):
    n = scheduler.check_once()
    return {"notified": n}


# ---------- 管理员：设置（所有参数可前台调整） ----------

@app.get("/api/settings")
def get_settings(user: dict = Depends(require_admin)):
    return config.CONFIG


@app.post("/api/settings")
def save_settings(payload: dict, user: dict = Depends(require_admin)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="配置格式错误")
    # 与默认配置合并，避免缺失字段
    merged = config._merge(config.DEFAULT_CONFIG, payload)
    config.save_config(merged)
    scheduler.reschedule()
    return {"ok": True}


# ---------- 管理员：用户管理 ----------

@app.get("/api/users")
def list_users(user: dict = Depends(require_admin)):
    return db.list_users()


@app.post("/api/users")
def create_user(body: UserIn, user: dict = Depends(require_admin)):
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="角色非法")
    if db.get_user_by_username(body.username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    db.create_user(body.username, body.password, body.role)
    return {"ok": True}


@app.delete("/api/users/{uid}")
def delete_user(uid: int, user: dict = Depends(require_admin)):
    target = db.get_user_by_id(uid)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target["id"] == user["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录的账号")
    if target["role"] == "admin" and db.count_users() <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个管理员")
    db.delete_user(uid)
    return {"ok": True}


# ---------- 静态前台 ----------

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
