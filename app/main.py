"""FastAPI 主应用：鉴权 + 生日管理 + 管理员设置/用户管理 + 静态前台。"""

import logging
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Header, UploadFile, File, Request
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

app = FastAPI(title="生日管家 Birthday Keeper", version="2.5.0")


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
    visibility: str | None = None  # 'private' | 'family' | 'public'


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
    visibility: str | None = None  # 'private' | 'family' | 'public'


class RegisterIn(BaseModel):
    username: str
    password: str


class ForgotIn(BaseModel):
    username: str


class ResetIn(BaseModel):
    token: str
    password: str


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
    return {
        "initialized": db.count_users() > 0,
        "allow_register": bool(config.CONFIG.get("privacy", {}).get("allow_register", False)),
    }


@app.get("/api/ui")
def ui_prefs(user: dict = Depends(get_current_user)):
    """返回与界面布局相关的偏好（不含任何密钥）。"""
    ui = dict(config.CONFIG.get("ui", {}))
    ui["default_visibility"] = config.CONFIG.get("privacy", {}).get("default_visibility", "private")
    ui["allow_register"] = config.CONFIG.get("privacy", {}).get("allow_register", False)
    return ui


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


def _can_view(r: dict, user: dict) -> bool:
    fam_idx = db._family_index()
    return db._is_visible(r, user["id"], fam_idx)


def _default_visibility() -> str:
    return config.CONFIG.get("privacy", {}).get("default_visibility", "private")


@app.post("/api/register")
def register(body: RegisterIn):
    if not config.CONFIG.get("privacy", {}).get("allow_register", False):
        raise HTTPException(status_code=403, detail="当前未开放注册，请联系管理员")
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if db.get_user_by_username(body.username):
        raise HTTPException(status_code=400, detail="该用户名已被占用")
    role = "admin" if db.count_users() == 0 else "user"
    uid = db.create_user(body.username, body.password, role=role)
    token = auth_mod.create_token()
    db.create_session(token, uid, auth_mod.session_expiry())
    return {"token": token, "username": body.username, "role": role}


@app.post("/api/forgot-password")
def forgot_password(body: ForgotIn, request: Request):
    token = db.create_reset_token(body.username)
    if not token:
        # 不暴露用户名是否存在
        return {"ok": True, "email_configured": None,
                "message": "若该用户存在，重置邮件已发送"}
    e = config.CONFIG.get("email", {})
    if not (e.get("enabled") and e.get("smtp_host") and e.get("to_addr")):
        return {"ok": False, "email_configured": False,
                "message": "未配置邮件渠道，无法发送重置邮件，请联系管理员重置密码"}
    base = str(request.base_url).rstrip("/")
    link = f"{base}/reset-password?token={token}"
    res = notifiers.email.send(
        "生日管家 · 密码重置",
        f"你请求重置密码。请点击以下链接（1 小时内有效）进行重置：\n{link}\n\n如非本人操作，请忽略此邮件。",
        config.CONFIG,
    )
    if not res.ok:
        return {"ok": False, "email_configured": True, "message": f"邮件发送失败：{res.message}"}
    return {"ok": True, "email_configured": True, "message": "重置邮件已发送，请查收"}


@app.post("/api/reset-password")
def reset_password(body: ResetIn):
    ok, err = db.consume_reset_token(body.token, body.password)
    if not ok:
        raise HTTPException(status_code=400, detail=err or "重置失败")
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
    return [_enrich(r) for r in db.visible_birthdays(user["id"])]


@app.post("/api/birthdays")
def create_birthday(b: BirthdayIn, user: dict = Depends(get_current_user)):
    data = b.model_dump()
    data["owner_id"] = user["id"]
    if not data.get("visibility"):
        data["visibility"] = _default_visibility()
    return _enrich(db.create_birthday(data))


@app.put("/api/birthdays/{bid}")
def update_birthday(bid: int, b: BirthdayIn, user: dict = Depends(get_current_user)):
    existing = db.get_birthday(bid)
    if not existing:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    if existing.get("owner_id") not in (None, user["id"]) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="只能修改自己创建的记录")
    data = b.model_dump()
    data["owner_id"] = existing.get("owner_id")  # 不改变归属
    return _enrich(db.update_birthday(bid, data))


@app.get("/api/birthdays/{bid}")
def get_birthday(bid: int, user: dict = Depends(get_current_user)):
    row = db.get_birthday(bid)
    if not row:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    if not _can_view(row, user):
        raise HTTPException(status_code=403, detail="无权查看该记录")
    return _enrich(row)


@app.delete("/api/birthdays/{bid}")
def delete_birthday(bid: int, user: dict = Depends(get_current_user)):
    existing = db.get_birthday(bid)
    if not existing:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    if existing.get("owner_id") not in (None, user["id"]) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="只能删除自己创建的记录")
    db.delete_birthday(bid)
    return {"ok": True}


@app.post("/api/birthdays/{bid}/avatar")
async def upload_avatar(bid: int, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    r = db.get_birthday(bid)
    if not r:
        raise HTTPException(status_code=404, detail="未找到该联系人")
    if r.get("owner_id") not in (None, user["id"]) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="只能为自己创建的记录上传头像")
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
        "is_leap", "notify_days", "channels", "note", "enabled", "visibility")}, "avatar_path": fn})
    return _enrich(db.get_birthday(bid))


@app.post("/api/birthdays/test")
def test_birthdays(body: BatchTestIn, user: dict = Depends(get_current_user)):
    """批量测试：传 ids 测试指定联系人，不传则测试全部可见联系人。"""
    ids = body.ids
    rows = db.visible_birthdays(user["id"])
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
    return db.upcoming_combined(days, user["id"])


@app.post("/api/anniversaries/test")
def test_anniversaries(body: BatchTestIn, user: dict = Depends(get_current_user)):
    """纪念日批量测试：传 ids 测试指定项，不传则测试全部可见项。"""
    ids = body.ids
    rows = db.visible_anniversaries(user["id"])
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
    return db.visible_anniversaries(user["id"])


@app.post("/api/anniversaries")
def create_anniversary(a: AnniversaryIn, user: dict = Depends(get_current_user)):
    data = a.model_dump()
    data["owner_id"] = user["id"]
    if not data.get("visibility"):
        data["visibility"] = _default_visibility()
    return db.create_anniversary(data)


@app.put("/api/anniversaries/{aid}")
def update_anniversary(aid: int, a: AnniversaryIn, user: dict = Depends(get_current_user)):
    existing = db.get_anniversary(aid)
    if not existing:
        raise HTTPException(status_code=404, detail="未找到该纪念日")
    if existing.get("owner_id") not in (None, user["id"]) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="只能修改自己创建的记录")
    data = a.model_dump()
    data["owner_id"] = existing.get("owner_id")
    row = db.update_anniversary(aid, data)
    if not row:
        raise HTTPException(status_code=404, detail="未找到该纪念日")
    return row


@app.delete("/api/anniversaries/{aid}")
def delete_anniversary(aid: int, user: dict = Depends(get_current_user)):
    existing = db.get_anniversary(aid)
    if not existing:
        raise HTTPException(status_code=404, detail="未找到该纪念日")
    if existing.get("owner_id") not in (None, user["id"]) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="只能删除自己创建的记录")
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


# ---------- 家庭（共享） ----------

@app.post("/api/families")
def create_family_api(body: dict, user: dict = Depends(get_current_user)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="家庭名称不能为空")
    fid = db.create_family(name, user["id"])
    return {"id": fid, "name": name}


@app.get("/api/families")
def my_families(user: dict = Depends(get_current_user)):
    return db.list_user_families(user["id"])


@app.post("/api/families/{fid}/invite")
def invite_api(fid: int, body: dict, user: dict = Depends(get_current_user)):
    fam = db.get_family(fid)
    if not fam:
        raise HTTPException(status_code=404, detail="家庭不存在")
    if fam["owner_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="只有家庭创建者可邀请成员")
    uname = (body.get("username") or "").strip()
    if not uname:
        raise HTTPException(status_code=400, detail="请输入要邀请的用户名")
    iid, err = db.invite_to_family(fid, user["id"], uname)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "invite_id": iid}


@app.get("/api/families/invites")
def my_invites(user: dict = Depends(get_current_user)):
    return db.list_invites_for_user(user["username"])


@app.post("/api/families/invites/{iid}/respond")
def respond_invite_api(iid: int, body: dict, user: dict = Depends(get_current_user)):
    accept = bool(body.get("accept", False))
    ok = db.respond_invite(iid, user["username"], accept)
    if not ok:
        raise HTTPException(status_code=404, detail="邀请不存在或已处理")
    return {"ok": True}


# ---------- 管理员：重置用户密码 ----------

@app.post("/api/users/{uid}/reset-password")
def admin_reset(uid: int, body: dict, user: dict = Depends(require_admin)):
    target = db.get_user_by_id(uid)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    pw = (body.get("password") or "")
    if len(pw) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    db.admin_set_password(uid, pw)
    return {"ok": True}


# ---------- 静态前台 ----------

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/reset-password")
def reset_password_page():
    """邮件中的重置链接落地页，由前端 SPA 读取 ?token= 参数。"""
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
