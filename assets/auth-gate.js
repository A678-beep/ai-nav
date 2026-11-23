/* 星籁 AI · 生成类工具统一登录引导（静态组件，无依赖）
 * ---------------------------------------------------------------------------
 * 用法（页面 <head> 内、业务脚本之前）：
 *   <link rel="stylesheet" href="../assets/auth-gate.css">
 *   <script src="../assets/auth-gate.js" data-mode="mask"></script>
 *
 * data-mode：
 *   mask   —— 工具页：未登录时整块操作区遮罩（默认）
 *   banner —— 展示页（导演编排器/监视器）：可先浏览公开数据，点生成/写操作或 401 时弹登录引导
 *
 * 做三件事：
 *   1) 页面加载检测登录态（xl_token + GET /auth/me）
 *   2) 未登录：显示「请先登录后使用（登录后可用 AI 生成）」+ 登录/注册；拦截 401 → 同一提示，不外抛原始错误
 *   3) 已登录：同源 /ai-nav/api 请求自动补 Authorization: Bearer <token>
 * 暴露：window.XLGate
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var SCRIPT = document.currentScript;
  if (!SCRIPT) {
    var all = document.getElementsByTagName('script');
    for (var i = 0; i < all.length; i++) {
      if (/assets\/auth-gate\.js/.test(all[i].src || '')) { SCRIPT = all[i]; break; }
    }
  }
  var MODE = (SCRIPT && SCRIPT.getAttribute('data-mode')) || 'mask';
  var ASSET_URL = SCRIPT ? new URL(SCRIPT.src, location.href) : new URL('/assets/auth-gate.js', location.href);
  var ROOT = new URL('../', ASSET_URL).href;
  var MSG = '请先登录后使用（登录后可用 AI 生成）';
  var LOGIN_TIP = '登录后可用 AI 生成 / 打包 / 导出等能力；未登录仅可浏览公开内容。';

  function rootUrl(p) { return ROOT + String(p || '').replace(/^\/+/, ''); }

  /* ---------------- API 地址（与 assets/auth.js 同口径） ---------------- */
  var API_BASE = (function () {
    try {
      var qs = new URLSearchParams(location.search);
      var ov = qs.get('api');
      if (ov) { try { localStorage.setItem('xl_api_base', ov); } catch (e) {} return ov.replace(/\/+$/, ''); }
      var saved = '';
      try { saved = localStorage.getItem('xl_api_base') || ''; } catch (e) {}
      if (saved) return saved.replace(/\/+$/, '');
      if (location.protocol === 'file:') return 'https://xinglaiai.com/ai-nav/api';
      if (/github\.io$/i.test(location.hostname)) return 'https://xinglaiai.com/ai-nav/api';
      var p = location.pathname, k = p.indexOf('/ai-nav/');
      if (k >= 0) return location.origin + p.slice(0, k) + '/ai-nav/api';
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(location.hostname)) return 'https://xinglaiai.com/ai-nav/api';
      return location.origin + '/ai-nav/api';
    } catch (e) { return '/ai-nav/api'; }
  })();

  function apiPathOf(url) {
    try {
      var u = String(url || '');
      var p = u;
      if (/^https?:/i.test(u)) p = new URL(u, location.href).pathname;
      else if (u.charAt(0) !== '/') {
        try { p = new URL(u, location.href).pathname; } catch (e) { return ''; }
      }
      var m = /\/ai-nav\/api(\/.*)?$/.exec(p);
      if (m) return m[1] || '/';
      if (/^\/api(\/.*)?$/.test(p)) return '/' + p.slice(5);
      return '';
    } catch (e) { return ''; }
  }
  function isApiUrl(url) { return !!apiPathOf(url); }

  /* ---------------- 存储 ---------------- */
  var K_TOKEN = 'xl_token', K_USER = 'xl_user';
  function getToken() {
    try { return sessionStorage.getItem(K_TOKEN) || localStorage.getItem(K_TOKEN) || ''; } catch (e) { return ''; }
  }
  function getStoredUser() {
    try {
      var raw = localStorage.getItem(K_USER) || sessionStorage.getItem(K_USER);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function cacheUser(u) {
    try {
      var st = localStorage.getItem(K_TOKEN) ? localStorage : sessionStorage;
      st.setItem(K_USER, JSON.stringify(u || {}));
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_USER);
      sessionStorage.removeItem(K_TOKEN); sessionStorage.removeItem(K_USER);
    } catch (e) {}
  }

  /* ---------------- 状态 ---------------- */
  var state = { ready: false, loggedIn: false, user: getStoredUser(), checking: false, reason: '', browsing: false };
  var listeners = [];
  function emit() {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](state); } catch (e) {} }
    try { document.dispatchEvent(new CustomEvent('xl-gate:change', { detail: { loggedIn: state.loggedIn, user: state.user } })); } catch (e) {}
  }

  /* ---------------- 原生 fetch（避免被自己拦截） ---------------- */
  var rawFetch = window.fetch ? window.fetch.bind(window) : null;

  function mergeAuthHeader(init) {
    var headers = init.headers;
    var token = getToken();
    if (!token) return init;
    if (headers) {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
        return init;
      }
      if (Array.isArray(headers)) {
        var has = false;
        for (var i = 0; i < headers.length; i++) if (String(headers[i][0]).toLowerCase() === 'authorization') has = true;
        if (!has) headers = headers.concat([['Authorization', 'Bearer ' + token]]);
        init.headers = headers;
        return init;
      }
      if (typeof headers === 'object') {
        var hasKey = false;
        for (var k in headers) if (k.toLowerCase() === 'authorization') hasKey = true;
        if (!hasKey) headers.Authorization = 'Bearer ' + token;
        return init;
      }
    }
    init.headers = { 'Authorization': 'Bearer ' + token };
    return init;
  }

  var SAFE_POST = /\/(upload|auth|login|register|logout|pay|cs|leadgen|track|metric)(\/|$)/;
  function methodOf(input, init) {
    var m = (init && init.method) || (input && input.method) || 'GET';
    return String(m).toUpperCase();
  }

  function patchFetch() {
    if (!rawFetch || window.__XL_GATE_FETCH_PATCHED__) return;
    window.__XL_GATE_FETCH_PATCHED__ = true;
    window.fetch = function (input, init) {
      init = init || {};
      var url = typeof input === 'string' ? input : ((input && input.url) || '');
      var apiPath = apiPathOf(url);
      var method = methodOf(input, init);
      if (apiPath) {
        // 未登录 + 生成类写请求：先提示登录，不发请求（服务端 401 之外的兜底）
        var isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
        if (isWrite && !getToken() && !SAFE_POST.test(apiPath)) {
          var reason = state.loggedIn ? 'session_invalid' : 'need_login';
          showGate(reason);
          var e0 = new Error(MSG);
          e0.code = 'AUTH_REQUIRED'; e0.status = 401;
          emitLoginEvent('blocked', apiPath);
          return Promise.reject(e0);
        }
        if (getToken()) init = mergeAuthHeader(init);
      }
      return rawFetch(input, init).then(function (res) {
        if (apiPath && res.status === 401) {
          handleUnauthorized(apiPath);
          var e = new Error(MSG);
          e.code = 'AUTH_REQUIRED'; e.status = 401;
          throw e;
        }
        return res;
      });
    };
  }

  var fired401 = 0;
  function handleUnauthorized(apiPath) {
    var now = Date.now();
    var wasLogged = !!getToken();
    clearSession();
    state.loggedIn = false; state.user = null;
    showGate(wasLogged ? 'session_invalid' : 'need_login');
    emit();
    if (now - fired401 > 2500) {
      fired401 = now;
      emitLoginEvent('401', apiPath);
    }
  }
  function emitLoginEvent(kind, path) {
    try {
      document.dispatchEvent(new CustomEvent('xl-gate:auth', { detail: { kind: kind, path: path } }));
    } catch (e) {}
  }

  /* ---------------- UI ---------------- */
  var ICO_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10" width="15" height="10.5" rx="2.4"/><path d="M8 10V7.4a4 4 0 0 1 8 0V10"/><path d="M12 14.2v2.6"/></svg>';
  var maskEl = null, barEl = null;

  function nextUrl() { return location.pathname + location.search + location.hash; }
  function loginUrl() { return rootUrl('account/index.html') + '?next=' + encodeURIComponent(nextUrl()); }
  function registerUrl() { return rootUrl('account/index.html') + '?tab=register&next=' + encodeURIComponent(nextUrl()); }

  function buildUi() {
    if (!document.body) return;
    // 遮罩
    maskEl = document.createElement('div');
    maskEl.className = 'xl-gate-mask';
    maskEl.setAttribute('role', 'dialog');
    maskEl.setAttribute('aria-modal', 'true');
    maskEl.setAttribute('aria-labelledby', 'xlGateTitle');
    maskEl.innerHTML =
      '<div class="xl-gate-card">' +
        '<button type="button" class="xl-gate-close" id="xlGateClose" aria-label="先浏览页面">✕</button>' +
        '<div class="xl-gate-ico">' + ICO_LOCK + '</div>' +
        '<h3 id="xlGateTitle">' + MSG + '</h3>' +
        '<p id="xlGateDesc">' + LOGIN_TIP + '</p>' +
        '<p class="xl-gate-tip" id="xlGateTip"></p>' +
        '<div class="xl-gate-actions">' +
          '<a class="xl-gate-btn primary" id="xlGateLogin" href="' + loginUrl() + '">登录</a>' +
          '<a class="xl-gate-btn" id="xlGateRegister" href="' + registerUrl() + '">注册新账号</a>' +
        '</div>' +
        '<div class="xl-gate-actions" style="margin-top:2px">' +
          '<button type="button" class="xl-gate-btn ghost" id="xlGateBrowse">先浏览页面</button>' +
        '</div>' +
        '<p class="xl-gate-note">登录/注册后自动回到本页；账号、套餐与额度在「个人中心」管理。AI 生成内容需遵守平台合规要求。</p>' +
      '</div>';
    document.body.appendChild(maskEl);
    document.getElementById('xlGateLogin').href = loginUrl();
    document.getElementById('xlGateRegister').href = registerUrl();
    maskEl.querySelector('#xlGateClose').addEventListener('click', dismissMask);
    maskEl.querySelector('#xlGateBrowse').addEventListener('click', dismissMask);

    // 常驻提示条
    barEl = document.createElement('div');
    barEl.className = 'xl-gate-bar';
    barEl.setAttribute('role', 'status');
    barEl.innerHTML =
      '<span class="xlg-dot"></span>' +
      '<span class="xlg-bar-txt"><b>未登录</b> · 登录后可用 AI 生成</span>' +
      '<a href="' + loginUrl() + '" id="xlGateBarLogin">登录</a>' +
      '<button type="button" class="reg" id="xlGateBarReg">注册</button>';
    document.body.appendChild(barEl);
    barEl.querySelector('#xlGateBarLogin').href = loginUrl();
    barEl.querySelector('#xlGateBarReg').addEventListener('click', function () { location.href = registerUrl(); });
  }

  function setTip(reason) {
    var tip = document.getElementById('xlGateTip');
    if (!tip) return;
    tip.textContent = reason === 'session_invalid' ? '登录状态已失效，请重新登录后继续。' :
      (reason === '401' ? '该操作需要登录，请登录后再试。' : '');
  }

  function showGate(reason) {
    state.reason = reason || '';
    if (!maskEl) buildUi();
    if (!maskEl) return;
    setTip(reason);
    maskEl.classList.add('on');
    if (barEl) barEl.classList.remove('on');
    document.documentElement.classList.add('xlg-locked');
    try { var b = maskEl.querySelector('#xlGateLogin'); if (b) setTimeout(function () { b.focus(); }, 60); } catch (e) {}
  }
  function hideGate() {
    if (maskEl) maskEl.classList.remove('on');
    document.documentElement.classList.remove('xlg-locked');
  }
  function showBar() {
    if (!barEl) buildUi();
    if (barEl) barEl.classList.add('on');
  }
  function hideBar() { if (barEl) barEl.classList.remove('on'); }
  function dismissMask() {
    hideGate();
    state.browsing = true;
    if (!state.loggedIn) showBar();
  }

  /* ---------------- 登录态探测 ---------------- */
  function requestMe() {
    if (!rawFetch) return Promise.reject(new Error('no fetch'));
    var token = getToken();
    return rawFetch(API_BASE + '/auth/me', {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
      mode: 'cors', cache: 'no-store'
    });
  }

  var readyResolve;
  var readyPromise = new Promise(function (res) { readyResolve = res; });

  function refresh() {
    if (state.checking) return readyPromise;
    state.checking = true;
    var token = getToken();
    if (!token) {
      state.loggedIn = false; state.user = null; state.ready = true; state.checking = false;
      return Promise.resolve(false);
    }
    return requestMe().then(function (res) {
      if (res.status === 401 || res.status === 403) {
        clearSession(); state.loggedIn = false; state.user = null;
        return false;
      }
      if (!res.ok) return true; // 服务异常时按已登录处理，不打断
      return res.json().then(function (d) {
        var u = (d && (d.user || d.data)) || d || {};
        state.user = u; cacheUser(u); state.loggedIn = true;
        return true;
      });
    }).catch(function () {
      // 网络异常：有 token 就按已登录处理（离线容忍）
      state.loggedIn = true;
      return true;
    }).then(function (ok) {
      state.ready = true; state.checking = false;
      readyResolve(ok);
      emit();
      return ok;
    });
  }

  function applyState(ok) {
    if (ok) { hideGate(); hideBar(); document.documentElement.classList.remove('xlg-anon'); }
    else {
      document.documentElement.classList.add('xlg-anon');
      if (MODE === 'mask' && !state.browsing) showGate('need_login');
      else showBar();
    }
    syncShellAuth(ok);
  }

  /* 同步站壳侧栏底部「登录 / 我的」入口（工具页未加载 auth.js 时的兜底） */
  function syncShellAuth(ok) {
    var slot = document.querySelector('.auth-slot');
    if (!slot) return;
    if (ok) {
      var u = state.user || {};
      var isAdm = !!(u && (u.role === 'admin' || u.is_admin === true));
      slot.innerHTML = '<a class="auth-link" href="' + rootUrl('account/dashboard.html') + '" title="个人中心">' +
        (isAdm ? '我的 · 管理员' : '我的') + '</a>';
    } else {
      slot.innerHTML = '<a class="auth-link" href="' + loginUrl() + '">登录</a>';
    }
  }

  /* ---------------- 对外 API ---------------- */
  var XLGate = {
    API_BASE: API_BASE, ROOT: ROOT, MSG: MSG, mode: MODE,
    ready: readyPromise,
    token: getToken,
    user: function () { return state.user; },
    isLoggedIn: function () { return state.loggedIn; },
    state: state,
    loginUrl: loginUrl, registerUrl: registerUrl, rootUrl: rootUrl,
    request: function (path, opts) { return window.fetch(API_BASE + path, opts); },
    apiUrl: function (path) { return API_BASE + path; },
    refresh: refresh,
    showGate: showGate,
    hideGate: function () { hideGate(); hideBar(); },
    requireLogin: function () {
      if (state.loggedIn && getToken()) return true;
      showGate('need_login');
      return false;
    },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    toast: function (msg, kind, ms) {
      var box = document.getElementById('xlGateToastBox');
      if (!box) {
        box = document.createElement('div');
        box.id = 'xlGateToastBox';
        box.style.cssText = 'position:fixed;z-index:990;left:50%;transform:translateX(-50%);bottom:64px;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none';
        document.body.appendChild(box);
      }
      var el = document.createElement('div');
      var color = kind === 'ok' ? '#34d399' : (kind === 'bad' ? '#f87171' : '#93c5fd');
      el.style.cssText = 'max-width:min(560px,90vw);padding:10px 16px;border-radius:11px;font-size:13px;line-height:1.55;color:#e8eefc;background:rgba(15,23,42,.94);border:1px solid ' + color + '55;box-shadow:0 16px 40px -18px #000;opacity:0;transition:opacity .2s,transform .2s;transform:translateY(6px)';
      el.textContent = msg;
      box.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'none'; });
      setTimeout(function () {
        el.style.opacity = '0';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, ms || 3200);
    }
  };
  window.XLGate = XLGate;

  /* ---------------- 启动 ---------------- */
  patchFetch();

  // 无 token + mask 模式：先隐藏正文，避免工具界面闪现（2.5s 兜底恢复，避免脚本异常导致白屏）
  if (MODE === 'mask' && !getToken()) {
    try {
      document.documentElement.classList.add('xlg-boot-hide');
      setTimeout(function () { document.documentElement.classList.remove('xlg-boot-hide'); }, 2500);
    } catch (e) {}
  }

  function boot() {
    buildUi();
    document.documentElement.classList.remove('xlg-boot-hide');
    var token = getToken();
    if (!token) {
      state.ready = true; state.loggedIn = false;
      applyState(false);
      readyResolve(false);
      emit();
      return;
    }
    refresh().then(applyState);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 复用页面已有登录态（如内联 auth.js 场景）：跨标签页变化同步
  window.addEventListener('storage', function (ev) {
    if (!ev || (ev.key !== K_TOKEN && ev.key !== null)) return;
    refresh().then(applyState);
  });
})();
