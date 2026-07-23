/* 生日管家 v2 前端 SPA */
"use strict";

/* ============ 工具 ============ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let TOKEN = localStorage.getItem("bk_token") || "";
let ME = null; // {username, role}

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

/* ============ 联系人 ============ */
const CH_NAMES = { wechat: "微信", feishu: "飞书", email: "邮件" };

async function loadContacts() {
  const box = $("#contacts-list");
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const rows = await api("/api/birthdays");
    if (!rows.length) {
      box.innerHTML = '<div class="empty">还没有联系人，点击「+ 添加联系人」开始记录 🎂</div>';
      return;
    }
    box.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>姓名</th><th>关系</th><th>生日</th><th>提前提醒</th><th>渠道</th><th>状态</th><th class="ta-r">操作</th>
        </tr></thead>
        <tbody>${rows.map(rowHtml).join("")}</tbody>
      </table>`;
  } catch (err) { box.innerHTML = ""; toast(err.message, false); }
}

function rowHtml(r) {
  const cal = r.calendar_type === "lunar"
    ? `<span class="tag tag-lunar">农历</span>`
    : `<span class="tag tag-solar">公历</span>`;
  const date = `${r.year ? r.year + "." : ""}${r.month}.${r.day}${r.is_leap ? "（闰月）" : ""}`;
  const days = (r.notify_days || []).length
    ? r.notify_days.map((d) => `提前${d}天`).join("、")
    : '<span class="muted">跟随全局</span>';
  const chs = (r.channels || []).length
    ? r.channels.map((c) => CH_NAMES[c] || c).join("、")
    : '<span class="muted">跟随全局</span>';
  return `<tr>
    <td><b>${esc(r.name)}</b>${r.note ? `<div class="muted sm">${esc(r.note)}</div>` : ""}</td>
    <td>${esc(r.relationship || "-")}</td>
    <td>${cal} ${date}</td>
    <td>${days}</td>
    <td>${chs}</td>
    <td>${r.enabled ? '<span class="tag tag-on">启用</span>' : '<span class="tag tag-off">停用</span>'}</td>
    <td class="ta-r">
      <button class="btn btn-ghost btn-sm" onclick="testNotify(${r.id})">测试</button>
      <button class="btn btn-ghost btn-sm" onclick='editContact(${JSON.stringify(r).replace(/'/g, "&#39;")})'>编辑</button>
      <button class="btn btn-danger-ghost btn-sm" onclick="delContact(${r.id}, '${esc(r.name)}')">删除</button>
    </td>
  </tr>`;
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

$("#add-btn").addEventListener("click", () => openContactModal(null));
$("#refresh-btn").addEventListener("click", loadContacts);

function openContactModal(r) {
  const isEdit = !!r;
  r = r || {};
  const nd = (r.notify_days || []).join(",");
  const chs = r.channels || [];
  openModal(`
    <h2>${isEdit ? "编辑联系人" : "添加联系人"}</h2>
    <form id="contact-form" class="modal-form">
      <div class="grid2">
        <div class="field">
          <label>姓名 *</label>
          <input id="c-name" required value="${esc(r.name || "")}" placeholder="如：老爸" />
        </div>
        <div class="field">
          <label>关系</label>
          <input id="c-rel" value="${esc(r.relationship || "")}" placeholder="如：家人 / 朋友" />
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
          <label>出生年份（可选，用于计算年龄）</label>
          <input id="c-year" type="number" min="1900" max="2100" value="${r.year || ""}" placeholder="如 1960" />
        </div>
      </div>
      <div class="grid3">
        <div class="field">
          <label>月 *</label>
          <input id="c-month" type="number" min="1" max="12" required value="${r.month || ""}" />
        </div>
        <div class="field">
          <label>日 *</label>
          <input id="c-day" type="number" min="1" max="31" required value="${r.day || ""}" />
        </div>
        <div class="field">
          <label class="chk"><input id="c-leap" type="checkbox" ${r.is_leap ? "checked" : ""}/> 闰月（仅农历）</label>
        </div>
      </div>
      <div class="field">
        <label>提前提醒天数（逗号分隔，留空则跟随全局默认）</label>
        <input id="c-days" value="${nd}" placeholder="如 1,3,7 表示提前1/3/7天各提醒一次" />
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
        <input id="c-note" value="${esc(r.note || "")}" placeholder="如：喜欢的礼物、忌口等" />
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
      const badge = r.days_until === 0
        ? '<span class="days today">🎉 今天</span>'
        : `<span class="days">${r.days_until} 天后</span>`;
      const cal = r.calendar_type === "lunar" ? "农历" : "公历";
      const age = r.age != null ? ` · ${r.age} 岁` : "";
      return `<div class="up-item">
        <div class="up-left">
          <div class="up-name">${esc(r.name)} <span class="muted sm">${esc(r.relationship || "")}</span></div>
          <div class="muted sm">${cal} ${r.month}.${r.day} · ${r.next_date}${age}</div>
        </div>
        ${badge}
      </div>`;
    }).join("");
  } catch (err) { box.innerHTML = ""; toast(err.message, false); }
}

/* ============ 设置（每个参数带说明） ============ */
/*
 * SETTINGS_SCHEMA：设置页的渲染蓝本。
 * 每个字段都有 label（名称）和 help（该参数的作用说明），
 * 管理员在前台即可看懂每一项配置的含义并直接修改。
 */
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
    // 简单校验
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
        <input id="u-name" required placeholder="登录用户名" />
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
