/* 星籁 AI · 全站登录态 / API 客户端 / 导航注入
 * 依赖：无。所有页面引入 <script defer src="…/assets/auth.js"></script>
 * 暴露：window.XLAuth
 */
(function () {
  'use strict';

  var scriptEl = document.currentScript;
  if (!scriptEl) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) {
      if (/assets\/auth\.js/.test(ss[i].src || '')) { scriptEl = ss[i]; break; }
    }
  }
  var assetUrl = scriptEl ? new URL(scriptEl.src, location.href) : new URL('/assets/auth.js', location.href);
  // 站点根：…/ai-nav/ 或本地 http://127.0.0.1:8080/
  var ROOT = new URL('../', assetUrl).href;

  function rootUrl(p) { return ROOT + String(p || '').replace(/^\/+/, ''); }

  /* ---------------- API 地址 ---------------- */
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
  function clearSession() {
    try {
      localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_USER);
      sessionStorage.removeItem(K_TOKEN); sessionStorage.removeItem(K_USER);
    } catch (e) {}
  }
  function saveSession(token, user, remember) {
    clearSession();
    try {
      var st = remember ? localStorage : sessionStorage;
      st.setItem(K_TOKEN, token);
      st.setItem(K_USER, JSON.stringify(user || {}));
    } catch (e) {}
  }
  function cacheUser(user) {
    try {
      var st = localStorage.getItem(K_TOKEN) ? localStorage : sessionStorage;
      st.setItem(K_USER, JSON.stringify(user || {}));
    } catch (e) {}
  }

  /* ---------------- 请求 ---------------- */
  function request(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    if (opts.headers) for (var hk in opts.headers) headers[hk] = opts.headers[hk];
    var body = opts.body;
    if (body != null && Object.prototype.toString.call(body) !== '[object FormData]') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    var token = opts.auth === false ? '' : (opts.token || getToken());
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = opts.timeout || 15000;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body,
      mode: 'cors',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (txt) {
        var data = {};
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { ok: false, error: 'BAD_JSON', raw: txt.slice(0, 160) }; } }
        if (res.status === 404) {
          var ne = new Error('功能准备中');
          ne.code = 'NOT_READY'; ne.status = 404; ne.data = data; throw ne;
        }
        if (!res.ok || (data && data.ok === false)) {
          var msg = (data && (data.hint || data.message || data.error)) || ('请求失败（' + res.status + '）');
          if (data && data.error === 'token_invalid') msg = '登录已失效，请重新登录';
          if (data && data.error === 'token_expired') msg = '登录已过期，请重新登录';
          var e = new Error(msg);
          e.code = (data && data.error) || ('HTTP_' + res.status);
          e.status = res.status; e.data = data;
          throw e;
        }
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.code) throw err;
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        var te = new Error('网络超时，请稍后再试'); te.code = 'TIMEOUT'; throw te;
      }
      var ne = new Error('网络异常，请检查网络后重试'); ne.code = 'NETWORK'; throw ne;
    });
  }

  /* ---------------- 状态 ---------------- */
  var state = { user: getStoredUser(), ready: false, offline: false };
  var listeners = [];

  function isAdmin(u) {
    u = u || state.user;
    return !!(u && (u.role === 'admin' || u.is_admin === true));
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state.user, state); } catch (e) {}
    }
    try { document.dispatchEvent(new CustomEvent('auth:change', { detail: { user: state.user } })); } catch (e) {}
  }

  function refresh() {
    if (!getToken()) { state.ready = true; renderNav(); emit(); return Promise.resolve(null); }
    return request('/auth/me').then(function (d) {
      var u = d.user || d;
      state.user = u; cacheUser(u); state.ready = true; state.offline = false;
      return u;
    }).catch(function (e) {
      if (e.status === 401) { clearSession(); state.user = null; }
      else if (e.code === 'NOT_READY' || e.code === 'NETWORK' || e.code === 'TIMEOUT') state.offline = true;
      state.ready = true;
      return state.user;
    }).then(function (u) { renderNav(); emit(); return u; });
  }

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(v) {
    if (!v) return '—';
    if (typeof v === 'number') {
      var d = new Date(v * 1000);
      if (isNaN(d.getTime())) return '—';
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    }
    return String(v).slice(0, 10);
  }
  function fmtDateTime(v) {
    if (!v) return '—';
    if (typeof v === 'number') {
      var d = new Date(v * 1000);
      if (isNaN(d.getTime())) return '—';
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }
    return String(v).slice(0, 16);
  }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function planName(id) {
    var m = { free: '体验版', basic: '基础版', pro: '专业版', enterprise: '旗舰版' };
    return m[id] || (id ? String(id) : '体验版');
  }
  function money(cents, amount) {
    if (amount != null && amount !== '') return Number(amount) === 0 ? '0' : String(Number(amount).toFixed(2)).replace(/\.00$/, '');
    if (cents != null) return String((Number(cents) / 100).toFixed(2)).replace(/\.00$/, '');
    return '0';
  }
  function toast(msg, kind, ms) {
    var box = document.getElementById('xlToastBox');
    if (!box) {
      box = document.createElement('div'); box.id = 'xlToastBox'; box.className = 'toast-box';
      (document.body || document.documentElement).appendChild(box);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = '.25s'; setTimeout(function () { el.remove(); }, 260); }, ms || 3000);
  }

  /* ---------------- 导航注入 ---------------- */
  var menuOpen = false;
  function bindNav() {
    var btn = document.getElementById('xlMe');
    var menu = document.getElementById('xlMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      menuOpen = !menuOpen;
      menu.classList.toggle('on', menuOpen);
      btn.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
    });
    menu.addEventListener('click', function (ev) {
      var lo = ev.target.closest('[data-logout]');
      if (lo) { ev.preventDefault(); logout(); }
    });
    document.addEventListener('click', function () {
      if (menuOpen) { menuOpen = false; menu.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuOpen) { menuOpen = false; menu.classList.remove('on'); }
    });
  }

  function renderNav() {
    var slot = document.querySelector('.auth-slot');
    if (!slot) {
      var top = document.querySelector('.topbar .wrap') || document.querySelector('header.top .top-in') || document.querySelector('.top .top-in') || document.querySelector('.top-in');
      if (!top) return;
      slot = document.createElement('div');
      slot.className = 'auth-slot';
      slot.setAttribute('data-auth-slot', '');
      top.appendChild(slot);
    }
    var token = getToken(), u = state.user;
    if (token && u) {
      var display = u.business_name || u.name || u.account || u.phone || '我的账号';
      var sub = planName(u.plan) + (u.plan_expire_at ? ' · ' + fmtDate(u.plan_expire_at) + ' 到期' : '');
      slot.innerHTML =
        '<button class="auth-link auth-me" id="xlMe" aria-haspopup="true" aria-expanded="false" type="button"><span class="auth-dot"></span>' +
        (isAdmin(u) ? '管理' : '我的') + ' ▾</button>' +
        '<div class="auth-menu" id="xlMenu" role="menu">' +
          '<div class="who"><b>' + esc(display) + '</b>' + esc(sub) + '</div>' +
          '<a role="menuitem" href="' + esc(rootUrl('account/dashboard.html')) + '">👤 个人中心</a>' +
          '<a role="menuitem" href="' + esc(rootUrl('account/dashboard.html#orders')) + '">🧾 我的订单</a>' +
          (isAdmin(u) ? '<a role="menuitem" href="' + esc(rootUrl('admin/index.html')) + '">🛠️ 管理后台</a>' : '') +
          '<button role="menuitem" class="danger" data-logout type="button">退出登录</button>' +
        '</div>';
      bindNav();
    } else {
      var next = location.pathname + location.search + location.hash;
      slot.innerHTML = '<a class="auth-link" href="' + esc(rootUrl('account/index.html')) + '?next=' + encodeURIComponent(next) + '">登录</a>';
    }
  }

  /* ---------------- 会话操作 ---------------- */
  function login(token, user, remember) {
    saveSession(token, user, !!remember);
    state.user = user; state.ready = true;
    renderNav(); emit();
  }
  function setUser(user) {
    if (!user) return;
    state.user = user; state.ready = true; cacheUser(user);
    renderNav(); emit();
  }
  function setToken(token) {
    if (!token) return;
    try {
      var st = localStorage.getItem(K_TOKEN) ? localStorage : sessionStorage;
      st.setItem(K_TOKEN, token);
    } catch (e) {}
  }
  function logout() {
    request('/auth/logout', { method: 'POST', auth: false, body: {} }).catch(function () {});
    clearSession(); state.user = null;
    renderNav();
    if (/\/account\/(index\.html)?$/.test(location.pathname)) { location.reload(); }
    else location.href = rootUrl('account/index.html');
  }
  function requireAuth() {
    if (getToken()) return true;
    var next = location.pathname + location.search + location.hash;
    location.replace(rootUrl('account/index.html') + '?next=' + encodeURIComponent(next));
    return false;
  }
  function safeNext(next) {
    if (!next) return '';
    try {
      if (next.charAt(0) !== '/' || next.charAt(1) === '/') return '';
      return next;
    } catch (e) { return ''; }
  }

  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ---------------- 启动 ---------------- */
  function boot() {
    renderNav();
    if (getToken()) refresh();
    else { state.ready = true; emit(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.XLAuth = {
    api: request, request: request,
    root: ROOT, rootUrl: rootUrl, apiBase: API_BASE,
    token: getToken, user: function () { return state.user; }, isAdmin: isAdmin,
    login: login, setUser: setUser, setToken: setToken, logout: logout, refresh: refresh, onChange: onChange,
    requireAuth: requireAuth, safeNext: safeNext,
    toast: toast, esc: esc, fmtDate: fmtDate, fmtDateTime: fmtDateTime,
    planName: planName, money: money, state: state
  };
})();
