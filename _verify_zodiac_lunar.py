import os
import sys

os.environ["DB_PATH"] = os.path.join(os.path.dirname(__file__), "_zodiac_tmp_lunar.db")
sys.path.insert(0, os.path.dirname(__file__))

from app import lunar  # noqa: E402
from app.db import _birthday_stats, _zodiac_sign  # noqa: E402

print("lunar.LunarDate available:", lunar.LunarDate is not None)


def build(calendar_type, month, day, year=None, is_leap=0):
    return {
        "name": "t", "relationship": None, "gender": None, "birth_time": None,
        "zodiac": None, "hobbies": None, "avatar": None, "mbti": None,
        "blood_type": None, "avatar_path": None, "calendar_type": calendar_type,
        "month": month, "day": day, "year": year, "is_leap": is_leap,
        "notify_days": None, "channels": None, "note": None, "enabled": 1,
        "created_at": None,
    }


fail = 0

# 1) 阳历直算不回归
for m, d, exp in [(3, 25, "白羊座"), (1, 1, "摩羯座"), (12, 22, "摩羯座")]:
    got = _zodiac_sign(m, d)
    ok = got == exp
    fail += not ok
    print(f"{'OK ' if ok else 'FAIL'} 阳历 {m}/{d} -> {got} (期望 {exp})")

# 2) 阴历按出生年份算星座
print("\n--- 阴历生日（按出生年份对应的阳历日期算星座）---")
cases = [
    (1990, 7, 7),    # 七夕
    (2000, 1, 1),
    (1988, 12, 15),
    (1976, 5, 20),
    (1995, 8, 8),
]
for y, m, d in cases:
    solar = lunar._lunar_to_solar(y, m, d, False)
    expected = _zodiac_sign(solar.month, solar.day) if solar else None
    out = _birthday_stats(build("lunar", m, d, year=y))
    ok = out["zodiac"] == expected
    fail += not ok
    # 错误路径：如果用今年的公历对应日的月日，会得到什么？
    wrong = None
    if lunar.LunarDate is not None:
        target = lunar.next_occurrence("lunar", m, d, False)
        if target:
            wrong = _zodiac_sign(target.month, target.day)
    print(f"{'OK ' if ok else 'FAIL'} 阴历 {y}年{m}月{d}日 -> 阳历 {solar} -> 星座 {out['zodiac']}"
          + (f"  (错误路径若用今年会得到 {wrong})" if wrong else ""))

# 3) 阴历缺出生年份：应回退到 target 月日（近似），且不应崩溃
out = _birthday_stats(build("lunar", 7, 7))
print(f"\n阴历缺年份 7/7 -> 星座 {out['zodiac']} (兜底，无崩溃)")

print("\n结果:", "全部通过 ✅" if fail == 0 else f"{fail} 项失败 ❌")
sys.exit(1 if fail else 0)
