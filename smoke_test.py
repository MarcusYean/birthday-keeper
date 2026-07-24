# -*- coding: utf-8 -*-
"""v2.2 端到端冒烟测试：初始化 → 登录 → 权限 → 生日 CRUD（含扩展/MBTI/血型）→ 头像上传
→ 纪念日 CRUD → 批量测试 → 即将到来(合并) → 设置热更新 → 用户管理 → 静态资源"""
import base64
import time
import requests

BASE = "http://127.0.0.1:8111"
ok_cnt = fail_cnt = 0

# 1x1 透明 PNG，用于头像上传测试
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"


def check(name, cond, extra=""):
    global ok_cnt, fail_cnt
    if cond:
        ok_cnt += 1
        print(f"[PASS] {name}")
    else:
        fail_cnt += 1
        print(f"[FAIL] {name}  {extra}")


# 等服务就绪
for _ in range(30):
    try:
        requests.get(BASE + "/api/health", timeout=2)
        break
    except Exception:
        time.sleep(1)

# 1. 初始化状态
r = requests.get(BASE + "/api/setup/status").json()
check("初始状态未初始化", r["initialized"] is False, str(r))

# 2. 未登录访问被拦截
r = requests.get(BASE + "/api/birthdays")
check("未登录访问 /api/birthdays 返回 401", r.status_code == 401, str(r.status_code))

# 3. 创建管理员
r = requests.post(BASE + "/api/setup", json={"username": "admin", "password": "admin123"})
check("创建管理员成功", r.status_code == 200 and r.json().get("role") == "admin", r.text)
admin_tok = r.json()["token"]
AH = {"Authorization": "Bearer " + admin_tok}

# 4. 重复初始化被拒
r = requests.post(BASE + "/api/setup", json={"username": "x", "password": "y"})
check("重复初始化被拒绝", r.status_code == 400, str(r.status_code))

# 5. 登录（错误密码 / 正确密码）
r = requests.post(BASE + "/api/login", json={"username": "admin", "password": "wrong"})
check("错误密码返回 401", r.status_code == 401, str(r.status_code))
r = requests.post(BASE + "/api/login", json={"username": "admin", "password": "admin123"})
check("正确密码登录成功", r.status_code == 200, r.text)

# 6. /api/me
r = requests.get(BASE + "/api/me", headers=AH).json()
check("/api/me 返回 admin", r.get("username") == "admin" and r.get("role") == "admin", str(r))

# 7. 生日 CRUD（公历 + 农历 + 扩展字段 + MBTI/血型）
r = requests.post(BASE + "/api/birthdays", headers=AH, json={
    "name": "老爸", "relationship": "家人", "calendar_type": "lunar",
    "month": 8, "day": 15, "year": 1960,
    "gender": "男", "birth_time": "辰时 07:00-09:00", "zodiac": "", "hobbies": "喝茶、钓鱼", "avatar": "🎣",
    "mbti": "ISTJ", "blood_type": "A",
    "notify_days": [1, 7], "channels": ["wechat"]})
check("添加农历联系人（含扩展字段+MBTI+血型）", r.status_code == 200, r.text[:300])
bid = r.json()["id"]
rdata = r.json()
check("返回含派生字段 (next_date/days_until/age/chinese_zodiac/zodiac)",
      all(k in rdata for k in ("next_date", "days_until", "age", "chinese_zodiac", "zodiac")),
      str({k: rdata.get(k) for k in ("next_date", "days_until", "age", "chinese_zodiac", "zodiac")}))
check("生肖为鼠", rdata.get("chinese_zodiac") == "鼠", rdata.get("chinese_zodiac"))
check("MBTI 已保存", rdata.get("mbti") == "ISTJ", str(rdata.get("mbti")))
check("血型已保存", rdata.get("blood_type") == "A", str(rdata.get("blood_type")))

r = requests.post(BASE + "/api/birthdays", headers=AH, json={
    "name": "小明", "calendar_type": "solar", "month": 12, "day": 1,
    "gender": "男", "birth_time": "", "zodiac": "射手座", "hobbies": "篮球", "avatar": "",
    "mbti": "ENFP", "blood_type": "O"})
check("添加公历联系人（含扩展字段）", r.status_code == 200, r.text[:300])

r = requests.get(BASE + "/api/birthdays", headers=AH).json()
check("列表返回 2 条", len(r) == 2, str(len(r)))
check("列表项含 days_lived", all("days_lived" in x for x in r), str([x.get("days_lived") for x in r]))

r = requests.put(BASE + f"/api/birthdays/{bid}", headers=AH, json={
    "name": "老爸", "relationship": "家人", "calendar_type": "lunar",
    "month": 8, "day": 15, "year": 1960, "gender": "男", "birth_time": "辰时 07:00-09:00", "zodiac": "", "hobbies": "喝茶、钓鱼、下棋", "avatar": "🎣",
    "mbti": "INTJ", "blood_type": "B",
    "notify_days": [1, 3, 7], "channels": ["wechat", "feishu"]})
check("更新联系人（含 MBTI/血型）", r.status_code == 200 and r.json()["notify_days"] == [1, 3, 7], r.text)
check("更新后 MBTI 正确", r.json().get("mbti") == "INTJ", r.json().get("mbti"))
check("更新后血型正确", r.json().get("blood_type") == "B", r.json().get("blood_type"))

# 8. 头像上传
png = base64.b64decode(PNG_B64)
r = requests.post(BASE + f"/api/birthdays/{bid}/avatar", headers=AH,
                  files={"file": ("a.png", png, "image/png")})
check("头像上传返回 200 且带 avatar_url", r.status_code == 200 and "avatar_url" in r.json(), r.text[:200])
avatar_url = r.json().get("avatar_url")
if avatar_url:
    rr = requests.get(BASE + avatar_url)
    check("头像静态资源可访问", rr.status_code == 200 and rr.headers.get("content-type", "").startswith("image"), str(rr.status_code))

# 9. 纪念日 CRUD
r = requests.post(BASE + "/api/anniversaries", headers=AH, json={
    "name": "结婚纪念日", "relationship": "伴侣", "kind": "结婚纪念日",
    "calendar_type": "solar", "month": 5, "day": 20, "year": 2015,
    "notify_days": [1, 7], "channels": ["wechat"]})
check("添加纪念日（含起始年）", r.status_code == 200, r.text[:300])
aid = r.json()["id"]
check("纪念日含 years_passed", r.json().get("years_passed") is not None, str(r.json().get("years_passed")))
r = requests.get(BASE + "/api/anniversaries", headers=AH).json()
check("纪念日列表返回 1 条", len(r) == 1, str(len(r)))

# 10. 即将到来（合并生日+纪念日，含 kind）
r = requests.get(BASE + "/api/upcoming?days=400", headers=AH).json()
check("upcoming 合并返回且含 kind 字段",
      len(r) >= 2 and all("kind" in x and "days_until" in x for x in r), str(r)[:200])
kinds = set(x.get("kind") for x in r)
check("upcoming 同时含 birthday 与 anniversary", "birthday" in kinds and "anniversary" in kinds, str(kinds))

# 11. 批量测试接口（v2.2 新：替换旧的单行测试）
r = requests.post(BASE + "/api/birthdays/test", headers=AH, json={"ids": [bid]})
check("批量测试（指定 ids）返回 200 与 results", r.status_code == 200 and "results" in r.json(), r.text[:200])
r = requests.post(BASE + "/api/birthdays/test", headers=AH, json={"ids": None})
check("批量测试（全部）返回 200", r.status_code == 200 and r.json().get("tested", 0) >= 1, r.text[:200])
r = requests.post(BASE + "/api/anniversaries/test", headers=AH, json={"ids": [aid]})
check("纪念日批量测试返回 200", r.status_code == 200 and "results" in r.json(), r.text[:200])

# 12. /api/ui 界面偏好
r = requests.get(BASE + "/api/ui", headers=AH).json()
check("/api/ui 含 menu_position/contact_edit_mode", "menu_position" in r and "contact_edit_mode" in r, str(r))

# 13. 普通用户创建与权限隔离
r = requests.post(BASE + "/api/users", headers=AH, json={"username": "mama", "password": "mm123", "role": "user"})
check("管理员创建普通用户", r.status_code == 200, r.text)
r = requests.post(BASE + "/api/login", json={"username": "mama", "password": "mm123"})
user_tok = r.json()["token"]
UH = {"Authorization": "Bearer " + user_tok}
r = requests.get(BASE + "/api/birthdays", headers=UH)
check("普通用户可看联系人", r.status_code == 200, str(r.status_code))
r = requests.get(BASE + "/api/settings", headers=UH)
check("普通用户访问设置返回 403", r.status_code == 403, str(r.status_code))
r = requests.get(BASE + "/api/users", headers=UH)
check("普通用户访问用户管理返回 403", r.status_code == 403, str(r.status_code))
# 普通用户应能看到 /api/ui（公开偏好）
r = requests.get(BASE + "/api/ui", headers=UH)
check("普通用户可读取界面偏好", r.status_code == 200, str(r.status_code))

# 14. 设置读取 + 热更新（含 ui 块）
cfg = requests.get(BASE + "/api/settings", headers=AH).json()
check("读取设置含 notify/wechat/feishu/email/ui",
      all(k in cfg for k in ("notify", "wechat", "feishu", "email", "ui")), str(cfg.keys()))
cfg["notify"]["check_hour"] = 9
cfg["notify"]["check_minute"] = 30
cfg["notify"]["default_notify_days"] = [0, 1, 3]
cfg["wechat"]["enabled"] = True
cfg["wechat"]["token"] = "SCT_TEST"
cfg["ui"]["menu_position"] = "top"
cfg["ui"]["contact_edit_mode"] = "drawer"
r = requests.post(BASE + "/api/settings", headers=AH, json=cfg)
check("保存设置成功", r.status_code == 200, r.text)
cfg2 = requests.get(BASE + "/api/settings", headers=AH).json()
check("热更新生效 (check 9:30 / days [0,1,3] / ui.top+drawer)",
      cfg2["notify"]["check_hour"] == 9 and cfg2["notify"]["check_minute"] == 30
      and cfg2["notify"]["default_notify_days"] == [0, 1, 3]
      and cfg2["wechat"]["enabled"] is True
      and cfg2["ui"]["menu_position"] == "top" and cfg2["ui"]["contact_edit_mode"] == "drawer",
      str(cfg2["notify"]) + " | " + str(cfg2["ui"]))
# 还原 ui 设置，避免影响后续手动验证
cfg2["ui"]["menu_position"] = "left"
cfg2["ui"]["contact_edit_mode"] = "modal"
requests.post(BASE + "/api/settings", headers=AH, json=cfg2)

# 15. 用户管理边界：删除自己 / 删除最后管理员
users = requests.get(BASE + "/api/users", headers=AH).json()
admin_id = next(u["id"] for u in users if u["username"] == "admin")
mama_id = next(u["id"] for u in users if u["username"] == "mama")
r = requests.delete(BASE + f"/api/users/{admin_id}", headers=AH)
check("不能删除当前登录账号", r.status_code == 400, str(r.status_code))
r = requests.delete(BASE + f"/api/users/{mama_id}", headers=AH)
check("删除普通用户成功", r.status_code == 200, r.text)
r = requests.get(BASE + "/api/birthdays", headers=UH)
check("被删用户的 token 失效", r.status_code == 401, str(r.status_code))

# 16. 手动检查（admin）
r = requests.post(BASE + "/api/check", headers=AH)
check("手动触发检查", r.status_code == 200, r.text)

# 17. 登出
r = requests.post(BASE + "/api/logout", headers=AH)
check("登出成功", r.status_code == 200, r.text)
r = requests.get(BASE + "/api/me", headers=AH)
check("登出后 token 失效", r.status_code == 401, str(r.status_code))

# 18. 前端静态资源
for p in ("/", "/static/css/styles.css", "/static/js/app.js"):
    r = requests.get(BASE + p)
    check(f"静态资源 {p} 可访问", r.status_code == 200, str(r.status_code))

print(f"\n===== 结果：{ok_cnt} 通过 / {fail_cnt} 失败 =====")
exit(1 if fail_cnt else 0)
