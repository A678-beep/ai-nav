/* 星籁 AI · 全站左侧竖向侧边栏外壳
 * - 复用现有页面顶部导航项，生成统一侧栏；原顶部栏由 site-shell.css 隐藏。
 * - ≥1100px：固定侧栏（220px，可折叠 64px）；<1100px：抽屉 + 遮罩。
 * - 登录/我的、主题切换按钮从原顶栏迁移到侧栏底部；主题仍由 assets/theme.js 管理。
 * - 文章页修复：去掉“正文 820px 在满屏 main 里居中”造成的大片空白，改为
 *   阅读栏 + 右侧目录双栏（≥1360px），窄屏单栏。
 * 存储键：xl_sb_collapsed = 0 | 1
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var html = root;
  var KEY = 'xl_sb_collapsed';
  var MOBILE = '(max-width: 1099.98px)';

  function mq() { return window.matchMedia ? window.matchMedia(MOBILE).matches : window.innerWidth < 1100; }

  /* 尽早加壳，避免原顶栏闪现 */
  html.classList.add('xl-shell');
  var collapsedPref = false;
  try { collapsedPref = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (collapsedPref && !mq()) html.classList.add('xl-sb-collapsed');

  /* ---------- 站点根 ---------- */
  var scriptEl = doc.currentScript;
  if (!scriptEl) {
    var ss = doc.getElementsByTagName('script');
    for (var si = 0; si < ss.length; si++) {
      if (/assets\/site-shell\.js/.test(ss[si].src || '')) { scriptEl = ss[si]; break; }
    }
  }
  var ROOT = scriptEl ? new URL('../', scriptEl.src).href : new URL('./', location.href).href;
  var rootPath = '/';
  try { rootPath = new URL(ROOT).pathname; } catch (e) {}

  function relPath() {
    var p = location.pathname;
    if (p.indexOf(rootPath) === 0) return p.slice(rootPath.length);
    return p.replace(/^\/+/, '');
  }

  /* ---------- embed 模式（如 /autoedit/?embed=1）：整页嵌入 iframe 时隐藏站壳 ----------
     只保留页面内容；html.xl-embed 的让位样式见 site-shell.css 末尾。
     非 embed 模式（直链打开）一切照旧。 */
  var EMBED = /(?:^|[?&])embed=1(?:&|$)/.test(location.search) || window.self !== window.top;
  if (EMBED) {
    html.classList.add('xl-embed');
    try { window.__XL_EMBED__ = true; } catch (e) {}
    return;
  }

  /* ---------- 旧 hash 入口统一跳到真实静态页 ----------
     历史页脚/书签里仍是 #/articles、#/tools（根 SPA 的旧路由），
     只改地址不改内容，属于死链。这里统一重定向到真实页面。 */
  var LEGACY_HASH = {
    '#/articles': ROOT + 'articles/',
    '#/tools': ROOT + 'tools/'
  };
  function redirectLegacyHash() {
    var h = location.hash || '';
    if (!h) return false;
    var qi = h.indexOf('?');
    var key = qi === -1 ? h : h.slice(0, qi);
    var target = LEGACY_HASH[key];
    if (!target) return false;
    location.replace(target + (qi === -1 ? '' : h.slice(qi)));
    return true;
  }
  redirectLegacyHash();

  /* ---------- 图标 ---------- */
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICO = {
    home: svg('<path d="M3 10.7 12 3l9 7.7"/><path d="M5.4 9.2V21h13.2V9.2"/><path d="M9.4 21v-6.2h5.2V21"/>'),
    studio: svg('<rect x="3" y="5.5" width="12.5" height="13" rx="2.2"/><path d="m15.5 10 5.5-3.2v10.4L15.5 14"/>'),
    templates: svg('<rect x="3.2" y="4.5" width="17.6" height="15" rx="2.2"/><path d="M8.4 4.5v15"/><path d="m11.4 13.4 2.2-3.1 1.7 2.1 1.5-1.6"/><circle cx="12.9" cy="8.4" r="1.1"/>'),
    autoedit: svg('<rect x="3" y="5.5" width="12.5" height="13" rx="2.2"/><path d="m15.5 10 5.5-3.2v10.4L15.5 14"/><path d="M6.4 9.2h4M6.4 12h4M6.4 14.8h2.6"/><path d="m18.6 6.2.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" stroke-width="1.2"/>'),
    leadgen: svg('<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'),
    ads: svg('<path d="M3.4 10.6v2.8a1.4 1.4 0 0 0 1.4 1.4h2.6l4.1 3.1V6.1L7.4 9.2H4.8a1.4 1.4 0 0 0-1.4 1.4Z"/><path d="M15.2 8.6a5 5 0 0 1 0 6.8"/><path d="M18 6.1a8.6 8.6 0 0 1 0 11.8"/>'),
    geo: svg('<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8"/><ellipse cx="12" cy="12" rx="4" ry="8.6"/>'),
    travel: svg('<path d="M21 4.5 3.6 11.4l6.2 2.5L12 20l3-6.6 6-8.9Z"/><path d="m9.8 13.9 4.4-4.4"/>'),
    select: svg('<circle cx="12" cy="12" r="8.6"/><path d="m15.4 8.6-2.1 4.8-4.7 2 2.1-4.8 4.7-2Z"/>'),
    radar: svg('<path d="M12 12 18.5 5.5"/><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5"/><path d="M12 6.6a5.4 5.4 0 1 0 5.4 5.4"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>'),
    articles: svg('<path d="M5 4.5h9.6A2.4 2.4 0 0 1 17 6.9v12.6H7.4A2.4 2.4 0 0 1 5 17.1V4.5Z"/><path d="M8.2 8.3h5.6M8.2 11.6h5.6M17 8.5h2v11H8.5"/>'),
    tools: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>'),
    pricing: svg('<path d="M20.5 13.1 13 20.6a1.8 1.8 0 0 1-2.5 0L3.4 13.5V3.5h10l7.1 7.1a1.7 1.7 0 0 1 0 2.5Z"/><circle cx="7.8" cy="7.8" r="1.3" fill="currentColor" stroke="none"/>'),
    chevL: svg('<path d="m14.5 6-6 6 6 6"/>'),
    chevR: svg('<path d="m9.5 6 6 6-6 6"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    x: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    panel: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M9.5 4.5v15"/>')
  };

  var NAV = [
    { key: 'home', label: 'AI 导航', href: ROOT, ico: ICO.home },
    { key: 'studio', label: '短视频工作台', href: ROOT + 'studio/', ico: ICO.studio },
    { key: 'templates', label: '模板市场', href: ROOT + 'templates/', ico: ICO.templates },
    { key: 'ads', label: 'AI 投放优化获客', href: ROOT + 'ads/', ico: ICO.ads },
    { key: 'leadgen', label: '线索台账', href: ROOT + 'leadgen/', ico: ICO.leadgen },
    { key: 'geo', label: 'GEO 推广', href: ROOT + 'geo3/', ico: ICO.geo },
    { key: 'travel', label: '出行导航', href: ROOT + 'travel/', ico: ICO.travel },
    { key: 'select-ai', label: '智能选型', href: ROOT + 'select-ai/', ico: ICO.select },
    { key: 'radar', label: '工具雷达', href: ROOT + 'radar/', ico: ICO.radar }
  ];
  var RES = [
    /* 教程文章改为真实静态列表页 /articles/；旧 hash 入口 #/articles 在下方统一重定向 */
    { key: 'articles', label: '教程文章', href: ROOT + 'articles/', ico: ICO.articles },
    { key: 'tools', label: '工具库', href: ROOT + 'tools/', ico: ICO.tools },
    { key: 'pricing', label: '套餐定价', href: ROOT + 'pricing/', ico: ICO.pricing }
  ];

  function activeKey() {
    var rel = relPath();
    var seg = rel.split('/')[0].replace(/\.html$/, '');
    if (seg === 'account' || seg === 'admin' || seg === 'store') return null;
    if (seg === 'geo2') return 'geo';
    if (seg === 'templates') return 'templates';
    /* 入口合并：自动剪辑已并入短视频工作台，进入 autoedit 时高亮「短视频工作台」 */
    if (seg === 'autoedit') return 'studio';
    if (seg === 'studio' || seg === 'leadgen' || seg === 'ads' || seg === 'geo' || seg === 'travel' ||
        seg === 'select-ai' || seg === 'radar') return seg;
    if (seg === 'pricing') return 'pricing';
    if (seg === 'tools' || seg === 'tool') return 'tools';
    if (seg === 'articles') return 'articles';
    if (seg === 'a' || seg === 't' || seg === 'faq' || seg === 'glossary' ||
        seg === 'prompts' || seg === 'selector' || seg === 'vs' ||
        seg === 'chat' || seg === 'image' || seg === 'code' || seg === 'write' ||
        seg === 'video' || seg === 'biz' || seg === 'util') return 'articles';
    if (location.hash === '#/articles') return 'articles';
    if (location.hash === '#/tools') return 'tools';
    return 'home';
  }

  function el(tag, cls, inner) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (inner != null) e.innerHTML = inner;
    return e;
  }

  function linkItem(item) {
    var a = el('a', 'xl-sb-link');
    a.href = item.href;
    a.setAttribute('data-nav', item.key);
    a.setAttribute('data-label', item.label);
    a.title = item.label;
    a.innerHTML = '<span class="xl-sb-ico">' + item.ico + '</span>' +
      '<span class="xl-sb-label">' + item.label + '</span>';
    return a;
  }

  /* ---------- 构建侧栏 ---------- */
  var body = doc.body;
  if (!body) return;

  var topbar = el('header', 'xl-topbar');
  topbar.setAttribute('aria-label', '页面顶部栏');
  topbar.innerHTML =
    '<button type="button" class="xl-hamburger" id="xlHamburger" aria-label="打开全站导航" aria-expanded="false" aria-controls="xlSidebar">' + ICO.menu + '</button>' +
    '<div class="xl-crumb"><a class="xl-crumb-home" href="' + ROOT + '">星籁 AI</a>' +
    '<span class="xl-crumb-sep" aria-hidden="true">/</span>' +
    '<span class="xl-crumb-now" id="xlCrumbNow">工作台</span></div>' +
    '<div class="xl-topbar-actions"><button type="button" class="xl-topbar-collapse" id="xlTopCollapse" title="折叠侧栏（[）" aria-label="折叠侧栏">' + ICO.panel + '</button></div>';

  var aside = el('aside', 'xl-sb');
  aside.id = 'xlSidebar';
  /* 兜底：即使样式表加载慢/被页面样式覆盖，侧栏也固定在视口左上，不会随内容下移 */
  aside.style.position = 'fixed';
  aside.style.top = '0';
  aside.style.bottom = '0';
  aside.style.left = '0';
  aside.style.height = '100vh';
  aside.style.zIndex = '58';
  aside.style.display = 'flex';
  aside.style.flexDirection = 'column';
  aside.style.justifyContent = 'flex-start';
  aside.setAttribute('aria-label', '全站侧边导航');
  aside.innerHTML =
    '<div class="xl-sb-top">' +
      '<a class="xl-sb-brand" href="' + ROOT + '">' +
        '<span class="xl-sb-mark" aria-hidden="true">✦</span>' +
        '<span class="xl-sb-brandtext"><b>星籁 AI</b><small>AI Workspace</small></span>' +
      '</a>' +
      '<button type="button" class="xl-sb-close-mobile" id="xlSbClose" aria-label="关闭全站导航">' + ICO.x + '</button>' +
    '</div>' +
    '<nav class="xl-sb-nav" aria-label="主导航">' +
      '<div class="xl-sb-group">工作台</div>' +
      '<div class="xl-sb-links" data-group="nav"></div>' +
      '<div class="xl-sb-group">资源</div>' +
      '<div class="xl-sb-links" data-group="res"></div>' +
    '</nav>' +
    '<div class="xl-sb-foot">' +
      '<div class="xl-sb-auth" data-auth-wrap></div>' +
      '<div class="xl-sb-theme" data-theme-wrap></div>' +
      '<button type="button" class="xl-sb-collapse" id="xlCollapse" title="收起侧栏（[）">' + ICO.chevL +
        '<span class="xl-sb-collapse-label">收起侧栏</span><kbd>[</kbd>' +
      '</button>' +
    '</div>';

  var overlay = el('div', 'xl-sb-overlay');
  overlay.id = 'xlSbOverlay';
  overlay.setAttribute('aria-hidden', 'true');

  topbar.style.position = 'fixed';
  topbar.style.top = '0';
  topbar.style.left = '0';
  topbar.style.right = '0';
  topbar.style.zIndex = '59';
  body.insertBefore(topbar, body.firstChild);
  body.appendChild(overlay);
  body.appendChild(aside);

  var navHost = aside.querySelector('[data-group="nav"]');
  var resHost = aside.querySelector('[data-group="res"]');
  for (var i = 0; i < NAV.length; i++) navHost.appendChild(linkItem(NAV[i]));
  for (var j = 0; j < RES.length; j++) resHost.appendChild(linkItem(RES[j]));

  /* ---------- 「教程文章」入口 ----------
     - 其它页面（含 /a/ 文章详情页）：普通跳转到 /articles/;
     - 已在文章列表页：阻止重复导航，回到顶部并重置搜索/分类/分页
       （列表页监听 xl:articles-reset；未挂监听的老页面则退化为普通刷新）。 */
  function isArticlesList() {
    var rel = relPath();
    return rel === 'articles/' || rel === 'articles/index.html';
  }
  var articlesLink = aside.querySelector('.xl-sb-link[data-nav="articles"]');
  if (articlesLink) {
    articlesLink.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (!isArticlesList()) return;
      e.preventDefault();
      if (window.__xlArticlesPage) {
        try { window.dispatchEvent(new CustomEvent('xl:articles-reset')); } catch (err) {}
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (err) { window.scrollTo(0, 0); }
        if (location.search) {
          try { history.replaceState(null, '', location.pathname); } catch (err) {}
        }
      } else {
        location.href = articlesLink.href;
      }
    });
  }

  function markActive(key) {
    var links = aside.querySelectorAll('.xl-sb-link');
    for (var k = 0; k < links.length; k++) {
      var on = links[k].getAttribute('data-nav') === key;
      links[k].classList.toggle('is-active', on);
      if (on) links[k].setAttribute('aria-current', 'page');
      else links[k].removeAttribute('aria-current');
    }
  }
  markActive(activeKey());

  /* ---------- 登录 / 我的：迁移 auth-slot ---------- */
  var authWrap = aside.querySelector('[data-auth-wrap]');
  var slot = doc.querySelector('.auth-slot');
  if (slot) {
    authWrap.appendChild(slot);
  } else {
    slot = el('div', 'auth-slot');
    slot.setAttribute('data-auth-slot', '');
    authWrap.appendChild(slot);
  }
  var hasAuthScript = !!doc.querySelector('script[src*="assets/auth.js"]');
  function fallbackAuth() {
    if (!slot || slot.textContent.trim()) return;
    var token = '';
    try { token = localStorage.getItem('xl_token') || sessionStorage.getItem('xl_token') || ''; } catch (e) {}
    var a = el('a', 'auth-link');
    if (token) {
      a.href = ROOT + 'account/dashboard.html';
      a.textContent = '我的';
    } else {
      a.href = ROOT + 'account/index.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
      a.textContent = '登录';
    }
    slot.appendChild(a);
  }
  if (!hasAuthScript) fallbackAuth();
  else setTimeout(function () { if (!slot.textContent.trim() && !window.XLAuth) fallbackAuth(); }, 1600);

  /* ---------- 主题按钮迁移 ---------- */
  var themeWrap = aside.querySelector('[data-theme-wrap]');
  var themeBtn = doc.querySelector('.xl-theme-btn');
  if (themeBtn) {
    themeBtn.classList.remove('xl-fixed');
    themeWrap.appendChild(themeBtn);
  } else {
    themeBtn = el('button', 'xl-theme-btn');
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', '切换主题');
    themeBtn.innerHTML = '<span class="xl-t-ico" aria-hidden="true">🌗</span>' +
      '<span class="xl-t-full">自动</span><span class="xl-t-short">自动</span>';
    themeBtn.addEventListener('click', function () {
      if (window.XLTheme && window.XLTheme.cycle) { window.XLTheme.cycle(); return; }
      var order = ['auto', 'dark', 'light'];
      var cur = html.getAttribute('data-theme-mode') || 'auto';
      var next = order[(order.indexOf(cur) + 1) % order.length];
      var sysLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      var theme = next === 'auto' ? (sysLight ? 'light' : 'dark') : next;
      html.setAttribute('data-theme', theme);
      html.setAttribute('data-theme-mode', next);
      try { localStorage.setItem('xl_theme', next); } catch (e) {}
    });
    themeWrap.appendChild(themeBtn);
  }
  /* 主题按钮可能被旧样式注入在多处，保留唯一一个 */
  var extraTheme = doc.querySelectorAll('.xl-theme-btn');
  for (var ti = 1; ti < extraTheme.length; ti++) {
    if (extraTheme[ti].parentNode) extraTheme[ti].parentNode.removeChild(extraTheme[ti]);
  }

  /* ---------- 顶栏页面标题 ---------- */
  var crumbNow = topbar.querySelector('#xlCrumbNow');
  function pageTitle() {
    var rel = relPath();
    if (rel === '' || rel === 'index.html') return '首页';
    var t = (doc.title || '').trim();
    if (/^(ready|loading|undefined|null|untitled)$/i.test(t)) t = '';
    t = t.replace(/\s*[·｜|]\s*.*$/, '').replace(/\s+-\s+.*$/, '').trim();
    if (t) return t;
    var h = doc.querySelector('main h1, h1');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '星籁 AI';
  }
  function updateCrumb() { if (crumbNow) crumbNow.textContent = pageTitle(); }
  updateCrumb();
  window.addEventListener('hashchange', function () {
    if (redirectLegacyHash()) return;
    updateCrumb();
    markActive(activeKey());
  });
  try {
    var titleEl = doc.querySelector('title');
    if (titleEl) {
      new MutationObserver(updateCrumb).observe(titleEl, { childList: true, subtree: true, characterData: true });
    }
  } catch (e) {}
  setTimeout(updateCrumb, 900);
  setTimeout(updateCrumb, 2400);

  /* ---------- 文章页：把 TOC 移进阅读双栏 ---------- */
  var reader = !!doc.querySelector('body > main > article.content');
  if (reader) html.classList.add('xl-reader');
  function findToc() {
    var toc = doc.getElementById('toc');
    if (toc) return toc;
    /* 文章页内联脚本生成的目录没有 id，用“本文目录 / #sec- 锚点”识别 */
    var cands = doc.querySelectorAll('body > div');
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci];
      if (c === overlay || c.classList.contains('xl-sb-overlay')) continue;
      if (c.querySelector && c.querySelector('a[href^="#sec-"]')) {
        c.id = 'toc';
        return c;
      }
    }
    return null;
  }
  function mountToc() {
    var main = doc.querySelector('body > main');
    var toc = findToc();
    if (!main || !toc) return;
    if (toc.parentNode !== main) {
      main.appendChild(toc);
      toc.classList.add('xl-toc-rail');
    }
  }
  if (reader) {
    try {
      new MutationObserver(mountToc).observe(body, { childList: true, subtree: true });
    } catch (e) {}
    setTimeout(mountToc, 1100);
    setTimeout(mountToc, 2200);
  }

  /* ---------- 折叠 / 抽屉 ---------- */
  var hamburger = topbar.querySelector('#xlHamburger');
  var closeBtn = aside.querySelector('#xlSbClose');
  var collapseBtn = aside.querySelector('#xlCollapse');
  var topCollapse = topbar.querySelector('#xlTopCollapse');

  function syncCollapseUI() {
    var isC = html.classList.contains('xl-sb-collapsed');
    var label = isC ? '展开侧栏' : '收起侧栏';
    if (collapseBtn) {
      collapseBtn.title = label + '（[）';
      var lb = collapseBtn.querySelector('.xl-sb-collapse-label');
      if (lb) lb.textContent = label;
      collapseBtn.setAttribute('aria-expanded', isC ? 'false' : 'true');
    }
    if (topCollapse) {
      topCollapse.title = label + '（[）';
      topCollapse.setAttribute('aria-label', label);
    }
  }
  function setCollapsed(v, persist) {
    html.classList.toggle('xl-sb-collapsed', !!v);
    if (persist) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} }
    syncCollapseUI();
  }
  if (collapseBtn) collapseBtn.addEventListener('click', function () { setCollapsed(!html.classList.contains('xl-sb-collapsed'), true); });
  if (topCollapse) topCollapse.addEventListener('click', function () { setCollapsed(!html.classList.contains('xl-sb-collapsed'), true); });
  syncCollapseUI();

  function openDrawer() {
    html.classList.add('xl-sb-open');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
    setTimeout(function () { if (closeBtn) closeBtn.focus(); }, 40);
  }
  function closeDrawer(returnFocus) {
    html.classList.remove('xl-sb-open');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
    if (returnFocus && hamburger) hamburger.focus();
  }
  if (hamburger) hamburger.addEventListener('click', function () {
    if (html.classList.contains('xl-sb-open')) closeDrawer(true); else openDrawer();
  });
  if (closeBtn) closeBtn.addEventListener('click', function () { closeDrawer(true); });
  overlay.addEventListener('click', function () { closeDrawer(true); });
  aside.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (a && mq()) closeDrawer(false);
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && html.classList.contains('xl-sb-open')) { closeDrawer(true); return; }
    if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    if (mq()) {
      if (html.classList.contains('xl-sb-open')) closeDrawer(true); else openDrawer();
    } else {
      setCollapsed(!html.classList.contains('xl-sb-collapsed'), true);
    }
  });

  /* 跨断点：手机端收起抽屉；桌面端恢复用户折叠偏好 */
  var rzTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      if (!mq()) {
        html.classList.remove('xl-sb-open');
        var pref = false;
        try { pref = localStorage.getItem(KEY) === '1'; } catch (e) {}
        setCollapsed(pref, false);
      }
    }, 120);
  });

  /* ---------- 首帧稳定后再开启动画 ---------- */
  requestAnimationFrame(function () {
    setTimeout(function () { html.classList.add('xl-shell-ready'); }, 60);
  });
})();
