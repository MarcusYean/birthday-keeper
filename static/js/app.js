/* 生日管家 v2.6 前端 SPA（含 i18n + 主题偏好） */
"use strict";

/* ============ 工具 ============ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let TOKEN = localStorage.getItem("bk_token") || "";
let ME = null;
let CONTACTS = [];
let ANNIS = [];
let MY_PREFS = { channels: ["inapp"], theme: {}, wechat: {}, feishu: {} };
let UI_PREFS = { menu_position: "left", contact_edit_mode: "modal", anniversary_enabled: true, default_visibility: "private", allow_register: false };

/* 强调色的十六进制值：设置页的色板要用它画小方块 */
const ACCENT_HEX = {
  teal: "#1b6e66", clay: "#b04b2c", indigo: "#4a45c4",
  forest: "#3f6b45", ochre: "#8a6520", graphite: "#3b3a37",
};

/* visibility is named in words on the tag; no icon, and no colour (the chrome holds none) */
const VIS_ICONS = { private: "", family: "", public: ""};
function visBadge(v) {
  const k = (v === "family"|| v === "public") ? v : "private";
  return `<span class="tag vis vis-${k}" title="${t("vis."+ k + "Tip")}">${VIS_ICONS[k]} ${t("vis."+ k)}</span>`;
}
/* 可见范围选项：普通用户只能选「私人 / 家庭」；管理员额外拥有「公开」（系统内所有用户可见） */
function visOptions() {
  return ME && ME.role === "admin"? ["private", "family", "public"] : ["private", "family"];
}

function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = ok ? "show ok": "show err";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = ""), 2800);
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json"};
  if (TOKEN) headers["Authorization"] = "Bearer "+ TOKEN;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { logoutLocal(); throw new Error("登录已过期，请重新登录"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || ("请求失败 "+ res.status));
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

/* ============ 弹窗 / 抽屉 ============ */
function openModal(html) { $("#modal").innerHTML = `<div class="modal-inner">${html}</div>`; $("#overlay").classList.add("show"); }
function closeModal() { $("#overlay").classList.remove("show"); $("#modal").innerHTML = ""; }

function showEditor(html) {
  if (UI_PREFS.contact_edit_mode === "drawer") {
    $("#drawer").innerHTML = `<div class="drawer-inner">${html}</div>`;
    $("#drawer-overlay").classList.add("show");
  } else {
    openModal(html);
  }
}
function closeEditor() {
  $("#overlay").classList.remove("show"); $("#modal").innerHTML = "";
  $("#drawer-overlay").classList.remove("show"); $("#drawer").innerHTML = "";
}
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeModal(); });
$("#drawer-overlay").addEventListener("click", (e) => { if (e.target.id === "drawer-overlay") closeEditor(); });

/* ============ 认证流程 ============ */
function logoutLocal() {
  TOKEN = ""; ME = null; localStorage.removeItem("bk_token");
  $("#app-view").classList.add("hidden"); $("#auth-view").classList.remove("hidden");
}

function initTooltip() {
  const tip = $("#tooltip");
  let current = null;
  const position = (el) => {
    const rect = el.getBoundingClientRect();
    const tRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tRect.width / 2;
    let top = rect.top - tRect.height - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - tRect.width - 8));
    top = Math.max(8, top);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  };
  const show = (el) => {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.classList.add("show");
    position(el);
  };
  const hide = () => { tip.classList.remove("show"); current = null; };
  document.addEventListener("mouseover", (e) => {
      const el = e.target.closest(".info-ic");
      if (el) show(el);
    });
  document.addEventListener("mouseout", (e) => {
      if (e.target.closest(".info-ic")) hide();
    });
  window.addEventListener("scroll", () => { if (current) position(current); }, true);
  document.addEventListener("click", (e) => {
      const el = e.target.closest(".info-ic");
      if (el && ("ontouchstart"in document.documentElement)) {
        show(el); setTimeout(hide, 2500);
      }
    });
}

function showAuthForm(name) {
  ["login", "setup", "register", "forgot", "reset"].forEach((f) => {
      const el = $(`#${f}-form`); if (el) el.classList.toggle("hidden", f !== name);
    });
  const subs = {
    login: t("auth.sub.login"),
    setup: t("auth.sub.setup"),
    register: t("auth.sub.register"),
    forgot: t("auth.sub.forgot"),
    reset: t("auth.sub.reset"),
  };
  $("#auth-sub").textContent = subs[name] || subs.login;
}

let RESET_TOKEN = "";

async function initAuth() {
  initTooltip();
  // 邮件重置链接落地：/reset-password?token=xxx
  const params = new URLSearchParams(location.search);
  if (location.pathname === "/reset-password"&& params.get("token")) {
    RESET_TOKEN = params.get("token");
    showAuthForm("reset");
    return;
  }
  const st = await api("/api/setup/status");
  if (!st.initialized) { showAuthForm("setup"); return; }
  showAuthForm("login");
  $("#to-register").classList.toggle("hidden", !st.allow_register);
  if (TOKEN) { try { ME = await api("/api/me"); enterApp(); } catch (_) {} }
}

/* 登录页链接切换 */
$("#to-register").addEventListener("click", (e) => { e.preventDefault(); showAuthForm("register"); });
$("#to-forgot").addEventListener("click", (e) => { e.preventDefault(); showAuthForm("forgot"); });
$("#reg-back").addEventListener("click", (e) => { e.preventDefault(); showAuthForm("login"); });
$("#forgot-back").addEventListener("click", (e) => { e.preventDefault(); showAuthForm("login"); });
$("#reset-back").addEventListener("click", (e) => { e.preventDefault(); history.replaceState(null, "", "/"); showAuthForm("login"); });

$("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api("/api/register", { method: "POST", body: JSON.stringify({ username: $("#reg-user").value.trim(), password: $("#reg-pass").value }) });
      TOKEN = data.token; localStorage.setItem("bk_token", TOKEN);
      ME = { username: data.username, role: data.role };
      toast(t("toast.regOk")); enterApp();
    } catch (err) { toast(err.message, false); }
  });

$("#forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#forgot-msg"); msg.textContent = t("forgot.sending");
    try {
      const data = await api("/api/forgot-password", { method: "POST", body: JSON.stringify({ username: $("#forgot-user").value.trim() }) });
      msg.textContent = data.message || t("toast.saved");
      msg.className = "auth-msg "+ (data.ok ? "ok": "err");
    } catch (err) { msg.textContent = err.message; msg.className = "auth-msg err"; }
  });

$("#reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#reset-msg");
    try {
      await api("/api/reset-password", { method: "POST", body: JSON.stringify({ token: RESET_TOKEN, password: $("#reset-pass").value }) });
      msg.textContent = t("reset.success"); msg.className = "auth-msg ok";
      setTimeout(() => { history.replaceState(null, "", "/"); showAuthForm("login"); }, 1200);
    } catch (err) { msg.textContent = err.message; msg.className = "auth-msg err"; }
  });

$("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify({ username: $("#login-user").value.trim(), password: $("#login-pass").value }) });
      TOKEN = data.token; localStorage.setItem("bk_token", TOKEN);
      ME = { username: data.username, role: data.role };
      enterApp();
    } catch (err) { toast(err.message, false); }
  });

$("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api("/api/setup", { method: "POST", body: JSON.stringify({ username: $("#setup-user").value.trim(), password: $("#setup-pass").value }) });
      TOKEN = data.token; localStorage.setItem("bk_token", TOKEN);
      ME = { username: data.username, role: data.role };
      toast(t("toast.adminOk")); enterApp();
    } catch (err) { toast(err.message, false); }
  });

const logoutBtn = $("#logout-btn");
if (logoutBtn) logoutBtn.addEventListener("click", async () => { try { await api("/api/logout", { method: "POST"}); } catch (_) {} logoutLocal(); });

async function enterApp() {
  $("#auth-view").classList.add("hidden"); $("#app-view").classList.remove("hidden");
  try { ME = await api("/api/me"); } catch (_) {}
  renderUserChip();
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", ME.role !== "admin"));
  try { UI_PREFS = await api("/api/ui"); } catch (_) {}
  try {
    MY_PREFS = await api("/api/me/prefs");
    /* 账号里保存的配色优先于本机偏好 */
    const th = (MY_PREFS && MY_PREFS.theme) || {};
    if (th.accent && typeof setAccent === "function") setAccent(th.accent);
    if (th.mode && typeof setMode === "function") setMode(th.mode);
  } catch (_) {}
  $("#nav-anniversaries") && $("#nav-anniversaries").classList.toggle("hidden", UI_PREFS.anniversary_enabled === false);
  refreshInviteBadge();
  refreshNotifBadge();
  switchView("dashboard");
}

function renderUserChip() {
  if (!ME) return;
  const name = ME.nickname || ME.username;
  const chip = $("#user-chip");
  chip.innerHTML = '<span class="chip-avatar">' + esc(String(name || "").trim().charAt(0) || "?") + '</span><span class="chip-name">' + esc(name) + '</span>';
  chip.onclick = (e) => {
    const item = e.target.closest(".user-menu-item");
    if (item) {
      if (item.id === "user-logout") { doLogout(); return; }
      switchView(item.dataset.go);
      closeUserMenu();
      return;
    }
    toggleUserMenu();
  };
}
function toggleUserMenu() { const m = document.getElementById("user-menu"); if (m) m.classList.toggle("open"); }
function closeUserMenu() { const m = document.getElementById("user-menu"); if (m) m.classList.remove("open"); }
function doLogout() { api("/api/logout", { method: "POST"}).catch(() => {}); logoutLocal(); }
document.addEventListener("click", (e) => { const m = document.getElementById("user-menu"); if (m && !e.target.closest("#user-chip") && !e.target.closest("#user-menu")) m.classList.remove("open"); });
$("#user-menu").addEventListener("click", (e) => {
    const item = e.target.closest(".user-menu-item");
    if (!item) return;
    if (item.id === "user-logout") { doLogout(); return; }
    if (item.dataset.go) { switchView(item.dataset.go); closeUserMenu(); }
  });

async function refreshInviteBadge() {
  try {
    const invites = await api("/api/families/invites");
    const badge = $("#invite-badge");
    if (badge) { badge.textContent = invites.length || ""; badge.classList.toggle("hidden", !invites.length); }
  } catch (_) {}
}

/* ============ 视图路由 ============ */
let CURRENT_VIEW = "contacts";

function switchView(name) {
  CURRENT_VIEW = name;
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const sec = $("#view-"+ name); if (sec) sec.classList.remove("hidden");
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  $$(".tabbar .tab").forEach((n) => n.classList.toggle("on", n.dataset.view === name));
  renderHead(name);
  if (name === "contacts") loadContacts();
  if (name === "anniversaries") loadAnniversaries();
  if (name === "upcoming") loadUpcoming();
  if (name === "family") loadFamily();
  if (name === "settings") loadSettings();
  if (name === "users") loadUsers();
  if (name === "profile") loadProfile();
  if (name === "dashboard") loadDashboard();
}

/* 每个页面顶部的大标题：衬线标题 + 一行副信息，内容由数据生成。
   只改 .head-main，右侧 .acts 里的按钮是静态的，事件绑定在加载时完成。 */
function setHead(view, title, meta) {
  const box = $("#head-" + view); if (!box) return;
  const main = box.querySelector(".head-main") || box;
  main.innerHTML = `<div class="h1">${title}</div>${meta ? `<div class="meta">${meta}</div>` : ""}`;
}
function renderHead(view) {
  if (view === "dashboard") return;   /* 首页的标题由 renderDashboard 用数据生成 */
  if (view === "contacts") setHead("contacts", esc(t("viewTitle.contacts")), esc(t("head.contacts", { n: CONTACTS.length })));
  if (view === "anniversaries") setHead("anniversaries", esc(t("viewTitle.anniversaries")), esc(t("head.anniversaries", { n: ANNIS.length })));
  if (view === "upcoming") setHead("upcoming", esc(t("viewTitle.upcoming")), esc(t("head.upcoming")));
  if (view === "family") setHead("family", esc(t("viewTitle.family")), esc(t("head.family")));
  if (view === "profile") setHead("profile", esc(t("viewTitle.profile")), esc(t("head.profile")));
  if (view === "settings") setHead("settings", esc(t("viewTitle.settings")), esc(t("head.settings")));
  if (view === "users") setHead("users", esc(t("viewTitle.users")), esc(t("head.users")));
}
$$(".nav-item").forEach((n) => n.addEventListener("click", () => {
      switchView(n.dataset.view);
    }));
$$(".tabbar .tab[data-view]").forEach((n) => n.addEventListener("click", () => switchView(n.dataset.view)));
$("#tab-more").addEventListener("click", () => {
    const items = $$(".nav-item").filter((n) => !n.classList.contains("hidden"))
      .map((n) => `<button type="button" class="user-menu-item" data-goto="${n.dataset.view}">${esc(n.textContent.trim())}</button>`).join("");
    openModal(`<h2>${esc(t("nav.more"))}</h2><div class="user-menu" style="display:block;position:static;padding:0">${items}</div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${esc(t("btn.cancel"))}</button></div>`);
    $$("#modal [data-goto]").forEach((b) => b.addEventListener("click", () => { closeModal(); switchView(b.dataset.goto); }));
  });

/* 语言切换后重新渲染当前视图 */
window.__onLangChange = function () { refreshStaticText(); switchView(CURRENT_VIEW); };

/* ============ 视图偏好 ============ */
const VIEW_PREFS_KEY = "bk_view_prefs";
const DEFAULT_FIELDS = ["avatar", "name", "relationship", "gender", "calendar_badge", "next_date", "days_until", "age", "zodiac", "enabled_actions"];

function loadViewPrefs() { try { return JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || "{}"); } catch { return {}; } }
function saveViewPrefs(p) { localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(p)); }
let VIEW_PREFS = { mode: "card", sort: "days_until_asc", group: "none", per_page: 50, page: 1, fields: [...DEFAULT_FIELDS], ...loadViewPrefs() };
if (VIEW_PREFS.mode === "list" || VIEW_PREFS.mode === "compact") VIEW_PREFS.mode = "card";
let FIELD_SET = new Set(VIEW_PREFS.fields);
let SELECTED_IDS = new Set();

/* 纪念日的视图偏好独立一份 */
const ANNI_PREFS_KEY = "bk_anni_prefs";
function loadAnniPrefs() { try { return JSON.parse(localStorage.getItem(ANNI_PREFS_KEY) || "{}"); } catch { return {}; } }
function saveAnniPrefs(p) { localStorage.setItem(ANNI_PREFS_KEY, JSON.stringify(p)); }
let ANNI_PREFS = { mode: "card", ...loadAnniPrefs() };
if (ANNI_PREFS.mode !== "list") ANNI_PREFS.mode = "card";

const UPCOMING_PREFS_KEY = "bk_upcoming_prefs";
function loadUpcomingPrefs() { try { return JSON.parse(localStorage.getItem(UPCOMING_PREFS_KEY) || "{}"); } catch { return {}; } }
function saveUpcomingPrefs(p) { localStorage.setItem(UPCOMING_PREFS_KEY, JSON.stringify(p)); }
let UPCOMING_PREFS = { mode: "list", ...loadUpcomingPrefs() };
let UPCOMING_ROWS = [];

function buildFieldMeta() {
  return [
    { key: "avatar", label: t("field.avatar") }, { key: "name", label: t("field.name") }, { key: "relationship", label: t("field.relationship") },
    { key: "gender", label: t("field.gender") }, { key: "birth_time", label: t("field.birthTime") }, { key: "calendar_badge", label: t("field.calBadge") },
    { key: "birth_date", label: t("field.birthDate") }, { key: "next_date", label: t("field.nextDate") }, { key: "days_until", label: t("field.countdown") },
    { key: "age", label: t("field.age") }, { key: "age_on_next", label: t("field.ageNext") }, { key: "days_lived", label: t("field.daysLived") },
    { key: "zodiac", label: t("field.zodiac") }, { key: "chinese_zodiac", label: t("field.zodiacCn") }, { key: "mbti", label: t("field.mbti") },
    { key: "blood_type", label: t("field.blood") }, { key: "hobbies", label: t("field.hobbies") }, { key: "note", label: t("field.note") },
    { key: "enabled_actions", label: t("field.actions") },
  ];
}
let FIELD_META = buildFieldMeta();

function chNames() { return { wechat: t("ch.wechat"), feishu: t("ch.feishu"), email: t("ch.email") }; }
function getChineseZodiac(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1) return null;
  return CHINESE_ZODIACS[y % 12];
}
function daysPickerHtml(name, selected) {
  const opts = [0, 1, 2, 3, 5, 7, 10, 15, 30];
  const set = new Set((selected || []).map(Number).filter((n) => Number.isFinite(n)));
  return `<div class="chk-row" id="${name}">${opts.map((d) => `<label class="chk"><input type="checkbox" value="${d}"${set.has(d) ? "checked": ""}/> ${d === 0 ? t("notify.day0") : d + t("unit.days")}</label>`).join("")}</div>`;
}
function collectDays(name) {
  const vals = $$(`#${name} input:checked`).map((i) => Number(i.value));
  return vals.length ? vals : null;
}
const BIRTH_TIMES = ["", "子时 23:00-01:00", "丑时 01:00-03:00", "寅时 03:00-05:00", "卯时 05:00-07:00", "辰时 07:00-09:00", "巳时 09:00-11:00", "午时 11:00-13:00", "未时 13:00-15:00", "申时 15:00-17:00", "酉时 17:00-19:00", "戌时 19:00-21:00", "亥时 21:00-23:00"];
const ZODIACS = ["", "白羊座", "金牛座", "双子座", "巨蟹座", "狮子座", "处女座", "天秤座", "天蝎座", "射手座", "摩羯座", "水瓶座", "双鱼座"];
const CHINESE_ZODIACS = ["猴", "鸡", "狗", "猪", "鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊"];
/* avatars are a photograph, or the person's own initial; no emoji set */
const AVATARS = [""];
const BLOOD_TYPES = ["", "A", "B", "AB", "O"];
const MBTI_TYPES = ["", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"];

const BLOOD_ANALYSIS = {
  "A": "A 型：严谨细致、责任感强、追求完美，但易焦虑。建议规律作息、注意肠胃。",
  "B": "B 型：开朗自由、富有创造力、适应力强，偶尔略显随性。",
  "AB": "AB 型：理性与感性并存、观察力强、善于社交，有时优柔寡断。",
  "O": "O 型：乐观自信、行动力强、富有领导力，偶尔较为固执。",
};
const MBTI_ANALYSIS = {
  "INTJ": "INTJ 建筑师：战略型思考者，独立、有远见、逻辑缜密。", "INTP": "INTP 逻辑学家：热爱思辨，好奇心强，擅长抽象分析。",
  "ENTJ": "ENTJ 指挥官：天生的领导者，果断、高效、目标导向。", "ENTP": "ENTP 辩论家：机敏善辩，点子多，喜欢挑战常规。",
  "INFJ": "INFJ 提倡者：理想主义、洞察人心、富有同理心。", "INFP": "INFP 调停者：温柔善良、重视价值与意义。",
  "ENFJ": "ENFJ 主人公：感染力强，乐于助人，天生的人际纽带。", "ENFP": "ENFP 竞选者：热情洋溢、富有想象、自由不羁。",
  "ISTJ": "ISTJ 物流师：务实可靠、遵守规则、值得信赖。", "ISFJ": "ISFJ 守卫者：细心体贴、默默付出、重视责任。",
  "ESTJ": "ESTJ 总经理：组织力强、条理清晰、重视秩序。", "ESFJ": "ESFJ 执政官：热心周到、善于协调、关心他人。",
  "ISTP": "ISTP 鉴赏家：冷静动手派，擅长解决现实问题。", "ISFP": "ISFP 探险家：温柔艺术感强，活在当下、随性自由。",
  "ESTP": "ESTP 企业家：行动派、反应快、喜欢刺激与挑战。", "ESFP": "ESFP 表演者：活力四射、热爱热闹、感染力强。",
};
function bloodTip(tp) { return tp ? (BLOOD_ANALYSIS[tp] || "暂无该血型分析。") : "选择血型后，悬停可查看性格与健康小贴士。"; }
function mbtiTip(tp) { return tp ? (MBTI_ANALYSIS[tp] || "暂无该 MBTI 分析。") : "选择 MBTI 后，悬停可查看性格特质分析。"; }

/* ============ 搜索与筛选（联系人 / 纪念日 / 即将到来 通用） ============ */
const VIEW_STATE = {
  contacts: { search: "", filters: { gender: "", zodiac: "", zodiacCn: "", calendar: "", enabled: ""} },
  annis: { search: "", filters: { calendar: "", enabled: ""} },
  upcoming: { search: "", filters: { category: "", calendar: ""} },
};
const SEARCH_FIELDS = {
  contacts: ["name", "relationship", "gender", "zodiac", "chinese_zodiac", "mbti", "blood_type", "hobbies", "note", "calendar_type"],
  annis: ["name", "kind", "note", "calendar_type"],
  upcoming: ["name", "relationship", "kind"],
};
function _norm(s) { return String(s == null ? "": s).toLowerCase(); }
function matchesSearch(view, r) {
  const term = (VIEW_STATE[view].search || "").trim().toLowerCase();
  if (!term) return true;
  return (SEARCH_FIELDS[view] || []).some((f) => _norm(r[f]).includes(term));
}
function _activeCount(st) { return ((st.search || "").trim() ? 1 : 0) + Object.values(st.filters).filter(Boolean).length; }

function getFilteredContacts() {
  const st = VIEW_STATE.contacts; let rows = CONTACTS.filter((r) => matchesSearch("contacts", r));
  const f = st.filters;
  if (f.gender) rows = rows.filter((r) => r.gender === f.gender);
  if (f.zodiac) rows = rows.filter((r) => r.zodiac === f.zodiac);
  if (f.zodiacCn) rows = rows.filter((r) => r.chinese_zodiac === f.zodiacCn);
  if (f.calendar) rows = rows.filter((r) => r.calendar_type === f.calendar);
  if (f.enabled) rows = rows.filter((r) => (r.enabled ? "on": "off") === f.enabled);
  return rows;
}
function getFilteredAnnis() {
  const st = VIEW_STATE.annis; let rows = ANNIS.filter((r) => matchesSearch("annis", r));
  const f = st.filters;
  if (f.calendar) rows = rows.filter((r) => r.calendar_type === f.calendar);
  if (f.enabled) rows = rows.filter((r) => (r.enabled ? "on": "off") === f.enabled);
  return rows;
}
function getFilteredUpcoming() {
  const st = VIEW_STATE.upcoming; let rows = UPCOMING_ROWS.filter((r) => matchesSearch("upcoming", r));
  const f = st.filters;
  if (f.category) rows = rows.filter((r) => r.category === f.category);
  if (f.calendar) rows = rows.filter((r) => r.calendar_type === f.calendar);
  return rows;
}
function populateSelect(el, options, allLabel) {
  if (!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">${esc(allLabel)}</option>` + options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("");
  el.value = cur;
}
function updateFilterBadge(view, badgeId) {
  const el = $("#"+ badgeId); if (!el) return;
  const n = _activeCount(VIEW_STATE[view]);
  el.textContent = n || ""; el.classList.toggle("show", n > 0);
}
function populateContactFilters() {
  populateSelect($("#f-gender"), [["male", t("gender.male")], ["female", t("gender.female")], ["other", t("gender.other")]], t("filter.all"));
  populateSelect($("#f-zodiac"), ZODIACS.slice(1).map((z) => [z, z]), t("filter.all"));
  populateSelect($("#f-zodiacCn"), CHINESE_ZODIACS.map((z) => [z, z]), t("filter.all"));
  populateSelect($("#f-calendar"), [["solar", t("cal.solar")], ["lunar", t("cal.lunar")]], t("filter.all"));
  populateSelect($("#f-enabled"), [["on", t("filter.statusOn")], ["off", t("filter.statusOff")]], t("filter.all"));
  updateFilterBadge("contacts", "contact-filter-count");
}
function populateAnniFilters() {
  populateSelect($("#a-f-calendar"), [["solar", t("cal.solar")], ["lunar", t("cal.lunar")]], t("filter.all"));
  populateSelect($("#a-f-enabled"), [["on", t("filter.statusOn")], ["off", t("filter.statusOff")]], t("filter.all"));
  updateFilterBadge("annis", "anni-filter-count");
}
function populateUpcomingFilters() {
  populateSelect($("#u-f-category"), [["birthday", t("filter.categoryBirthday")], ["anniversary", t("filter.categoryAnni")]], t("filter.all"));
  populateSelect($("#u-f-calendar"), [["solar", t("cal.solar")], ["lunar", t("cal.lunar")]], t("filter.all"));
  updateFilterBadge("upcoming", "upcoming-filter-count");
}

/* ============ 联系人 ============ */
/* 视图切换：卡片 / 表格（分段控件，不是下拉） */
function bindSeg(sel, get, set) {
  const el = $(sel); if (!el) return;
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
        if (get() === b.dataset.mode) return;
        set(b.dataset.mode);
      }));
}
bindSeg("#view-mode", () => VIEW_PREFS.mode, (m) => { VIEW_PREFS.mode = m; saveViewPrefs(VIEW_PREFS); renderContacts(); });
bindSeg("#anni-view-mode", () => ANNI_PREFS.mode, (m) => { ANNI_PREFS.mode = m; saveAnniPrefs(ANNI_PREFS); renderAnniversaries(); });
$("#sort-by").addEventListener("change", (e) => { VIEW_PREFS.sort = e.target.value; saveViewPrefs(VIEW_PREFS); renderContacts(); });
$("#group-by").addEventListener("change", (e) => { VIEW_PREFS.group = e.target.value; saveViewPrefs(VIEW_PREFS); renderContacts(); });
$("#per-page").addEventListener("change", (e) => { VIEW_PREFS.per_page = parseInt(e.target.value) || 0; VIEW_PREFS.page = 1; saveViewPrefs(VIEW_PREFS); renderContacts(); });
$("#fields-btn").addEventListener("click", openFieldPicker);
$("#refresh-btn").addEventListener("click", loadContacts);
$("#add-btn").addEventListener("click", () => openContactEditor(null));
$("#batch-test-btn").addEventListener("click", () => runBatchTestSelection("birthday"));
$("#batch-test-anni-btn").addEventListener("click", () => runBatchTestSelection("anniversary"));
$("#select-all-btn").addEventListener("click", () => { CONTACTS.forEach((r) => SELECTED_IDS.add(r.id)); updateBatchBadge(); renderContacts(); });
$("#select-none-btn").addEventListener("click", () => { SELECTED_IDS.clear(); updateBatchBadge(); renderContacts(); });
$("#select-inv-btn").addEventListener("click", () => { CONTACTS.forEach((r) => { if (SELECTED_IDS.has(r.id)) SELECTED_IDS.delete(r.id); else SELECTED_IDS.add(r.id); }); updateBatchBadge(); renderContacts(); });
$("#up-view-mode").addEventListener("change", (e) => { UPCOMING_PREFS.mode = e.target.value; saveUpcomingPrefs(UPCOMING_PREFS); renderUpcoming(); });

/* 综合搜索 + 组合筛选 + 刷新重算 */
$("#contact-search").addEventListener("input", (e) => { VIEW_STATE.contacts.search = e.target.value; renderContacts(); });
$("#f-gender").addEventListener("change", (e) => { VIEW_STATE.contacts.filters.gender = e.target.value; renderContacts(); });
$("#f-zodiac").addEventListener("change", (e) => { VIEW_STATE.contacts.filters.zodiac = e.target.value; renderContacts(); });
$("#f-zodiacCn").addEventListener("change", (e) => { VIEW_STATE.contacts.filters.zodiacCn = e.target.value; renderContacts(); });
$("#f-calendar").addEventListener("change", (e) => { VIEW_STATE.contacts.filters.calendar = e.target.value; renderContacts(); });
$("#f-enabled").addEventListener("change", (e) => { VIEW_STATE.contacts.filters.enabled = e.target.value; renderContacts(); });
$("#f-reset").addEventListener("click", () => { VIEW_STATE.contacts = { search: "", filters: { gender: "", zodiac: "", zodiacCn: "", calendar: "", enabled: ""} }; $("#contact-search").value = ""; populateContactFilters(); renderContacts(); });
$("#contact-filter-toggle").addEventListener("click", () => { $("#contact-filter-panel").classList.toggle("hidden"); });

$("#anni-search").addEventListener("input", (e) => { VIEW_STATE.annis.search = e.target.value; renderAnniversaries(); });
$("#a-f-calendar").addEventListener("change", (e) => { VIEW_STATE.annis.filters.calendar = e.target.value; renderAnniversaries(); });
$("#a-f-enabled").addEventListener("change", (e) => { VIEW_STATE.annis.filters.enabled = e.target.value; renderAnniversaries(); });
$("#a-f-reset").addEventListener("click", () => { VIEW_STATE.annis = { search: "", filters: { calendar: "", enabled: ""} }; $("#anni-search").value = ""; populateAnniFilters(); renderAnniversaries(); });
$("#anni-filter-toggle").addEventListener("click", () => { $("#anni-filter-panel").classList.toggle("hidden"); });

$("#upcoming-search").addEventListener("input", (e) => { VIEW_STATE.upcoming.search = e.target.value; renderUpcoming(); });
$("#u-f-category").addEventListener("change", (e) => { VIEW_STATE.upcoming.filters.category = e.target.value; renderUpcoming(); });
$("#u-f-calendar").addEventListener("change", (e) => { VIEW_STATE.upcoming.filters.calendar = e.target.value; renderUpcoming(); });
$("#u-f-reset").addEventListener("click", () => { VIEW_STATE.upcoming = { search: "", filters: { category: "", calendar: ""} }; $("#upcoming-search").value = ""; populateUpcomingFilters(); renderUpcoming(); });
$("#upcoming-filter-toggle").addEventListener("click", () => { $("#upcoming-filter-panel").classList.toggle("hidden"); });

$("#refresh-up-btn").addEventListener("click", loadUpcoming);
$("#dash-refresh").addEventListener("click", loadDashboard);

async function loadContacts() {
  const box = $("#contacts-list"); box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
  try {
    CONTACTS = await api("/api/birthdays");
    // 移除已不存在的选中
    const validIds = new Set(CONTACTS.map((r) => r.id));
    SELECTED_IDS = new Set(Array.from(SELECTED_IDS).filter((id) => validIds.has(id)));
    applyToolbar(); updateBatchBadge(); renderContacts(); populateContactFilters();
  }
  catch (err) { box.innerHTML = ""; toast(err.message, false); }
}
function applyToolbar() {
  const vm = $("#view-mode");
  if (vm) vm.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === VIEW_PREFS.mode));
  const am = $("#anni-view-mode");
  if (am) am.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === ANNI_PREFS.mode));
  $("#sort-by").value = VIEW_PREFS.sort;
  $("#group-by").value = VIEW_PREFS.group;
  $("#per-page").value = VIEW_PREFS.per_page;
  const ue = $("#up-view-mode"); if (ue) ue.value = UPCOMING_PREFS.mode;
}

function sortContacts(rows) {
  const s = VIEW_PREFS.sort; const a = [...rows];
  const direction = s.endsWith("_desc") ? -1 : 1; const key = s.replace(/_(asc|desc)$/, "");
  const getVal = (r) => {
    if (key === "name") return r.name || "";
    if (key === "days_until") return r.days_until == null ? 9999 : r.days_until;
    if (key === "age") return r.age == null ? -1 : r.age;
    if (key === "month_day") return (r.month || 0) * 100 + (r.day || 0);
    if (key === "days_lived") return r.days_lived == null ? -1 : r.days_lived;
    if (key === "created_at") return r.created_at || "";
    return r.name || "";
  };
  a.sort((x, y) => { const vx = getVal(x), vy = getVal(y); if (vx < vy) return -1 * direction; if (vx > vy) return 1 * direction; return 0; });
  return a;
}
function groupValue(r) {
  const g = VIEW_PREFS.group;
  if (g === "none") return null;
  if (g === "birth_month") return r.month ? `${r.month} ${t("unit.month")}` : t("group.unfiled");
  if (g === "calendar_type") return r.calendar_type === "lunar"? t("cal.lunar") + t("cal.birthday") : t("cal.solar") + t("cal.birthday");
  if (g === "zodiac") return r.zodiac || t("group.unfiled");
  if (g === "chinese_zodiac") return r.chinese_zodiac || t("group.unfiled");
  return r[g] || t("group.unfiled");
}
function groupContacts(rows) {
  if (VIEW_PREFS.group === "none") return [{ title: t("group.all"), items: rows }];
  const map = new Map();
  rows.forEach((r) => { const k = groupValue(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
  const titles = Array.from(map.keys());
  if (VIEW_PREFS.group === "birth_month") titles.sort((a, b) => parseInt(a) - parseInt(b));
  return titles.map((tt) => ({ title: tt, items: map.get(tt) }));
}
function renderContacts() {
  const box = $("#contacts-list");
  if (!CONTACTS.length) { box.innerHTML = '<div class="empty">' + t("empty.contacts") + '</div>'; $("#contacts-paging").innerHTML = ""; return; }
  const rowsAll = getFilteredContacts();
  if (!rowsAll.length) { box.innerHTML = '<div class="empty">' + t("filter.noResult") + '</div>'; $("#contacts-paging").innerHTML = ""; return; }
  const sorted = sortContacts(rowsAll);
  const perPage = VIEW_PREFS.per_page;
  let pageItems = sorted, totalPages = 1, page = VIEW_PREFS.page || 1;
  if (perPage > 0) {
    totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
    page = Math.max(1, Math.min(page, totalPages));
    VIEW_PREFS.page = page;
    const start = (page - 1) * perPage;
    pageItems = sorted.slice(start, start + perPage);
  } else { VIEW_PREFS.page = 1; }
  const groups = groupContacts(pageItems);
  box.innerHTML = groups.map((g, i) => renderGroup(g, i)).join("");
  renderPagination(sorted.length, totalPages, page);
  updateSelectStates();
}
function renderGroup(g, idx) {
  const mode = VIEW_PREFS.mode;
  const items = g.items.map((r, i) => mode === "card"? cardHtml(r, idx * 12 + i) : mode === "compact"? compactRowHtml(r) : listRowHtml(r)).join("");
  const title = `${esc(g.title)} <span class="group-count">${g.items.length}</span> <label class="group-select" title="${t("group.selectAll")}"><input type="checkbox" class="group-select-all" data-gidx="${idx}"> <span data-i18n="group.selectAll">${t("group.selectAll")}</span></label>`;
  if (mode === "card") return `<div class="group"><div class="group-title">${title}</div><div class="pcards">${items}</div></div>`;
  if (mode === "compact") return `<div class="group"><div class="group-title">${title}</div><div class="compact-list">${items}</div></div>`;
  const cg = listColgroup();
  return `<div class="group"><div class="group-title">${title}</div><div class="table-card"><table class="table table-fixed"style="min-width:${cg.total}px">${cg.html}<thead>${listHeader()}</thead><tbody>${items}</tbody></table></div></div>`;
}
function hasField(key) { return FIELD_SET.has(key); }
function renderPagination(total, totalPages, page) {
  const box = $("#contacts-paging");
  if (totalPages <= 1) { box.innerHTML = `<span class="muted sm">` + t("pagination.total", { n: total }) + `</span>`; return; }
  let html = `<button class="btn btn-ghost btn-sm" id="page-prev"${page === 1 ? "disabled": ""}>${t("pagination.prev")}</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="btn btn-sm page-num ${i === page ? "btn-primary": "btn-ghost"}"data-page="${i}">${i}</button>`;
  }
  html += `<button class="btn btn-ghost btn-sm" id="page-next"${page === totalPages ? "disabled": ""}>${t("pagination.next")}</button>`;
  html += `<span class="muted sm">` + t("pagination.page", { n: total, cur: page, total: totalPages }) + `</span>`;
  box.innerHTML = html;
  $("#page-prev") && $("#page-prev").addEventListener("click", () => { VIEW_PREFS.page--; saveViewPrefs(VIEW_PREFS); renderContacts(); });
  $("#page-next") && $("#page-next").addEventListener("click", () => { VIEW_PREFS.page++; saveViewPrefs(VIEW_PREFS); renderContacts(); });
  $$(".page-num").forEach((b) => b.addEventListener("click", () => { VIEW_PREFS.page = parseInt(b.dataset.page); saveViewPrefs(VIEW_PREFS); renderContacts(); }));
}
function updateBatchBadge() {
  const badge = $("#batch-count");
  if (!badge) return;
  badge.textContent = SELECTED_IDS.size || "";
  badge.classList.toggle("show", SELECTED_IDS.size > 0);
}

/* 列定义（顺序即表头顺序）。宽度用于 colgroup，使分组/分页的多个表格列宽完全一致。 */
const CONTACT_COLUMNS = [
  { key: "avatar", label: "", width: "48px"},
  { key: "name", label: "field.name", width: "150px"},
  { key: "relationship", label: "field.relationship", width: "120px"},
  { key: "gender", label: "field.gender", width: "72px"},
  { key: "birth_time", label: "field.birthTime", width: "98px"},
  { key: "calendar_badge", label: "field.calBadge", width: "68px"},
  { key: "birth_date", label: "field.birthDate", width: "150px"},
  { key: "next_date", label: "field.nextDate", width: "112px"},
  { key: "days_until", label: "field.countdown", width: "96px"},
  { key: "age", label: "field.age", width: "72px"},
  { key: "age_on_next", label: "field.ageNext", width: "72px"},
  { key: "days_lived", label: "field.daysLived", width: "104px"},
  { key: "zodiac", label: "field.zodiac", width: "76px"},
  { key: "chinese_zodiac", label: "field.zodiacCn", width: "54px"},
  { key: "mbti", label: "field.mbti", width: "84px"},
  { key: "blood_type", label: "field.blood", width: "62px"},
  { key: "hobbies", label: "field.hobbies", width: "150px"},
  { key: "note", label: "field.note", width: "170px"},
];
function listColgroup() {
  const cols = ['<col style="width:38px">'];
  let total = 38;
  CONTACT_COLUMNS.forEach((c) => {
      if (!hasField(c.key)) return;
      cols.push('<col style="width:' + c.width + '">');
      total += parseInt(c.width, 10) || 0;
    });
  /* the sum is the width below which the columns start to squeeze; the wrapper scrolls past it */
  return { html: `<colgroup>${cols.join("")}</colgroup>`, total };
}
function listHeader() {
  const ths = ['<th class="select-col"><input type="checkbox" id="select-all-page" title="' + t("toolbar.selectAllPage") + '"></th>'];
  CONTACT_COLUMNS.forEach((c) => {
      if (!hasField(c.key)) return;
      ths.push("<th"+ (c.cls ? ' class="' + c.cls + '"' : "") + ">"+ (c.label ? t(c.label) : "") + "</th>");
    });
  return `<tr>${ths.join("")}</tr>`;
}
function listRowHtml(r) {
  const cells = [];
  cells.push(`<td class="select-col" data-label="${t("toolbar.selectAll")}"><input type="checkbox" class="row-select" value="${r.id}"${SELECTED_IDS.has(r.id) ? "checked": ""}></td>`);
  if (hasField("avatar")) cells.push(`<td data-label="${t("field.avatar")}">${avatarHtml(r)}</td>`);
  if (hasField("name")) cells.push(`<td data-label="${t("field.name")}"><div class="name-cell" onclick="editContact(${r.id})"><div class="name-line"><b>${esc(r.name)}</b>${statusTags(r)}${subLine(r)}</div></div></td>`);
  if (hasField("relationship")) cells.push(`<td data-label="${t("field.relationship")}">${esc(r.relationship || "-")}</td>`);
  if (hasField("gender")) cells.push(`<td data-label="${t("field.gender")}">${genderBadge(r.gender)}</td>`);
  if (hasField("birth_time")) cells.push(`<td data-label="${t("field.birthTime")}">${esc((r.birth_time || "").split("")[0] || "-")}</td>`);
  if (hasField("calendar_badge")) cells.push(`<td data-label="${t("field.calBadge")}">${calendarBadge(r)}</td>`);
  if (hasField("birth_date")) cells.push(`<td data-label="${t("field.birthDate")}">${birthDateLabel(r)}</td>`);
  if (hasField("next_date")) cells.push(`<td data-label="${t("field.nextDate")}">${nextDateLabel(r)}</td>`);
  if (hasField("days_until")) cells.push(`<td data-label="${t("field.countdown")}">${daysBadge(r)}</td>`);
  if (hasField("age")) cells.push(`<td data-label="${t("field.age")}">${ageLabel(r.age)}</td>`);
  if (hasField("age_on_next")) cells.push(`<td data-label="${t("field.ageNext")}">${ageLabel(r.age_on_next)}</td>`);
  if (hasField("days_lived")) cells.push(`<td data-label="${t("field.daysLived")}">${r.days_lived != null ? `<span class="num">${r.days_lived.toLocaleString()}</span>` : "-"}</td>`);
  if (hasField("zodiac")) cells.push(`<td data-label="${t("field.zodiac")}">${zodiacBadge(r.zodiac)}</td>`);
  if (hasField("chinese_zodiac")) cells.push(`<td data-label="${t("field.zodiacCn")}">${esc(r.chinese_zodiac || "-")}</td>`);
  if (hasField("mbti")) cells.push(`<td data-label="${t("field.mbti")}">${r.mbti ? `${esc(r.mbti)} <span class="info-ic" data-tip="${esc(mbtiTip(r.mbti))}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span>` : "-"}</td>`);
  if (hasField("blood_type")) cells.push(`<td data-label="${t("field.blood")}">${r.blood_type ? `${esc(r.blood_type)} <span class="info-ic" data-tip="${esc(bloodTip(r.blood_type))}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span>` : "-"}</td>`);
  if (hasField("hobbies")) cells.push(`<td class="ellipsis" data-label="${t("field.hobbies")}">${esc(r.hobbies || "-")}</td>`);
  if (hasField("note")) cells.push(`<td class="ellipsis" data-label="${t("field.note")}">${esc(r.note || "-")}</td>`);
  return `<tr>${cells.join("")}</tr>`;
}
/* 每个人的固定色相偏移（-42…+42）。头像底色 = 强调色相 + 这个偏移，
   所以换强调色时全家的头像一起换色，而彼此的色相关系保持不变。 */
function hueOffset(key) {
  const s = String(key == null ? "" : key);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return ((h % 13) - 6) * 16;   /* -96 … +96，13 档 */
}
function notifyNodesHtml(days) {
  const list = (Array.isArray(days) ? days : []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return "";
  return list.map((d) => (d === 0 ? t("notify.day0") : d + t("unit.days"))).join(" + ");
}
function cardHtml(r, i = 0) {
  const d = r.days_until;
  const soon = d != null && d >= 0 && d <= 7;
  const passed = d != null && d < 0;
  const tags = [
    r.relationship ? `<span class="tag">${esc(r.relationship)}</span>` : "",
    calendarBadge(r),
    r.zodiac ? `<span class="tag">${esc(r.zodiac)}</span>` : "",
    r.enabled === false ? `<span class="tag tag-off">${esc(t("filter.statusOff"))}</span>` : "",
  ].filter(Boolean).join("");
  const nodes = notifyNodesHtml(r.notify_days);
  const days = d == null ? "—" : passed ? Math.abs(d) : d;
  const unit = d == null ? "" : passed ? t("days.ago") : t("days.left");
  return `
  <div class="pcard${soon ? " soon": ""}" data-id="${r.id}" style="--i:${i}">
  <div class="pcard-top">
  <label class="card-select" title="${t("toolbar.selectAll")}"><input type="checkbox" class="row-select" value="${r.id}"${SELECTED_IDS.has(r.id) ? "checked": ""}></label>
  <span onclick="editContact(${r.id})">${avatarHtml(r)}</span>
  <div class="grow" onclick="editContact(${r.id})">
  <div class="pcard-name">${esc(r.name)}</div>
  <div class="pcard-meta">${tags}</div>
  </div>
  <div class="pcard-days"><div class="n">${days}</div><div class="u">${esc(unit)}</div></div>
  </div>
  <div class="pcard-foot">
  <span class="tag">${nextDateLabel(r)}</span>
  ${nodes ? `<span class="tag">${esc(nodes)}</span>` : `<span class="muted">${esc(t("card.noReminder"))}</span>`}
  <span class="spacer"></span>
  <span class="muted">${r.age_on_next != null ? esc(t("card.willBe", { age: r.age_on_next })) : ""}</span>
  </div>
  </div>`;
}
function compactRowHtml(r) {
  return `
  <div class="compact-item" data-id="${r.id}">
  <label class="compact-select" title="${t("toolbar.selectAll")}"><input type="checkbox" class="row-select" value="${r.id}"${SELECTED_IDS.has(r.id) ? "checked": ""}></label>
  <div class="compact-left" onclick="editContact(${r.id})">
  ${avatarHtml(r)}<b>${esc(r.name)}</b>${statusTags(r)}
  <span class="muted sm">${esc(r.relationship || "")}${r.relationship ? "· ": ""}${calendarBadge(r)}</span>
  </div>
  <div class="compact-right">
  ${hasField("days_until") ? daysBadge(r) : ""}
  ${hasField("next_date") ? `<span class="muted sm">${nextDateLabel(r)}</span>` : ""}
  ${r.mbti ? `${esc(r.mbti)}<span class="info-ic" data-tip="${esc(mbtiTip(r.mbti))}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span>` : ""}
  ${r.blood_type ? `${esc(r.blood_type)}<span class="info-ic" data-tip="${esc(bloodTip(r.blood_type))}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span>` : ""}
  </div>
  </div>`;
}

/* 小部件 */
function avatarHtml(r, big = false) {
  const po = hueOffset(r.id != null ? r.id : r.name);
  const cls = "avatar" + (big ? " avatar-lg": "");
  const style = `style="--po:${po}"`;
  if (r.avatar_url) return `<span class="${cls}" ${style}><img src="${esc(r.avatar_url)}" alt=""/></span>`;
  /* a monogram: the person's own initial, stable and readable at 24px */
  const initial = String(r.name || "").trim().charAt(0) || "?";
  return `<span class="${cls}" ${style}>${esc(initial)}</span>`;
}
function calendarBadge(r) { return r.calendar_type === "lunar"? '<span class="tag tag-lunar">' + t("cal.lunar") + '</span>' : '<span class="tag tag-solar">' + t("cal.solar") + '</span>'; }
function genderKey(g) {
  if (!g) return "";
  const s = String(g).trim().toLowerCase();
  if (s === "male"|| s === "m"|| s === "男"|| s === "雄性") return "male";
  if (s === "female"|| s === "f"|| s === "女"|| s === "雌性") return "female";
  if (s === "other"|| s === "o"|| s === "其他"|| s === "其它") return "other";
  return "";
}
function genderLabel(g) { const k = genderKey(g); return k ? t("gender."+ k) : ""; }
function genderBadge(g) { const k = genderKey(g); if (!k) return "-"; return `<span class="tag ${k}">${t("gender."+ k)}</span>`; }
function zodiacBadge(z) { return z ? `<span class="tag zodiac">${esc(z)}</span>` : "-"; }
function ageLabel(age) { return age != null ? `<span class="num">${age}</span> ${t("unit.years")}` : "-"; }
function subLine(r) { return (r.relationship && !hasField("relationship")) ? `<span class="muted sm">· ${esc(r.relationship)}</span>` : ""; }
function metaLine(r) {
  const parts = [];
  if (r.relationship && hasField("relationship")) parts.push(esc(r.relationship));
  if (r.gender && hasField("gender")) parts.push(genderBadge(r.gender));
  if (r.birth_time && hasField("birth_time")) parts.push(esc((r.birth_time || "").split("")[0]));
  if (r.zodiac && hasField("zodiac")) parts.push(zodiacBadge(r.zodiac));
  if (r.chinese_zodiac && hasField("chinese_zodiac")) parts.push(esc(r.chinese_zodiac));
  if (r.mbti && hasField("mbti")) parts.push(esc(r.mbti));
  if (r.blood_type && hasField("blood_type")) parts.push(esc(r.blood_type));
  return parts.join("") || "&nbsp;";
}
function birthDateLabel(r) {
  const cal = r.calendar_type === "lunar"? t("cal.lunar") : t("cal.solar"); const y = r.year ? r.year + " "+ t("unit.year") + "": "";
  return `${cal} ${y}${r.month} ${t("unit.month")} ${r.day} ${t("unit.day")}${r.is_leap ? "（"+ t("form.leapShort") + "）": ""}`;
}
function nextDateLabel(r) { return r.next_date ? `<span class="mono">${r.next_date}</span>` : "-"; }
function daysBadge(r) {
  if (r.days_until == null) return "-";
  if (r.is_today || r.days_until === 0) return '<span class="tag today"> ' + t("today") + '</span>';
  if (r.days_until <= 3) return `<span class="tag soon">${r.days_until} ${t("days.left")}</span>`;
  if (r.days_until <= 14) return `<span class="tag near">${r.days_until} ${t("days.left")}</span>`;
  return `<span class="tag">${r.days_until} ${t("days.left")}</span>`;
}
function statusTags(r) {
  return `<span class="row-status">${visBadge(r.visibility)}${r.enabled === false ? '<span class="tag tag-off">' + t("tag.disabled") + '</span>' : '<span class="tag tag-on">' + t("tag.enabled") + '</span>'}</span>`;
}
function actionsHtml(r, kind) {
  return `<div class="actions">${statusTags(r)}<button class="btn btn-ghost btn-sm" onclick="edit${kind === "anni"? "Anni": "Contact"}(${r.id})">${t("btn.edit")}</button><button class="btn btn-danger-ghost btn-sm" onclick="delRecord('${kind}', ${r.id}, '${esc(r.name)}')">${t("btn.delete")}</button></div>`;
}

/* 字段选择器 */
function openFieldPicker() {
  const rows = FIELD_META.map((f) => `<label class="field-check"><input type="checkbox" value="${f.key}"${FIELD_SET.has(f.key) ? "checked": ""} /><span>${f.label}</span></label>`).join("");
  openModal(`<h2>${t("fieldPicker.title")}</h2><p class="muted sm" style="margin-bottom:12px">${t("fieldPicker.desc")}</p><form id="fields-form" class="field-picker">${rows}</form><div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="button" class="btn btn-primary" id="save-fields-btn">${t("form.save")}</button></div>`);
  $("#save-fields-btn").addEventListener("click", () => {
      const chosen = $$("#fields-form input:checked").map((i) => i.value);
      if (!chosen.includes("name")) chosen.unshift("name");
      VIEW_PREFS.fields = chosen; FIELD_SET = new Set(chosen); saveViewPrefs(VIEW_PREFS); closeModal(); renderContacts(); toast(t("fieldPicker.saved"));
    });
}

/* 添加/编辑联系人（modal 或 drawer） */
function openContactEditor(r) {
  const isEdit = !!r; r = r || {};
  const days = r.notify_days || [];
  const gender = r.gender || "", avatar = r.avatar || "", birthTime = r.birth_time || "", hobbies = r.hobbies || "";
  const mbti = r.mbti || "", blood = r.blood_type || "";
  const cnZodiac = getChineseZodiac(r.year) || "";
  const uploadHtml = `<div class="avatar-upload">
  <div class="avatar-preview">${avatarHtml(r, true)}</div>
  <div>
  <label class="btn btn-ghost btn-sm">${t("upload.photo")}<input id="c-avatar-file" type="file" accept="image/*"hidden /></label>
  <span class="muted sm" id="c-avatar-tip">${t("upload.tip")}</span>
  </div>
  </div>`;
  const visTip = `${t("vis.privateTip")}；${t("vis.familyTip")}；${t("vis.publicTip")}`;
  const html = `
  <h2>${isEdit ? t("contact.edit") : t("contact.add")}</h2>
  <form id="contact-form" class="modal-form">
  <div class="grid2">
  <div class="field"><label>${t("form.name")} *</label><input id="c-name" type="text"required value="${esc(r.name || "")}"placeholder="${t("form.name")}"/></div>
  <div class="field"><label>${t("form.relationship")}</label><input id="c-rel" type="text" value="${esc(r.relationship || "")}"placeholder="${t("form.relationship")}"/></div>
  </div>
  <div class="field">${uploadHtml}</div>
  <div class="grid3">
  <div class="field"><label>${t("form.gender")}</label><select id="c-gender">${["", t("gender.male"), t("gender.female"), t("gender.other")].map((v) => `<option value="${v}"${gender === v ? "selected": ""}>${v || "-"}</option>`).join("")}</select></div>
  <div class="field"><label>${t("form.avatarEmoji")}</label><select id="c-avatar">${AVATARS.map((v) => `<option value="${v}"${avatar === v ? "selected": ""}>${v || t("form.default")}</option>`).join("")}</select></div>
  <div class="field"><label>${t("form.birthTime")}</label><select id="c-birth-time">${BIRTH_TIMES.map((v) => `<option value="${esc(v)}"${birthTime === v ? "selected": ""}>${v ? v.split("")[0] + " "+ v.split("")[1] : "-"}</option>`).join("")}</select></div>
  </div>
  <div class="grid2">
  <div class="field"><label>${t("form.mbti")} <span class="info-ic" id="c-mbti-info" data-tip="${esc(mbtiTip(mbti))}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span></label><select id="c-mbti">${MBTI_TYPES.map((v) => `<option value="${v}"${mbti === v ? "selected": ""}>${v || t("mbti.unset")}</option>`).join("")}</select></div>
  <div class="field"><label>${t("form.blood")} <span class="info-ic" id="c-blood-info" data-tip="${esc(bloodTip(blood))}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span></label><select id="c-blood">${BLOOD_TYPES.map((v) => `<option value="${v}"${blood === v ? "selected": ""}>${v || t("blood.unset")}</option>`).join("")}</select></div>
  </div>
  <div class="grid3">
  <div class="field"><label>${t("form.calType")}</label><select id="c-cal"><option value="solar"${r.calendar_type !== "lunar"? "selected": ""}>${t("cal.solarFull")}</option><option value="lunar"${r.calendar_type === "lunar"? "selected": ""}>${t("cal.lunarFull")}</option></select></div>
  <div class="field"><label>${t("form.zodiac")}</label><select id="c-zodiac">${ZODIACS.map((v) => `<option value="${v}"${r.zodiac === v ? "selected": ""}>${v || t("zodiac.auto")}</option>`).join("")}</select></div>
  <div class="field"><label>${t("form.chineseZodiac")}</label><input id="c-chinese-zodiac" type="text" value="${cnZodiac}"readonly placeholder="${t("zodiac.auto")}"/></div>
  </div>
  <div class="grid3">
  <div class="field"><label>${t("form.year")}</label><input id="c-year" type="number" min="1900" max="2100" value="${r.year || ""}"placeholder="${t("form.year")}"/></div>
  <div class="field"><label>${t("form.month")} *</label><input id="c-month" type="number" min="1" max="12"required value="${r.month || ""}"/></div>
  <div class="field"><label>${t("form.day")} *</label><input id="c-day" type="number" min="1" max="31"required value="${r.day || ""}"/></div>
  </div>
  <div class="field"><label class="chk"><input id="c-leap" type="checkbox"${r.is_leap ? "checked": ""}/> ${t("form.leap")}</label></div>
  <div class="field"><label>${t("form.hobbies")}</label><input id="c-hobbies" type="text" value="${esc(hobbies)}" placeholder="${t("form.hobbies")}"/></div>
  <div class="field"><label>${t("form.notifyDays")}</label>${daysPickerHtml("c-days", days)}</div>
  <div class="field"><label>${t("form.note")}</label><input id="c-note" type="text" value="${esc(r.note || "")}"placeholder="${t("form.note")}"/></div>
  <div class="field"><label>${t("form.visibility")} <span class="info-ic" data-tip="${visTip}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span></label>
  <div class="vis-picker" id="c-vis">${visOptions().map((v) => `<label class="vis-opt ${((r.visibility || UI_PREFS.default_visibility || "private") === v) ? "active": ""}"><input type="radio" name="c-vis" value="${v}"${((r.visibility || UI_PREFS.default_visibility || "private") === v) ? "checked": ""} hidden />${VIS_ICONS[v]} ${t("vis."+ v)}</label>`).join("")}</div>
  </div>
  <div class="field"><label class="chk"><input id="c-enabled" type="checkbox"${r.enabled === false ? "": "checked"}/> ${t("form.enabled")}</label></div>
  <div class="modal-actions">
  ${isEdit ? `<button type="button" class="btn btn-danger-ghost" onclick="delFromEditor('contact', ${r.id}, '${esc(r.name)}')">${t("btn.delete")}</button>` : ""}
  <button type="button" class="btn btn-ghost" onclick="closeEditor()">${t("btn.cancel")}</button>
  <button type="submit" class="btn btn-primary">${isEdit ? t("form.save") : t("form.add")}</button>
  </div>
  </form>`;
  showEditor(html);
  // 可见范围选中态
  $$("#c-vis input").forEach((i) => i.addEventListener("change", () => {
        $$("#c-vis .vis-opt").forEach((l) => l.classList.toggle("active", l.querySelector("input").checked));
      }));
  // 动态更新 MBTI/血型分析提示
  const msel = $("#c-mbti"), bsel = $("#c-blood");
  msel.addEventListener("change", () => $("#c-mbti-info").setAttribute("data-tip", mbtiTip(msel.value)));
  bsel.addEventListener("change", () => $("#c-blood-info").setAttribute("data-tip", bloodTip(bsel.value)));
  // 出生年份变化时自动计算属相
  const yearEl = $("#c-year"), czEl = $("#c-chinese-zodiac");
  const updateCnZodiac = () => { const z = getChineseZodiac(yearEl.value); czEl.value = z || ""; };
  yearEl.addEventListener("input", updateCnZodiac);
  // 头像上传
  $("#c-avatar-file").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (!r.id) { toast(t("toast.avatarNeedSave"), false); e.target.value = ""; return; }
      const fd = new FormData(); fd.append("file", file);
      try {
        const data = await fetch(`/api/birthdays/${r.id}/avatar`, { method: "POST", headers: { Authorization: "Bearer "+ TOKEN }, body: fd }).then((x) => x.json());
        if (data.detail) throw new Error(data.detail);
        r.avatar_url = data.avatar_url; r.avatar_path = data.avatar_path;
        $(".avatar-preview").innerHTML = avatarHtml(data, true);
        toast(t("toast.avatarUpdated"));
      } catch (err) { toast(err.message || t("toast.uploadFail"), false); }
    });
  $("#contact-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        name: $("#c-name").value.trim(), relationship: $("#c-rel").value.trim() || null,
        gender: $("#c-gender").value || null, birth_time: $("#c-birth-time").value || null,
        zodiac: $("#c-zodiac").value || null, hobbies: $("#c-hobbies").value.trim() || null,
        avatar: $("#c-avatar").value || null, mbti: $("#c-mbti").value || null, blood_type: $("#c-blood").value || null,
        calendar_type: $("#c-cal").value, year: $("#c-year").value ? parseInt($("#c-year").value) : null,
        month: parseInt($("#c-month").value), day: parseInt($("#c-day").value), is_leap: $("#c-leap").checked,
        notify_days: collectDays("c-days"),
        note: $("#c-note").value.trim() || null, enabled: $("#c-enabled").checked,
        visibility: (document.querySelector('#c-vis input:checked') || {}).value || null,
      };
      try {
        if (isEdit) await api(`/api/birthdays/${r.id}`, { method: "PUT", body: JSON.stringify(body) });
        else await api("/api/birthdays", { method: "POST", body: JSON.stringify(body) });
        closeEditor(); toast(isEdit ? t("toast.saved") : t("toast.added")); loadContacts();
      } catch (err) { toast(err.message, false); }
    });
}
window.editContact = (id) => { const r = CONTACTS.find((x) => x.id === id); openContactEditor(r || { id }); };
window.closeEditor = closeEditor;
window.closeModal = closeModal;

/* 批量测试 */
async function runBatchTestApi(kind, ids) {
  const resultBox = $("#bt-result");
  if (resultBox) resultBox.textContent = t("batch.testing");
  try {
    const data = await api(`/api/${kind === "birthday"? "birthdays": "anniversaries"}/test`, { method: "POST", body: JSON.stringify({ ids }) });
    const lines = data.results.map((x) => {
        const rs = x.results.map((r) => `${chNames()[r.channel] || r.channel}：${r.ok ? "": ""+ r.message}`).join("；");
        return `· ${x.name}：${rs}`;
      });
    if (resultBox) resultBox.textContent = t("batch.tested", { n: data.tested }) + "：\n"+ (lines.join("\n") || t("batch.noChannel"));
  } catch (err) { if (resultBox) resultBox.textContent = err.message; }
}
function runBatchTestSelection(kind) {
  if (kind !== "birthday") { openBatchTest(kind); return; }
  const ids = Array.from(SELECTED_IDS);
  if (!ids.length) { toast(t("toast.selectFirst"), false); return; }
  openModal(`<h2>${t("batch.titleB")}</h2>
    <p class="muted sm">${t("batch.selected", { n: ids.length })}</p>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="button" class="btn btn-primary" id="bt-run">${t("batch.run")}</button></div>
    <div id="bt-result" class="muted sm" style="margin-top:10px;white-space:pre-wrap"></div>`);
    $("#bt-run").addEventListener("click", () => runBatchTestApi("birthday", ids));
  }
  function openBatchTest(kind) {
    const rows = kind === "birthday"? CONTACTS : ANNIS;
    if (!rows.length) { toast(t("batch.noRecord"), false); return; }
    const items = rows.map((r) => `<label class="field-check"><input type="checkbox" class="bt-ch" value="${r.id}"/><span>${esc(r.name)} <span class="muted sm">${r.next_date || ""}</span></span></label>`).join("");
    openModal(`<h2>${t("batch.title"+ (kind === "birthday"? "B": "A"))}</h2>
      <p class="muted sm" style="margin-bottom:10px">${t("batch.desc")}</p>
      <div class="field-picker" style="max-height:46vh">${items}</div>
      <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button>
      <button type="button" class="btn btn-ghost" id="bt-all">${t("batch.all", { n: rows.length })}</button>
      <button type="button" class="btn btn-primary" id="bt-sel">${t("batch.sel")}</button>
      </div>
      <div id="bt-result" class="muted sm" style="margin-top:10px;white-space:pre-wrap"></div>`);
      $("#bt-all").addEventListener("click", () => runBatchTestApi(kind, null));
      $("#bt-sel").addEventListener("click", () => {
          const ids = $$(".bt-ch:checked").map((i) => parseInt(i.value));
          if (!ids.length) return toast(t("batch.none"), false);
          runBatchTestApi(kind, ids);
        });
    }
    window.runBatchTest = runBatchTestSelection;

    /* ============ 纪念日 ============ */
    $("#add-anni-btn").addEventListener("click", () => openAnniEditor(null));
    $("#refresh-anni-btn").addEventListener("click", loadAnniversaries);

    async function loadAnniversaries() {
      const box = $("#anniversaries-list"); box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
      try { ANNIS = await api("/api/anniversaries"); renderAnniversaries(); populateAnniFilters(); }
      catch (err) { box.innerHTML = ""; toast(err.message, false); }
    }
    function renderAnniversaries() {
      const box = $("#anniversaries-list");
      if (!ANNIS.length) { box.innerHTML = '<div class="empty">' + t("empty.annis") + '</div>'; return; }
      const rows = getFilteredAnnis();
      if (!rows.length) { box.innerHTML = '<div class="empty">' + t("filter.noResult") + '</div>'; return; }
      if (ANNI_PREFS.mode === "card") {
        const cards = rows.map((r, i) => {
            const d = r.days_until;
            const soon = d != null && d >= 0 && d <= 7;
            const nodes = notifyNodesHtml(r.notify_days);
            const tags = [r.kind ? `<span class="tag">${esc(r.kind)}</span>` : "", calendarBadge(r), r.enabled === false ? `<span class="tag tag-off">${esc(t("filter.statusOff"))}</span>` : ""].filter(Boolean).join("");
            return `<div class="pcard${soon ? " soon": ""}" style="--i:${i}">
            <div class="pcard-top" onclick="editAnni(${r.id})">
              <span class="avatar" style="--po:${hueOffset(r.id)}">${esc(String(r.name || "").trim().charAt(0) || "?")}</span>
              <div class="grow"><div class="pcard-name">${esc(r.name)}</div><div class="pcard-meta">${tags}</div></div>
              <div class="pcard-days"><div class="n">${d == null ? "—" : d}</div><div class="u">${d == null ? "" : esc(t("days.left"))}</div></div>
            </div>
            ${r.note ? `<div class="pcard-note">${esc(r.note)}</div>` : ""}
            <div class="pcard-foot">
              <span class="tag">${nextDateLabel(r)}</span>
              ${nodes ? `<span class="tag">${esc(nodes)}</span>` : `<span class="muted">${esc(t("card.noReminder"))}</span>`}
              <span class="spacer"></span>
              ${r.years_passed != null ? `<span class="muted">${esc(t("field.passed"))} ${r.years_passed} ${esc(t("unit.anniv"))}</span>` : ""}
            </div>
            </div>`;
          }).join("");
        box.innerHTML = `<div class="pcards">${cards}</div>`;
        return;
      }
      const body = rows.map((r) => `
        <tr>
        <td data-label="${t("field.name")}"><div class="name-cell" onclick="editAnni(${r.id})"><div class="name-line"><b>${esc(r.name)}</b>${statusTags(r)}</div></div></td>
        <td data-label="${t("field.desc")}">${esc(r.note || "-")}</td>
        <td data-label="${t("form.type")}">${esc(r.kind || t("anni.default"))}</td>
        <td data-label="${t("field.calBadge")}">${calendarBadge(r)}</td>
        <td data-label="${t("field.date")}">${r.year ? r.year + " "+ t("unit.year") + "": ""}${r.month} ${t("unit.month")} ${r.day} ${t("unit.day")}${r.is_leap ? "（"+ t("form.leapShort") + "）": ""}</td>
        <td data-label="${t("field.nextDate")}">${nextDateLabel(r)}</td>
        <td data-label="${t("field.countdown")}">${daysBadge(r)}</td>
        <td data-label="${t("field.passed")}">${r.years_passed != null ? `<span class="num">${r.years_passed}</span> ${t("unit.anniv")}` : "-"}</td>
        </tr>`).join("");
      box.innerHTML = `<div class="table-card"><table class="table"><thead><tr><th>${t("field.name")}</th><th>${t("field.desc")}</th><th>${t("form.type")}</th><th>${t("field.calBadge")}</th><th>${t("field.date")}</th><th>${t("field.nextDate")}</th><th>${t("field.countdown")}</th><th>${t("field.passed")}</th></tr></thead><tbody>${body}</tbody></table></div>`;
      }
      function openAnniEditor(r) {
        const isEdit = !!r; r = r || {};
        const days = r.notify_days || [];
        const visTip = `${t("vis.privateTip")}；${t("vis.familyTip")}；${t("vis.publicTip")}`;
        const html = `
        <h2>${isEdit ? t("anni.editTitle") : t("anni.addTitle")}</h2>
        <form id="anni-form" class="modal-form">
        <div class="grid2"><div class="field"><label>${t("form.anniName")} *</label><input id="a-name" type="text"required value="${esc(r.name || "")}"placeholder="${t("form.anniName")}"/></div>
        <div class="field"><label>${t("form.type")}</label><input id="a-kind" type="text" value="${esc(r.kind || t("anni.default"))}"placeholder="${t("form.type")}"/></div></div>
        <div class="grid2"><div class="field"><label>${t("form.calType")}</label><select id="a-cal"><option value="solar"${r.calendar_type !== "lunar"? "selected": ""}>${t("cal.solarFull")}</option><option value="lunar"${r.calendar_type === "lunar"? "selected": ""}>${t("cal.lunarFull")}</option></select></div>
        <div class="field"><label>${t("form.startYear")}</label><input id="a-year" type="number" min="1900" max="2100" value="${r.year || ""}"placeholder="${t("form.startYear")}"/></div></div>
        <div class="grid3"><div class="field"><label>${t("form.month")} *</label><input id="a-month" type="number" min="1" max="12"required value="${r.month || ""}"/></div>
        <div class="field"><label>${t("form.day")} *</label><input id="a-day" type="number" min="1" max="31"required value="${r.day || ""}"/></div>
        <div class="field"><label>${t("form.anniDesc")}</label><input id="a-note" type="text" value="${esc(r.note || "")}"placeholder="${t("form.anniDesc")}"/></div></div>
        <div class="field"><label>${t("form.reminderDays")}</label>${daysPickerHtml("a-days", days)}</div>
        <div class="field"><label>${t("form.visibility")} <span class="info-ic" data-tip="${visTip}"><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><use href="#ic-info"/></svg></span></label>
        <div class="vis-picker" id="a-vis">${visOptions().map((v) => `<label class="vis-opt ${((r.visibility || UI_PREFS.default_visibility || "private") === v) ? "active": ""}"><input type="radio" name="a-vis" value="${v}"${((r.visibility || UI_PREFS.default_visibility || "private") === v) ? "checked": ""} hidden />${VIS_ICONS[v]} ${t("vis."+ v)}</label>`).join("")}</div>
        </div>
        <div class="field"><label class="chk"><input id="a-enabled" type="checkbox"${r.enabled === false ? "": "checked"}/> ${t("form.enabled")}</label></div>
        <div class="modal-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-ghost" onclick="delFromEditor('anni', ${r.id}, '${esc(r.name)}')">${t("btn.delete")}</button>` : ""}
        <button type="button" class="btn btn-ghost" onclick="closeEditor()">${t("btn.cancel")}</button>
        <button type="submit" class="btn btn-primary">${isEdit ? t("form.save") : t("form.add")}</button>
        </div>
        </form>`;
        showEditor(html);
        $$("#a-vis input").forEach((i) => i.addEventListener("change", () => {
              $$("#a-vis .vis-opt").forEach((l) => l.classList.toggle("active", l.querySelector("input").checked));
            }));
        $("#anni-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const body = {
              name: $("#a-name").value.trim(), kind: $("#a-kind").value.trim() || t("anni.default"),
              calendar_type: $("#a-cal").value, year: $("#a-year").value ? parseInt($("#a-year").value) : null,
              month: parseInt($("#a-month").value), day: parseInt($("#a-day").value), is_leap: false,
              notify_days: collectDays("a-days"),
              note: $("#a-note").value.trim() || null, enabled: $("#a-enabled").checked,
              visibility: (document.querySelector('#a-vis input:checked') || {}).value || null,
            };
            try {
              if (isEdit) await api(`/api/anniversaries/${r.id}`, { method: "PUT", body: JSON.stringify(body) });
              else await api("/api/anniversaries", { method: "POST", body: JSON.stringify(body) });
              closeEditor(); toast(isEdit ? t("toast.saved") : t("toast.added")); loadAnniversaries();
            } catch (err) { toast(err.message, false); }
          });
      }
      window.editAnni = (id) => { const r = ANNIS.find((x) => x.id === id); openAnniEditor(r || { id }); };

      window.delRecord = async (kind, id, name) => {
        if (!confirm(t("confirm.delRecord", { name }))) return;
        try {
          await api(`/api/${kind === "anni"? "anniversaries": "birthdays"}/${id}`, { method: "DELETE"});
          toast(t("toast.deleted"));
          if (kind === "anni") loadAnniversaries(); else loadContacts();
        } catch (err) { toast(err.message, false); }
      };
      window.delFromEditor = async (kind, id, name) => {
        if (!confirm(t("confirm.delRecord", { name }))) return;
        closeEditor();
        try {
          await api(`/api/${kind === "anni"? "anniversaries": "birthdays"}/${id}`, { method: "DELETE"});
          toast(t("toast.deleted"));
          if (kind === "anni") loadAnniversaries(); else loadContacts();
        } catch (err) { toast(err.message, false); }
      };

      /* ============ 即将到来（当前自然年内的全部生日+纪念日，含已过） ============ */
      async function loadUpcoming() {
        const box = $("#upcoming-list"); box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
        // 预热联系人/纪念日数据，便于即将到来里直接编辑
        if (!CONTACTS.length) loadContacts();
        if (!ANNIS.length) loadAnniversaries();
        try {
          UPCOMING_ROWS = await api("/api/year-dates");
          renderUpcoming(); populateUpcomingFilters();
        } catch (err) { box.innerHTML = ""; toast(err.message, false); }
      }
      function anniKindBadge(kind) { return kind ? `<span class="tag tag-anni">${esc(kind)}</span>` : ""; }
      function upDaysBadge(r) {
        if (r.days_until == null) return "-";
        if (r.days_until === 0 || r.is_today) return '<span class="tag today"> ' + t("today") + '</span>';
        if (r.days_until > 0) {
          if (r.days_until <= 3) return `<span class="tag soon">${r.days_until} ${t("days.left")}</span>`;
          if (r.days_until <= 14) return `<span class="tag near">${r.days_until} ${t("days.left")}</span>`;
          return `<span class="tag">${r.days_until} ${t("days.left")}</span>`;
        }
        return `<span class="tag tag-off">${t("field.passedDays", { n: Math.abs(r.days_until) })}</span>`;
      }
      function upSubLabel(r) {
        const isAnni = r.category === "anniversary";
        if (isAnni) return r.kind || t("anni.default");
        return r.relationship || "";
      }
      function upHead() {
        return `<tr><th>${t("field.name")}</th><th>${t("field.relationship")}</th><th>${t("field.calBadge")}</th><th>${t("field.date")}</th><th>${t("field.countdown")}</th><th>${t("field.note")}</th></tr>`;
      }
      function upRow(r) {
        const isAnni = r.category === "anniversary";
        return `<tr>
        <td data-label="${t("field.name")}"><div class="name-cell"><div class="name-line"><b>${esc(r.name)}</b> ${isAnni ? anniKindBadge(r.kind) : calendarBadge(r)} ${statusTags(r)}</div></div></td>
        <td data-label="${t("field.relationship")}">${isAnni ? esc(r.kind || "-") : esc(r.relationship || "-")}</td>
        <td data-label="${t("field.calBadge")}">${calendarBadge(r)}</td>
        <td data-label="${t("field.date")}"><span class="mono">${r.occ_date}</span>${r.is_leap ? ` <span class="muted sm">(${t("form.leapShort")})</span>` : ""}</td>
        <td data-label="${t("field.countdown")}">${upDaysBadge(r)}</td>
        <td data-label="${t("field.note")}">${esc(r.note || "-")}</td>
        </tr>`;
      }
      function upCard(r, i = 0) {
        const isAnni = r.category === "anniversary";
        const soon = r.days_until != null && r.days_until >= 0 && r.days_until <= 7;
        const tags = [isAnni ? anniKindBadge(r.kind) : calendarBadge(r), isAnni ? "" : (r.relationship ? `<span class="tag">${esc(r.relationship)}</span>` : "")].filter(Boolean).join("");
        const extra = isAnni
        ? (r.anniv_num != null ? `<span class="muted">${r.anniv_num} ${esc(t("unit.anniv"))}</span>` : "")
        : (r.age_on_occ != null ? `<span class="muted">${esc(t("card.willBe", { age: r.age_on_occ }))}</span>` : "");
        return `<div class="pcard${soon ? " soon": ""}" style="--i:${i}">
        <div class="pcard-top">
        ${avatarHtml(r)}
        <div class="grow"><div class="pcard-name">${esc(r.name)}</div><div class="pcard-meta">${tags}</div></div>
        <div class="pcard-days"><div class="n">${r.days_until == null ? "—" : r.days_until}</div><div class="u">${esc(t("days.left"))}</div></div>
        </div>
        <div class="pcard-foot">
        <span class="tag">${esc(r.occ_date || "")}</span>
        ${extra}
        <span class="spacer"></span>
        ${r.note ? `<span class="muted ellipsis" style="max-width:44%">${esc(r.note)}</span>` : ""}
        </div>
        </div>`;
      }
      function upCompact(r) {
        const isAnni = r.category === "anniversary";
        return `<div class="compact-item" data-id="${r.id}">
        <div class="compact-left">
        ${avatarHtml(r)}<b>${esc(r.name)}</b>${statusTags(r)}
        <span class="muted sm">${esc(upSubLabel(r))} ${isAnni ? anniKindBadge(r.kind) : calendarBadge(r)}</span>
        </div>
        <div class="compact-right">
        ${upDaysBadge(r)}
        <span class="muted sm"><span class="mono">${r.occ_date}</span></span>
        </div>
        </div>`;
      }
      function renderUpcoming() {
        const box = $("#upcoming-list");
        if (!UPCOMING_ROWS.length) { box.innerHTML = '<div class="empty">' + t("empty.upcoming") + '</div>'; return; }
        const rows = getFilteredUpcoming();
        if (!rows.length) { box.innerHTML = '<div class="empty">' + t("filter.noResult") + '</div>'; return; }
        const mode = UPCOMING_PREFS.mode;
        const build = (r, i) => mode === "card"? upCard(r, i) : mode === "compact"? upCompact(r) : upRow(r);
        const wrapOpen = mode === "card"? `<div class="pcards">` : mode === "compact"? `<div class="compact-list">` : `<div class="table-card"><table class="table"><thead>${upHead()}</thead><tbody>`;
        const wrapClose = mode === "card"? `</div>` : mode === "compact"? `</div>` : `</tbody></table></div>`;
        const renderGroup = (title, items) => {
          if (!items.length) return "";
          return `<div class="group"><div class="group-title">${title} <span class="group-count">${items.length}</span></div>${wrapOpen}${items.map(build).join("")}${wrapClose}</div>`;
        };
        const upcoming = rows.filter((r) => r.is_upcoming);
        const passed = rows.filter((r) => r.is_passed);
        box.innerHTML = renderGroup(t("upcoming.soon"), upcoming) + renderGroup(t("upcoming.passed"), passed);
      }

      /* ============ 首页看板 ============ */
      function _dist(rows, key) {
        const m = {};
        rows.forEach((r) => { const k = (r[key] && String(r[key]).trim()) || t("group.unfiled"); m[k] = (m[k] || 0) + 1; });
        const max = Object.values(m).length ? Math.max(...Object.values(m)) : 0;
        return { entries: Object.entries(m).sort((a, b) => b[1] - a[1]), max };
      }
      function _distBars(entries, max) {
        if (!entries.length) return '<div class="muted sm">' + t("dashboard.noData") + '</div>';
        const rows = entries.map(([k, v]) => `<div class="dist-row"><span class="dist-label">${esc(k)}</span><span class="dist-track"><span class="dist-fill"style="width:${max ? Math.round(v / max * 100) : 0}%"></span></span><span class="dist-num">${v}</span></div>`).join("");
        return `<div class="dist">${rows}</div>`;
      }

      /* ---------- 日期与日历 ---------- */
      function _locale() {
        return ({ zh: "zh-CN", "zh-Hant": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" })[getLang()] || "zh-CN";
      }
      /* 星期名按当前语言给，不写死中文 */
      function _weekLabels() {
        try {
          const fmt = new Intl.DateTimeFormat(_locale(), { weekday: "short" });
          return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
        } catch (e) {
          return ["一", "二", "三", "四", "五", "六", "日"];
        }
      }
      function _monthName(y, m) {
        try { return new Intl.DateTimeFormat(_locale(), { month: "long" }).format(new Date(y, m - 1, 1)); }
        catch (e) { return m + " " + t("unit.month"); }
      }
      function _today() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }

      /* 月历：命中日用强调色实心块，其余是白卡；上/下月的日子留空但不占视觉重量 */
      function _monthGrid(y, m, marks) {
        const first = new Date(y, m - 1, 1);
        const lead = (first.getDay() + 6) % 7;               /* 周一为一周之首 */
        const dim = new Date(y, m, 0).getDate();
        const prevDim = new Date(y, m - 1, 0).getDate();
        const cells = [];
        for (let i = lead - 1; i >= 0; i--) cells.push({ d: prevDim - i, out: true });
        for (let d = 1; d <= dim; d++) cells.push({ d, out: false });
        const trail = (7 - (cells.length % 7)) % 7;
        for (let d = 1; d <= trail; d++) cells.push({ d, out: true });
        const now = _today();
        const html = cells.map((c) => {
            const hit = (!c.out && marks[c.d] && marks[c.d].length) ? marks[c.d] : null;
            const isToday = !c.out && y === now.y && m === now.m && c.d === now.d;
            const cls = c.out ? "cal-cell out" : (hit ? "cal-cell hit" : (isToday ? "cal-cell today" : "cal-cell"));
            const who = hit ? `<span class="who">${esc(String(hit[0]).slice(0, 2))}</span>` : "";
            return `<div class="${cls}"><span>${c.d}</span>${who}</div>`;
          }).join("");
        const wd = _weekLabels().map((w) => `<div class="cal-wd">${esc(w)}</div>`).join("");
        return `<div class="cal">${wd}</div><div class="cal">${html}</div>`;
      }

      /* ---------- 首页看板 ---------- */
      async function loadDashboard() {
        const box = $("#dashboard-content");
        if (box) box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
        try {
          // 始终重新拉取，确保下次生日/倒计时/已活天数/年龄/星座/生肖等自动计算字段实时刷新
          const [c, a, y] = await Promise.all([
              api("/api/birthdays"), api("/api/anniversaries"), api("/api/year-dates"),
            ]);
          CONTACTS = c; ANNIS = a; UPCOMING_ROWS = y;
          renderDashboard();
        } catch (err) { if (box) box.innerHTML = ""; toast(err.message, false); }
      }
      /* 窗口变宽窄时重画日历（月份标签宽度会变） */
      let _resizeTimer = null;
      window.addEventListener("resize", () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => { if (CURRENT_VIEW === "dashboard" && CONTACTS.length) renderDashboard(); }, 220);
      });

      /* 提醒渠道概览：哪几个开了、飞书配了没有 */
      function _channelSummary() {
        const chans = (MY_PREFS && MY_PREFS.channels) || [];
        const rows = [
          { key: "inapp", label: t("ch.inapp"), on: chans.includes("inapp") },
          { key: "wechat", label: t("ch.wechat"), on: chans.includes("wechat") && !!(MY_PREFS.wechat || {}).enabled },
          { key: "feishu", label: t("ch.feishu"), on: chans.includes("feishu") && !!(MY_PREFS.feishu || {}).enabled },
        ];
        return rows.map((r) => `<div class="dash-kv"><span>${esc(r.label)}</span><span class="tag${r.on ? " tag-on": " tag-off"}">${esc(r.on ? t("dash.on") : t("dash.off"))}</span></div>`).join("");
      }

      function renderDashboard() {
        const box = $("#dashboard-content"); if (!box) return;

        const upcoming = CONTACTS.filter((r) => r.days_until != null && r.days_until >= 0)
          .sort((a, b) => a.days_until - b.days_until);
        const todayList = CONTACTS.filter((r) => r.is_today);
        const in30 = upcoming.filter((r) => r.days_until <= 30);
        const next = upcoming[0] || null;
        const now = _today();

        /* 问候语由数据生成，不写「欢迎回来」 */
        const hour = new Date().getHours();
        const greetKey = hour < 6 ? "greet.night" : hour < 12 ? "greet.morning" : hour < 18 ? "greet.afternoon" : "greet.evening";
        let head, meta;
        if (todayList.length) {
          head = t(todayList.length > 1 ? "greet.todayMany" : "greet.todayOne", { n: todayList.length });
          meta = t("greet.todayMeta", { names: todayList.map((r) => r.name).join("、") });
        } else if (next && next.days_until <= 30) {
          head = t("greet.soon", { n: next.days_until });
          meta = t("greet.soonMeta", { name: next.name, date: next.next_date || "" });
        } else {
          head = t("greet.none");
          meta = t("greet.noneMeta");
        }
        setHead("dashboard", esc(t(greetKey) + "，" + head), esc(`${_monthName(now.y, now.m)} ${now.d} ${t("unit.day")} · ${meta}`));

        /* 日历主视图：下一个有生日的月份 */
        let calY = now.y, calM = now.m, marks = {};
        if (next && next.next_date) {
          const parts = String(next.next_date).split("-");
          calY = parseInt(parts[0], 10) || now.y;
          calM = parseInt(parts[1], 10) || now.m;
        }
        const inMonth = CONTACTS.filter((r) => {
            if (!r.next_date || r.days_until == null || r.days_until < 0) return false;
            const p = String(r.next_date).split("-");
            return parseInt(p[0], 10) === calY && parseInt(p[1], 10) === calM;
          });
        inMonth.forEach((r) => {
            const day = parseInt(String(r.next_date).split("-")[2], 10);
            if (!marks[day]) marks[day] = [];
            marks[day].push(r.name);
          });
        const calTitle = t("dash.nextIn", { month: _monthName(calY, calM) });

        /* 「接下来」清单：生日与纪念日混排 */
        const mixed = [];
        CONTACTS.forEach((r) => { if (r.days_until != null && r.days_until >= 0) mixed.push({ ...r, _kind: "birthday" }); });
        (UPCOMING_ROWS || []).forEach((r) => { if (r.category === "anniversary" && r.days_until != null && r.days_until >= 0) mixed.push({ ...r, _kind: "anniversary" }); });
        mixed.sort((a, b) => a.days_until - b.days_until);
        const nextList = mixed.slice(0, 6);

        const rel = _dist(CONTACTS, "relationship");
        const ages = CONTACTS.map((r) => r.age).filter((a) => a != null);
        const avgAge = ages.length ? (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : "—";
        /* 今年已经过掉的生日：年度事件里标了 is_passed 的那些 */
        const passedThisYear = (UPCOMING_ROWS || []).filter((r) => r.category === "birthday" && r.is_passed).length;

        const rowsHtml = nextList.length ? nextList.map((r, i) => {
            const soon = r.days_until <= 7;
            const who = r._kind === "anniversary" ? r.name : r.name;
            const rel2 = r._kind === "anniversary" ? (r.kind || t("anni.default")) : (r.relationship || "");
            return `<div class="row" style="--i:${i}">
            <span class="avatar avatar-sm" style="--po:${hueOffset(r.id)}">${esc(String(who || "").trim().charAt(0) || "?")}</span>
            <div class="grow"><div class="nm">${esc(who)}</div>${rel2 ? `<div class="sub">${esc(rel2)}</div>` : ""}</div>
            <div class="when${soon ? " strong": ""}">${r.days_until} ${esc(t("days.left"))}</div>
            </div>`;
          }).join("") : `<div class="muted sm">${esc(t("dashboard.noData"))}</div>`;

        box.innerHTML = `
        <div class="stats">
        <div class="stat"><div class="label">${esc(t("dashboard.totalContacts"))}</div><div class="value">${CONTACTS.length}</div></div>
        <div class="stat"><div class="label">${esc(t("dashboard.totalAnnis"))}</div><div class="value">${ANNIS.length}</div></div>
        <div class="stat${in30.length ? " accent": ""}"><div class="label">${esc(t("dashboard.upcoming30"))}</div><div class="value">${in30.length}</div></div>
        </div>

        <div class="dash-9-3">
        <div class="panel">
          <div class="dash-split-head">
            <div><div class="h2">${esc(calTitle)}</div><div class="panel-note">${esc(next ? t("dash.nextOn", { name: next.name, date: next.next_date }) : t("dash.nothingSoon"))}</div></div>
            ${next ? `<span class="tag today">${esc(t("dash.inDays", { n: next.days_until }))}</span>` : ""}
          </div>
          ${_monthGrid(calY, calM, marks)}
          ${next ? `<div class="dash-person">${avatarHtml(next)}<div class="grow"><div class="pcard-name">${esc(next.name)}</div><div class="pcard-meta">${esc([next.relationship, next.zodiac].filter(Boolean).join(" · "))}</div></div><span class="tag">${esc(next.next_date || "")}</span></div>` : ""}
        </div>
        <div class="panel">
          <div class="panel-title" style="margin-bottom:6px">${esc(t("dash.nextUp"))}</div>
          <div class="rows">${rowsHtml}</div>
        </div>
        </div>

        <div class="dash-6-6">
        <div class="panel">
          <div class="panel-title" style="margin-bottom:12px">${esc(t("chart.relDist"))}</div>
          ${_distBars(rel.entries.slice(0, 6), rel.max)}
        </div>
        <div class="panel">
          <div class="panel-title" style="margin-bottom:12px">${esc(t("dash.channels"))}</div>
          ${_channelSummary()}
          <div class="dash-insight-row">
            <div><div class="label">${esc(t("dash.avgAge"))}</div><div class="value">${avgAge}</div></div>
            <div><div class="label">${esc(t("dash.sentThisYear"))}</div><div class="value">${passedThisYear}</div></div>
          </div>
        </div>
        </div>`;
      }

      /* ============ 家庭共享 ============ */
      $("#create-family-btn").addEventListener("click", () => {
          openModal(`<h2>${t("family.create")}</h2><form id="family-form" class="modal-form">
            <div class="field"><label>${t("form.name")} *</label><input id="f-name" type="text"required placeholder="${t("form.name")}"/></div>
            <p class="muted sm">${t("family.createDesc")}</p>
            <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="submit" class="btn btn-primary">${t("btn.create")}</button></div>
            </form>`);
            $("#family-form").addEventListener("submit", async (e) => {
                e.preventDefault();
                try {
                  await api("/api/families", { method: "POST", body: JSON.stringify({ name: $("#f-name").value.trim() }) });
                  closeModal(); toast(t("toast.familyCreated")); loadFamily();
                } catch (err) { toast(err.message, false); }
              });
          });

        async function loadFamily() {
          const invBox = $("#family-invites"), listBox = $("#family-list");
          invBox.innerHTML = ""; listBox.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
          try {
            const [invites, families] = await Promise.all([api("/api/families/invites"), api("/api/families")]);
            // 待处理邀请
            if (invites.length) {
              invBox.innerHTML = `<div class="card invite-card">
              <div class="group-title">${t("invite.pending")}</div>
              ${invites.map((iv) => `<div class="invite-item">
                  <div><b>${esc(iv.inviter_name || t("user.current"))}</b> ${t("invite.from2")}「<b>${esc(iv.family_name || "")}</b>」</div>
                  <div class="invite-actions">
                  <button class="btn btn-primary btn-sm" onclick="respondInvite(${iv.id}, true)">${t("invite.accept")}</button>
                  <button class="btn btn-ghost btn-sm" onclick="respondInvite(${iv.id}, false)">${t("invite.reject")}</button>
                  </div>
                  </div>`).join("")}
                  </div>`;
                }
                // 我的家庭
                if (!families.length) {
                  listBox.innerHTML = '<div class="card"><div class="empty">' + t("empty.family") + '</div></div>';
                } else {
                  listBox.innerHTML = families.map((f) => {
                      const isOwner = ME && f.owner_name === ME.username;
                      const isAdmin = ME && ME.role === "admin";
                      const canManage = isOwner || isAdmin;
                      const isMember = (f.members || []).some((m) => m.username === ME.username);
                      const canLeave = isMember && !isOwner;
                      return `<div class="card family-card">
                      <div class="family-head">
                      <div class="family-name"> ${esc(f.name)} ${isOwner ? '<span class="tag tag-on">' + t("invite.mine") + '</span>' : ""}</div>
                      <div class="family-actions">
                      ${canManage ? `<button class="btn btn-ghost btn-sm" onclick="renameFamily(${f.id}, '${esc(f.name)}')"> ${t("family.rename")}</button>` : ""}
                      ${canManage ? `<button class="btn btn-ghost btn-sm" onclick="openInvite(${f.id}, '${esc(f.name)}')">+ ${t("invite.inviteMember")}</button>` : ""}
                      ${canManage ? `<button class="btn btn-danger-ghost btn-sm" onclick="deleteFamily(${f.id}, '${esc(f.name)}')"> ${t("family.delete")}</button>` : ""}
                      ${canLeave ? `<button class="btn btn-ghost btn-sm" onclick="leaveFamily(${f.id}, '${esc(f.name)}')"> ${t("family.leave")}</button>` : ""}
                      </div>
                      </div>
                      <div class="family-members">
                      ${(f.members || []).map((m) => `<span class="member-chip">${m.username === f.owner_name ? "": ""} ${esc(m.username)}${ME && m.username === ME.username ? "（"+ t("invite.me") + "）": ""}${canManage && m.username !== f.owner_name ? ` <a href="javascript:void(0)" class="member-remove" title="${t("family.removeMember")}"onclick="removeMember(${f.id}, ${m.id}, '${esc(m.username)}', '${esc(f.name)}')"></a>` : ""}</span>`).join("")}
                      </div>
                      ${(f.pending_invites || []).length ? `<div class="muted sm" style="margin-top:8px">${t("invite.waiting", { list: f.pending_invites.map((p) => esc(p)).join(t("unit.comma")) })}</div>` : ""}
                      </div>`;
                    }).join("");
                }
                refreshInviteBadge();
              } catch (err) { listBox.innerHTML = ""; toast(err.message, false); }
            }

            window.respondInvite = async (iid, accept) => {
              try {
                await api(`/api/families/invites/${iid}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
                toast(accept ? t("toast.joined") : t("toast.rejected"));
                loadFamily();
              } catch (err) { toast(err.message, false); }
            };

            window.openInvite = (fid, fname) => {
              openModal(`<h2>${t("invite.sendTitle", { name: esc(fname) })}</h2><form id="invite-form" class="modal-form">
                <div class="field"><label>${t("invite.username")} *</label><input id="iv-user" type="text"required placeholder="${t("invite.username")}"/></div>
                <p class="muted sm">${t("invite.desc")}</p>
                <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="submit" class="btn btn-primary">${t("invite.send")}</button></div>
                </form>`);
                $("#invite-form").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    try {
                      await api(`/api/families/${fid}/invite`, { method: "POST", body: JSON.stringify({ username: $("#iv-user").value.trim() }) });
                      closeModal(); toast(t("toast.inviteSent")); loadFamily();
                    } catch (err) { toast(err.message, false); }
                  });
              };

              window.renameFamily = (fid, fname) => {
                openModal(`<h2>${t("family.renameTitle", { name: esc(fname) })}</h2><form id="rename-form" class="modal-form">
                  <div class="field"><label>${t("form.name")} *</label><input id="rf-name" type="text"required value="${esc(fname)}"/></div>
                  <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="submit" class="btn btn-primary">${t("btn.save")}</button></div>
                  </form>`);
                  $("#rename-form").addEventListener("submit", async (e) => {
                      e.preventDefault();
                      try {
                        await api(`/api/families/${fid}`, { method: "PUT", body: JSON.stringify({ name: $("#rf-name").value.trim() }) });
                        closeModal(); toast(t("toast.familyRenamed")); loadFamily();
                      } catch (err) { toast(err.message, false); }
                    });
                };

                window.deleteFamily = (fid, fname) => {
                  if (!confirm(t("family.deleteConfirm", { name: esc(fname) }))) return;
                  api(`/api/families/${fid}`, { method: "DELETE"})
                  .then(() => { toast(t("toast.familyDeleted")); loadFamily(); })
                  .catch((err) => toast(err.message, false));
                };

                window.removeMember = (fid, uid, uname, fname) => {
                  if (!confirm(t("family.removeMemberConfirm", { name: esc(uname), family: esc(fname) }))) return;
                  api(`/api/families/${fid}/members/${uid}`, { method: "DELETE"})
                  .then(() => { toast(t("toast.memberRemoved")); loadFamily(); })
                  .catch((err) => toast(err.message, false));
                };

                window.leaveFamily = (fid, fname) => {
                  if (!confirm(t("family.leaveConfirm", { name: esc(fname) }))) return;
                  api(`/api/families/${fid}/leave`, { method: "POST"})
                  .then(() => { toast(t("toast.leftFamily")); loadFamily(); })
                  .catch((err) => toast(err.message, false));
                };

                /* ============ 个人资料及偏好（基本资料 + 提醒 + 主题/语言） ============ */

                const NOTIFY_CHANNELS = [
                  { key: "inapp", icon: "", label: "notify.chanInapp", desc: "notify.chanInappDesc"},
                  { key: "wechat", icon: "", label: "notify.chanWechat", desc: "notify.chanWechatDesc"},
                  { key: "feishu", icon: "", label: "notify.chanFeishu", desc: "notify.chanFeishuDesc"},
                ];
                const DEFAULT_BODY_TPL = "{when}{name}的{type}（{calendar_type}{month}月{day}日）{age}\n关系：{relationship}\n备注：{note}";

                function loadProfile() {
                  const box = $("#profile-content"); if (!box) return;
                  box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
                  Promise.all([api("/api/me/prefs"), api("/api/me")]).then(([prefs, me]) => {
                      ME = me;
                      const chanHtml = NOTIFY_CHANNELS.map((c) => {
                          const on = (prefs.channels || []).includes(c.key);
                          return `<label class="chk-card${on ? " on": ""}"><input type="checkbox" class="np-chan" value="${c.key}"${on ? "checked": ""}/><span class="chk-body"><b>${t(c.label)}</b><small class="muted">${t(c.desc)}</small></span></label>`;
                        }).join("");
                      const wc = prefs.wechat || {};
                      const fc = prefs.feishu || {};
                      const langs = (typeof LANGS !== "undefined"&& LANGS) || [];
                      let curAccent = (typeof getAccent === "function"? getAccent() : "teal") || "teal";
                      let curMode = (typeof getMode === "function"? getMode() : "light") || "light";
                      const curLang = (typeof getLang === "function"? getLang() : "zh") || "zh";
                      MY_PREFS = prefs;
                      const langOpts = langs.map((lg) => `<label class="vis-opt ${lg.code === curLang ? "active": ""}"><input type="radio" name="np-lang" value="${esc(lg.code)}"${lg.code === curLang ? "checked": ""} hidden />${esc(lg.label)}</label>`).join("");

                      box.innerHTML = `
                      <div class="card">
                      <div class="group-title"> ${t("profile.basic")}</div>
                      <p class="help">${t("profile.basicDesc")}</p>
                      <div class="field"><label>${t("user.username")} <span class="muted">(${t("profile.accountFixed")})</span></label><input id="pf-username" type="text" value="${esc(ME.username)}"disabled /></div>
                      <div class="field"><label>${t("profile.nickname")}</label><input id="pf-nickname" type="text" value="${esc(ME.nickname || "")}"placeholder="${t("profile.nicknamePh")}"/></div>
                      <div class="field"><label>${t("profile.email")}</label><input id="pf-email" type="email" value="${esc(ME.email || "")}"placeholder="${t("profile.emailPh")}"/></div>
                      <div class="modal-actions"><button class="btn btn-primary" id="pf-save">${t("btn.save")}</button></div>

                      <div class="group-title" style="margin-top:18px"> ${t("profile.password")}</div>
                      <p class="help">${t("profile.passwordDesc")}</p>
                      <div class="field"><label>${t("profile.curPass")}</label><input id="pf-cur" type="password" autocomplete="current-password"/></div>
                      <div class="field"><label>${t("profile.newPass")}</label><input id="pf-new" type="password" autocomplete="new-password"/></div>
                      <div class="field"><label>${t("profile.confirmPass")}</label><input id="pf-conf" type="password" autocomplete="new-password"/></div>
                      <div class="modal-actions"><button class="btn btn-primary" id="pf-pwd">${t("profile.changePass")}</button></div>
                      </div>

                      <div class="card">
                      <div class="group-title"> ${t("profile.notify")}</div>
                      <p class="help">${t("profile.notifyDesc")}</p>

                      <div class="field"><label>${t("notify.channels")}</label>
                      <div class="chk-row">${chanHtml}</div>
                      </div>
                      <div class="field np-inapp-field" style="display:none"><p class="help">${t("profile.inappNote")}</p></div>
                      <div class="field np-wechat-field" style="display:none">
                      <div class="group-subtitle"> ${t("profile.wechatCfg")}</div>
                      <div class="field"><label>${t("settings.wechatEnabled")}</label><label class="switch"><input type="checkbox" id="np-wc-en"${wc.enabled ? "checked": ""}/><span class="slider"></span></label></div>
                      <div class="field"><label>${t("settings.wechatType")}</label><select id="np-wc-type">${[["serverchan", t("settings.wechatServerchan")], ["pushplus", t("settings.wechatPushplus")], ["bark", t("settings.wechatBark")]].map(([v, tt]) => `<option value="${v}"${v === (wc.type || "serverchan") ? "selected": ""}>${tt}</option>`).join("")}</select></div>
                      <div class="field"><label>${t("settings.wechatToken")}</label><input id="np-wc-token" type="password" value="${esc(wc.token || "")}"placeholder="●●●●●●"/></div>
                      <div class="field"><label>${t("settings.barkServer")}</label><input id="np-wc-bark" type="text" value="${esc(wc.bark_server || "")}"placeholder="https://api.day.app"/></div>
                      </div>
                      <div class="field np-feishu-field" style="display:none">
                      <div class="group-subtitle"> ${t("profile.feishuCfg")}</div>
                      <div class="field"><label>${t("settings.feishuEnabled")}</label><label class="switch"><input type="checkbox" id="np-fs-en"${fc.enabled ? "checked": ""}/><span class="slider"></span></label></div>
                      <div class="field"><label>${t("settings.webhook")}</label><input id="np-fs-webhook" type="text" value="${esc(fc.webhook || "")}"placeholder="https://open.feishu.cn/..."/></div>
                      <div class="field"><label>${t("settings.secret")}</label><input id="np-fs-secret" type="password" value="${esc(fc.secret || "")}"placeholder="●●●●●●"/></div>
                      </div>

                      <div class="field"><label>${t("notify.content")}</label>
                      <textarea id="np-body" rows="4" placeholder="${t("notify.contentPh")}">${esc(prefs.template_body || DEFAULT_BODY_TPL)}</textarea>
                      <p class="help">${t("notify.contentHelp")}</p>
                      <button class="btn btn-ghost btn-sm" id="np-reset-tpl">${t("notify.resetTpl")}</button>
                      </div>
                      <div class="modal-actions"><button class="btn btn-primary" id="np-save">${t("btn.save")}</button></div>
                      </div>

                      <div class="panel">
                      <div class="panel-title">${esc(t("prefs.theme"))}</div>
                      <p class="help">${esc(t("prefs.themeDesc"))}</p>
                      <div class="theme-modes" id="np-modes">
                        ${MODES.map((m) => `<button type="button" class="theme-mode${m.code === curMode ? " on": ""}" data-mode="${m.code}">
                          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><use href="#${m.code === "dark" ? "ic-moon" : "ic-sun"}" /></svg>${esc(t("mode." + m.code))}</button>`).join("")}
                      </div>
                      <div class="theme-swatches" id="np-accents">
                        ${ACCENTS.map((a) => `<button type="button" class="theme-swatch${a.code === curAccent ? " on": ""}" data-accent="${a.code}" title="${esc(t("accent." + a.code))}">
                          <span class="sw" style="background:${ACCENT_HEX[a.code] || "#1b6e66"}"></span><span class="lb">${esc(t("accent." + a.code))}</span></button>`).join("")}
                      </div>
                      </div>
                      <div class="panel">
                      <div class="panel-title">${esc(t("prefs.lang"))}</div>
                      <p class="help">${esc(t("prefs.langDesc"))}</p>
                      <div class="vis-picker" id="np-langs">${langOpts}</div>
                      </div>`;

                      /* 配色即时生效，并存到账号里（换设备也一致） */
                      const saveTheme = async () => {
                        const theme = { accent: curAccent, mode: curMode };
                        MY_PREFS.theme = theme;   /* PUT 只回 ok，别把整个偏好对象换掉 */
                        try {
                          await api("/api/me/prefs", { method: "PUT", body: JSON.stringify({ ...MY_PREFS, theme }) });
                        } catch (_) {}
                      };
                      box.querySelectorAll(".theme-mode").forEach((b) => b.addEventListener("click", () => {
                        curMode = b.dataset.mode;
                        box.querySelectorAll(".theme-mode").forEach((x) => x.classList.toggle("on", x === b));
                        setMode(curMode); saveTheme();
                      }));
                      box.querySelectorAll(".theme-swatch").forEach((b) => b.addEventListener("click", () => {
                        curAccent = b.dataset.accent;
                        box.querySelectorAll(".theme-swatch").forEach((x) => x.classList.toggle("on", x === b));
                        setAccent(curAccent); saveTheme();
                      }));

                      const toggleExtra = () => {
                        const chans = Array.from(box.querySelectorAll(".np-chan:checked")).map((i) => i.value);
                        box.querySelector(".np-inapp-field").style.display = chans.includes("inapp") ? "": "none";
                        box.querySelector(".np-wechat-field").style.display = chans.includes("wechat") ? "": "none";
                        box.querySelector(".np-feishu-field").style.display = chans.includes("feishu") ? "": "none";
                        box.querySelectorAll(".np-chan").forEach((i) => i.closest(".chk-card").classList.toggle("on", i.checked));
                      };
                      box.querySelectorAll(".np-chan").forEach((c) => c.addEventListener("change", toggleExtra));
                      toggleExtra();

                      $("#pf-save").addEventListener("click", async () => {
                          try {
                            const r = await api("/api/me/profile", { method: "POST", body: JSON.stringify({ nickname: $("#pf-nickname").value.trim(), email: $("#pf-email").value.trim() }) });
                            ME.nickname = r.nickname; ME.email = r.email; renderUserChip();
                            toast(t("toast.saved"));
                          } catch (e) { toast(e.message, false); }
                        });
                      $("#pf-pwd").addEventListener("click", async () => {
                          const cur = $("#pf-cur").value, nw = $("#pf-new").value, cf = $("#pf-conf").value;
                          if (nw.length < 6) { toast(t("profile.pwdTooShort"), false); return; }
                          if (nw !== cf) { toast(t("profile.pwdMismatch"), false); return; }
                          try { await api("/api/me/password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: nw }) }); toast(t("toast.saved")); $("#pf-cur").value = $("#pf-new").value = $("#pf-conf").value = ""; }
                          catch (e) { toast(e.message, false); }
                        });
                      $("#np-reset-tpl").addEventListener("click", () => { $("#np-body").value = DEFAULT_BODY_TPL; });
                      $("#np-save").addEventListener("click", async () => {
                          const channels = Array.from(box.querySelectorAll(".np-chan:checked")).map((i) => i.value);
                          const body = $("#np-body").value.trim();
                          const wechat = channels.includes("wechat") ? {
                            enabled: $("#np-wc-en").checked,
                            type: $("#np-wc-type").value,
                            token: $("#np-wc-token").value.trim(),
                            bark_server: $("#np-wc-bark").value.trim() || "https://api.day.app",
                          } : {};
                          const feishu = channels.includes("feishu") ? {
                            enabled: $("#np-fs-en").checked,
                            webhook: $("#np-fs-webhook").value.trim(),
                            secret: $("#np-fs-secret").value.trim(),
                          } : {};
                          const payload = {
                            channels: channels.length ? channels : ["inapp"],
                            wechat: wechat,
                            feishu: feishu,
                            template_body: body === DEFAULT_BODY_TPL ? null : body,
                            theme: MY_PREFS.theme || {},
                          };
                          try { await api("/api/me/prefs", { method: "PUT", body: JSON.stringify(payload) }); MY_PREFS = { ...MY_PREFS, ...payload }; toast(t("toast.saved")); }
                          catch (e) { toast(e.message, false); }
                        });

                      $$("#np-langs input").forEach((i) => i.addEventListener("change", () => {
                            $$("#np-langs .vis-opt").forEach((l) => l.classList.toggle("active", l.querySelector("input").checked));
                            setLang(i.value).then(() => toast(t("toast.langSaved")));
                          }));
                    }).catch((e) => { box.innerHTML = ""; toast(e.message, false); });
                }

                /* ============ 站内信（每用户提醒收件箱） ============ */

                async function refreshNotifBadge() {
                  try {
                    const d = await api("/api/me/notifications");
                    const b = $("#notif-unread");
                    if (b) { b.textContent = d.unread || ""; b.classList.toggle("hidden", !d.unread); }
                  } catch (_) {}
                }

                function loadNotifications() {
                  const list = $("#notif-list"); if (!list) return;
                  api("/api/me/notifications").then((d) => {
                      const items = d.items || [];
                      if (!items.length) { list.innerHTML = '<div class="muted sm" style="padding:12px">' + t("notif.empty") + '</div>'; return; }
                      list.innerHTML = items.map((n) => `<div class="notif-item ${n.is_read ? "": "unread"}"data-id="${n.id}">
                        <div class="notif-title">${esc(n.title)}</div>
                        <div class="notif-body">${esc(n.content)}</div>
                        <div class="notif-time muted sm">${esc((n.sent_at || "").replace("T", "").slice(0, 16))}</div>
                        </div>`).join("");
                        list.querySelectorAll(".notif-item.unread").forEach((el) => el.addEventListener("click", async () => {
                              try { await api("/api/me/notifications/read", { method: "POST", body: JSON.stringify({ id: parseInt(el.dataset.id) }) }); el.classList.remove("unread"); refreshNotifBadge(); }
                              catch (_) {}
                            }));
                      }).catch(() => { list.innerHTML = '<div class="muted sm" style="padding:12px">' + t("notif.empty") + '</div>'; });
                  }

                  $("#notif-bell").addEventListener("click", (e) => {
                      e.stopPropagation();
                      const p = $("#notif-panel");
                      const show = p.classList.contains("hidden");
                      p.classList.toggle("hidden", !show);
                      if (show) loadNotifications();
                    });
                  $("#notif-read-all").addEventListener("click", async () => {
                      try { await api("/api/me/notifications/read-all", { method: "POST"}); $("#notif-panel").querySelectorAll(".notif-item").forEach((el) => el.classList.remove("unread")); refreshNotifBadge(); }
                      catch (_) {}
                    });
                  document.addEventListener("click", (e) => {
                      const p = $("#notif-panel");
                      if (p && !p.classList.contains("hidden") && !p.contains(e.target) && e.target.id !== "notif-bell") {
                        p.classList.add("hidden");
                      }
                    });

                  /* ============ 设置（每个参数带说明 + 二级菜单） ============ */
                  let SETTINGS_SCHEMA = buildSettingsSchema();
                  function buildSettingsSchema() {
                    return [
                      { key: "ui", icon: "", title: t("settings.group.ui"), desc: t("settings.group.uiDesc"), fields: [
                          { path: "ui.menu_position", label: t("settings.menuPosition"), type: "select", options: [["left", t("settings.menuLeftOpt")], ["top", t("settings.menuTopOpt")]], help: "导航菜单显示在页面左侧还是顶部。选择后保存立即生效（刷新一次即可看到布局变化）。"},
                          { path: "ui.contact_edit_mode", label: t("settings.editMode"), type: "select", options: [["modal", t("settings.modalOpt")], ["drawer", t("settings.drawerOpt")]], help: "编辑或新建联系人时，表单以「居中的弹窗」还是「从右侧滑出的抽屉」呈现。抽屉方式在宽屏下更便于一边查看列表一边编辑。"},
                          { path: "ui.anniversary_enabled", label: t("settings.anniEnabled"), type: "bool", help: "关闭后左侧导航与页面中的「纪念日」入口将隐藏。若你只用生日提醒，可关闭以保持界面简洁。"},
                        ] },
                      { key: "privacy", icon: "", title: t("settings.group.privacy"), desc: t("settings.privacyDesc"), fields: [
                          { path: "privacy.default_visibility", label: t("settings.defaultVis"), type: "select", options: [["private", t("settings.visPrivate")], ["family", t("settings.visFamily")], ["public", t("settings.visPublic")]], help: "新建生日/纪念日时默认选中的可见范围。私人=仅本人；家庭=与你同属一个家庭的成员可见；公开=系统内所有用户可见。每条数据也可在编辑时单独调整。"},
                          { path: "privacy.allow_register", label: t("settings.allowRegister"), type: "bool", help: "开启后，登录页会显示「注册账号」入口，任何人都可以自助注册普通用户。关闭后仅管理员可在「用户管理」中创建账号。"},
                        ] },
                      { key: "notify", icon: "", title: t("settings.group.notify"), desc: t("settings.notifyDesc") + ' <span class="set-hint"> ' + t("settings.notifyHint") + '</span>', fields: [
                          { path: "notify.check_hour", label: t("settings.checkHour"), type: "number", min: 0, max: 23, help: "系统每天在这个小时执行一次生日/纪念日检查（24小时制，0-23）。保存后立即生效，无需重启。"},
                          { path: "notify.check_minute", label: t("settings.checkMinute"), type: "number", min: 0, max: 59, help: "配合上面的小时使用，精确到分钟（0-59）。"},
                          { path: "notify.default_notify_days", label: t("settings.defaultDays"), type: "numlist", help: "全局默认的提前提醒天数，多个值用逗号分隔。例如「1,3,7」表示每位联系人会在生日前 7/3/1 天各收到一次提醒。联系人单独设置则以联系人自己的为准。填 0 表示当天也提醒。"},
                          { path: "notify.default_channels", label: t("settings.defaultChannels"), type: "channels", help: "全局默认使用哪些渠道（可多选）。联系人未单独指定渠道、且本人「个人资料及偏好」也未指定时使用此设置。"},
                        ] },
                      { key: "templates", icon: "", title: t("settings.group.templates"), desc: t("settings.templatesDesc"), fields: [
                          { path: "templates.birthday_title", label: t("settings.birthdayTitle"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.birthday_body", label: t("settings.birthdayBody"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.anniversary_title", label: t("settings.anniversaryTitle"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.anniversary_body", label: t("settings.anniversaryBody"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.test_title", label: t("settings.testTitle"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.test_body", label: t("settings.testBody"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.anniversary_test_title", label: t("settings.anniTestTitle"), type: "textarea", help: t("settings.templateVars") },
                          { path: "templates.anniversary_test_body", label: t("settings.anniTestBody"), type: "textarea", help: t("settings.templateVars") },
                        ] },
                      { key: "app", icon: "", title: t("settings.group.system"), desc: t("settings.systemDesc"), fields: [
                          { path: "app.timezone", label: t("settings.timezone"), type: "text", help: "定时检查所使用的时区，默认 Asia/Shanghai。"},
                          { path: "app.port", label: t("settings.port"), type: "number", min: 1, max: 65535, help: "容器内监听端口，默认 8000。修改后需重启容器并调整 docker-compose 端口映射。"},
                        ] },
                    ];
                  }

                  function refreshStaticText() {
                    FIELD_META = buildFieldMeta();
                    SETTINGS_SCHEMA = buildSettingsSchema();
                  }
                  let SETTINGS_CACHE = null;
                  function getPath(obj, path) { return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj); }
                  function setPath(obj, path, val) { const keys = path.split("."); let o = obj; for (let i = 0; i < keys.length - 1; i++) { if (typeof o[keys[i]] !== "object"|| o[keys[i]] === null) o[keys[i]] = {}; o = o[keys[i]]; } o[keys[keys.length - 1]] = val; }

                  async function loadSettings() {
                    const box = $("#settings-form"); box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
                    try {
                      SETTINGS_CACHE = await api("/api/settings");
                      $("#settings-nav").innerHTML = SETTINGS_SCHEMA.map((g) => `<a class="settings-nav-item" data-target="setgroup-${g.key}">${g.icon} ${g.title}</a>`).join("");
                      box.innerHTML = SETTINGS_SCHEMA.map(groupHtml).join("");
                      $$(".settings-nav-item").forEach((a) => a.addEventListener("click", () => {
                            const el = document.getElementById(a.dataset.target);
                            if (el) el.scrollIntoView({ behavior: "smooth", block: "start"});
                          }));
                    } catch (err) { box.innerHTML = ""; toast(err.message, false); }
                  }
                  function fieldId(path) { return "set-"+ path.replace(/\./g, "-"); }
                  function groupHtml(g) {
                    return `<div class="card settings-group" id="setgroup-${g.key}">
                    <div class="group-head"><div class="group-title">${g.icon} ${g.title}</div><div class="group-desc">${g.desc}</div></div>
                    ${g.fields.map(fieldHtml).join("")}
                    </div>`;
                  }
                  function fieldHtml(f) {
                    const val = getPath(SETTINGS_CACHE, f.path); const id = fieldId(f.path); let input = "";
                    if (f.type === "bool") input = `<label class="switch"><input type="checkbox" id="${id}"${val ? "checked": ""} /><span class="slider"></span></label>`;
                    else if (f.type === "select") input = `<select id="${id}">${f.options.map(([v, tt]) => `<option value="${v}"${v === val ? "selected": ""}>${tt}</option>`).join("")}</select>`;
                    else if (f.type === "numlist") input = daysPickerHtml(id, val);
                    else if (f.type === "channels") { const chosen = val || []; input = `<div class="chk-row" id="${id}">${["wechat", "feishu"].map((c) => `<label class="chk"><input type="checkbox" value="${c}"${chosen.includes(c) ? "checked": ""}/> ${chNames()[c]}</label>`).join("")}</div>`; }
                    else if (f.type === "password") input = `<input id="${id}" type="password" value="${esc(val || "")}"autocomplete="new-password" placeholder="●●●●●●"/>`;
                    else if (f.type === "number") input = `<input id="${id}" type="number" value="${val ?? ""}"${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} />`;
                    else if (f.type === "textarea") input = `<textarea id="${id}" rows="3">${esc(val ?? "")}</textarea>`;
                    else input = `<input id="${id}" type="text" value="${esc(val ?? "")}"/>`;
                    return `<div class="field setting-field ${f.type === "bool"? "field-inline": ""}">
                    <div class="field-main"><label class="field-label" for="${id}">${f.label}</label>${input}</div>
                    <p class="help">${f.help}</p>
                    </div>`;
                  }
                  function collectSettings() {
                    const out = JSON.parse(JSON.stringify(SETTINGS_CACHE));
                    for (const g of SETTINGS_SCHEMA) for (const f of g.fields) {
                      const id = fieldId(f.path); const el = document.getElementById(id); if (!el) continue;
                      let v;
                      if (f.type === "bool") v = el.checked;
                      else if (f.type === "number") v = el.value === ""? getPath(SETTINGS_CACHE, f.path) : Number(el.value);
                      else if (f.type === "numlist") v = Array.from(el.querySelectorAll("input:checked")).map((i) => Number(i.value));
                      else if (f.type === "channels") v = Array.from(el.querySelectorAll("input:checked")).map((i) => i.value);
                      else v = el.value.trim();
                      setPath(out, f.path, v);
                    }
                    return out;
                  }
                  $("#save-settings-btn").addEventListener("click", async () => {
                      try {
                        const cfg = collectSettings();
                        const h = cfg.notify.check_hour, m = cfg.notify.check_minute;
                        if (h < 0 || h > 23 || m < 0 || m > 59) return toast(t("toast.invalidTime"), false);
                        if (!cfg.notify.default_notify_days.length) return toast(t("toast.notifyDaysRequired"), false);
                        await api("/api/settings", { method: "POST", body: JSON.stringify(cfg) });
                        SETTINGS_CACHE = cfg;
                        // 若界面偏好改变，立即在本地生效
                        if (cfg.ui) {
                          UI_PREFS = { ...UI_PREFS, ...cfg.ui };
                          document.body.classList.toggle("menu-top", UI_PREFS.menu_position === "top");
                          document.body.classList.toggle("menu-left", UI_PREFS.menu_position !== "top");
                          $("#nav-anniversaries") && $("#nav-anniversaries").classList.toggle("hidden", UI_PREFS.anniversary_enabled === false);
                        }
                        toast(t("toast.saved"));
                      } catch (err) { toast(err.message, false); }
                    });

                  /* ============ 用户管理 ============ */
                  async function loadUsers() {
                    const box = $("#users-list"); box.innerHTML = '<div class="empty">' + t("empty.loading") + '</div>';
                    try {
                      const rows = await api("/api/users");
                      box.innerHTML = `<div class="table-card table-fit"><table class="table"><thead><tr><th>${t("user.username")}</th><th>${t("user.role")}</th><th>${t("user.createdAt")}</th><th class="ta-r">${t("field.actions")}</th></tr></thead><tbody>${rows.map((u) => `<tr>
                      <td data-label="${t("user.username")}"><b>${esc(u.username)}</b>${ME && u.username === ME.username ? ' <span class="tag tag-solar">' + t("user.current") + '</span>' : ""}</td>
                      <td data-label="${t("user.role")}">${u.role === "admin"? '<span class="tag tag-on">' + t("user.admin") + '</span>' : '<span class="tag tag-off">' + t("user.normal") + '</span>'}</td>
                      <td data-label="${t("user.createdAt")}"class="muted">${esc((u.created_at || "").slice(0, 16).replace("T", ""))}</td>
                      <td data-label="${t("field.actions")}"class="ta-r"><button class="btn btn-ghost btn-sm" onclick="resetUserPwd(${u.id}, '${esc(u.username)}')">${t("btn.resetPass")}</button><button class="btn btn-danger-ghost btn-sm" onclick="delUser(${u.id}, '${esc(u.username)}')">${t("btn.delete")}</button></td>
                      </tr>`).join("")}</tbody></table></div><p class="muted sm" style="padding:12px 16px">${t("user.note")}</p>`;
                    } catch (err) { box.innerHTML = ""; toast(err.message, false); }
                  }
                  window.resetUserPwd = (id, name) => {
                    openModal(`<h2>${t("user.resetPwd", { name: esc(name) })}</h2><form id="rp-form" class="modal-form">
                      <div class="field"><label>${t("user.newPwd")} *</label><input id="rp-pass" type="password"required placeholder="${t("placeholder.regPass")}"/></div>
                      <p class="muted sm">${t("user.resetDesc")}</p>
                      <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="submit" class="btn btn-primary">${t("btn.resetPass")}</button></div>
                      </form>`);
                      $("#rp-form").addEventListener("submit", async (e) => {
                          e.preventDefault();
                          try {
                            await api(`/api/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password: $("#rp-pass").value }) });
                            closeModal(); toast(t("toast.pwdReset"));
                          } catch (err) { toast(err.message, false); }
                        });
                    };

                    window.delUser = async (id, name) => {
                      if (!confirm(t("confirm.delUser", { name }))) return;
                      try { await api(`/api/users/${id}`, { method: "DELETE"}); toast(t("toast.deleted")); loadUsers(); } catch (err) { toast(err.message, false); }
                    };
                    $("#add-user-btn").addEventListener("click", () => {
                        openModal(`<h2>${t("user.addTitle")}</h2><form id="user-form" class="modal-form">
                          <div class="field"><label>${t("user.username")} *</label><input id="u-name" type="text"required placeholder="${t("user.username")}"/></div>
                          <div class="field"><label>${t("user.password")} *</label><input id="u-pass" type="password"required placeholder="${t("user.password")}"/></div>
                          <div class="field"><label>${t("user.role")}</label><select id="u-role"><option value="user">${t("user.normal")}</option><option value="admin">${t("user.admin")}</option></select></div>
                          <div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">${t("btn.cancel")}</button><button type="submit" class="btn btn-primary">${t("btn.create")}</button></div>
                          </form>`);
                          $("#user-form").addEventListener("submit", async (e) => {
                              e.preventDefault();
                              try { await api("/api/users", { method: "POST", body: JSON.stringify({ username: $("#u-name").value.trim(), password: $("#u-pass").value, role: $("#u-role").value }) }); closeModal(); toast(t("toast.added")); loadUsers(); }
                              catch (err) { toast(err.message, false); }
                            });
                        });

                      /* 行选择事件委托：避免每次 renderContacts 都重新绑定 N 个 checkbox */
                      $("#contacts-list").addEventListener("change", (e) => {
                          const rowCb = e.target.closest(".row-select");
                          if (rowCb) {
                            const id = parseInt(rowCb.value);
                            if (rowCb.checked) SELECTED_IDS.add(id); else SELECTED_IDS.delete(id);
                            updateBatchBadge();
                            updateSelectStates();
                            return;
                          }
                          if (e.target.id === "select-all-page") {
                            const checked = e.target.checked;
                            $$(".row-select").forEach((cb) => {
                                const id = parseInt(cb.value);
                                if (checked) SELECTED_IDS.add(id); else SELECTED_IDS.delete(id);
                              });
                            updateBatchBadge();
                            updateSelectStates();
                            return;
                          }
                          const groupCb = e.target.closest(".group-select-all");
                          if (groupCb) {
                            const grp = groupCb.closest(".group");
                            const ids = grp ? Array.from(grp.querySelectorAll(".row-select")).map((cb) => parseInt(cb.value)) : [];
                            if (groupCb.checked) ids.forEach((id) => SELECTED_IDS.add(id));
                            else ids.forEach((id) => SELECTED_IDS.delete(id));
                            updateBatchBadge();
                            updateSelectStates();
                          }
                        });

                      /* 同步「本页全选」与「各分组全选」的勾选/半选状态 */
                      function updateSelectStates() {
                        const allPage = $("#select-all-page");
                        if (allPage) {
                          const visible = $$(".row-select");
                          const sel = visible.filter((cb) => SELECTED_IDS.has(parseInt(cb.value))).length;
                          allPage.checked = visible.length > 0 && sel === visible.length;
                          allPage.indeterminate = sel > 0 && sel < visible.length;
                        }
                        $$(".group-select-all").forEach((gcb) => {
                            const grp = gcb.closest(".group");
                            const cbs = grp ? Array.from(grp.querySelectorAll(".row-select")) : [];
                            const sel = cbs.filter((cb) => SELECTED_IDS.has(parseInt(cb.value))).length;
                            gcb.checked = cbs.length > 0 && sel === cbs.length;
                            gcb.indeterminate = sel > 0 && sel < cbs.length;
                          });
                      }

                      /* ============ 启动 ============ */
                      initAuth().catch((err) => toast(err.message, false));
