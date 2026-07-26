/* ============================================================
   生日管家 · 国际化 (i18n) + 主题偏好 加载器
   语言文件按需加载，默认从 localStorage 读取 bk_lang，回退 zh。
   支持：简体中文(zh) / 繁體中文(zh-Hant) / English(en) / 한국어(ko) / 日本語(ja)
   语言与主题均保存在 localStorage，按用户各自偏好生效。
   ============================================================ */
(function () {
  "use strict";

  /* 可选语言 */
  var LANGS = [
    { code: "zh", label: "简体中文" },
    { code: "zh-Hant", label: "繁體中文" },
    { code: "en", label: "English" },
    { code: "ko", label: "한국어" },
    { code: "ja", label: "日本語" },
  ];

  /* 5 种简约主题（均为浅色基调，不同底色与强调色） */
  var THEMES = [
    { code: "clean", label: "极简白", icon: "" },
    { code: "warm", label: "暖灰", icon: "" },
    { code: "mint", label: "薄荷", icon: "" },
    { code: "morandi", label: "莫兰迪", icon: "" },
    { code: "sakura", label: "樱粉", icon: "" },
  ];

  /* 已加载语言字典 */
  var DICT = {};
  /* 加载中 Promise 缓存 */
  var LOADING = {};

  /* 当前语言 / 主题（持久化到 localStorage） */
  var LANG = "zh";
  var THEME = "clean";
  try { LANG = localStorage.getItem("bk_lang") || "zh"; } catch (e) {}
  try { THEME = localStorage.getItem("bk_theme") || "clean"; } catch (e) {}

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
    LOADING[code] = loadScript("/static/js/i18n/" + code + ".js").then(function () {
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

  /* 主题应用 */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", THEME);
  }

  function setTheme(code) {
    THEME = code || "clean";
    setLs("bk_theme", THEME);
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
  function getTheme() { return THEME; }

  /* 初始化：加载默认语言并暴露全局 API */
  function init() {
    applyTheme();
    document.documentElement.setAttribute("lang", LANG === "zh" ? "zh-CN" : LANG);
    return loadLang(LANG).then(function () {
      applyI18n();
      var api = {
        LANGS: LANGS, THEMES: THEMES, DICT: DICT,
        register: register, loadLang: loadLang, t: t,
        applyI18n: applyI18n, applyTheme: applyTheme,
        setTheme: setTheme, setLang: setLang,
        getLang: getLang, getTheme: getTheme
      };
      window.I18N = api;
      window.LANGS = LANGS;
      window.THEMES = THEMES;
      window.t = t;
      window.applyI18n = applyI18n;
      window.applyTheme = applyTheme;
      window.setTheme = setTheme;
      window.setLang = setLang;
      window.getLang = getLang;
      window.getTheme = getTheme;
    });
  }

  /* 语言文件加载前，先暴露 register；init 完成后会覆盖为完整 API */
  window.I18N = { init: init, register: register };
})();
