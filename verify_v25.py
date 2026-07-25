# -*- coding: utf-8 -*-
"""v2.5 端到端验证（自包含、无需启动服务）：
登录修复 / 注册开关 / 找回密码 / 三级权限 / 家庭共享 / 新前端接口字段。

运行：python verify_v25.py
也可被导入：from verify_v25 import main
"""
import os
import sys
import tempfile
import pathlib


def main():
    tmp = tempfile.mkdtemp()
    os.environ["DB_PATH"] = str(pathlib.Path(tmp) / "verify.db")

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import app.config as _config
    _config.CONFIG_PATHS[:] = [str(pathlib.Path(tmp) / "config.yaml")]
    _config.CONFIG = _config.load_config()

    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    PASS, FAIL = 0, 0

    def check(name, cond, extra=""):
        nonlocal PASS, FAIL
        if cond:
            PASS += 1
            print(f"  PASS {name}")
        else:
            FAIL += 1
            print(f"  FAIL {name} {extra}")

    # ---- setup/status 返回 allow_register ----
    r = c.get("/api/setup/status").json()
    check("setup/status 含 allow_register", "allow_register" in r and r["allow_register"] is False)

    # ---- 初始化管理员 ----
    r = c.post("/api/setup", json={"username": "admin", "password": "admin123"})
    check("初始化管理员", r.status_code == 200)
    ADMIN = {"Authorization": "Bearer " + r.json()["token"]}

    # ---- 注册默认关闭 ----
    r = c.post("/api/register", json={"username": "bob", "password": "bob12345"})
    check("注册默认关闭 403", r.status_code == 403)

    # ---- 开启注册 ----
    cfg = c.get("/api/settings", headers=ADMIN).json()
    cfg["privacy"]["allow_register"] = True
    cfg["privacy"]["default_visibility"] = "private"
    r = c.post("/api/settings", json=cfg, headers=ADMIN)
    check("保存 privacy 设置", r.status_code == 200)
    r = c.get("/api/setup/status").json()
    check("setup/status allow_register=True", r["allow_register"] is True)

    # ---- 注册 bob ----
    r = c.post("/api/register", json={"username": "bob", "password": "bob12345"})
    check("注册 bob 成功", r.status_code == 200)
    BOB = {"Authorization": "Bearer " + r.json()["token"]}

    # ---- /api/ui 返回 default_visibility ----
    r = c.get("/api/ui", headers=ADMIN).json()
    check("ui 含 default_visibility/allow_register",
          r.get("default_visibility") == "private" and r.get("allow_register") is True)

    # ---- admin 添加三种可见性数据 ----
    for vis in ("private", "family", "public"):
        r = c.post("/api/birthdays", json={"name": f"admin-{vis}", "month": 5, "day": 20,
                                           "calendar_type": "solar", "visibility": vis}, headers=ADMIN)
        check(f"admin 添加 {vis} 生日", r.status_code == 200)

    # ---- bob 只能看到 public ----
    rows = c.get("/api/birthdays", headers=BOB).json()
    names = {x["name"] for x in rows}
    check("bob 仅见 public", names == {"admin-public"}, str(names))

    # ---- 家庭流程 ----
    r = c.post("/api/families", json={"name": "老王家"}, headers=ADMIN)
    check("创建家庭", r.status_code == 200)
    fid = r.json()["id"]
    r = c.post(f"/api/families/{fid}/invite", json={"username": "bob"}, headers=ADMIN)
    check("邀请 bob", r.status_code == 200)
    inv = c.get("/api/families/invites", headers=BOB).json()
    check("bob 收到邀请且含 inviter_name/family_name",
          len(inv) == 1 and inv[0].get("inviter_name") == "admin" and inv[0].get("family_name") == "老王家", str(inv))
    r = c.post(f"/api/families/invites/{inv[0]['id']}/respond", json={"accept": True}, headers=BOB)
    check("bob 接受邀请", r.status_code == 200)

    # ---- 家庭列表字段（前端使用 owner_name/members/pending_invites） ----
    fams = c.get("/api/families", headers=BOB).json()
    f0 = fams[0] if fams else {}
    check("家庭含 owner_name", f0.get("owner_name") == "admin", str(f0))
    check("家庭含 members 2 人", len(f0.get("members", [])) == 2)
    check("家庭含 pending_invites 字段", "pending_invites" in f0)

    # ---- bob 现在能看到 family 数据 ----
    rows = c.get("/api/birthdays", headers=BOB).json()
    names = {x["name"] for x in rows}
    check("bob 可见 public+family", names == {"admin-public", "admin-family"}, str(names))

    # ---- bob 无法删除 admin 的记录 ----
    target = [x for x in rows if x["name"] == "admin-family"][0]
    r = c.delete(f"/api/birthdays/{target['id']}", headers=BOB)
    check("bob 删除他人记录被拒", r.status_code == 403)

    # ---- 忘记密码（未配邮件） ----
    r = c.post("/api/forgot-password", json={"username": "bob"}).json()
    check("忘记密码提示未配邮件", r.get("email_configured") is False)

    # ---- 管理员重置密码 ----
    users = c.get("/api/users", headers=ADMIN).json()
    bob_id = [u for u in users if u["username"] == "bob"][0]["id"]
    r = c.post(f"/api/users/{bob_id}/reset-password", json={"password": "newpass6"}, headers=ADMIN)
    check("管理员重置 bob 密码", r.status_code == 200)
    r = c.post("/api/login", json={"username": "bob", "password": "newpass6"})
    check("bob 新密码可登录", r.status_code == 200)
    BOB = {"Authorization": "Bearer " + r.json()["token"]}  # 旧 token 已随重置失效

    # ---- 重置链接落地页 ----
    r = c.get("/reset-password?token=abc")
    check("/reset-password 返回页面", r.status_code == 200 and "生日管家" in r.text)

    # ---- 纪念日可见性 ----
    r = c.post("/api/anniversaries", json={"name": "结婚纪念日", "month": 6, "day": 1,
                                           "calendar_type": "solar", "visibility": "family"}, headers=ADMIN)
    check("admin 添加 family 纪念日", r.status_code == 200)
    rows = c.get("/api/anniversaries", headers=BOB).json()
    check("bob 可见 family 纪念日", any(x["name"] == "结婚纪念日" for x in rows))

    print(f"\n结果: {PASS} PASS / {FAIL} FAIL")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
