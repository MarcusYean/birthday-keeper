"""FastAPI 主应用：鉴权 + 生日管理 + 管理员设置/用户管理 + 静态前台。"""

import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Header, UploadFile, File
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
AVATAR_DIR = Path(db.DB_PATH).resolve().parent / "avatars"

app = FastAPI(title="生日管家 Birthday Keeper", version="2.4.0")


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
    gender: str | None = None
    birth_time: str | None = None
    zodiac: str | None = None
    hobbies: str | None = None
    avatar: str | None = None
    mbti: str | None = None
    blood_type: str | None = None
    avatar_path: str | None = None
    calendar_type: str = "solar"  # 'solar' | 'lunar'
    month: int
    day: int
    year: int | None = None
    is_leap: bool = False
    notify_days: list[int] | None = None
    channels: list[str] | None = None
    note: str | None = None
    enabled: bool = True


class AnniversaryIn(BaseModel):
    name: str
    relationship: str | None = None
    kind: str = "纪念日"
    calendar_type: str = "solar"
    month: int
    day: int
    year: int | None = None
    is_leap: bool = False
    notify_days: list[int] | None = None
    channels: list[str] | None = None
    note: str | None = None
    enabled: bool = True


class BatchTestIn(BaseModel):
    ids: list[int] | None = None  # 为空则测试全部


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


@app.get("/api/ui")
def ui_prefs(user: dict = Depends(get_current_user)):
    """返回与界面布局相关的偏好（不含任何密钥）。"""
    return config.CONFIG.get("ui", {})


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

def _enrich(r: dict | None) -> dict | None:
    if not r:
        return None
    if r.get("avatar_path"):
        r = dict(r)
        r["avatar_url"] = "/avatars/" + r["avatar_path"].split("/")[-1]
    return r


@app.get("/api/birthdays")
def list_birthdays(user: dict = Depends(get_current_user)):
    return [_enrich(r) for r in db.get_all_birthdays()]


@app.post("/api/birthdays")
def create_birthday(b: BirthdayIn, user: dict = Depends(get_current_user)):
    return _enrich(db.create_birthday(b.model_dump()))


@app.put("/api/birthdays/{bid}")
def update_birthday(bid: int, b: BirthdayIn, user: dict = Depends(get_current_user)):
    row = db.update_birthday(bid, b.model_dump())
    if not row:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    return _enrich(row)


@app.get("/api/birthdays/{bid}")
def get_birthday(bid: int, user: dict = Depends(get_current_user)):
    row = _enrich(db.get_birthday(bid))
    if not row:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    return row


@app.delete("/api/birthdays/{bid}")
def delete_birthday(bid: int, user: dict = Depends(get_current_user)):
    db.delete_birthday(bid)
    return {"ok": True}


@app.post("/api/birthdays/{bid}/avatar")
async def upload_avatar(bid: int, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    r = db.get_birthday(bid)
    if not r:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    # 校验类型与大小（<= 2MB）
    allowed = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
    ctype = (file.content_type or "").lower()
    if ctype not in allowed:
        raise HTTPException(status_code=400, detail="仅支持 PNG/JPG/WEBP/GIF 图片")
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片过大（上限 2MB）")
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
           "image/webp": "webp", "image/gif": "gif"}[ctype]
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    # 删除旧头像
    if r.get("avatar_path"):
        try:
            (AVATAR_DIR / r["avatar_path"].split("/")[-1]).unlink(missing_ok=True)
        except OSError:
            pass
    fn = f"{bid}_{abs(hash(bid))}{int(__import__('time').time())}.{ext}"
    (AVATAR_DIR / fn).write_bytes(data)
    db.update_birthday(bid, {**{k: r.get(k) for k in (
        "name", "relationship", "gender", "birth_time", "zodiac", "hobbies",
        "avatar", "mbti", "blood_type", "calendar_type", "month", "day", "year",
        "is_leap", "notify_days", "channels", "note", "enabled")}, "avatar_path": fn})
    return _enrich(db.get_birthday(bid))


@app.post("/api/birthdays/test")
def test_birthdays(body: BatchTestIn, user: dict = Depends(get_current_user)):
    """批量测试：传 ids 测试指定联系人，不传则测试全部。"""
    ids = body.ids
    rows = db.get_all_birthdays()
    if ids:
        rows = [r for r in rows if r["id"] in ids]
    if not rows:
        return {"tested": 0, "results": []}
    cfg = config.CONFIG
    out = []
    for r in rows:
        channels = r.get("channels") or cfg["notify"]["default_channels"]
        title, content = messages.build_test(r)
        results = notifiers.send_all(channels, title, content, cfg)
        out.append({
            "id": r["id"],
            "name": r["name"],
            "results": [{"channel": c, "ok": res.ok, "message": res.message} for c, res in results],
        })
    return {"tested": len(out), "results": out}


@app.get("/api/upcoming")
def upcoming(days: int = 30, user: dict = Depends(get_current_user)):
    return db.upcoming_combined(days)


@app.post("/api/anniversaries/test")
def test_anniversaries(body: BatchTestIn, user: dict = Depends(get_current_user)):
    """纪念日批量测试：传 ids 测试指定项，不传则测试全部。"""
    ids = body.ids
    rows = db.get_all_anniversaries()
    if ids:
        rows = [r for r in rows if r["id"] in ids]
    if not rows:
        return {"tested": 0, "results": []}
    cfg = config.CONFIG
    out = []
    for r in rows:
        channels = r.get("channels") or cfg["notify"]["default_channels"]
        title, content = messages.build_anniversary_test(r)
        results = notifiers.send_all(channels, title, content, cfg)
        out.append({
            "id": r["id"],
            "name": r["name"],
            "results": [{"channel": c, "ok": res.ok, "message": res.message} for c, res in results],
        })
    return {"tested": len(out), "results": out}


@app.post("/api/check")
def manual_check(user: dict = Depends(require_admin)):
    n = scheduler.check_once()
    return {"notified": n}


# ---------- 纪念日（需登录） ----------

@app.get("/api/anniversaries")
def list_anniversaries(user: dict = Depends(get_current_user)):
    return db.get_all_anniversaries()


@app.post("/api/anniversaries")
def create_anniversary(a: AnniversaryIn, user: dict = Depends(get_current_user)):
    return db.create_anniversary(a.model_dump())


@app.put("/api/anniversaries/{aid}")
def update_anniversary(aid: int, a: AnniversaryIn, user: dict = Depends(get_current_user)):
    row = db.update_anniversary(aid, a.model_dump())
    if not row:
        raise HTTPException(status_code=404, detail="未找到该纪念日")
    return row


@app.delete("/api/anniversaries/{aid}")
def delete_anniversary(aid: int, user: dict = Depends(get_current_user)):
    db.delete_anniversary(aid)
    return {"ok": True}


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


@app.get("/avatars/{filename}")
def avatar_file(filename: str):
    from pathlib import Path as _P
    # 防目录穿越
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="非法文件名")
    p = AVATAR_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="未找到头像")
    return FileResponse(str(p))


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
