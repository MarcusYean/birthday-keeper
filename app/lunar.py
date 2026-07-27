"""农历 <-> 公历 转换辅助。

优先使用 zhdate；若未安装则降级返回 None（公历不受影响）。
"""

from datetime import date

try:
    from lunardate import LunarDate
except Exception:  # pragma: no cover
    LunarDate = None


def _solar_this_year(month: int, day: int):
    y = date.today().year
    try:
        return date(y, month, day)
    except ValueError:
        return None


def _lunar_to_solar(year: int, month: int, day: int, is_leap: bool = False):
    if LunarDate is None:
        return None
    # 农历小月可能只有 29 天，逐步回退到该月最后一个有效日
    d = day
    leap = 1 if is_leap else 0
    while d >= 1:
        try:
            ld = LunarDate(year, month, d, leap)
            return ld.to_solar_date() if hasattr(ld, "to_solar_date") else ld.toSolarDate()
        except Exception:
            d -= 1
    # 闰月仅存在于部分年份：若当年根本没有这个闰月（如「闰五月」遇无闰月之年），
    # 则回退到同月的普通版本（民间惯例：无闰月年份在农历同月过），避免「算不出来」。
    if is_leap:
        d = day
        leap = 0
        while d >= 1:
            try:
                ld = LunarDate(year, month, d, leap)
                return ld.to_solar_date() if hasattr(ld, "to_solar_date") else ld.toSolarDate()
            except Exception:
                d -= 1
    return None


def next_occurrence(calendar_type: str, month: int, day: int, is_leap: bool = False):
    """返回下一次生日对应的公历日期（今年；若已过则取明年）。"""
    today = date.today()
    if calendar_type == "lunar":
        target = _lunar_to_solar(today.year, month, day, is_leap)
    else:
        target = _solar_this_year(month, day)

    if target is None:
        return None

    if target < today:
        # 今年已过，顺延到明年
        if calendar_type == "lunar":
            target = _lunar_to_solar(today.year + 1, month, day, is_leap)
        else:
            try:
                target = date(today.year + 1, month, day)
            except ValueError:
                return None
    return target
