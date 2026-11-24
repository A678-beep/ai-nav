/* ============================================================================
   星籁 AI · 网页端体验统一脚本（DS UI v1）· 2026-11-24
   与 site-shell.js 的分工：shell 只负责导航外壳；本文件只负责页面内组件与状态，
   不覆盖 window.fetch、不改页面业务逻辑、只暴露唯一命名空间 window.XLDS。
   若被重复引入：window.XLDS.__installed 守卫，保证只初始化一次（不重复绑定事件）。
   能力：
   1) 统一组件外观：给存量按钮/输入/表格/卡片/AI 标识打 ds-* 类
   2) 状态完备：加载指示、空态引导、接口错误中文提示 + 重试、折叠骨架占位
   3) 可信细节：数据更新时间、危险/扣费二次确认、复制成功 Toast
   4) 移动端与性能：图片 lazy、点击区域、离线提示、深色对比度令牌
   ============================================================================ */
(function () {
  'use strict';
  if (window.XLDS && window.XLDS.__installed) return;
  var VERSION = '20261124a';
  var doc = document;
  var w = window;
  var queue = [];
  var toastBox = null;
  var watched = [];
  var scanTimer = null;
  var classifyTimer = null;
  var lastToast = {};
  var lastNet = 0;
  var skeletonExpired = false;
  var loadingActive = false;
  var progressEl = null;
  var progressTimer = null;
  var DATA_UPDATED = {
    pricing: '2026-11-24 09:21',
    assets: '2026-11-24 09:18',
    plugins: '2026-11-24 07:30',
    templates: '2026-11-23 21:31'
  };
  var DATA_SOURCE = {
    pricing: '套餐价格目录',
    assets: '素材索引',
    plugins: '插件市场接口',
    templates: '模板市场接口'
  };

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function addClass(el, c) { if (el && el.classList && !el.classList.contains(c)) el.classList.add(c); }
  function removeClass(el, c) { if (el && el.classList && el.classList.contains(c)) el.classList.remove(c); }
  function pageKey() {
    var p = (location.pathname || '').toLowerCase();
    if (/(^|\/)pricing\/?$/.test(p)) return 'pricing';
    if (/(^|\/)assets\/?$/.test(p)) return 'assets';
    if (/(^|\/)plugins\/?$/.test(p)) return 'plugins';
    if (/(^|\/)templates\/?$/.test(p)) return 'templates';
    return '';
  }

  /* ---------------- 顶部加载进度（由页面加载态驱动，不接管 fetch） ---------------- */
  function ensureProgress() {
    if (progressEl || !doc.body) return progressEl;
    progressEl = doc.createElement('div');
    progressEl.id = 'dsTopProgress';
    progressEl.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(progressEl);
    return progressEl;
  }
  function progressStart() {
    var el = ensureProgress();
    if (!el) return;
    el.classList.add('on');
    el.style.transform = 'scaleX(0.12)';
    clearInterval(progressTimer);
    progressTimer = setInterval(function () {
      var m = /scaleX\(([\d.]+)\)/.exec(el.style.transform || '');
      var v = m ? parseFloat(m[1]) : 0.12;
      if (v < 0.9) el.style.transform = 'scaleX(' + (v + (0.9 - v) * 0.16) + ')';
    }, 320);
  }
  function progressDone() {
    clearInterval(progressTimer);
    if (!progressEl) return;
    progressEl.style.transform = 'scaleX(1)';
    setTimeout(function () {
      if (progressEl) {
        progressEl.classList.remove('on');
        progressEl.style.transform = 'scaleX(0)';
      }
    }, 240);
  }
  function syncProgress() {
    var n = doc.querySelectorAll('.ds-loading,.ds-skel').length;
    if (n > 0 && !loadingActive) { loadingActive = true; progressStart(); }
    else if (n === 0 && loadingActive) { loadingActive = false; progressDone(); }
  }

  /* ---------------- Toast ---------------- */
  var ICONS = { info: 'ⓘ', success: '✓', error: '!', warn: '!' };
  function ensureToastBox() {
    if (toastBox || !doc.body) return toastBox;
    toastBox = doc.createElement('div');
    toastBox.id = 'dsToastBox';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    doc.body.appendChild(toastBox);
    return toastBox;
  }
  function toast(msg, type, opts) {
    if (!msg) return null;
    opts = opts || {};
    var key = opts.key || (type + '|' + msg);
    var now = Date.now();
    if (lastToast[key] && now - lastToast[key] < (opts.throttle || 6000)) return null;
    lastToast[key] = now;
    var box = ensureToastBox();
    if (!box) { queue.push([msg, type, opts]); return null; }
    type = type || 'info';
    var item = doc.createElement('div');
    item.className = 'ds-toast is-' + type;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var ico = doc.createElement('span');
    ico.className = 'ds-toast-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = ICONS[type] || 'ⓘ';
    item.appendChild(ico);
    var main = doc.createElement('div');
    main.className = 'ds-toast-main';
    if (opts.title) {
      var b = doc.createElement('b');
      b.textContent = opts.title;
      main.appendChild(b);
    }
    var span = doc.createElement('span');
    span.textContent = msg;
    main.appendChild(span);
    item.appendChild(main);
    if (opts.actionLabel && typeof opts.action === 'function') {
      var act = doc.createElement('button');
      act.type = 'button';
      act.className = 'ds-toast-act';
      act.textContent = opts.actionLabel;
      act.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); dismiss();
        try { opts.action(); } catch (err) {}
      });
      item.appendChild(act);
    }
    var x = doc.createElement('button');
    x.type = 'button';
    x.className = 'ds-toast-x';
    x.setAttribute('aria-label', '关闭提示');
    x.textContent = '×';
    x.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); dismiss(); });
    item.appendChild(x);
    var timer = null;
    function dismiss() {
      clearTimeout(timer);
      if (!item.parentNode) return;
      item.style.opacity = '0';
      item.style.transform = 'translateY(6px)';
      item.style.transition = 'opacity .15s ease, transform .15s ease';
      setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 170);
    }
    item.addEventListener('mouseenter', function () { clearTimeout(timer); });
    item.addEventListener('mouseleave', function () { timer = setTimeout(dismiss, 2600); });
    box.appendChild(item);
    while (box.children.length > 3) box.removeChild(box.children[0]);
    timer = setTimeout(dismiss, opts.duration || 4600);
    return item;
  }
  function flushQueue() {
    if (!queue.length) return;
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) toast(q[i][0], q[i][1], q[i][2]);
  }

  /* ---------------- 复制成功提示（不接管 fetch；只补 clipboard 反馈） ---------------- */
  function patchClipboard() {
    try {
      var cb = navigator.clipboard;
      if (cb && typeof cb.writeText === 'function') {
        var orig = cb.writeText;
        cb.writeText = function (text) {
          return orig.call(cb, text).then(function (r) {
            toast('内容已复制到剪贴板', 'success', { key: 'copy', duration: 2200, title: '复制成功' });
            return r;
          });
        };
      }
    } catch (e) {}
    try {
      var ec = doc.execCommand;
      if (typeof ec === 'function') {
        doc.execCommand = function (cmd) {
          var r = ec.apply(doc, arguments);
          if (String(cmd).toLowerCase() === 'copy' && r) {
            toast('内容已复制到剪贴板', 'success', { key: 'copy', duration: 2200, title: '复制成功' });
          }
          return r;
        };
      }
    } catch (e2) {}
  }

  /* ---------------- 二次确认（删除 / 重置 / 扣费） ---------------- */
  var RULES = [
    { re: /永久删除|彻底删除|删除全部|清空全部|清空所有/, type: 'danger', title: '确认删除全部内容？', desc: '此操作不可撤销，删除后数据无法恢复。建议先导出或备份。', ok: '确认删除' },
    { re: /删除|移除|销毁|注销|^删$/, type: 'danger', title: '确认删除？', desc: '删除后不可恢复，请确认该项已不再需要。', ok: '确认删除' },
    { re: /清空|重置|恢复默认|还原/, type: 'warn', title: '确认重置？', desc: '当前填写内容或生成结果将被清空，请确认后继续。', ok: '确认重置' },
    { re: /扣费|扣积分|消耗积分/, type: 'gold', title: '确认扣除积分？', desc: '该操作将消耗账号积分并提交任务，生成失败按平台规则处理。', ok: '确认继续' }
  ];
  function inOpenDialog(el) {
    var n = el;
    for (var i = 0; i < 5 && n && n !== doc.body; i++) {
      if (n.nodeType === 1) {
        var cls = (n.className || '').toString() + ' ' + (n.id || '');
        if (/modal|dialog|popup|drawer|sheet/i.test(cls) && n.offsetParent !== null && n !== el) return true;
      }
      n = n.parentNode;
    }
    return false;
  }
  function matchRule(el) {
    var raw = (el.innerText || el.textContent || '').replace(/\s+/g, '');
    if (!raw) raw = (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, '');
    var txt = raw.slice(0, 40);
    if (!txt || txt.length > 30) return null;
    if (/^(确认|确定|删除中|处理中|正在)/.test(txt)) return null;
    var explicit = el.getAttribute('data-ds-confirm');
    if (explicit === '0') return null;
    var scope = el.parentElement ? (el.parentElement.innerText || '') : '';
    var cm = /(消耗|扣(?:除|费)?)[^0-9]{0,8}(\d{1,6})\s*(?:积分|点)/.exec(scope) || /扣费/.exec(txt);
    var cost = cm && cm[2] ? parseInt(cm[2], 10) : 0;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].re.test(txt)) {
        if (i === 3 && !cm) continue;
        var r = { type: RULES[i].type, title: RULES[i].title, desc: RULES[i].desc, ok: RULES[i].ok };
        if (i === 3) r.desc = '该操作会消耗积分并提交任务，确认后开始执行。';
        if (cost > 0) r.cost = cost;
        return r;
      }
    }
    if (explicit === '1' || explicit === 'confirm') {
      return { type: 'danger', title: '确认执行该操作？', desc: '请确认操作对象无误，执行后可能无法撤销。', ok: '确认继续' };
    }
    return null;
  }
  function confirmDialog(cfg) {
    return new Promise(function (resolve) {
      var mask = doc.createElement('div');
      mask.className = 'ds-mask';
      mask.setAttribute('role', 'dialog');
      mask.setAttribute('aria-modal', 'true');
      var modal = doc.createElement('div');
      modal.className = 'ds-modal' + (cfg.type === 'danger' ? ' is-danger' : '');
      var head = doc.createElement('div');
      head.className = 'ds-modal-head';
      var badge = doc.createElement('div');
      badge.className = 'ds-modal-badge';
      badge.textContent = cfg.type === 'danger' ? '!' : (cfg.type === 'gold' ? '✦' : '↻');
      head.appendChild(badge);
      var h = doc.createElement('h3');
      h.textContent = cfg.title;
      head.appendChild(h);
      modal.appendChild(head);
      var desc = doc.createElement('p');
      desc.className = 'ds-modal-desc';
      desc.textContent = cfg.desc || '';
      modal.appendChild(desc);
      if (cfg.cost) {
        var cost = doc.createElement('div');
        cost.className = 'ds-modal-cost';
        cost.appendChild(doc.createTextNode('预计消耗 '));
        var b = doc.createElement('b');
        b.textContent = cfg.cost + ' 积分';
        cost.appendChild(b);
        cost.appendChild(doc.createTextNode('，生成失败按平台积分规则返还。'));
        modal.appendChild(cost);
      }
      var actions = doc.createElement('div');
      actions.className = 'ds-modal-actions';
      var cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ds-btn ds-btn-ghost';
      cancel.textContent = '取消';
      var ok = doc.createElement('button');
      ok.type = 'button';
      ok.className = 'ds-btn ' + (cfg.type === 'danger' ? 'ds-btn-danger' : 'ds-btn-primary');
      ok.textContent = cfg.ok || '确认';
      actions.appendChild(cancel);
      actions.appendChild(ok);
      modal.appendChild(actions);
      mask.appendChild(modal);
      var done = false;
      function close(v) {
        if (done) return;
        done = true;
        doc.removeEventListener('keydown', onKey, true);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); close(true); }
        else if (e.key === 'Tab') { e.preventDefault(); (doc.activeElement === ok ? cancel : ok).focus(); }
      }
      cancel.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); close(false); });
      ok.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); close(true); });
      mask.addEventListener('click', function (e) { if (e.target === mask) close(false); });
      doc.addEventListener('keydown', onKey, true);
      doc.body.appendChild(mask);
      setTimeout(function () { try { ok.focus(); } catch (e) {} }, 30);
    });
  }
  function bindConfirm() {
    doc.addEventListener('click', function (e) {
      if (e.__dsConfirmed) return;
      var t = e.target;
      while (t && t !== doc.body && !(t.tagName === 'BUTTON' || (t.tagName === 'A' && t.getAttribute('role') === 'button'))) t = t.parentNode;
      if (!t || t === doc.body) return;
      if (t.closest && t.closest('#xlSidebar,#xlTopbar,#dsToastBox,.ds-mask,.xl-gate-mask,.xl-gate-card,.xl-gate-bar')) return;
      if (inOpenDialog(t)) return;
      var cfg = matchRule(t);
      if (!cfg) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      confirmDialog(cfg).then(function (ok) {
        if (!ok) return;
        e.__dsConfirmed = true;
        try { t.click(); } catch (err) {}
        setTimeout(function () { e.__dsConfirmed = false; }, 500);
        if (cfg.type === 'danger') toast('已确认，正在执行删除', 'info', { key: 'confirmed-del', duration: 2400 });
        else if (cfg.type === 'warn') toast('已确认，正在重置', 'info', { key: 'confirmed-reset', duration: 2400 });
        else if (cfg.type === 'gold') toast('已确认，正在提交任务', 'info', { key: 'confirmed-credit', duration: 2400 });
      });
    }, true);
  }

  /* ---------------- 组件统一（打 ds-* 类） ---------------- */
  var GHOST_RE = /(^|[-_])(ghost|line|soft|link|secondary|outline|plain|transparent|linkbtn|textbtn)([-_]|$)/;
  var DANGER_RE = /(^|[-_])(danger|dangerous|delete|del|trash|remove|bad|warn|risk)([-_]|$)/;
  var PRIMARY_RE = /(^|[-_])(primary|main|gold|teal|green|cta|submit|save|buy|start|confirm|ok|generate|render|publish|download|export|create|upgrade|pay)([-_]|$)/;
  var SKIP_RE = /(^|[-_])(tab|tabs|tabbtn|seg|segment|swatch|stepper|step|nav|menu|toggle|switch|select|picker|filter|chip|chipbtn|pill|dot|indicator|mark|marker|badge|tag|page|pager|arrow|close|back|preview|modal|x|ico|icon|iconbtn|playbtn|abtn|dlbtn|sound|mic|file|upload|tool|fav|heart|star|rate|color|bg|mode|aspect|style|ex|layout|view|sort|order|spinner|loader|handle|thumb|slider)([-_]|$)/;
  var PRIMARY_TXT = /生成|开始|保存|购买|支付|开通|发布|导出|下载|提交|确认|创建|渲染|校验|升级|安装|启用|立即|套用/;
  function tokensOf(el) { return ((el.className || '').toString().toLowerCase().match(/[^\s]+/g) || []); }
  function tokenMatch(tokens, re) {
    for (var i = 0; i < tokens.length; i++) if (re.test(tokens[i])) return true;
    return false;
  }
  function looksIcon(txt, rect) { return txt.length <= 2 && rect.width > 0 && rect.width <= 46 && rect.height <= 46; }
  function styleButton(el) {
    if (el.getAttribute('data-ds-done') === '1') return;
    if (el.closest && el.closest('#xlSidebar,#xlTopbar,.xl-sb,.xl-topbar,#dsToastBox,.ds-mask,.xl-gate-mask,.xl-gate-card,.xl-gate-bar')) { el.setAttribute('data-ds-done', '1'); return; }
    var isBtn = el.tagName === 'BUTTON';
    var cls = (el.className || '').toString().toLowerCase();
    if (!isBtn && !/(^|\s)(btn|button|cta)(\s|$)/.test(cls) && el.getAttribute('role') !== 'button') {
      el.setAttribute('data-ds-done', '1'); return;
    }
    if (el.getAttribute('role') === 'tab' || el.getAttribute('aria-selected') === 'true' ||
        el.hasAttribute('data-pane') || el.hasAttribute('data-view') || el.hasAttribute('data-tab') ||
        el.getAttribute('aria-controls') ||
        (el.closest && el.closest('[role="tablist"],[class*="tabs"],[class*="tabbar"],[class*="tabnav"],[class*="tabs-wrap"]'))) {
      el.setAttribute('data-ds-done', '1'); return;
    }
    var rect = el.getBoundingClientRect();
    var txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    var tokens = tokensOf(el);
    var danger = tokenMatch(tokens, DANGER_RE) || DANGER_RE.test(cls);
    var iconLike = looksIcon(txt, rect) || tokenMatch(tokens, /(^|[-_])(iconbtn|icon|ico)([-_]|$)/);
    if (iconLike) {
      if (danger) { addClass(el, 'ds-btn'); addClass(el, 'ds-btn-danger'); addClass(el, 'ds-btn-sm'); }
      el.setAttribute('data-ds-done', '1'); return;
    }
    if (tokenMatch(tokens, SKIP_RE)) { el.setAttribute('data-ds-done', '1'); return; }
    var variant = 'default';
    if (danger) variant = 'danger';
    else if (tokenMatch(tokens, GHOST_RE)) variant = 'ghost';
    else if (tokenMatch(tokens, PRIMARY_RE) || (txt.length <= 18 && PRIMARY_TXT.test(txt))) variant = 'primary';
    addClass(el, 'ds-btn');
    if (variant === 'primary') addClass(el, 'ds-btn-primary');
    else if (variant === 'danger') addClass(el, 'ds-btn-danger');
    else if (variant === 'ghost') addClass(el, 'ds-btn-ghost');
    if ((rect.height > 0 && rect.height <= 34) || tokenMatch(tokens, /^(sm|mini|small|xs)$/)) addClass(el, 'ds-btn-sm');
    if (/block|full|wide/.test(cls)) addClass(el, 'ds-btn-block');
    el.setAttribute('data-ds-done', '1');
  }
  function styleInput(el) {
    if (el.getAttribute('data-ds-done') === '1') return;
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (el.tagName === 'INPUT' && /^(hidden|checkbox|radio|range|color|button|submit|reset|image)$/.test(type)) return;
    if (el.closest && el.closest('#xlSidebar,#xlTopbar,#dsToastBox,.xl-gate-mask,.xl-gate-card,.xl-gate-bar')) { el.setAttribute('data-ds-done', '1'); return; }
    var rect = el.getBoundingClientRect();
    addClass(el, 'ds-input');
    if (rect.height > 0 && rect.height < 30) addClass(el, 'ds-input-compact');
    el.setAttribute('data-ds-done', '1');
  }
  function styleTable(el) {
    if (el.getAttribute('data-ds-done') === '1') return;
    addClass(el, 'ds-table');
    el.setAttribute('data-ds-done', '1');
  }
  function styleCard(el) {
    if (el.getAttribute('data-ds-done') === '1') return;
    var tokens = tokensOf(el);
    for (var i = 0; i < tokens.length; i++) {
      if (/^(card|tile)$/.test(tokens[i]) || /-card$/.test(tokens[i])) { addClass(el, 'ds-card'); break; }
    }
    el.setAttribute('data-ds-done', '1');
  }
  function classify(root) {
    root = root || doc.body;
    if (!root || root.nodeType !== 1) return;
    var els = $$('button, a[role="button"], a[class*="btn"], input, select, textarea, table, [class*="card"]', root);
    for (var i = 0; i < els.length && i < 900; i++) {
      var el = els[i], tag = el.tagName;
      if (tag === 'TABLE') styleTable(el);
      else if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') styleInput(el);
      else if (el.classList && /(^|[-_\s])(card|tile)([-_\s]|$)/i.test(el.className)) styleCard(el);
      else styleButton(el);
    }
  }
  function classifyLoose() {
    var els = $$('button:not([data-ds-done="1"]), input:not([data-ds-done="1"]), select:not([data-ds-done="1"]), textarea:not([data-ds-done="1"]), table:not([data-ds-done="1"])');
    for (var i = 0; i < els.length && i < 500; i++) {
      var el = els[i], tag = el.tagName;
      if (tag === 'TABLE') styleTable(el);
      else if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') styleInput(el);
      else styleButton(el);
    }
  }

  /* ---------------- AI 标识统一 ---------------- */
  function normalizeAi(root) {
    var els = $$('span, em, b, small, i, strong', root || doc.body);
    for (var i = 0; i < els.length && i < 900; i++) {
      var el = els[i];
      if (el.getAttribute('data-ds-ai') === '1') continue;
      if (el.childElementCount > 0) continue;
      var t = (el.textContent || '').trim();
      if (!/^AI\s*(生成|合成|创作|标识|生成内容)$/.test(t)) continue;
      el.setAttribute('data-ds-ai', '1');
      if (t !== 'AI 生成') el.textContent = 'AI 生成';
      addClass(el, 'ds-ai-badge');
    }
  }

  /* ---------------- 加载 / 空态 / 骨架 / 错误重试 ---------------- */
  function contextOf(el) {
    var c = ((el.className || '').toString()) + ' ' + (el.id || '') + ' ';
    var p = el.parentElement;
    if (p) c += ((p.className || '').toString()) + ' ' + (p.id || '');
    return c;
  }
  function isStatBox(el) {
    var c = contextOf(el);
    return /stat|num|value|val|count|total|kpi|price|metric|balance|credit|amount|rate|counter|placeholder/i.test(c);
  }
  function retryTarget(el) {
    var scope = el.parentElement;
    for (var i = 0; i < 4 && scope; i++) {
      var btn = scope.querySelector('button,a.btn,[class*="btn"]');
      if (btn && /重试|刷新|重新加载|再次加载|重新生成/.test((btn.innerText || ''))) return btn;
      scope = scope.parentElement;
    }
    return null;
  }
  function addRetry(el) {
    if (el.getAttribute('data-ds-retry') === '1') return;
    el.setAttribute('data-ds-retry', '1');
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-retry';
    btn.textContent = '重试';
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var target = retryTarget(el);
      if (target) { try { target.click(); } catch (err) {} }
      else location.reload();
    });
    el.appendChild(btn);
  }
  function scanStates() {
    var els = $$('div, span, p, small, em, b, i, strong, dd, td, li, label');
    for (var i = 0; i < els.length && i < 2400; i++) {
      var el = els[i];
      if (el.getAttribute('data-ds-state') === '1') continue;
      if (el.closest && el.closest('#xlSidebar,#xlTopbar,#dsToastBox,.ds-mask,.xl-gate-mask,.xl-gate-card,.xl-gate-bar,pre,code,script')) continue;
      if (el.childElementCount > 0) continue;
      var txt = (el.textContent || '').trim();
      if (!txt || txt.length > 42) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < 18 || rect.height < 8) continue;
      var ctx = contextOf(el);
      var kind = '';
      if (/^(加载中|载入中|读取中|自检中|正在读取|正在加载|正在检测|加载更多|连接中)/.test(txt)) kind = 'loading';
      else if (/^(还没有|暂无|暂无数据|没有数据|暂无内容|未选择|未上传|空空如也)/.test(txt) && /empty|none|no-?data|placeholder|state|status|hint|meta|result|output|preview|list|grid|table|panel|box|card|wrap|content|body/i.test(ctx)) kind = 'empty';
      else if (/^[—–-]$/.test(txt) && isStatBox(el) && !skeletonExpired) kind = 'skel';
      else if (/^(失败|加载失败|出错了|服务异常|接口不可用|请求失败|网络异常|网络错误|提交失败|生成失败)/.test(txt) && /result|status|state|banner|alert|hint|msg|message|error|fail|card|panel|box/i.test(ctx)) kind = 'error';
      if (!kind) continue;
      el.setAttribute('data-ds-state', '1');
      if (kind === 'skel') {
        addClass(el, 'ds-skel');
      } else if (kind === 'empty') {
        var ownBorder = false;
        try {
          var cs = getComputedStyle(el);
          ownBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden';
        } catch (e) {}
        if (ownBorder) { addClass(el, 'ds-empty-plain'); kind = 'empty-plain'; }
        else addClass(el, 'ds-empty');
      } else if (kind === 'error') {
        addClass(el, 'ds-error-inline');
        addRetry(el);
      } else {
        addClass(el, 'ds-loading');
      }
      watched.push({ el: el, kind: kind });
      if (watched.length > 160) break;
    }
    for (var k = watched.length - 1; k >= 0; k--) {
      var it = watched[k];
      if (!it.el || !doc.contains(it.el)) { watched.splice(k, 1); continue; }
      var cur = (it.el.textContent || '').trim();
      var okLoading = it.kind === 'loading' && /^(加载中|载入中|读取中|自检中|正在读取|正在加载|正在检测|加载更多|连接中)/.test(cur);
      var okEmpty = (it.kind === 'empty' || it.kind === 'empty-plain') && /^(还没有|暂无|暂无数据|没有数据|暂无内容|未选择|未上传|空空如也)/.test(cur);
      var okSkel = it.kind === 'skel' && !skeletonExpired && /^[—–-]$/.test(cur);
      var okError = it.kind === 'error' && /^(失败|加载失败|出错了|服务异常|接口不可用|请求失败|网络异常|网络错误|提交失败|生成失败)/.test(cur);
      if (!(okLoading || okEmpty || okSkel || okError)) {
        removeClass(it.el, 'ds-' + it.kind);
        removeClass(it.el, 'ds-error-inline');
        it.el.removeAttribute('data-ds-state');
        it.el.removeAttribute('data-ds-retry');
        var r = it.el.querySelector('.ds-retry');
        if (r) r.parentNode.removeChild(r);
        watched.splice(k, 1);
      }
    }
    syncProgress();
  }
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function () { try { scanStates(); } catch (e) {} }, 260);
  }

  /* ---------------- 数据更新时间 ---------------- */
  function injectFreshness() {
    var key = pageKey();
    if (!key || !DATA_UPDATED[key]) return;
    if ($('.ds-freshness')) return;
    var div = doc.createElement('div');
    div.className = 'ds-freshness';
    var dot = doc.createElement('span');
    dot.className = 'ds-dot';
    div.appendChild(dot);
    var txt = doc.createElement('span');
    txt.appendChild(doc.createTextNode('数据更新于 '));
    var b = doc.createElement('b');
    b.textContent = DATA_UPDATED[key];
    txt.appendChild(b);
    txt.appendChild(doc.createTextNode(' · 来源：' + DATA_SOURCE[key] + ' · 以结算/授权页实时结果为准'));
    div.appendChild(txt);
    var host = {
      pricing: '.pricing-hero .status-bar',
      assets: '.hero .statrow',
      plugins: '.xp-hero-pills',
      templates: '.hero p'
    }[key];
    var target = host ? $(host) : null;
    if (target && target.parentNode) {
      if (target.nextSibling) target.parentNode.insertBefore(div, target.nextSibling);
      else target.parentNode.appendChild(div);
    } else {
      var main = $('main') || doc.body;
      main.appendChild(div);
    }
  }

  /* ---------------- 图片 lazy / 防跳动 ---------------- */
  function lazyImages(root) {
    var imgs = $$('img', root || doc);
    for (var i = 0; i < imgs.length && i < 300; i++) {
      var img = imgs[i];
      if (img.getAttribute('data-ds-lazy') === '1') continue;
      img.setAttribute('data-ds-lazy', '1');
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      var wAttr = parseInt(img.getAttribute('width'), 10);
      var hAttr = parseInt(img.getAttribute('height'), 10);
      if (wAttr > 0 && hAttr > 0 && !img.style.aspectRatio) img.style.aspectRatio = wAttr + ' / ' + hAttr;
    }
  }

  /* ---------------- 全局事件（只绑定一次；不接管 fetch） ---------------- */
  function bindGlobal() {
    w.addEventListener('online', function () { toast('网络已恢复，可以继续操作', 'success', { key: 'online' }); });
    w.addEventListener('offline', function () { toast('网络已断开，部分操作需联网后重试', 'warn', { key: 'offline', duration: 6000 }); });
    w.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      if (!r || (r.name && r.name === 'AbortError')) return;
      var msg = (r && (r.message || r.hint || r.error)) || '';
      var friendly = '';
      if (/Failed to fetch|NetworkError|Load failed|network|网络/i.test(msg)) friendly = '网络连接失败，请检查网络后重试';
      else if (/401|未登录|登录/i.test(msg)) friendly = '登录状态已失效，请重新登录后再试';
      else if (/403|无权限|额度|积分不足/i.test(msg)) friendly = '当前账号无权限或额度不足，请查看套餐后再试';
      else if (/429|频繁/i.test(msg)) friendly = '操作太频繁，请稍等几秒再重试';
      else if (/50[0-9]|服务不可用|服务器/i.test(msg)) friendly = '服务暂时不可用，请稍后重试';
      else friendly = '页面有操作未完成，可重试或刷新';
      toast(friendly, 'error', {
        key: 'rejection', title: '操作未完成',
        actionLabel: '刷新重试', action: function () { location.reload(); }
      });
    });
    w.addEventListener('error', function (ev) {
      if (!ev || !ev.message) return;
      toast('页面出现异常，刷新后可恢复', 'error', {
        key: 'jserror', title: '页面异常',
        actionLabel: '刷新', action: function () { location.reload(); }
      });
    });
  }

  /* ---------------- MutationObserver ---------------- */
  function startObserver() {
    if (!w.MutationObserver || !doc.body) return;
    var mo = new w.MutationObserver(function (muts) {
      var need = false;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type !== 'childList' || !m.addedNodes.length) continue;
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.id === 'dsToastBox' || n.id === 'dsTopProgress' ||
              (n.classList && (n.classList.contains('ds-toast') || n.classList.contains('ds-mask') || n.classList.contains('ds-retry')))) continue;
          need = true;
          try {
            classify(n);
            normalizeAi(n);
            lazyImages(n);
            if (n.matches && n.matches('button,input,select,textarea,a')) {
              if (n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA') styleInput(n);
              else styleButton(n);
            }
          } catch (e) {}
        }
      }
      if (need) { scheduleScan(); scheduleClassify(); }
    });
    mo.observe(doc.body, { childList: true, subtree: true });
  }
  function scheduleClassify() {
    clearTimeout(classifyTimer);
    classifyTimer = setTimeout(function () {
      try { classifyLoose(); normalizeAi(); lazyImages(); } catch (e) {}
    }, 320);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    ensureProgress();
    ensureToastBox();
    patchClipboard();
    bindConfirm();
    bindGlobal();
    try { classify(doc.body); } catch (e) {}
    try { normalizeAi(); } catch (e) {}
    try { scanStates(); } catch (e) {}
    try { lazyImages(); } catch (e) {}
    try { injectFreshness(); } catch (e) {}
    startObserver();
    flushQueue();
    setTimeout(function () { try { classifyLoose(); scanStates(); normalizeAi(); } catch (e) {} }, 1500);
    setTimeout(function () { try { classifyLoose(); scanStates(); } catch (e) {} }, 4000);
    setTimeout(function () {
      skeletonExpired = true;
      var sk = $$('.ds-skel');
      for (var i = 0; i < sk.length; i++) { removeClass(sk[i], 'ds-skel'); sk[i].removeAttribute('data-ds-state'); }
      watched = watched.filter(function (it) {
        if (it.kind === 'skel') { removeClass(it.el, 'ds-skel'); return false; }
        return true;
      });
      syncProgress();
    }, 9000);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();

  window.XLDS = {
    __installed: true,
    version: VERSION,
    toast: toast,
    confirm: confirmDialog,
    classify: classify,
    scan: function () { scheduleScan(); }
  };
})();
