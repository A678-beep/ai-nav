/* 星籁 AI · 全站主题切换（深色 / 浅色 / 跟随系统）
 * 依赖：无。所有页面 <head> 最前已内联同样逻辑的极小启动脚本（防闪白），
 * 本文件负责：状态持久化、系统主题监听、跨标签同步、顶栏按钮、window.XLTheme。
 * 存储键：localStorage.xl_theme = auto | dark | light（默认 auto）
 */
(function () {
  'use strict';

  var KEY = 'xl_theme';
  var MODES = ['auto', 'dark', 'light'];
  var LABEL = { auto: '自动', dark: '深色', light: '浅色' };
  var SHORT = { auto: '自动', dark: '深', light: '浅' };
  var doc = document;
  var root = doc.documentElement;
  var mql = null;
  try { mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null; } catch (e) { mql = null; }

  function getMode() {
    try {
      var v = localStorage.getItem(KEY);
      if (v && MODES.indexOf(v) !== -1) return v;
    } catch (e) {}
    return 'auto';
  }

  function systemTheme() {
    /* 无法读取系统偏好时，站点默认深色 */
    return mql && mql.matches ? 'light' : 'dark';
  }

  function resolve(mode) {
    if (mode === 'auto') return systemTheme();
    return mode === 'light' ? 'light' : 'dark';
  }

  function apply() {
    var mode = getMode();
    var theme = resolve(mode);
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-mode', mode);
    try { root.style.colorScheme = theme; } catch (e) {}
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f6f8fb' : '#070a10');
    var btns = doc.querySelectorAll('.xl-theme-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.setAttribute('data-mode', mode);
      b.title = '主题：' + LABEL[mode] + '（点击切换 自动 → 深色 → 浅色）';
      b.setAttribute('aria-label', b.title);
      var f = b.querySelector('.xl-t-full');
      var s = b.querySelector('.xl-t-short');
      if (f) f.textContent = LABEL[mode];
      if (s) s.textContent = SHORT[mode];
    }
    try {
      window.dispatchEvent(new CustomEvent('xlthemechange', { detail: { mode: mode, theme: theme } }));
    } catch (e) {}
  }

  function set(mode) {
    if (MODES.indexOf(mode) === -1) mode = 'auto';
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply();
  }

  function cycle() {
    var i = MODES.indexOf(getMode());
    set(MODES[(i + 1) % MODES.length]);
  }

  window.XLTheme = {
    KEY: KEY,
    modes: MODES.slice(),
    get: getMode,
    resolved: function () { return resolve(getMode()); },
    system: systemTheme,
    set: set,
    cycle: cycle,
    apply: apply
  };

  /* 系统主题变化：仅在 auto 下重新解析 */
  if (mql) {
    var onSys = function () { if (getMode() === 'auto') apply(); };
    if (mql.addEventListener) mql.addEventListener('change', onSys);
    else if (mql.addListener) mql.addListener(onSys);
  }
  /* 跨标签页同步 */
  window.addEventListener('storage', function (e) {
    if (!e || e.key === KEY || e.key === null) apply();
  });

  function injectBtn() {
    if (doc.querySelector('.xl-theme-btn')) { apply(); return; }
    var slot = doc.querySelector('.auth-slot');
    var top = doc.querySelector('.topbar .wrap') ||
      doc.querySelector('header.top .top-in') ||
      doc.querySelector('.top .top-in') ||
      doc.querySelector('.top-in') ||
      doc.querySelector('.topbar') ||
      doc.querySelector('header.top') ||
      doc.querySelector('header');
    var fixed = false;
    if (!top) { top = doc.body; fixed = true; }
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'xl-theme-btn' + (fixed ? ' xl-fixed' : '');
    b.setAttribute('aria-label', '切换主题');
    b.title = '主题：自动（点击切换 自动 → 深色 → 浅色）';
    b.innerHTML = '<span class="xl-t-ico" aria-hidden="true">🌗</span>' +
      '<span class="xl-t-full">自动</span><span class="xl-t-short">自动</span>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      cycle();
    });
    var host = null;
    if (slot && slot.parentNode) host = slot.parentNode;
    if (host && host.insertBefore) host.insertBefore(b, slot);
    else if (top === doc.body) doc.body.appendChild(b);
    else {
      var back = top.querySelector('.back');
      if (back && back.parentNode === top) top.insertBefore(b, back);
      else top.appendChild(b);
    }
    apply();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', injectBtn);
  else injectBtn();
})();
