/* 星籁 AI · autoedit 积分预估 / 余额提示（可插入片段）
 *
 * 接入方式（二选一，推荐方式 A）：
 *   A) 在 /var/www/ai-nav/autoedit/index.html 的 </body> 前加一行：
 *        <script defer src="../assets/credits-autoedit.js"></script>
 *      并在顶部加一行开关（可省略，默认开启）： <script>window.XL_CREDITS_AUTOEDIT = true;</script>
 *   B) 直接把本文件内容粘到 autoedit/index.html 的 </script> 之后、</body> 之前。
 *
 * 开关：window.XL_CREDITS_AUTOEDIT === false 时不生效（便于紧急回滚，不必改代码）。
 * 行为：
 *   - 第 3 步「导出成片」区域显示「积分余额 / 本次预估消耗 / 去充值」；
 *   - 预估 = 成片渲染 2 积分/条 + 数字人（换背景 0.3 / 真口型 0.8 / 照片口播 0.6 积分/秒）× 时长；
 *   - 余额不足时拦截「开始导出/重新导出/蝉镜生成」并提示去充值（后端仍会二次校验，双保险）；
 *   - 导出返回 402 insufficient_credits 时提示「积分不足，请充值」并给出去充值入口。
 * 依赖：assets/auth.js（window.XLAuth）；不依赖 autoedit 内部 state（通过 __AE_TEST__ 只读钩子取 presenter）。
 */
(function () {
  'use strict';
  if (window.XL_CREDITS_AUTOEDIT === false) return;
  if (window.__XL_AE_CREDITS__) return;
  window.__XL_AE_CREDITS__ = true;

  var ACCOUNT_URL = '/ai-nav/account/dashboard.html#creditsCard';
  var state = { balance: null, estimate: null, enough: true, loading: false, lastAt: 0, err: '', isAdmin: false };
  var MODE_NAMES = { chanjing: '数字人 · 换背景版', lipsync: '数字人 · 真口型', photo_lipsync: '数字人 · 照片口播' };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return window.XLAuth ? XLAuth.esc(s) : String(s == null ? '' : s); }
  function fmt(n) {
    var v = Number(n || 0);
    return (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }
  function toast(msg, kind, ms) {
    if (window.XLAuth && XLAuth.toast) XLAuth.toast(msg, kind || 'warn', ms || 4200);
    else {
      var t = $('#aeToast');
      if (t) { t.textContent = msg; t.className = 'ae-toast show ' + (kind || ''); }
    }
  }

  function durationOf() {
    try {
      var foot = $('#aeTimelineFoot');
      if (foot) {
        var m = String(foot.textContent || '').match(/约\s*(\d+(?:\.\d+)?)\s*秒/);
        if (m) return Math.max(1, Math.round(Number(m[1])));
      }
      var on = $('#aeDurationRow .ae-pill.on, .ae-pill[data-duration].on');
      if (on) {
        var d = Number(on.getAttribute('data-duration'));
        if (d > 0) return d;
      }
      var any = $('.ae-pill[data-duration]');
      if (any) {
        var d2 = Number(any.getAttribute('data-duration'));
        if (d2 > 0) return d2;
      }
    } catch (e) {}
    return 30;
  }
  function modeOf() {
    var m = 'none';
    try {
      if (window.__AE_TEST__ && typeof window.__AE_TEST__.presenterSpec === 'function') {
        var p = window.__AE_TEST__.presenterSpec() || {};
        m = String(p.mode || 'none');
      } else {
        var card = $('.ae-presenter-card.on[data-presenter]');
        if (card) m = String(card.getAttribute('data-presenter') || 'none');
      }
    } catch (e) {}
    return MODE_NAMES[m] ? m : 'none';
  }
  function api(path, opts) {
    if (window.XLAuth && XLAuth.api) return XLAuth.api(path, opts || {});
    return Promise.reject(new Error('登录组件未加载'));
  }

  function ensurePanel() {
    var panel = $('#xlAeCredits');
    if (panel) return panel;
    var hint = $('#expHint');
    if (!hint || !hint.parentNode) return null;
    panel = document.createElement('div');
    panel.id = 'xlAeCredits';
    panel.style.cssText = 'margin-top:10px;padding:11px 12px;border-radius:12px;border:1px solid rgba(56,189,248,.35);'
      + 'background:#0e1726;background-image:linear-gradient(180deg,rgba(56,189,248,.10),rgba(139,92,246,.07));'
      + 'box-shadow:0 6px 18px rgba(0,0,0,.25);font-size:12.5px;line-height:1.65;'
      + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative;z-index:2';
    panel.innerHTML = '<span>💎 积分余额加载中…</span>';
    hint.parentNode.insertBefore(panel, hint.nextSibling);
    return panel;
  }

  function render() {
    var panel = ensurePanel();
    if (!panel) return;
    var mode = modeOf();
    var dur = durationOf();
    var est = state.estimate || {};
    var bal = state.balance;
    var parts = [];
    if (state.isAdmin) {
      /* 内部账号（老板/管理员）：平台自己的账号不跟自己收费 —— 免扣积分，只记录成本 */
      parts.push('<span class="xl-ae-admin-chip">💎 内部账号 · 免扣积分</span>');
      if (est.credits != null) {
        parts.push('<span style="color:#e0f2fe">本次预估：<b>' + fmt(est.credits) + '</b> 积分'
          + '<span style="color:var(--ae-txt3,#94a3b8);font-size:11.5px">（仅记录成本，导出不扣减 · ' + fmt(dur) + ' 秒 · '
          + esc(MODE_NAMES[mode] || '无数字人') + ' + 成片渲染）</span></span>');
      }
      parts.push('<a href="' + ACCOUNT_URL + '" target="_blank" rel="noopener" style="color:var(--ae-cyan,#38bdf8);text-decoration:underline;margin-left:auto">积分明细</a>');
      panel.innerHTML = parts.join(' ');
      panel.style.borderColor = 'rgba(52,211,153,.55)';
      panel.style.background = '#0e1726';
      panel.style.backgroundImage = 'linear-gradient(180deg,rgba(52,211,153,.10),rgba(56,189,248,.06))';
      return;
    }
    parts.push('<span>💎 积分余额：<b style="color:#7dd3fc;font-size:15px">' + (bal == null ? '—' : fmt(bal)) + '</b> 积分</span>');
    if (est.credits != null) {
      var detail = (est.items || []).map(function (it) { return esc(it.label) + ' ' + fmt(it.credits) + ' 积分'; }).join(' + ');
      parts.push('<span style="color:#e0f2fe">本次预估：<b>' + fmt(est.credits) + '</b> 积分</span>'
        + '<span style="color:var(--ae-txt3,#94a3b8);font-size:11.5px">（' + fmt(dur) + ' 秒 · ' + esc(MODE_NAMES[mode] || '无数字人') + ' + 成片渲染；' + (detail || '') + '）</span>');
    }
    if (state.enough === false) {
      parts.push('<span style="color:#fca5a5;font-weight:800">积分不足，请去充值</span>'
        + '<a href="' + ACCOUNT_URL + '" target="_blank" rel="noopener" style="color:#fcd34d;text-decoration:underline">去充值 →</a>');
    } else {
      parts.push('<a href="' + ACCOUNT_URL + '" target="_blank" rel="noopener" style="color:var(--ae-cyan,#38bdf8);text-decoration:underline;margin-left:auto">积分明细 / 充值</a>');
    }
    panel.innerHTML = parts.join(' ');
    panel.style.background = '#0e1726';
    panel.style.backgroundImage = 'linear-gradient(180deg,rgba(56,189,248,.10),rgba(139,92,246,.07))';
    panel.style.borderColor = state.enough === false ? 'rgba(248,113,113,.55)' : 'rgba(56,189,248,.35)';
  }

  function refresh(force) {
    if (state.loading) return;
    state.loading = true;
    var mode = modeOf();
    var dur = durationOf();
    Promise.all([
      api('/credits', { timeout: 12000 }),
      api('/credits/estimate', {
        method: 'POST', timeout: 12000,
        body: { duration_seconds: dur, presenter_mode: mode === 'none' ? 'none' : mode, render: true }
      })
    ]).then(function (arr) {
      state.isAdmin = !!(arr[0] && (arr[0].is_admin || arr[0].admin_exempt));
      state.balance = Number(arr[0].balance || 0);
      state.estimate = arr[1] || {};
      state.enough = !!(state.estimate && state.estimate.enough) ||
        state.balance + 1e-6 >= Number(state.estimate.credits || 0) || state.isAdmin;
      state.err = '';
      state.lastAt = Date.now();
      render();
    }).catch(function (e) {
      state.err = (e && e.message) || '积分服务暂时不可用';
      var panel = ensurePanel();
      if (panel) {
        panel.innerHTML = '<span style="color:var(--ae-txt3,#94a3b8)">💎 积分余额暂不可用（'
          + esc(state.err) + '），不影响生成；如余额不足后端会提示充值</span>';
      }
    }).then(function () { state.loading = false; });
  }

  /* 生成前拦截（双保险）：余额不足时阻止导出并引导充值；内部账号（admin 免扣）不拦 */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var hit = t && t.closest ? t.closest('#btnExport, #btnCjGenBtn, #btnExpRetry, #btnReexport') : null;
    if (!hit) return;
    if (state.enough === false && !state.isAdmin) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      toast('积分不足，请先充值：本次约需 ' + fmt((state.estimate || {}).credits) + ' 积分，当前余额 ' + fmt(state.balance) + ' 积分', 'warn', 6000);
      var panel = ensurePanel();
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    refresh();
  }, true);

  /* 步骤/出镜方式/时长变化时刷新预估（捕获阶段，不影响原逻辑） */
  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { refresh(); }, 350); }
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('.ae-step-btn[data-goto="3"], .ae-presenter-card, .ae-pill[data-duration], .ae-layout, [data-layout]')) schedule();
  }, true);

  /* 402 兜底提示：后端余额校验返回 insufficient_credits 时给出中文引导 */
  try {
    var _fetch = window.fetch;
    if (_fetch && !_fetch.__xlCreditsWrapped) {
      var wrapped = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
        return _fetch.call(this, input, init).then(function (res) {
          try {
            if (res && res.status === 402 && /\/render|\/lipsync/.test(url) && !state.isAdmin) {
              res.clone().json().then(function (d) {
                if (d && d.error === 'insufficient_credits') {
                  toast((d.hint || '积分不足，请充值') + '（需 ' + fmt(d.need) + ' 积分，当前 ' + fmt(d.balance) + '）', 'warn', 6500);
                  refresh();
                }
              }).catch(function () {});
            }
          } catch (e) {}
          return res;
        });
      };
      wrapped.__xlCreditsWrapped = true;
      window.fetch = wrapped;
    }
  } catch (e) {}

  function boot() {
    /* 内部账号免扣样式（注入一次；不依赖页面 CSS 版本） */
    try {
      if (!document.getElementById('xlAeAdminChipCss')) {
        var st = document.createElement('style');
        st.id = 'xlAeAdminChipCss';
        st.textContent = '.xl-ae-admin-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;'
          + 'border-radius:999px;border:1px solid rgba(52,211,153,.6);background:rgba(52,211,153,.14);'
          + 'color:#6ee7b7;font-weight:800;font-size:12.5px;white-space:nowrap}';
        (document.head || document.documentElement).appendChild(st);
      }
    } catch (e) {}
    ensurePanel();
    setTimeout(function () { refresh(); }, 600);
    setInterval(function () {
      var panel = $('#xlAeCredits');
      if (panel && panel.offsetParent !== null && Date.now() - state.lastAt > 45000) refresh();
    }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
