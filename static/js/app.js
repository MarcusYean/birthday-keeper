/* 生日管家 v2.1 前端 SPA */
"use strict";

/* ============ 工具 ============ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let TOKEN = localStorage.getItem("bk_token") || "";
let ME = null; // {username, role}
let CONTACTS = []; // 当前缓存，带派生字段

function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = ok ? "show ok" : "show err";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = ""), 2600);
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    logoutLocal();
    throw new Error("登录已过期，请重新登录");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败 " + res.status);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ============ 弹窗 ============ */
function openModal(html) {
  $("#modal").innerHTML = html;
  $("#overlay").classList.add("show");
}
function closeModal() {
  $("#overlay").classList.remove("show");
  $("#modal").innerHTML = "";
}
$("#overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closeModal();
});

/* ============ 认证流程 ============ */
function logoutLocal() {
  TOKEN = "";
  ME = null;
  localStorage.removeItem("bk_token");
  $("#app-view").classList.add("hidden");
  $("#auth-view").classList.remove("hidden");
}

async function initAuth() {
  const st = await api("/api/setup/status");
  if (!st.initialized) {
    $("#login-form").classList.add("hidden");
    $("#setup-form").classList.remove("hidden");
    $("#auth-sub").textContent = "首次部署 · 创建管理员账号";
    return;
  }
  $("#setup-form").classList.add("hidden");
  $("#login-form").classList.remove("hidden");
  if (TOKEN) {
    try {
      ME = await api("/api/me");
      enterApp();
    } catch (_) { /* token 失效，停留在登录页 */ }
  }
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#login-user").value.trim(), password: $("#login-pass").value }),
    });
    TOKEN = data.token;
    localStorage.setItem("bk_token", TOKEN);
    ME = { username: data.username, role: data.role };
    enterApp();
  } catch (err) { toast(err.message, false); }
});

$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({ username: $("#setup-user").value.trim(), password: $("#setup-pass").value }),
    });
    TOKEN = data.token;
    localStorage.setItem("bk_token", TOKEN);
    ME = { username: data.username, role: data.role };
    toast("管理员创建成功，欢迎使用 🎉");
    enterApp();
  } catch (err) { toast(err.message, false); }
});

$("#logout-btn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch (_) {}
  logoutLocal();
});

function enterApp() {
  $("#auth-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#user-chip").textContent =
    (ME.role === "admin" ? "👑 " : "👤 ") + ME.username + (ME.role === "admin" ? "（管理员）" : "");
  $$(".admin-only").forEach((el) =>
    el.classList.toggle("hidden", ME.role !== "admin"));
  switchView("contacts");
}

/* ============ 视图路由 ============ */
const VIEW_TITLES = {
  contacts: "联系人",
  upcoming: "即将到来",
  settings: "系统设置",
  users: "用户管理",
};

function switchView(name) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  $$(".nav-item").forEach((n) =>
    n.classList.toggle("active", n.dataset.view === name));
  $("#view-title").textContent = VIEW_TITLES[name] || name;
  if (name === "contacts") loadContacts();
  if (name === "upcoming") loadUpcoming();
  if (name === "settings") loadSettings();
  if (name === "users") loadUsers();
}

$$(".nav-item").forEach((n) =>
  n.addEventListener("click", () => switchView(n.dataset.view)));

/* ============ 视图偏好（联系人页） ============ */
const VIEW_PREFS_KEY = "bk_view_prefs";
const DEFAULT_FIELDS = [
  "avatar", "name", "relationship", "gender", "calendar_badge", "next_date",
  "days_until", "age", "zodiac", "enabled_actions"
];

function loadViewPrefs() {
  try {
    return { ...JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || "{}") };
  } catch {
    return {};
  }
}
function saveViewPrefs(prefs) {
  localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
}
let VIEW_PREFS = {
  mode: "list",
  sort: "days_until_asc",
  group: "none",
  fields: [...DEFAULT_FIELDS],
  ...loadViewPrefs(),
};

const FIELD_META = [
  { key: "avatar", label: "头像" },
  { key: "name", label: "姓名" },
  { key: "relationship", label: "关系" },
  { key: "gender", label: "性别" },
  { key: "birth_time", label: "时辰" },
  { key: "calendar_badge", label: "历法标签" },
  { key: "birth_date", label: "出生日期" },
  { key: "next_date", label: "下次生日" },
  { key: "days_until", label: "倒计时" },
  { key: "age", label: "当前年龄" },
  { key: "age_on_next", label: "届时年龄" },
  { key: "days_lived", label: "已活天数" },
  { key: "zodiac", label: "星座" },
  { key: "chinese_zodiac", label: "生肖" },
  { key: "hobbies", label: "爱好" },
  { key: "note", label: "备注" },
  { key: "enabled_actions", label: "状态与操作" },
];

const CH_NAMES = { wechat: "微信", feishu: "飞书", email: "邮件" };
const BIRTH_TIMES = [
  "", "子时 23:00-01:00", "丑时 01:00-03:00", "寅时 03:00-05:00", "卯时 05:00-07:00",
  "辰时 07:00-09:00", "巳时 09:00-11:00", "午时 11:00-13:00", "未时 13:00-15:00",
  "申时 15:00-17:00", "酉时 17:00-19:00", "戌时 19:00-21:00", "亥时 21:00-23:00"
];
const ZODIACS = ["", "白羊座", "金牛座", "双子座", "巨蟹座", "狮子座", "处女座", "天秤座", "天蝎座", "射手座", "摩羯座", "水瓶座", "双鱼座"];
const AVATARS = ["", "🎂", "🎈", "🎁", "🧸", "🎊", "🎉", "👶", "👧", "👦", "👩", "👨", "👴", "👵", "🧑", "🐶", "🐱", "🐰", "🐯", "🐼", "🐨", "🦊", "🦁"];

function applyToolbar() {
  $("#view-mode").value = VIEW_PREFS.mode;
  $("#sort-by").value = VIEW_PREFS.sort;
  $("#group-by").value = VIEW_PREFS.group;
}

$("#view-mode").addEventListener("change", (e) => { VIEW_PREFS.mode = e.target.value; saveViewPrefs(VIEW_PREFS); renderContacts(); });
$("#sort-by").addEventListener("change", (e) => { VIEW_PREFS.sort = e.target.value; saveViewPrefs(VIEW_PREFS); renderContacts(); });
$("#group-by").addEventListener("change", (e) => { VIEW_PREFS.group = e.target.value; saveViewPrefs(VIEW_PREFS); renderContacts(); });
$("#fields-btn").addEventListener("click", openFieldPicker);
$("#refresh-btn").addEventListener("click", loadContacts);
$("#add-btn").addEventListener("click", () => openContactModal(null));

/* ============ 联系人 ============ */
async function loadContacts() {
  const box = $("#contacts-list");
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    CONTACTS = await api("/api/birthdays");
    applyToolbar();
    renderContacts();
  } catch (err) { box.innerHTML = ""; toast(err.message, false); }
}

function sortContacts(rows) {
  const s = VIEW_PREFS.sort;
  const a = [...rows];
  const direction = s.endsWith("_desc") ? -1 : 1;
  const key = s.replace(/_(asc|desc)$/, "");

  const getVal = (r) => {
    if (key === "name") return r.name || "";
    if (key === "days_until") return r.days_until == null ? 9999 : r.days_until;
    if (key === "age") return r.age == null ? -1 : r.age;
    if (key === "month_day") return (r.month || 0) * 100 + (r.day || 0);
    if (key === "created_at") return r.created_at || "";
    return r.name || "";
  };
  a.sort((x, y) => {
    const vx = getVal(x), vy = getVal(y);
    if (vx < vy) return -1 * direction;
    if (vx > vy) return 1 * direction;
    return 0;
  });
  return a;
}

function groupValue(r) {
  const g = VIEW_PREFS.group;
  if (g === "none") return null;
  if (g === "birth_month") return r.month ? `${r.month} 月` : "未填写";
  if (g === "calendar_type") return r.calendar_type === "lunar" ? "农历生日" : "公历生日";
  if (g === "zodiac") return r.zodiac || "未填写";
  if (g === "chinese_zodiac") return r.chinese_zodiac || "未填写";
  return r[g] || "未分组";
}

function groupContacts(rows) {
  if (VIEW_PREFS.group === "none") return [{ title: "全部联系人", items: rows }];
  const map = new Map();
  rows.forEach((r) => {
    const k = groupValue(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  const titles = Array.from(map.keys());
  // 常见分组排序：月份按数字，其他按字母/原样
  if (VIEW_PREFS.group === "birth_month") {
    titles.sort((a, b) => parseInt(a) - parseInt(b));
  }
  return titles.map((t) => ({ title: t, items: map.get(t) }));
}

function renderContacts() {
  const box = $("#contacts-list");
  if (!CONTACTS.length) {
    box.innerHTML = '<div class="empty">还没有联系人，点击「+ 添加联系人」开始记录 🎂</div>';
    return;
  }
  const sorted = sortContacts(CONTACTS);
  const groups = groupContacts(sorted);
  const html = groups.map((g) => renderGroup(g)).join("");
  box.innerHTML = html;
}

function renderGroup(g) {
  const mode = VIEW_PREFS.mode;
  const items = g.items.map((r) => {
    if (mode === "card") return cardHtml(r);
    if (mode === "compact") return compactRowHtml(r);
    return listRowHtml(r);
  }).join("");

  if (mode === "card") {
    return `<div class="group"><div class="group-title">${esc(g.title)} <span class="group-count">${g.items.length}</span></div><div class="card-grid">${items}</div></div>`;
  }
  if (mode === "compact") {
    return `<div class="group"><div class="group-title">${esc(g.title)} <span class="group-count">${g.items.length}</span></div><div class="compact-list">${items}</div></div>`;
  }
  return `<div class="group"><div class="group-title">${esc(g.title)} <span class="group-count">${g.items.length}</span></div><table class="table"><thead>${listHeader()}</thead><tbody>${items}</tbody></table></div>`;
}

function hasField(key) { return VIEW_PREFS.fields.includes(key); }

function listHeader() {
  const ths = [];
  if (hasField("avatar")) ths.push("<th></th>");
  if (hasField("name")) ths.push("<th>姓名</th>");
  if (hasField("relationship")) ths.push("<th>关系</th>");
  if (hasField("gender")) ths.push("<th>性别</th>");
  if (hasField("birth_time")) ths.push("<th>时辰</th>");
  if (hasField("calendar_badge")) ths.push("<th>历法</th>");
  if (hasField("birth_date")) ths.push("<th>出生日期</th>");
  if (hasField("next_date")) ths.push("<th>下次生日</th>");
  if (hasField("days_until")) ths.push("<th>倒计时</th>");
  if (hasField("age")) ths.push("<th>年龄</th>");
  if (hasField("age_on_next")) ths.push("<th>届时</th>");
  if (hasField("days_lived")) ths.push("<th>已活天数</th>");
  if (hasField("zodiac")) ths.push("<th>星座</th>");
  if (hasField("chinese_zodiac")) ths.push("<th>生肖</th>");
  if (hasField("hobbies")) ths.push("<th>爱好</th>");
  if (hasField("note")) ths.push("<th>备注</th>");
  if (hasField("enabled_actions")) ths.push('<th class="ta-r">状态 / 操作</th>');
  return `<tr>${ths.join("")}</tr>`;
}

function listRowHtml(r) {
  const cells = [];
  if (hasField("avatar")) cells.push(`<td>${avatarHtml(r)}</td>`);
  if (hasField("name")) cells.push(`<td><b>${esc(r.name)}</b>${subLine(r)}</td>`);
  if (hasField("relationship")) cells.push(`<td>${esc(r.relationship || "-")}</td>`);
  if (hasField("gender")) cells.push(`<td>${genderBadge(r.gender)}</td>`);
  if (hasField("birth_time")) cells.push(`<td>${esc((r.birth_time || "").split(" ")[0] || "-")}</td>`);
  if (hasField("calendar_badge")) cells.push(`<td>${calendarBadge(r)}</td>`);
  if (hasField("birth_date")) cells.push(`<td>${birthDateLabel(r)}</td>`);
  if (hasField("next_date")) cells.push(`<td>${nextDateLabel(r)}</td>`);
  if (hasField("days_until")) cells.push(`<td>${daysBadge(r)}</td>`);
  if (hasField("age")) cells.push(`<td>${ageLabel(r.age)}</td>`);
  if (hasField("age_on_next")) cells.push(`<td>${ageLabel(r.age_on_next)}</td>`);
  if (hasField("days_lived")) cells.push(`<td>${r.days_lived != null ? `<span class="num">${r.days_lived.toLocaleString()}</span>` : "-"}</td>`);
  if (hasField("zodiac")) cells.push(`<td>${zodiacBadge(r.zodiac)}</td>`);
  if (hasField("chinese_zodiac")) cells.push(`<td>${r.chinese_zodiac || "-"}</td>`);
  if (hasField("hobbies")) cells.push(`<td class="ellipsis">${esc(r.hobbies || "-")}</td>`);
  if (hasField("note")) cells.push(`<td class="ellipsis">${esc(r.note || "-")}</td>`);
  if (hasField("enabled_actions")) cells.push(`<td class="ta-r">${actionsHtml(r)}</td>`);
  return `<tr>${cells.join("")}</tr>`;
}

function cardHtml(r) {
  const name = esc(r.name);
  return `
  <div class="contact-card">
    <div class="cc-head">
      <div class="cc-avatar">${avatarHtml(r, true)}</div>
      <div class="cc-head-info">
        <div class="cc-name">${name}${calendarBadge(r)}</div>
        <div class="cc-sub">${metaLine(r)}</div>
      </div>
    </div>
    <div class="cc-stats">
      ${hasField("next_date") || hasField("days_until") ? `<div class="cc-stat"><span class="cc-stat-label">下次生日</span><span class="cc-stat-val">${nextDateLabel(r)}</span></div>` : ""}
      ${hasField("days_until") ? `<div class="cc-stat"><span class="cc-stat-label">倒计时</span><span class="cc-stat-val">${daysBadge(r)}</span></div>` : ""}
      ${hasField("age") || hasField("age_on_next") ? `<div class="cc-stat"><span class="cc-stat-label">届时年龄</span><span class="cc-stat-val">${ageLabel(r.age_on_next)}</span></div>` : ""}
      ${hasField("days_lived") ? `<div class="cc-stat"><span class="cc-stat-label">已活天数</span><span class="cc-stat-val">${r.days_lived != null ? `<span class="num">${r.days_lived.toLocaleString()}</span>` : "-"}</span></div>` : ""}
    </div>
    ${hasField("hobbies") && r.hobbies ? `<div class="cc-tags"><span class="muted">爱好：</span>${esc(r.hobbies)}</div>` : ""}
    ${hasField("note") && r.note ? `<div class="cc-note">${esc(r.note)}</div>` : ""}
    <div class="cc-actions">${actionsHtml(r)}</div>
  </div>`;
}

function compactRowHtml(r) {
  return `
  <div class="compact-item">
    <div class="compact-left">
      ${avatarHtml(r)}<b>${esc(r.name)}</b>
      <span class="muted sm">${esc(r.relationship || "")}${r.relationship ? " · " : ""}${calendarBadge(r)}</span>
    </div>
    <div class="compact-right">
      ${hasField("days_until") ? daysBadge(r) : ""}
      ${hasField("next_date") ? `<span class="muted sm">${nextDateLabel(r)}</span>` : ""}
      ${hasField("age") ? `<span class="muted sm">${ageLabel(r.age_on_next)}</span>` : ""}
      ${actionsHtml(r)}
    </div>
  </div>`;
}

/* 小部件 */
function avatarHtml(r, big = false) {
  const av = r.avatar || (r.gender === "男" ? "👨" : r.gender === "女" ? "👩" : "🧑");
  return `<span class="avatar ${big ? "avatar-lg" : ""}">${av}</span>`;
}
function calendarBadge(r) {
  if (r.calendar_type === "lunar") return '<span class="tag tag-lunar">农历</span>';
  return '<span class="tag tag-solar">公历</span>';
}
function genderBadge(g) {
  if (!g) return "-";
  const cls = g === "男" ? "male" : g === "女" ? "female" : "";
  return `<span class="tag ${cls}">${g}</span>`;
}
function zodiacBadge(z) { return z ? `<span class="tag zodiac">${esc(z)}</span>` : "-"; }
function ageLabel(age) { return age != null ? `<span class="num">${age}</span> 岁` : "-"; }
function subLine(r) { return (r.relationship && !hasField("relationship")) ? `<div class="muted sm">${esc(r.relationship)}</div>` : ""; }
function metaLine(r) {
  const parts = [];
  if (r.relationship && hasField("relationship")) parts.push(esc(r.relationship));
  if (r.gender && hasField("gender")) parts.push(genderBadge(r.gender));
  if (r.birth_time && hasField("birth_time")) parts.push(esc((r.birth_time || "").split(" ")[0]));
  if (r.zodiac && hasField("zodiac")) parts.push(zodiacBadge(r.zodiac));
  if (r.chinese_zodiac && hasField("chinese_zodiac")) parts.push(r.chinese_zodiac);
  return parts.join(" ") || "&nbsp;";
}
function birthDateLabel(r) {
  const cal = r.calendar_type === "lunar" ? "农历" : "公历";
  const y = r.year ? r.year + " 年 " : "";
  return `${cal} ${y}${r.month} 月 ${r.day} 日${r.is_leap ? "（闰月）" : ""}`;
}
function nextDateLabel(r) {
  if (!r.next_date) return "-";
  return `<span class="mono">${r.next_date}</span>`;
}
function daysBadge(r) {
  if (r.days_until == null) return "-";
  if (r.is_today) return '<span class="tag today">🎉 今天</span>';
  if (r.days_until === 0) return '<span class="tag today">🎉 今天</span>';
  if (r.days_until <= 3) return `<span class="tag soon">${r.days_until} 天后</span>`;
  if (r.days_until <= 14) return `<span class="tag near">${r.days_until} 天后</span>`;
  return `<span class="tag">${r.days_until} 天后</span>`;
}
function actionsHtml(r) {
  const en = r.enabled ? '<span class="tag tag-on">启用</span>' : '<span class="tag tag-off">停用</span>';
  const btns = `
    <button class="btn btn-ghost btn-sm" onclick="testNotify(${r.id})">测试</button>
    <button class="btn btn-ghost btn-sm" onclick='editContact(${JSON.stringify(r).replace(/'/g, "&#39;")})'>编辑</button>
    <button class="btn btn-danger-ghost btn-sm" onclick="delContact(${r.id}, '${esc(r.name)}')">删除</button>
  `;
  return `<div class="actions">${en}${btns}</div>`;
}

window.testNotify = async (id) => {
  toast("正在发送测试通知…");
  try {
    const data = await api(`/api/birthdays/${id}/test`, { method: "POST" });
    const msg = data.results
      .map((r) => `${CH_NAMES[r.channel] || r.channel}：${r.ok ? "✅成功" : "❌" + r.message}`)
      .join("；");
    toast(msg || "没有可用渠道，请先在「设置」中启用", data.results.every((r) => r.ok));
  } catch (err) { toast(err.message, false); }
};

window.delContact = async (id, name) => {
  if (!confirm(`确定删除「${name}」吗？`)) return;
  try {
    await api(`/api/birthdays/${id}`, { method: "DELETE" });
    toast("已删除");
    loadContacts();
  } catch (err) { toast(err.message, false); }
};

window.editContact = (r) => openContactModal(r);

/* 字段选择器 */
function openFieldPicker() {
  const rows = FIELD_META.map((f) => `
    <label class="field-check">
      <input type="checkbox" value="${f.key}" ${VIEW_PREFS.fields.includes(f.key) ? "checked" : ""} />
      <span>${f.label}</span>
    </label>
  `).join("");
  openModal(`
    <h2>选择显示字段</h2>
    <p class="muted sm" style="margin-bottom:12px">勾选希望在联系人列表/卡片中显示的字段。</p>
    <form id="fields-form" class="field-picker">${rows}</form>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button type="button" class="btn btn-primary" id="save-fields-btn">保存</button>
    </div>
  `);
  $("#save-fields-btn").addEventListener("click", () => {
    const chosen = $$("#fields-form input:checked").map((i) => i.value);
    if (!chosen.includes("name")) chosen.unshift("name"); // 至少保留姓名
    if (!chosen.includes("enabled_actions")) chosen.push("enabled_actions"); // 保留操作
    VIEW_PREFS.fields = chosen;
    saveViewPrefs(VIEW_PREFS);
    closeModal();
    renderContacts();
    toast("显示字段已更新");
  });
}

/* 添加/编辑联系人弹窗 */
function openContactModal(r) {
  const isEdit = !!r;
  r = r || {};
  const nd = (r.notify_days || []).join(",");
  const chs = r.channels || [];
  const zodiac = r.zodiac || "";
  const gender = r.gender || "";
  const birthTime = r.birth_time || "";
  const avatar = r.avatar || "";
  const hobbies = r.hobbies || "";

  openModal(`
    <h2>${isEdit ? "编辑联系人" : "添加联系人"}</h2>
    <form id="contact-form" class="modal-form">
      <div class="grid2">
        <div class="field">
          <label>姓名 *</label>
          <input id="c-name" type="text" required value="${esc(r.name || "")}" placeholder="如：老爸" />
        </div>
        <div class="field">
          <label>关系</label>
          <input id="c-rel" type="text" value="${esc(r.relationship || "")}" placeholder="如：家人 / 朋友" />
        </div>
      </div>

      <div class="grid3">
        <div class="field">
          <label>性别</label>
          <select id="c-gender">${["", "男", "女", "其他"].map((v) => `<option value="${v}" ${gender === v ? "selected" : ""}>${v || "-"}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>头像</label>
          <select id="c-avatar">${AVATARS.map((v) => `<option value="${v}" ${avatar === v ? "selected" : ""}>${v || "默认"}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>出生时辰</label>
          <select id="c-birth-time">${BIRTH_TIMES.map((v) => `<option value="${esc(v)}" ${birthTime === v ? "selected" : ""}>${v ? v.split(" ")[0] + " " + v.split(" ")[1] : "-"}</option>`).join("")}</select>
        </div>
      </div>

      <div class="grid2">
        <div class="field">
          <label>历法类型</label>
          <select id="c-cal">
            <option value="solar" ${r.calendar_type !== "lunar" ? "selected" : ""}>公历（阳历）</option>
            <option value="lunar" ${r.calendar_type === "lunar" ? "selected" : ""}>农历（阴历）</option>
          </select>
        </div>
        <div class="field">
          <label>星座（留空则自动根据生日计算）</label>
          <select id="c-zodiac">${ZODIACS.map((v) => `<option value="${v}" ${zodiac === v ? "selected" : ""}>${v || "自动计算"}</option>`).join("")}</select>
        </div>
      </div>

      <div class="grid3">
        <div class="field">
          <label>出生年份（可选，用于计算年龄）</label>
          <input id="c-year" type="number" min="1900" max="2100" value="${r.year || ""}" placeholder="如 1960" />
        </div>
        <div class="field">
          <label>月 *</label>
          <input id="c-month" type="number" min="1" max="12" required value="${r.month || ""}" />
        </div>
        <div class="field">
          <label>日 *</label>
          <input id="c-day" type="number" min="1" max="31" required value="${r.day || ""}" />
        </div>
      </div>

      <div class="field">
        <label class="chk"><input id="c-leap" type="checkbox" ${r.is_leap ? "checked" : ""}/> 闰月（仅农历）</label>
      </div>

      <div class="field">
        <label>爱好（用逗号分隔）</label>
        <input id="c-hobbies" type="text" value="${esc(hobbies)}" placeholder="如：读书、旅游、羽毛球" />
      </div>

      <div class="field">
        <label>提前提醒天数（逗号分隔，留空则跟随全局默认）</label>
        <input id="c-days" type="text" value="${nd}" placeholder="如 1,3,7 表示提前1/3/7天各提醒一次" />
      </div>
      <div class="field">
        <label>提醒渠道（留空则跟随全局默认）</label>
        <div class="chk-row">
          <label class="chk"><input type="checkbox" class="c-ch" value="wechat" ${chs.includes("wechat") ? "checked" : ""}/> 微信</label>
          <label class="chk"><input type="checkbox" class="c-ch" value="feishu" ${chs.includes("feishu") ? "checked" : ""}/> 飞书</label>
          <label class="chk"><input type="checkbox" class="c-ch" value="email" ${chs.includes("email") ? "checked" : ""}/> 邮件</label>
        </div>
      </div>
      <div class="field">
        <label>备注</label>
        <input id="c-note" type="text" value="${esc(r.note || "")}" placeholder="如：喜欢的礼物、忌口等" />
      </div>
      <div class="field">
        <label class="chk"><input id="c-enabled" type="checkbox" ${r.enabled === false ? "" : "checked"}/> 启用提醒</label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "保存" : "添加"}</button>
      </div>
    </form>
  `);
  $("#contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: $("#c-name").value.trim(),
      relationship: $("#c-rel").value.trim() || null,
      gender: $("#c-gender").value || null,
      birth_time: $("#c-birth-time").value || null,
      zodiac: $("#c-zodiac").value || null,
      hobbies: $("#c-hobbies").value.trim() || null,
      avatar: $("#c-avatar").value || null,
      calendar_type: $("#c-cal").value,
      year: $("#c-year").value ? parseInt($("#c-year").value) : null,
      month: parseInt($("#c-month").value),
      day: parseInt($("#c-day").value),
      is_leap: $("#c-leap").checked,
      notify_days: $("#c-days").value.trim()
        ? $("#c-days").value.split(/[,，\s]+/).filter(Boolean).map(Number).filter((n) => n >= 0)
        : null,
      channels: $$(".c-ch:checked").map((i) => i.value).length
        ? $$(".c-ch:checked").map((i) => i.value)
        : null,
      note: $("#c-note").value.trim() || null,
      enabled: $("#c-enabled").checked,
    };
    try {
      if (isEdit) await api(`/api/birthdays/${r.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/birthdays", { method: "POST", body: JSON.stringify(body) });
      closeModal();
      toast(isEdit ? "已保存" : "已添加");
      loadContacts();
    } catch (err) { toast(err.message, false); }
  });
}
window.closeModal = closeModal;

/* ============ 即将到来 ============ */
async function loadUpcoming() {
  const box = $("#upcoming-list");
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const rows = await api("/api/upcoming?days=60");
    if (!rows.length) {
      box.innerHTML = '<div class="empty">未来 60 天内没有生日 🍃</div>';
      return;
    }
    box.innerHTML = rows.map((r) => {
      const cal = r.calendar_type === "lunar" ? "农历" : "公历";
      const age = r.age_on_next != null ? ` · ${r.age_on_next} 岁` : "";
      const lived = r.days_lived != null ? `<div class="up-meta">已活 <span class="num">${r.days_lived.toLocaleString()}</span> 天</div>` : "";
      return `<div class="up-item">
        <div class="up-left">
          <div class="up-name">${avatarHtml(r)} ${esc(r.name)} <span class="muted sm">${esc(r.relationship || "")}</span></div>
          <div class="muted sm">${cal} ${r.month}.${r.day} · ${r.next_date}${age}</div>
          ${lived}
        </div>
        ${daysBadge(r)}
      </div>`;
    }).join("");
  } catch (err) { box.innerHTML = ""; toast(err.message, false); }
}

/* ============ 设置（每个参数带说明） ============ */
const SETTINGS_SCHEMA = [
  {
    key: "notify",
    icon: "⏰",
    title: "提醒策略",
    desc: "控制系统每天什么时候检查生日、默认提前几天提醒、默认用什么渠道发送。",
    fields: [
      { path: "notify.check_hour", label: "每日检查时间 - 小时", type: "number", min: 0, max: 23,
        help: "系统每天在这个小时执行一次生日检查（24小时制，0-23）。例如填 8 表示每天早上 8 点检查并发送提醒。保存后立即生效，无需重启。" },
      { path: "notify.check_minute", label: "每日检查时间 - 分钟", type: "number", min: 0, max: 59,
        help: "配合上面的小时使用，精确到分钟（0-59）。例如小时填 8、分钟填 30，即每天 8:30 检查。" },
      { path: "notify.default_notify_days", label: "默认提前提醒天数", type: "numlist",
        help: "全局默认的提前提醒天数，多个值用逗号分隔。例如「1,3,7」表示每位联系人会在生日前 7 天、3 天、1 天各收到一次提醒。若某个联系人单独设置了天数，则以联系人自己的设置为准。填 0 表示当天也提醒。" },
      { path: "notify.default_channels", label: "默认提醒渠道", type: "channels",
        help: "全局默认使用哪些渠道发送提醒（可多选）。联系人未单独指定渠道时使用此设置。注意：勾选的渠道还需在下方对应板块中「启用」并填好参数才能真正发出。" },
    ],
  },
  {
    key: "wechat",
    icon: "💬",
    title: "微信推送",
    desc: "通过第三方推送服务把提醒发到你的微信。推荐 Server酱（sct.ftqq.com）或 PushPlus（pushplus.plus），注册后复制 Token 填入即可。",
    fields: [
      { path: "wechat.enabled", label: "启用微信推送", type: "bool",
        help: "总开关。关闭后即使联系人选择了微信渠道，也不会发送微信提醒。" },
      { path: "wechat.type", label: "推送服务类型", type: "select",
        options: [["serverchan", "Server酱 (sct.ftqq.com)"], ["pushplus", "PushPlus (pushplus.plus)"], ["bark", "Bark (iOS 通知)"]],
        help: "选择你使用的推送服务商：Server酱/PushPlus 推送到微信服务号，Bark 推送到 iPhone 系统通知。三者都是免费注册后获得一个 Token。" },
      { path: "wechat.token", label: "推送 Token / Key", type: "password",
        help: "推送服务的密钥。Server酱在「Key&API」页面复制 SendKey（SCT 开头）；PushPlus 在「一对一推送」页面复制 token；Bark 为 App 中显示的设备 Key。" },
      { path: "wechat.bark_server", label: "Bark 服务器地址", type: "text",
        help: "仅使用 Bark 时需要。默认官方服务器 https://api.day.app，如果你自建了 Bark 服务端可改为自己的地址。使用 Server酱/PushPlus 时此项忽略。" },
    ],
  },
  {
    key: "feishu",
    icon: "🚀",
    title: "飞书机器人",
    desc: "通过飞书群「自定义机器人」发送提醒卡片。在飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人，即可获得 Webhook 地址。",
    fields: [
      { path: "feishu.enabled", label: "启用飞书提醒", type: "bool",
        help: "总开关。关闭后不会向飞书发送任何提醒。" },
      { path: "feishu.webhook", label: "Webhook 地址", type: "text",
        help: "自定义机器人的 Webhook URL，形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxx。添加机器人时飞书会自动生成，直接复制粘贴到这里。" },
      { path: "feishu.secret", label: "签名密钥（可选）", type: "password",
        help: "如果创建机器人时勾选了「签名校验」安全设置，把生成的密钥填在这里；系统会自动计算签名。没有开启签名校验则留空。" },
    ],
  },
  {
    key: "email",
    icon: "📧",
    title: "邮件通知",
    desc: "通过 SMTP 发送邮件提醒。常见服务：QQ邮箱 smtp.qq.com:465、163邮箱 smtp.163.com:465、Gmail smtp.gmail.com:465。需要到邮箱设置里开启 SMTP 并获取「授权码」。",
    fields: [
      { path: "email.enabled", label: "启用邮件通知", type: "bool",
        help: "总开关。关闭后不会发送邮件提醒。" },
      { path: "email.smtp_host", label: "SMTP 服务器地址", type: "text",
        help: "发件邮箱的 SMTP 服务器域名，例如 QQ 邮箱为 smtp.qq.com，163 邮箱为 smtp.163.com。" },
      { path: "email.smtp_port", label: "SMTP 端口", type: "number", min: 1, max: 65535,
        help: "SMTP 服务端口。SSL 加密一般为 465（推荐），STARTTLS 为 587，不加密为 25（多数运营商已封禁）。" },
      { path: "email.use_tls", label: "使用 SSL/TLS 加密", type: "bool",
        help: "端口为 465 时应开启（SSL）；开启后邮件传输过程加密，更安全。绝大多数邮箱服务都要求开启。" },
      { path: "email.smtp_user", label: "SMTP 登录账号", type: "text",
        help: "发件邮箱的完整地址，例如 example@qq.com。" },
      { path: "email.smtp_pass", label: "SMTP 授权码", type: "password",
        help: "注意：不是邮箱登录密码，而是邮箱设置中生成的「SMTP 授权码」。QQ邮箱在 设置→账户→POP3/SMTP服务 中开启并生成。" },
      { path: "email.from_addr", label: "发件人地址", type: "text",
        help: "邮件显示的发件人，一般与登录账号相同。留空时自动使用登录账号。" },
      { path: "email.to_addr", label: "收件人地址", type: "text",
        help: "提醒邮件发送到哪个邮箱。可以填自己的常用邮箱，多个收件人用逗号分隔。" },
    ],
  },
  {
    key: "app",
    icon: "🛠️",
    title: "系统",
    desc: "应用基础参数。修改这些参数请谨慎。",
    fields: [
      { path: "app.timezone", label: "时区", type: "text",
        help: "定时检查所使用的时区，默认 Asia/Shanghai（北京时间）。除非 NAS 部署在海外且需要按当地时间提醒，否则不建议修改。" },
      { path: "app.port", label: "容器内服务端口", type: "number", min: 1, max: 65535,
        help: "应用在容器内监听的端口，默认 8000。⚠️ 此项修改后需要重启容器并同步调整 docker-compose 的端口映射才会生效，一般保持默认即可。" },
    ],
  },
];

let SETTINGS_CACHE = null;

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}
function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== "object" || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}

async function loadSettings() {
  const box = $("#settings-form");
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    SETTINGS_CACHE = await api("/api/settings");
    box.innerHTML = SETTINGS_SCHEMA.map(groupHtml).join("");
  } catch (err) { box.innerHTML = ""; toast(err.message, false); }
}

function fieldId(path) { return "set-" + path.replace(/\./g, "-"); }

function groupHtml(g) {
  return `<div class="card settings-group">
    <div class="group-head">
      <div class="group-title">${g.icon} ${g.title}</div>
      <div class="group-desc">${g.desc}</div>
    </div>
    ${g.fields.map(fieldHtml).join("")}
  </div>`;
}

function fieldHtml(f) {
  const val = getPath(SETTINGS_CACHE, f.path);
  const id = fieldId(f.path);
  let input = "";
  if (f.type === "bool") {
    input = `<label class="switch">
      <input type="checkbox" id="${id}" ${val ? "checked" : ""} />
      <span class="slider"></span>
    </label>`;
  } else if (f.type === "select") {
    input = `<select id="${id}">${f.options
      .map(([v, t]) => `<option value="${v}" ${v === val ? "selected" : ""}>${t}</option>`)
      .join("")}</select>`;
  } else if (f.type === "numlist") {
    input = `<input id="${id}" type="text" value="${esc((val || []).join(","))}" placeholder="如 1,3,7" />`;
  } else if (f.type === "channels") {
    const chosen = val || [];
    input = `<div class="chk-row" id="${id}">
      ${["wechat", "feishu", "email"].map((c) =>
        `<label class="chk"><input type="checkbox" value="${c}" ${chosen.includes(c) ? "checked" : ""}/> ${CH_NAMES[c]}</label>`
      ).join("")}
    </div>`;
  } else if (f.type === "password") {
    input = `<input id="${id}" type="password" value="${esc(val || "")}" autocomplete="new-password" placeholder="●●●●●●" />`;
  } else if (f.type === "number") {
    input = `<input id="${id}" type="number" value="${val ?? ""}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} />`;
  } else {
    input = `<input id="${id}" type="text" value="${esc(val ?? "")}" />`;
  }
  return `<div class="field setting-field ${f.type === "bool" ? "field-inline" : ""}">
    <div class="field-main">
      <label for="${id}">${f.label}</label>
      ${input}
    </div>
    <p class="help">${f.help}</p>
  </div>`;
}

function collectSettings() {
  const out = JSON.parse(JSON.stringify(SETTINGS_CACHE));
  for (const g of SETTINGS_SCHEMA) {
    for (const f of g.fields) {
      const id = fieldId(f.path);
      const el = document.getElementById(id);
      if (!el) continue;
      let v;
      if (f.type === "bool") v = el.querySelector ? el.checked : el.checked;
      else if (f.type === "number") v = el.value === "" ? getPath(SETTINGS_CACHE, f.path) : Number(el.value);
      else if (f.type === "numlist")
        v = el.value.split(/[,，\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
      else if (f.type === "channels")
        v = Array.from(el.querySelectorAll("input:checked")).map((i) => i.value);
      else v = el.value.trim();
      setPath(out, f.path, v);
    }
  }
  return out;
}

$("#save-settings-btn").addEventListener("click", async () => {
  try {
    const cfg = collectSettings();
    const h = cfg.notify.check_hour, m = cfg.notify.check_minute;
    if (h < 0 || h > 23 || m < 0 || m > 59) return toast("检查时间不合法（小时0-23，分钟0-59）", false);
    if (!cfg.notify.default_notify_days.length) return toast("默认提前提醒天数至少填一个值", false);
    await api("/api/settings", { method: "POST", body: JSON.stringify(cfg) });
    SETTINGS_CACHE = cfg;
    toast("设置已保存并立即生效 ✅");
  } catch (err) { toast(err.message, false); }
});

/* ============ 用户管理 ============ */
async function loadUsers() {
  const box = $("#users-list");
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const rows = await api("/api/users");
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>用户名</th><th>角色</th><th>创建时间</th><th class="ta-r">操作</th></tr></thead>
        <tbody>${rows.map((u) => `<tr>
          <td><b>${esc(u.username)}</b>${ME && u.username === ME.username ? ' <span class="tag tag-solar">当前</span>' : ""}</td>
          <td>${u.role === "admin" ? '<span class="tag tag-on">管理员</span>' : '<span class="tag tag-off">普通用户</span>'}</td>
          <td class="muted">${esc((u.created_at || "").slice(0, 16).replace("T", " "))}</td>
          <td class="ta-r">
            <button class="btn btn-danger-ghost btn-sm" onclick="delUser(${u.id}, '${esc(u.username)}')">删除</button>
          </td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="muted sm" style="padding:12px 16px">说明：管理员可管理联系人、修改系统设置、管理用户；普通用户只能管理联系人和查看即将到来的生日。</p>`;
  } catch (err) { box.innerHTML = ""; toast(err.message, false); }
}

window.delUser = async (id, name) => {
  if (!confirm(`确定删除用户「${name}」吗？其登录状态将立即失效。`)) return;
  try {
    await api(`/api/users/${id}`, { method: "DELETE" });
    toast("已删除");
    loadUsers();
  } catch (err) { toast(err.message, false); }
};

$("#add-user-btn").addEventListener("click", () => {
  openModal(`
    <h2>新增用户</h2>
    <form id="user-form" class="modal-form">
      <div class="field">
        <label>用户名 *</label>
        <input id="u-name" type="text" required placeholder="登录用户名" />
      </div>
      <div class="field">
        <label>密码 *</label>
        <input id="u-pass" type="password" required placeholder="登录密码" />
      </div>
      <div class="field">
        <label>角色</label>
        <select id="u-role">
          <option value="user">普通用户 — 只能管理联系人、查看提醒</option>
          <option value="admin">管理员 — 可修改系统设置、管理用户</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">创建</button>
      </div>
    </form>
  `);
  $("#user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: $("#u-name").value.trim(),
          password: $("#u-pass").value,
          role: $("#u-role").value,
        }),
      });
      closeModal();
      toast("用户已创建");
      loadUsers();
    } catch (err) { toast(err.message, false); }
  });
});

/* ============ 启动 ============ */
initAuth().catch((err) => toast(err.message, false));
