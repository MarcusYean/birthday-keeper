/* ============================================================
   生日管家 · 国际化 (i18n) + 主题偏好 加载器
   语言文件按需加载，默认从 localStorage 读取 bk_lang，回退 zh。
   支持：简体中文(zh) / 繁體中文(zh-Hant) / English(en) / 한국어(ko) / 日本語(ja)
   语言与主题均保存在 localStorage，按用户各自偏好生效。
   ============================================================ */
(function () {
  "use strict";

  /* 静态资源版本号：从加载本文件的 <script src=".../i18n.js?v=X"> 自动提取，
     确保懒加载的语言包与主文件同版本、发版后不吃旧缓存 */
  var ASSET_V = (function () {
    try {
      var s = document.querySelector('script[src*="/static/js/i18n.js"]');
      var m = s && s.src.match(/[?&]v=([^&]+)/);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  })();

  /* 可选语言 */
  var LANGS = [
    { code: "zh", label: "简体中文" },
    { code: "zh-Hant", label: "繁體中文" },
    { code: "en", label: "English" },
    { code: "ko", label: "한국어" },
    { code: "ja", label: "日本語" },
  ];

  /* 强调色：界面结构由「一层色调面板」承担，颜色只用来标记数据与身份。
     用户可以在个人资料里换强调色，页面结构与配色方案保持不变。 */
  var ACCENTS = [
    { code: "teal", label: "Teal" },
    { code: "clay", label: "Clay" },
    { code: "indigo", label: "Indigo" },
    { code: "forest", label: "Forest" },
    { code: "ochre", label: "Ochre" },
    { code: "graphite", label: "Graphite" },
  ];

  /* 明暗两档：只换表面层，强调色各自有深浅两套值。 */
  var MODES = [
    { code: "light", label: "Light" },
    { code: "dark", label: "Dark" },
  ];

  /* 兼容旧字段：THEMES 现在指向强调色列表 */
  var THEMES = ACCENTS;

  /* 已加载语言字典 */
  var DICT = {};
  /* 加载中 Promise 缓存 */
  var LOADING = {};

  /* 当前语言 / 主题（持久化到 localStorage） */
  var LANG = "zh";
  var ACCENT = "teal";
  var MODE = "light";
  try { LANG = localStorage.getItem("bk_lang") || "zh"; } catch (e) {}
  try { ACCENT = localStorage.getItem("bk_accent") || "teal"; } catch (e) {}
  try { MODE = localStorage.getItem("bk_mode") || "light"; } catch (e) {}
  /* 旧版本只存了一个 bk_theme（light/dark），把它迁到明暗档 */
  if (!localStorage.getItem("bk_mode")) {
    try { var oldTheme = localStorage.getItem("bk_theme"); if (oldTheme === "light" || oldTheme === "dark") MODE = oldTheme; } catch (e) {}
  }
  if (["teal", "clay", "indigo", "forest", "ochre", "graphite"].indexOf(ACCENT) < 0) ACCENT = "teal";
  if (MODE !== "light" && MODE !== "dark") MODE = "light";

  function setLs(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  /* 语言文件调用此函数注册字典 */
  function register(lang, dict) {
    DICT[lang] = dict || {};
  }

  /* 动态加载 <script> */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("i18n load failed: " + src)); };
      document.head.appendChild(s);
    });
  }

  /* 按需加载某语言 */
  function loadLang(code) {
    if (DICT[code]) return Promise.resolve();
    if (LOADING[code]) return LOADING[code];
    LOADING[code] = loadScript("/static/js/i18n/" + code + ".js" + (ASSET_V ? "?v=" + ASSET_V : "")).then(function () {
      if (!DICT[code]) DICT[code] = {};
    });
    return LOADING[code];
  }

  /* 翻译函数 */
  function t(key, vars) {
    var dict = DICT[LANG] || DICT.zh || {};
    var s = dict[key];
    if (s == null) s = (DICT.zh && DICT.zh[key] != null) ? DICT.zh[key] : key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split("{" + k + "}").join(String(vars[k]));
        }
      }
    }
    return s;
  }

  /* 将 [data-i18n] 等属性翻译为当前语言 */
  function applyI18n(root) {
    root = root || document;
    var nodes = root.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    nodes = root.querySelectorAll("[data-i18n-ph]");
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute("placeholder", t(nodes[i].getAttribute("data-i18n-ph")));
    }
    nodes = root.querySelectorAll("[data-i18n-title]");
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute("title", t(nodes[i].getAttribute("data-i18n-title")));
    }
  }

  /* 主题应用：只改两个属性，其余交给 CSS */
  function applyTheme() {
    document.documentElement.setAttribute("data-accent", ACCENT);
    document.documentElement.setAttribute("data-mode", MODE);
  }

  function setTheme(code) {
    /* 旧接口：theme 曾经表示 light/dark，现在表示强调色 */
    if (code === "light" || code === "dark") { setMode(code); return; }
    ACCENT = code || "teal";
    setLs("bk_accent", ACCENT);
    applyTheme();
  }

  function setAccent(code) {
    ACCENT = code || "teal";
    setLs("bk_accent", ACCENT);
    applyTheme();
  }

  function setMode(code) {
    MODE = code === "dark" ? "dark" : "light";
    setLs("bk_mode", MODE);
    applyTheme();
  }

  function setLang(code) {
    code = code || "zh";
    return loadLang(code).then(function () {
      LANG = code;
      setLs("bk_lang", LANG);
      document.documentElement.setAttribute("lang", LANG === "zh" ? "zh-CN" : LANG);
      applyI18n();
      if (typeof window.__onLangChange === "function") window.__onLangChange();
    });
  }

  function getLang() { return LANG; }
  function getTheme() { return ACCENT; }
  function getAccent() { return ACCENT; }
  function getMode() { return MODE; }

  /* 初始化：加载默认语言并暴露全局 API */
  function init() {
    applyTheme();
    document.documentElement.setAttribute("lang", LANG === "zh" ? "zh-CN" : LANG);
    return loadLang(LANG).then(function () {
      applyI18n();
      var api = {
        LANGS: LANGS, THEMES: THEMES, ACCENTS: ACCENTS, MODES: MODES, DICT: DICT,
        register: register, loadLang: loadLang, t: t,
        applyI18n: applyI18n, applyTheme: applyTheme,
        setTheme: setTheme, setAccent: setAccent, setMode: setMode, setLang: setLang,
        getLang: getLang, getTheme: getTheme, getAccent: getAccent, getMode: getMode
      };
      window.I18N = api;
      window.LANGS = LANGS;
      window.THEMES = THEMES;
      window.ACCENTS = ACCENTS;
      window.MODES = MODES;
      window.t = t;
      window.applyI18n = applyI18n;
      window.applyTheme = applyTheme;
      window.setTheme = setTheme;
      window.setAccent = setAccent;
      window.setMode = setMode;
      window.setLang = setLang;
      window.getLang = getLang;
      window.getTheme = getTheme;
      window.getAccent = getAccent;
      window.getMode = getMode;
    });
  }

  /* 语言文件加载前，先暴露 register；init 完成后会覆盖为完整 API */
  window.I18N = { init: init, register: register };
})();
