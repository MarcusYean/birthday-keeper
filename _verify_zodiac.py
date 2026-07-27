import os
import sys

# 避免 import 时触及项目数据库
os.environ["DB_PATH"] = os.path.join(os.path.dirname(__file__), "_zodiac_tmp_test.db")

sys.path.insert(0, os.path.dirname(__file__))
from app.db import _zodiac_sign  # noqa: E402

# (月, 日, 期望星座) —— 覆盖全部 12 个星座及其交界日
CASES = [
    (1, 1, "摩羯座"), (1, 19, "摩羯座"), (1, 20, "水瓶座"), (2, 18, "水瓶座"),
    (2, 19, "双鱼座"), (3, 20, "双鱼座"), (3, 21, "白羊座"), (4, 19, "白羊座"),
    (4, 20, "金牛座"), (5, 20, "金牛座"), (5, 21, "双子座"), (6, 21, "双子座"),
    (6, 22, "巨蟹座"), (7, 22, "巨蟹座"), (7, 23, "狮子座"), (8, 22, "狮子座"),
    (8, 23, "处女座"), (9, 22, "处女座"), (9, 23, "天秤座"), (10, 23, "天秤座"),
    (10, 24, "天蝎座"), (11, 22, "天蝎座"), (11, 23, "射手座"), (12, 21, "射手座"),
    (12, 22, "摩羯座"), (12, 31, "摩羯座"),
]

fail = 0
for m, d, exp in CASES:
    got = _zodiac_sign(m, d)
    ok = got == exp
    if not ok:
        fail += 1
    print(f"{'OK ' if ok else 'FAIL'}  {m:2d}/{d:2d} -> {got}  (期望 {exp})")

print("\n结果:", "全部通过 ✅" if fail == 0 else f"{fail} 项失败 ❌")
sys.exit(1 if fail else 0)
