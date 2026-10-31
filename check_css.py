"""CSS 健康检查：括号配对 + 属性选择器引号成对 + 关键规则存在。
在浏览器里还会核对实际解析出的规则条数，防止「语法错误把后面整段吞掉」。"""
import pathlib, re, sys

p = pathlib.Path("static/css/styles.css")
s = p.read_text(encoding="utf-8")
bad = []

# 1. 去掉注释后再查括号
stripped = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
if stripped.count("{") != stripped.count("}"):
    bad.append(f"花括号不配对：{{ {stripped.count('{')} vs }} {stripped.count('}')}")
d = 0
for i, ch in enumerate(stripped):
    if ch == "{": d += 1
    elif ch == "}":
        d -= 1
        if d < 0:
            bad.append(f"多余的 }} 在第 {i} 个字符处"); break
if d != 0:
    bad.append(f"结尾括号未闭合，深度 {d}")

# 2. 属性选择器里引号必须成对
for m in re.finditer(r"\[[^\]\n]*\]", stripped):
    t = m.group(0)
    if t.count('"') % 2 or t.count("'") % 2:
        bad.append(f"属性选择器引号不成对：{t}")

# 3. 声明里必须以分号结尾（允许最后一个不带）
for blk in re.finditer(r"\{([^{}]*)\}", stripped):
    body = blk.group(1)
    if not body.strip(): continue
    if ";" not in body and not body.strip().endswith("}"):
        bad.append("声明块缺少分号：%s" % body.strip()[:60])

# 4. 关键规则必须存在
must = [".app {", ":root {", ".pcard {", ".cal-cell", "[data-skin=\"dopamine\"]", "[data-skin=\"ios\"]",
        "[data-accent=\"custom\"]", ".theme-swatch", ".skin-picker", ".tabbar"]
for k in must:
    if k not in s:
        bad.append(f"缺少关键规则：{k}")

if bad:
    print("CSS 检查未通过：")
    for b in bad: print("  -", b)
    sys.exit(1)
print("CSS 检查通过：括号配对、引号成对、关键规则齐全")
