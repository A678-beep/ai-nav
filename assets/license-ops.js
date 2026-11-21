/* 星籁剪辑 · 运营后台「软件授权」tab 组件（/ai-nav/ops/edit/ 引入，admin only）
 * 依赖：assets/auth.js（window.XLAuth，Bearer token + /ai-nav/api 基址）
 * 功能：概览 / Key 生成·吊销·延长·加座·换绑 / 设备台账（踢下线·封禁）/ 订单登记 /
 *       异常告警（多 IP 自动封禁 + 邮件老板）/ 功能开关与风控阈值 / CSV 导出 / 隐形水印溯源。
 * 说明：仅运营后台加载，客户端不加载此文件；所有写操作后端 admin 鉴权 + 审计。
 */
(function () {
  'use strict';
  if (window.__XL_LICENSE_OPS__) return;
  window.__XL_LICENSE_OPS__ = true;

  var API = '/license/ops';
  var BUILT = false;
  var state = {
    sub: 'overview',
    loaded: {},
    overview: null,
    keys: { items: [], total: 0, page: 1, size: 20, q: '', status: '', plan: '' },
    devices: { items: [], total: 0, page: 1, size: 20, status: '', q: '' },
    orders: { items: [], total: 0, page: 1, size: 20, status: '', q: '', stats: null },
    alerts: { items: [], total: 0, page: 1, size: 20, status: 'open', counts: {} },
    config: null,
    plans: {},
    timer: null
  };

  /* ---------------- 小工具 ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    if (window.XLAuth && XLAuth.esc) return XLAuth.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    var v = Number(n == null ? 0 : n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString ? v.toLocaleString('zh-CN') : String(v);
  }
  function money(cents) { return '¥' + (Number(cents || 0) / 100).toFixed(2).replace(/\.00$/, ''); }
  function fmtTs(s) { return s ? String(s).slice(0, 19) : '—'; }
  function api(method, path, body, timeout) {
    var opts = { method: method, timeout: timeout || 16000 };
    if (body != null) opts.body = body;
    return XLAuth.api(path, opts);
  }
  function errText(e) {
    if (!e) return '操作失败';
    if (e.status === 401) return '登录已失效，请重新登录';
    if (e.status === 403) return '需要管理员权限';
    if (e.status === 404 && e.code === 'NOT_READY') return '授权接口尚未生效（服务端待重启）';
    if (e.status === 404 && /not_found/i.test(e.code || '')) return '授权接口尚未生效（服务端待重启）';
    return (e.data && (e.data.hint || e.data.message || e.data.error)) || e.message || ('请求失败' + (e.status || ''));
  }
  function toast(msg, kind, ms) {
    if (window.XLAuth && XLAuth.toast) XLAuth.toast(msg, kind || 'ok', ms || 2600);
  }
  function post(path, body) { return api('POST', path, body || {}); }
  function get(path) { return api('GET', path); }
  function badge(txt, tone, title) {
    return '<span class="lo-tag ' + (tone || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(txt) + '</span>';
  }
  function statusBadge(s) {
    var m = { active: ['正常', 'ok'], revoked: ['已吊销', 'bad'], expired: ['已过期', 'warn'],
      kicked: ['已解绑', 'muted'], banned: ['已封禁', 'bad'] };
    var v = m[s] || [s || '—', 'muted'];
    return badge(v[0], v[1]);
  }
  function planBadge(p) {
    var tone = p === 'enterprise' ? 'violet' : p === 'trial' ? 'cyan' : 'lime';
    var name = (state.plans[p] && state.plans[p].name) || p;
    return badge(name, tone);
  }
  function bindClick(root, sel, fn) {
    $$(sel, root).forEach(function (el) {
      el.addEventListener('click', function (ev) { ev.preventDefault(); fn(el, ev); });
    });
  }
  function copyText(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt);
        toast('已复制到剪贴板');
        return;
      }
    } catch (e) { }
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      toast('已复制到剪贴板');
    } catch (e) { toast('复制失败，请手动选择复制', 'warn'); }
  }
  function downloadFile(name, content, mime) {
    try {
      var blob = new Blob([content], { type: mime || 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
    } catch (e) { toast('下载失败：' + e.message, 'err'); }
  }

  /* ---------------- 弹窗 ---------------- */
  function closeModal() {
    var m = $('#loModal');
    if (m) m.remove();
  }
  function openModal(title, bodyHtml, buttons, wide) {
    closeModal();
    var mask = document.createElement('div');
    mask.id = 'loModal';
    mask.className = 'lo-mask';
    mask.innerHTML = '<div class="lo-modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="lo-modal-h"><b>' + esc(title) + '</b><button type="button" class="lo-x" data-lo-close="1">✕</button></div>' +
      '<div class="lo-modal-b">' + bodyHtml + '</div>' +
      '<div class="lo-modal-f">' + (buttons || []).map(function (b, i) {
        return '<button type="button" class="lo-btn ' + (b.cls || '') + '" data-lo-btn="' + i + '">' + esc(b.label) + '</button>';
      }).join('') + '</div></div>';
    document.body.appendChild(mask);
    bindClick(mask, '[data-lo-close]', closeModal);
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });
    (buttons || []).forEach(function (b, i) {
      var btn = $('[data-lo-btn="' + i + '"]', mask);
      if (btn) btn.addEventListener('click', function () {
        if (!b.fn || b.fn(btn, mask) !== false) closeModal();
      });
    });
    return mask;
  }

  /* ---------------- 样式 ---------------- */
  function injectCss() {
    if ($('#lo-style')) return;
    var s = document.createElement('style');
    s.id = 'lo-style';
    s.textContent = [
      '#panel-license{padding:0}',
      '#panel-license .lo-head{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;margin:2px 0 12px}',
      '#panel-license .lo-head .grow{flex:1;min-width:240px}',
      '#panel-license .lo-title{font-size:18px;font-weight:800;letter-spacing:.01em;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '#panel-license .lo-title .pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(56,189,248,.14);color:#7dd3fc;border:1px solid rgba(56,189,248,.3)}',
      '#panel-license .lo-sub{font-size:11.5px;color:var(--oe-txt3,#8a99ad);margin-top:4px;line-height:1.7}',
      '#panel-license .lo-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}',
      '#panel-license .lo-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--oe-line,#243244);margin-bottom:14px;padding-bottom:0;scrollbar-width:thin}',
      '#panel-license .lo-tabs button{border:0;background:transparent;color:var(--oe-txt2,#9fb0c4);padding:9px 12px;font-size:12.5px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;display:flex;align-items:center;gap:5px}',
      '#panel-license .lo-tabs button:hover{color:var(--oe-txt,#e6edf5)}',
      '#panel-license .lo-tabs button.on{color:var(--oe-cyan,#38bdf8);border-bottom-color:var(--oe-cyan,#38bdf8)}',
      '#panel-license .lo-tabs button .n{font-size:9.5px;min-width:15px;height:15px;line-height:15px;padding:0 4px;border-radius:99px;background:rgba(148,163,184,.16);color:var(--oe-txt2);text-align:center;font-variant-numeric:tabular-nums}',
      '#panel-license .lo-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:13px}',
      '#panel-license .lo-stat{position:relative;padding:11px 12px 10px;border-radius:11px;border:1px solid var(--oe-line,#243244);background:var(--oe-panel,#111a26);overflow:hidden;min-width:0}',
      '#panel-license .lo-stat:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,var(--sc,#38bdf8),transparent 80%)}',
      '#panel-license .lo-stat .l{font-size:10.5px;color:var(--oe-txt3,#8a99ad);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#panel-license .lo-stat .v{margin-top:5px;font-size:21px;line-height:1.15;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '#panel-license .lo-stat .v small{font-size:11px;font-weight:700;color:var(--oe-txt2);margin-left:2px}',
      '#panel-license .lo-stat .f{font-size:10px;color:var(--oe-txt3);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#panel-license .lo-card{background:var(--oe-panel,#111a26);border:1px solid var(--oe-line,#243244);border-radius:12px;padding:0;margin-bottom:13px;overflow:hidden}',
      '#panel-license .lo-card-h{display:flex;align-items:center;gap:9px;padding:11px 13px;border-bottom:1px solid var(--oe-line,#243244);flex-wrap:wrap}',
      '#panel-license .lo-card-h h3{margin:0;font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px}',
      '#panel-license .lo-card-h .right{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '#panel-license .lo-card-b{padding:11px 13px 13px}',
      '#panel-license .lo-bar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:10px}',
      '#panel-license .lo-bar .grow{flex:1;min-width:150px}',
      '#panel-license .lo-input,#panel-license .lo-select,#panel-license .lo-textarea{background:var(--oe-bg2,#0c1420);border:1px solid var(--oe-line,#243244);border-radius:8px;color:var(--oe-txt,#e6edf5);padding:0 9px;min-height:30px;font-size:12.5px;min-width:0}',
      '#panel-license .lo-input:focus,#panel-license .lo-select:focus,#panel-license .lo-textarea:focus{outline:none;border-color:rgba(56,189,248,.55)}',
      '#panel-license .lo-textarea{width:100%;min-height:90px;padding:8px 9px;line-height:1.6;resize:vertical;font-family:Consolas,monospace;font-size:11.5px}',
      '#panel-license .lo-btn{border:1px solid var(--oe-line,#243244);background:rgba(148,163,184,.07);color:var(--oe-txt,#e6edf5);border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}',
      '#panel-license .lo-btn:hover{border-color:rgba(56,189,248,.5);color:var(--oe-cyan,#38bdf8)}',
      '#panel-license .lo-btn.primary{background:linear-gradient(135deg,#2f6fb3,#2563a8);border-color:transparent;color:#fff}',
      '#panel-license .lo-btn.primary:hover{filter:brightness(1.12)}',
      '#panel-license .lo-btn.danger{color:#fb7185;border-color:rgba(251,113,133,.42);background:rgba(251,113,133,.08)}',
      '#panel-license .lo-btn.ghost{background:transparent}',
      '#panel-license .lo-btn.sm{padding:3px 8px;font-size:10.5px;border-radius:7px}',
      '#panel-license .lo-btn[disabled]{opacity:.5;cursor:not-allowed}',
      '#panel-license .lo-table-wrap{overflow:auto;max-width:100%;scrollbar-width:thin}',
      '#panel-license .lo-table{width:100%;border-collapse:separate;border-spacing:0;font-size:11.8px;min-width:820px}',
      '#panel-license .lo-table th{position:sticky;top:0;z-index:2;background:var(--oe-bg,#070b12);text-align:left;padding:8px 10px;font-size:10px;font-weight:800;color:var(--oe-txt3,#8a99ad);border-bottom:1px solid var(--oe-line,#243244);white-space:nowrap}',
      '#panel-license .lo-table td{padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.08);vertical-align:middle;color:var(--oe-txt2,#9fb0c4);line-height:1.5}',
      '#panel-license .lo-table tbody tr:hover{background:rgba(148,163,184,.04)}',
      '#panel-license .lo-table tbody tr:last-child td{border-bottom:0}',
      '#panel-license .lo-table td.mono{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:#93c5fd;word-break:break-all}',
      '#panel-license .lo-table td.strong{color:var(--oe-txt,#e6edf5);font-weight:700}',
      '#panel-license .lo-table td.actions{white-space:nowrap;text-align:right}',
      '#panel-license .lo-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
      '#panel-license .lo-tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;background:rgba(148,163,184,.12);color:var(--oe-txt2,#9fb0c4);white-space:nowrap;line-height:1.6}',
      '#panel-license .lo-tag.ok{background:rgba(52,211,153,.14);color:#34d399}',
      '#panel-license .lo-tag.warn{background:rgba(251,191,36,.15);color:#fbbf24}',
      '#panel-license .lo-tag.bad{background:rgba(251,113,133,.15);color:#fb7185}',
      '#panel-license .lo-tag.info{background:rgba(56,189,248,.14);color:#38bdf8}',
      '#panel-license .lo-tag.violet{background:rgba(167,139,250,.16);color:#a78bfa}',
      '#panel-license .lo-tag.cyan{background:rgba(56,189,248,.14);color:#38bdf8}',
      '#panel-license .lo-tag.lime{background:rgba(52,211,153,.14);color:#34d399}',
      '#panel-license .lo-tag.muted{background:rgba(148,163,184,.1);color:#8a99ad}',
      '#panel-license .lo-empty{padding:26px 12px;text-align:center;color:var(--oe-txt3,#8a99ad);font-size:12px;line-height:1.8}',
      '#panel-license .lo-prog{height:5px;border-radius:99px;background:rgba(148,163,184,.14);overflow:hidden;min-width:54px}',
      '#panel-license .lo-prog i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#38bdf8,#a78bfa)}',
      '#panel-license .lo-pager{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:9px 4px 0;font-size:11px;color:var(--oe-txt3)}',
      '#panel-license .lo-pager b{color:var(--oe-txt2);font-variant-numeric:tabular-nums}',
      '#panel-license .lo-kv{display:grid;grid-template-columns:110px 1fr;gap:7px 12px;font-size:12px;line-height:1.6}',
      '#panel-license .lo-kv .k{color:var(--oe-txt3,#8a99ad)}',
      '#panel-license .lo-note{font-size:11.5px;color:var(--oe-txt3,#8a99ad);line-height:1.7;background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.18);border-radius:9px;padding:9px 11px;margin-bottom:11px}',
      '#panel-license .lo-note.warn{background:rgba(251,191,36,.06);border-color:rgba(251,191,36,.24);color:#fcd34d}',
      '#panel-license .lo-featgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
      '#panel-license .lo-feat{display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--oe-line,#243244);border-radius:9px;background:var(--oe-bg2,#0c1420);font-size:12px;cursor:pointer}',
      '#panel-license .lo-feat input{accent-color:#38bdf8}',
      '#panel-license .lo-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:12px}',
      '#panel-license .lo-flow .step{background:var(--oe-bg2,#0c1420);border:1px solid var(--oe-line,#243244);border-radius:10px;padding:10px 11px;min-width:0}',
      '#panel-license .lo-flow .step .n{font-size:10px;font-weight:800;color:#38bdf8;letter-spacing:.06em}',
      '#panel-license .lo-flow .step .t{font-size:12.5px;font-weight:800;color:var(--oe-txt,#e6edf5);margin:3px 0 4px}',
      '#panel-license .lo-flow .step .d{font-size:10.5px;color:var(--oe-txt3,#8a99ad);line-height:1.6}',
      '.lo-mask{position:fixed;inset:0;z-index:12000;background:rgba(3,7,14,.72);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:7vh 16px 16px;overflow:auto}',
      '.lo-modal{width:min(620px,100%);background:#0d1624;border:1px solid rgba(148,163,184,.24);border-radius:14px;box-shadow:0 30px 80px -30px #000;color:#e6edf5;font-size:13px}',
      '.lo-modal.wide{width:min(980px,100%)}',
      '.lo-modal-h{display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid rgba(148,163,184,.16)}',
      '.lo-modal-h b{font-size:14px}',
      '.lo-modal-h .lo-x{margin-left:auto;border:0;background:transparent;color:#8a99ad;font-size:15px;cursor:pointer;padding:2px 6px;border-radius:7px}',
      '.lo-modal-h .lo-x:hover{background:rgba(148,163,184,.14);color:#e6edf5}',
      '.lo-modal-b{padding:15px;max-height:64vh;overflow:auto}',
      '.lo-modal-f{display:flex;justify-content:flex-end;gap:8px;padding:0 15px 15px}',
      '.lo-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.lo-form .full{grid-column:1/-1}',
      '.lo-form label{display:block;font-size:11px;color:#8a99ad;font-weight:700;margin-bottom:4px}',
      '.lo-form input,.lo-form select,.lo-form textarea{width:100%;min-height:32px;padding:0 9px;border-radius:8px;border:1px solid rgba(148,163,184,.24);background:#081019;color:#e6edf5;font-size:12.5px}',
      '.lo-form textarea{min-height:86px;padding:8px 9px;line-height:1.6;font-family:Consolas,monospace;font-size:11.5px}',
      '.lo-form input:focus,.lo-form select:focus,.lo-form textarea:focus{outline:none;border-color:rgba(56,189,248,.6)}',
      '.lo-keys-out{width:100%;min-height:130px;background:#050b12;border:1px dashed rgba(56,189,248,.4);border-radius:10px;color:#7dd3fc;font-family:Consolas,monospace;font-size:12.5px;line-height:1.9;padding:10px;white-space:pre;overflow:auto}',
      '.lo-mini{font-size:10.5px;color:#8a99ad}',
      '@media (max-width:1180px){#panel-license .lo-stats{grid-template-columns:repeat(3,minmax(0,1fr))}#panel-license .lo-featgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------------- 数据加载 ---------------- */
  function ensureOverview(force) {
    if (state.overview && !force) return Promise.resolve(state.overview);
    return get('/license/ops/overview').then(function (d) {
      state.overview = d;
      state.plans = d.plan_defs || state.plans;
      return d;
    });
  }
  function ensureKeys(force) {
    if (state.keys.items.length && !force) return Promise.resolve(state.keys);
    var k = state.keys;
    var qs = '?page=' + k.page + '&size=' + k.size + '&q=' + encodeURIComponent(k.q) +
      '&status=' + encodeURIComponent(k.status) + '&plan=' + encodeURIComponent(k.plan);
    return get('/license/ops/keys' + qs).then(function (d) {
      k.items = d.items || []; k.total = d.total || 0;
      return k;
    });
  }
  function ensureDevices(force) {
    if (state.devices.items.length && !force) return Promise.resolve(state.devices);
    var d = state.devices;
    var qs = '?page=' + d.page + '&size=' + d.size + '&status=' + encodeURIComponent(d.status) +
      '&q=' + encodeURIComponent(d.q);
    return get('/license/ops/devices' + qs).then(function (r) {
      d.items = r.items || []; d.total = r.total || 0;
      return d;
    });
  }
  function ensureOrders(force) {
    if (state.orders.items.length && !force) return Promise.resolve(state.orders);
    var o = state.orders;
    var qs = '?page=' + o.page + '&size=' + o.size + '&status=' + encodeURIComponent(o.status) +
      '&q=' + encodeURIComponent(o.q);
    return get('/license/ops/orders' + qs).then(function (r) {
      o.items = r.items || []; o.total = r.total || 0; o.stats = r.stats || null;
      return o;
    });
  }
  function ensureAlerts(force) {
    if (state.alerts.items.length && !force) return Promise.resolve(state.alerts);
    var a = state.alerts;
    var qs = '?page=' + a.page + '&size=' + a.size + '&status=' + encodeURIComponent(a.status);
    return get('/license/ops/alerts' + qs).then(function (r) {
      a.items = r.items || []; a.total = r.total || 0; a.counts = r.counts || {};
      return a;
    });
  }
  function ensureConfig(force) {
    if (state.config && !force) return Promise.resolve(state.config);
    return get('/license/ops/config').then(function (d) {
      state.config = d; state.plans = d.plan_defs || state.plans;
      return d;
    });
  }

  /* ---------------- 骨架 ---------------- */
  function build() {
    var panel = $('#panel-license');
    if (!panel) return false;
    injectCss();
    panel.innerHTML =
      '<div class="lo-head"><div class="grow">' +
      '<div class="lo-title">🔐 软件授权 <span class="pill">Key · 设备 · 风控</span>' +
      '<span class="lo-tag info" id="loSignState">签名服务检测中…</span></div>' +
      '<div class="lo-sub">星籁剪辑独立销售授权：License Key → 绑定账号 → 激活设备（座位数可配）→ 订阅到期；' +
      '心跳续期 + 签名 License Token（离线校验）+ 远程功能开关 + 吊销/换绑 + 异常多 IP 自动封禁 + 隐形溯源水印。' +
      '盗版本体文件可运行但拿不到云端价值。</div></div>' +
      '<div class="lo-actions">' +
      '<button type="button" class="lo-btn" id="loRefresh">↻ 刷新</button>' +
      '<button type="button" class="lo-btn ghost" id="loExport">⬇ 导出 CSV</button>' +
      '<button type="button" class="lo-btn primary" id="loGen">＋ 生成 Key</button>' +
      '</div></div>' +
      '<div class="lo-tabs" id="loTabs">' +
      ['overview', 'keys', 'devices', 'orders', 'alerts', 'flags'].map(function (k) {
        var label = { overview: '概览', keys: 'Key 管理', devices: '设备台账', orders: '订单', alerts: '异常告警', flags: '功能开关' }[k];
        return '<button type="button" data-sub="' + k + '">' + label + '<span class="n" data-badge="' + k + '" hidden>0</span></button>';
      }).join('') +
      '</div><div id="loPane"></div>';
    bindClick(panel, '#loTabs button', function (b) { switchSub(b.getAttribute('data-sub')); });
    $('#loRefresh', panel).addEventListener('click', function () { refreshAll(); });
    $('#loExport', panel).addEventListener('click', showExportMenu);
    $('#loGen', panel).addEventListener('click', showGenerate);
    BUILT = true;
    return true;
  }

  function switchSub(sub) {
    state.sub = sub;
    var hash = '#/license' + (sub !== 'overview' ? '?sub=' + sub : '');
    try { history.replaceState(null, '', hash); } catch (e) { }
    renderSub(true);
  }

  function setBadge(name, n) {
    var el = $('[data-badge="' + name + '"]');
    if (!el) return;
    if (!n) { el.hidden = true; el.textContent = '0'; }
    else { el.hidden = false; el.textContent = String(n); }
  }

  function renderSub(force) {
    var pane = $('#loPane');
    if (!pane) return;
    $$('#loTabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-sub') === state.sub);
    });
    var fn = { overview: paneOverview, keys: paneKeys, devices: paneDevices, orders: paneOrders,
      alerts: paneAlerts, flags: paneFlags }[state.sub] || paneOverview;
    pane.innerHTML = '<div class="lo-empty">加载中…</div>';
    fn(force);
  }

  function refreshAll() {
    state.loaded = {};
    state.overview = null;
    ['keys', 'devices', 'orders', 'alerts'].forEach(function (k) {
      state[k].items = []; state[k].page = 1;
    });
    state.config = null;
    ensureOverview(true).then(function () {
      updateHeadState();
      renderSub(true);
      toast('已刷新', 'ok', 1400);
    }).catch(function (e) { toast('刷新失败：' + errText(e), 'err', 4000); });
  }

  function updateHeadState() {
    var el = $('#loSignState');
    if (!el || !state.overview) return;
    el.textContent = '签名服务正常 · 数据实时';
    el.className = 'lo-tag ok';
  }

  /* ---------------- 概览 ---------------- */
  function paneOverview(force) {
    ensureOverview(force).then(function (d) {
      updateHeadState();
      var lic = d.licenses || {}, dev = d.devices || {}, al = d.alerts || {}, od = d.orders || {};
      var autoBan = (d.anomaly || {}).auto_ban_enabled;
      var planRows = Object.keys(d.plan_defs || {});
      var planTotal = Math.max(1, lic.total || 0);
      var html =
        '<div class="lo-stats">' +
        statCard('#38bdf8', '🔑', 'Key 总数', num(lic.total), '正常 ' + num(lic.active) + ' · 未激活 ' + num(lic.unactivated)) +
        statCard('#34d399', '✅', '正常 License', num(lic.active), '已激活账号 ' + num(lic.active)) +
        statCard('#fb7185', '⛔', '已吊销', num(lic.revoked), '自动封禁 ' + (autoBan ? '已开启' : '未开启')) +
        statCard('#fbbf24', '⌛', '已过期', num(lic.expired), '到期需续费') +
        statCard('#a78bfa', '💻', '活跃设备', num(dev.active), '在线 ' + num(dev.online) + ' · 总设备 ' + num(dev.total)) +
        statCard(al.open ? '#fb7185' : '#38bdf8', '🚨', '未处理告警', num(al.open), '窗口 ' + (d.anomaly || {}).window_min + ' 分钟') +
        '</div>' +
        '<div class="lo-flow">' +
        '<div class="step"><div class="n">STEP 01</div><div class="t">生成 Key</div><div class="d">按套餐/座位/天数批量生成，明文只出现一次（库里只存哈希）</div></div>' +
        '<div class="step"><div class="n">STEP 02</div><div class="t">激活设备</div><div class="d">客户端机器指纹 + 登录账号绑定，最多 N 台（可加座）</div></div>' +
        '<div class="step"><div class="n">STEP 03</div><div class="t">心跳续期</div><div class="d">24h 心跳拿签名 Token；离线最长 7 天后锁云端功能</div></div>' +
        '<div class="step"><div class="n">STEP 04</div><div class="t">远程控制</div><div class="d">吊销 / 换绑 / 功能开关 / 异常自动封禁 / 溯源水印</div></div>' +
        '</div>' +
        '<div class="oe-grid g2">' +
        '<div class="lo-card"><div class="lo-card-h"><h3>📦 套餐分布</h3><span class="right">' +
        '<span class="lo-tag muted">' + num(lic.total) + ' 个 License</span></span></div><div class="lo-card-b">' +
        planRows.map(function (p) {
          var n = (lic.by_plan || {})[p] || 0;
          var pct = Math.round(n / planTotal * 100);
          var def = (d.plan_defs || {})[p] || {};
          return '<div style="display:flex;align-items:center;gap:9px;margin:9px 0">' +
            '<div style="width:78px;font-size:12px;font-weight:700">' + esc(def.name || p) + '</div>' +
            '<div class="lo-prog" style="flex:1"><i style="width:' + Math.max(2, pct) + '%"></i></div>' +
            '<div style="width:64px;text-align:right;font-size:11.5px;font-variant-numeric:tabular-nums">' +
            num(n) + ' · ' + pct + '%</div></div>';
        }).join('') +
        '<div class="lo-mini" style="margin-top:9px">座位默认：' + planRows.map(function (p) {
          return esc(((d.plan_defs || {})[p] || {}).name) + ' ' + (((d.plan_defs || {})[p] || {}).seats || '-') + ' 台';
        }).join(' · ') + '</div>' +
        '</div></div>' +
        '<div class="lo-card"><div class="lo-card-h"><h3>💰 订单与收入</h3><span class="right">' +
        '<span class="lo-tag ok">已支付 ' + num(od.paid) + '</span></span></div><div class="lo-card-b">' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
        '<div><div class="lo-mini">已支付金额</div><div style="font-size:22px;font-weight:800;color:#6ee7b7">' + money(od.revenue_cents) + '</div></div>' +
        '<div><div class="lo-mini">订单总数</div><div style="font-size:22px;font-weight:800">' + num(od.total) + '</div></div>' +
        '<div><div class="lo-mini">异常告警</div><div style="font-size:22px;font-weight:800;color:' + (al.open ? '#fb7185' : '#34d399') + '">' + num(al.open) + '</div></div>' +
        '</div><div class="lo-mini" style="margin-top:10px">手工登记订单即可发放积分（与账号/积分打通）；对接支付后由回调自动登记。</div>' +
        '</div></div>' +
        '</div>' +
        '<div class="lo-card"><div class="lo-card-h"><h3>🧾 最近授权事件</h3><span class="right">' +
        '<span class="lo-tag muted">审计可查</span></span></div>' +
        '<div class="lo-table-wrap"><table class="lo-table"><thead><tr><th>时间</th><th>事件</th><th>License</th>' +
        '<th>设备</th><th>IP</th><th>详情</th></tr></thead><tbody>' +
        ((d.recent_events || []).length ? d.recent_events.map(function (e) {
          return '<tr><td class="mono">' + fmtTs(e.created_at_str) + '</td><td>' + eventBadge(e.event) + '</td>' +
            '<td class="mono">#' + num(e.license_id) + '</td><td class="mono">' + esc((e.device_id || '').slice(0, 14)) + '</td>' +
            '<td class="mono">' + esc(e.ip || '—') + '</td>' +
            '<td style="max-width:360px;word-break:break-all">' + esc(String(e.detail || '').slice(0, 150)) + '</td></tr>';
        }).join('') : '<tr><td colspan="6"><div class="lo-empty">暂无事件</div></td></tr>') +
        '</tbody></table></div></div>';
      $('#loPane').innerHTML = html;
      setBadge('keys', lic.total);
      setBadge('alerts', al.open);
      setBadge('devices', dev.active);
      bindClick($('#loPane'), '[data-jump]', function (b) { switchSub(b.getAttribute('data-jump')); });
    }).catch(function (e) {
      $('#loPane').innerHTML = '<div class="lo-empty">加载概览失败：' + esc(errText(e)) + '</div>';
    });
  }

  function statCard(color, ico, label, value, foot) {
    return '<div class="lo-stat" style="--sc:' + color + '"><div class="l">' + ico + ' ' + esc(label) + '</div>' +
      '<div class="v">' + value + '</div><div class="f">' + esc(foot || '') + '</div></div>';
  }

  var EVENT_MAP = {
    activate: ['激活', 'ok'], activate_fail: ['激活失败', 'warn'], bind: ['绑定账号', 'info'],
    heartbeat: ['心跳', 'muted'], deactivate: ['释放设备', 'muted'], revoke: ['吊销', 'bad'],
    unrevoke: ['恢复', 'ok'], extend: ['延长', 'info'], seats_change: ['加座', 'info'],
    rebind: ['换绑', 'violet'], kick: ['踢下线', 'warn'], device_ban: ['封禁设备', 'bad'],
    device_unban: ['解封设备', 'info'], auto_ban: ['自动封禁', 'bad'], anomaly: ['异常告警', 'warn'],
    watermark_issue: ['发放水印', 'violet'], trace_lookup: ['溯源查询', 'info'],
    unbind_account: ['解绑账号', 'muted']
  };
  function eventBadge(e) {
    var m = EVENT_MAP[e] || [e, 'muted'];
    return badge(m[0], m[1], e);
  }

  /* ---------------- Key 管理 ---------------- */
  function paneKeys(force) {
    Promise.all([ensureKeys(force), ensureOverview(false)]).then(function () {
    updateHeadState();
    var k = state.keys;
    var chips = [['', '全部'], ['active', '正常'], ['revoked', '已吊销'], ['expired', '已过期']];
    var html =
      '<div class="lo-stats">' +
      statCard('#38bdf8', '🔑', 'Key 总数', num((state.overview && state.overview.licenses.total) || k.total), '按状态筛选') +
      statCard('#34d399', '✅', '正常', num((state.overview && state.overview.licenses.active) || '—'), '可激活/心跳') +
      statCard('#fb7185', '⛔', '已吊销', num((state.overview && state.overview.licenses.revoked) || '—'), '心跳即锁云端') +
      statCard('#fbbf24', '⌛', '已过期', num((state.overview && state.overview.licenses.expired) || '—'), '续费/延长恢复') +
      statCard('#a78bfa', '🎟️', '未激活', num((state.overview && state.overview.licenses.unactivated) || '—'), '已售未激活') +
      statCard('#38bdf8', '💻', '活跃设备', num((state.overview && state.overview.devices.active) || '—'), '座位占用中') +
      '</div>' +
      '<div class="lo-card"><div class="lo-card-h"><h3>🔑 Key 列表</h3><span class="right">' +
      '<div class="lo-bar" style="margin:0">' +
      '<input class="lo-input" id="loKeyQ" placeholder="搜索 Key 前缀 / 订单号 / 备注" style="width:230px" value="' + esc(k.q) + '">' +
      '<select class="lo-select" id="loKeyPlan"><option value="">全部套餐</option>' +
      Object.keys(state.plans || {}).map(function (p) {
        return '<option value="' + p + '"' + (k.plan === p ? ' selected' : '') + '>' + esc((state.plans[p] || {}).name || p) + '</option>';
      }).join('') + '</select>' +
      '<button class="lo-btn sm" id="loKeySearch">搜索</button>' +
      '</div></span></div>' +
      '<div class="lo-card-b" style="padding-bottom:4px"><div class="lo-bar">' +
      chips.map(function (c) {
        return '<button class="lo-btn sm ' + (k.status === c[0] ? 'primary' : 'ghost') + '" data-status="' + c[0] + '">' + c[1] + '</button>';
      }).join('') +
      '<span class="lo-mini" style="margin-left:auto">共 <b style="color:#e6edf5">' + num(k.total) + '</b> 条；Key 明文只在生成时出现一次</span>' +
      '</div></div>' +
      '<div class="lo-table-wrap"><table class="lo-table"><thead><tr>' +
      '<th>Key（脱敏）</th><th>套餐</th><th>座位</th><th>绑定账号</th><th>状态</th><th>激活时间</th>' +
      '<th>到期时间</th><th class="num">剩余</th><th>订单号</th><th class="actions">操作</th></tr></thead><tbody>' +
      (k.items.length ? k.items.map(function (it) {
        var usedPct = it.seats ? Math.min(100, Math.round(it.seats_used / it.seats * 100)) : 0;
        return '<tr data-lic-id="' + it.id + '">' +
          '<td class="strong"><div class="mono" style="color:#e6edf5">' + esc(it.key_masked) + '</div>' +
          '<div class="lo-mini">#' + it.id + (it.batch_id ? ' · ' + esc(it.batch_id) : '') + '</div></td>' +
          '<td>' + planBadge(it.plan) + '</td>' +
          '<td><div style="display:flex;align-items:center;gap:6px"><b style="color:#e6edf5">' + it.seats_used + '</b>/' + it.seats +
          '<div class="lo-prog" style="width:48px"><i style="width:' + usedPct + '%"></i></div></div></td>' +
          '<td>' + (it.account ? '<div class="strong">' + esc(it.account.name || '账号' + it.account.id) + '</div>' +
            '<div class="lo-mini mono">' + esc(it.account.phone_masked || '') + '</div>' :
            '<span class="lo-tag warn">未绑定</span>') + '</td>' +
          '<td>' + statusBadge(it.status) + '</td>' +
          '<td class="mono">' + fmtTs(it.activated_at_str) + '</td>' +
          '<td class="mono">' + (it.expires_at_str ? fmtTs(it.expires_at_str) : '—') + '</td>' +
          '<td class="num">' + (it.days_remaining == null ? '—' : it.days_remaining + '<small style="color:#8a99ad"> 天</small>') + '</td>' +
          '<td class="mono">' + esc(it.order_no || '—') + '</td>' +
          '<td class="actions">' +
          '<button class="lo-btn sm" data-act="detail" data-id="' + it.id + '">详情</button>' +
          (it.status === 'revoked'
            ? '<button class="lo-btn sm primary" data-act="unrevoke" data-id="' + it.id + '">恢复</button>'
            : '<button class="lo-btn sm danger" data-act="revoke" data-id="' + it.id + '">吊销</button>') +
          '<button class="lo-btn sm" data-act="extend" data-id="' + it.id + '">延长</button>' +
          '<button class="lo-btn sm" data-act="seats" data-id="' + it.id + '">加座</button>' +
          '<button class="lo-btn sm" data-act="rebind" data-id="' + it.id + '">换绑</button>' +
          '</td></tr>';
      }).join('') : '<tr><td colspan="10"><div class="lo-empty">还没有 License Key：点右上角「＋ 生成 Key」批量生成</div></td></tr>') +
      '</tbody></table></div>' +
      pager(k) +
      '</div>';
    $('#loPane').innerHTML = html;
    setBadge('keys', k.total);
    if (state.overview) setBadge('alerts', (state.overview.alerts || {}).open);
    var q = $('#loKeyQ'), plan = $('#loKeyPlan');
    var doSearch = function () {
      k.q = (q.value || '').trim(); k.plan = plan.value || ''; k.page = 1; k.items = [];
      paneKeys(true);
    };
    $('#loKeySearch').addEventListener('click', doSearch);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    plan.addEventListener('change', doSearch);
    bindClick($('#loPane'), '[data-status]', function (b) {
      k.status = b.getAttribute('data-status'); k.page = 1; k.items = []; paneKeys(true);
    });
    bindClick($('#loPane'), '[data-page]', function (b) {
      k.page = parseInt(b.getAttribute('data-page'), 10) || 1; k.items = []; paneKeys(true);
    });
    bindClick($('#loPane'), '[data-act]', function (b) {
      var act = b.getAttribute('data-act');
      var id = parseInt(b.getAttribute('data-id'), 10);
      if (act === 'detail') return showKeyDetail(id);
      if (act === 'revoke') return showRevoke(id);
      if (act === 'unrevoke') return doAction('/license/ops/keys/' + id + '/unrevoke', {}, '已恢复');
      if (act === 'extend') return showExtend(id);
      if (act === 'seats') return showSeats(id);
      if (act === 'rebind') return showRebind(id);
    });
    }).catch(function (e) {
      $('#loPane').innerHTML = '<div class="lo-empty">加载 Key 列表失败：' + esc(errText(e)) + '</div>';
    });
  }

  function pager(o) {
    var pages = Math.max(1, Math.ceil((o.total || 0) / (o.size || 20)));
    return '<div class="lo-pager">共 <b>' + num(o.total) + '</b> 条 · 第 <b>' + o.page + '</b>/' + pages + ' 页' +
      '<button class="lo-btn sm" data-page="' + Math.max(1, o.page - 1) + '"' + (o.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<button class="lo-btn sm" data-page="' + Math.min(pages, o.page + 1) + '"' + (o.page >= pages ? ' disabled' : '') + '>下一页</button></div>';
  }

  function doAction(path, body, okMsg) {
    return post(path, body).then(function (d) {
      toast(okMsg || '操作成功');
      state.loaded = {}; state.overview = null; state.keys.items = []; state.devices.items = [];
      renderSub(true);
      return d;
    }).catch(function (e) { toast('失败：' + errText(e), 'err', 4200); });
  }

  function showRevoke(id) {
    openModal('吊销 License #' + id,
      '<div class="lo-note warn">吊销后：该 License 所有设备下一次心跳即锁定云端功能（配方/素材库/云 AI/更新），' +
      '本地剪辑仍可用；可在列表点「恢复」撤销。</div>' +
      '<div class="lo-form"><div class="full"><label>吊销原因（写入审计）</label>' +
      '<input id="loRevokeReason" placeholder="如：退款 / 违规多设备 / 客户要求" value="管理员吊销"></div></div>',
      [{ label: '取消' }, { label: '确认吊销', cls: 'danger', fn: function (btn, mask) {
        var reason = ($('#loRevokeReason', mask) || {}).value || '管理员吊销';
        doAction('/license/ops/keys/' + id + '/revoke', { reason: reason }, '已吊销');
      } }]);
  }

  function showExtend(id) {
    openModal('延长 License #' + id,
      '<div class="lo-note">从当前到期时间（已过期则从今天）顺延。企业版常用 365 天续费。</div>' +
      '<div class="lo-form"><div><label>延长天数</label><select id="loExtendDays">' +
      [30, 90, 180, 365, 730].map(function (d) { return '<option value="' + d + '"' + (d === 365 ? ' selected' : '') + '>' + d + ' 天</option>'; }).join('') +
      '</select></div><div><label>自定义天数（1~3650，留空用左侧）</label>' +
      '<input id="loExtendCustom" type="number" min="1" max="3650" placeholder="如 365"></div></div>',
      [{ label: '取消' }, { label: '确认延长', cls: 'primary', fn: function (btn, mask) {
        var custom = parseInt(($('#loExtendCustom', mask) || {}).value || '0', 10);
        var days = custom > 0 ? custom : parseInt($('#loExtendDays', mask).value, 10);
        doAction('/license/ops/keys/' + id + '/extend', { days: days }, '已延长 ' + days + ' 天');
      } }]);
  }

  function showSeats(id) {
    openModal('调整座位数 #' + id,
      '<div class="lo-note">加座后允许更多设备同时激活；已占用的设备不会被自动踢下线。</div>' +
      '<div class="lo-form"><div><label>座位数（1~100）</label>' +
      '<input id="loSeats" type="number" min="1" max="100" value="' + ((state.keys.items.filter(function (x) { return x.id === id; })[0] || {}).seats || 2) + '"></div></div>',
      [{ label: '取消' }, { label: '保存', cls: 'primary', fn: function (btn, mask) {
        doAction('/license/ops/keys/' + id + '/seats', { seats: parseInt(($('#loSeats', mask) || {}).value, 10) }, '座位数已更新');
      } }]);
  }

  function showRebind(id) {
    var it = state.keys.items.filter(function (x) { return x.id === id; })[0] || {};
    get('/license/ops/keys/' + id).then(function (d) {
      var lic = d.license || {};
      var devs = (lic.devices || []).filter(function (x) { return x.status === 'active'; });
      openModal('换绑 / 解绑设备 · License #' + id,
        '<div class="lo-note">选择要释放的旧设备（踢下线）→ 新设备重新激活即占用该座位。也可一键解绑全部设备。</div>' +
        (devs.length ? '<div class="lo-form"><div class="full"><label>在线设备</label><select id="loRebindDev">' +
          devs.map(function (x) {
            return '<option value="' + esc(x.device_id) + '">' + esc(x.device_name || '未命名') + ' · ' +
              esc(x.os || '') + ' · ' + esc((x.device_id || '').slice(0, 14)) + '… · ' + esc(x.last_seen_str || '') + '</option>';
          }).join('') + '</select></div></div>'
          : '<div class="lo-empty">当前没有活跃设备（可让新设备直接激活）</div>'),
        [{ label: '取消' },
          { label: '解绑全部设备', cls: 'danger', fn: function () {
            doAction('/license/ops/keys/' + id + '/unbind', {}, '全部设备已解绑');
          } }].concat(devs.length ? [{
            label: '释放所选设备', cls: 'primary', fn: function (btn, mask) {
              var dev = ($('#loRebindDev', mask) || {}).value || '';
              doAction('/license/ops/keys/' + id + '/rebind', { device_id: dev }, '已释放设备，可换绑新设备');
            }
          }] : []));
    }).catch(function (e) { toast('加载设备失败：' + errText(e), 'err'); });
  }

  function showKeyDetail(id) {
    get('/license/ops/keys/' + id).then(function (d) {
      var lic = d.license || {};
      var acc = lic.account;
      var html = '<div class="oe-grid g2">' +
        '<div><div class="lo-kv">' +
        '<div class="k">License ID</div><div class="v">#' + lic.id + ' · ' + esc(lic.key_masked) + '</div>' +
        '<div class="k">套餐</div><div class="v">' + planBadge(lic.plan) + ' · 座位 ' + lic.seats_used + '/' + lic.seats + ' · ' + lic.days + ' 天</div>' +
        '<div class="k">状态</div><div class="v">' + statusBadge(lic.status) + '</div>' +
        '<div class="k">绑定账号</div><div class="v">' + (acc ? esc(acc.name || acc.phone_masked) + '（#' + acc.id + ' · ' + esc(acc.workspace_id) + '）' : '<span class="lo-tag warn">未绑定</span>') + '</div>' +
        '<div class="k">激活 / 到期</div><div class="v">' + fmtTs(lic.activated_at_str) + ' → ' + fmtTs(lic.expires_at_str) + '（剩 ' + (lic.days_remaining == null ? '—' : lic.days_remaining) + ' 天）</div>' +
        '<div class="k">订单 / 批次</div><div class="v">' + esc(lic.order_no || '—') + ' · ' + esc(lic.batch_id || '—') + '</div>' +
        '<div class="k">备注</div><div class="v">' + esc(lic.note || '—') + '</div>' +
        '<div class="k">吊销原因</div><div class="v">' + esc(lic.revoke_reason || '—') + '</div>' +
        '<div class="k">功能开关</div><div class="v">' + Object.keys(lic.features || {}).map(function (f) {
          return badge(f, lic.features[f] ? 'ok' : 'muted');
        }).join(' ') + '</div>' +
        '</div></div>' +
        '<div><div class="lo-mini" style="margin-bottom:6px">设备（' + (lic.devices || []).length + '）</div>' +
        '<div class="lo-table-wrap" style="max-height:230px"><table class="lo-table" style="min-width:520px"><thead><tr><th>设备</th><th>状态</th><th>最后心跳</th><th class="actions">操作</th></tr></thead><tbody>' +
        ((lic.devices || []).length ? lic.devices.map(function (dv) {
          return '<tr><td><div class="strong">' + esc(dv.device_name || '未命名') + '</div>' +
            '<div class="mono lo-mini">' + esc(dv.device_id.slice(0, 22)) + '…</div></td>' +
            '<td>' + statusBadge(dv.status) + '</td><td class="mono">' + fmtTs(dv.last_seen_str) + '</td>' +
            '<td class="actions"><button class="lo-btn sm" data-dev-act="kick" data-dev-id="' + dv.id + '">踢下线</button>' +
            '<button class="lo-btn sm danger" data-dev-act="ban" data-dev-id="' + dv.id + '">封禁</button></td></tr>';
        }).join('') : '<tr><td colspan="4"><div class="lo-empty">暂无设备</div></td></tr>') +
        '</tbody></table></div>' +
        '<div class="lo-mini" style="margin:10px 0 5px">最近事件（' + (lic.events || []).length + '）</div>' +
        '<div class="lo-table-wrap" style="max-height:180px"><table class="lo-table" style="min-width:520px"><thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead><tbody>' +
        ((lic.events || []).length ? lic.events.map(function (e) {
          return '<tr><td class="mono">' + fmtTs(e.created_at_str) + '</td><td>' + eventBadge(e.event) + '</td>' +
            '<td style="max-width:260px;word-break:break-all">' + esc(String(e.detail || '').slice(0, 140)) + '</td></tr>';
        }).join('') : '<tr><td colspan="3"><div class="lo-empty">暂无事件</div></td></tr>') +
        '</tbody></table></div></div></div>';
      var mask = openModal('License 详情 #' + lic.id, html, [{ label: '关闭' }, {
        label: '吊销', cls: 'danger', fn: function () { showRevoke(lic.id); }
      }], true);
      bindClick(mask, '[data-dev-act]', function (b) {
        var act = b.getAttribute('data-dev-act'), dv = b.getAttribute('data-dev-id');
        post('/license/ops/devices/' + dv + '/' + act, { reason: act === 'ban' ? '管理员封禁' : '' })
          .then(function () { toast('设备已' + (act === 'ban' ? '封禁' : '踢下线')); state.keys.items = []; showKeyDetail(lic.id); })
          .catch(function (e) { toast('失败：' + errText(e), 'err'); });
      });
    }).catch(function (e) { toast('加载详情失败：' + errText(e), 'err', 4000); });
  }

  function showGenerate() {
    var plans = state.plans || {};
    var ids = Object.keys(plans);
    openModal('批量生成 License Key',
      '<div class="lo-note">Key 明文只在本弹窗出现一次（立即复制/下载）；数据库只存哈希与前缀，事后无法找回明文。' +
      '默认按套餐给座位数与天数，可自定义。</div>' +
      '<div class="lo-form">' +
      '<div><label>数量（1~200）</label><input id="loGenCount" type="number" min="1" max="200" value="3"></div>' +
      '<div><label>套餐</label><select id="loGenPlan">' + (ids.length ? ids : ['trial', 'pro', 'enterprise']).map(function (p) {
        var def = plans[p] || {};
        return '<option value="' + p + '"' + (p === 'pro' ? ' selected' : '') + '>' + esc(def.name || p) +
          '（默认 ' + (def.seats || 2) + ' 台 / ' + (def.days || 365) + ' 天）</option>';
      }).join('') + '</select></div>' +
      '<div><label>座位数</label><input id="loGenSeats" type="number" min="1" max="100" placeholder="默认按套餐"></div>' +
      '<div><label>有效天数</label><input id="loGenDays" type="number" min="1" max="3650" placeholder="默认按套餐"></div>' +
      '<div><label>订单号（可选）</label><input id="loGenOrder" placeholder="对接支付后回填"></div>' +
      '<div><label>备注（可选）</label><input id="loGenNote" placeholder="如：抖音渠道 3 套"></div>' +
      '</div>',
      [{ label: '取消' }, { label: '生成', cls: 'primary', fn: function (btn, mask) {
        var body = {
          count: parseInt(($('#loGenCount', mask) || {}).value || '1', 10),
          plan: ($('#loGenPlan', mask) || {}).value || 'pro',
          order_no: ($('#loGenOrder', mask) || {}).value || '',
          note: ($('#loGenNote', mask) || {}).value || ''
        };
        var seats = parseInt(($('#loGenSeats', mask) || {}).value || '0', 10);
        var days = parseInt(($('#loGenDays', mask) || {}).value || '0', 10);
        if (seats > 0) body.seats = seats;
        if (days > 0) body.days = days;
        btn.disabled = true; btn.textContent = '生成中…';
        post('/license/ops/keys/generate', body).then(function (d) {
          closeModal();
          showGenerated(d);
          state.keys.items = []; state.overview = null;
        }).catch(function (e) {
          btn.disabled = false; btn.textContent = '生成';
          toast('生成失败：' + errText(e), 'err', 4500);
        });
        return false;
      } }], true);
  }

  function showGenerated(d) {
    var body = '<div class="lo-note">批次 <b>' + esc(d.batch_id) + '</b> · ' + d.plan + ' · ' + d.seats + ' 台 / ' + d.days + ' 天 · ' +
      '共 <b>' + d.count + '</b> 个。请立即复制或下载 CSV。</div>' +
      '<textarea class="lo-keys-out" id="loKeysOut" readonly>' + esc(d.keys_text || '') + '</textarea>';
    openModal('Key 生成成功（明文仅此一次）', body, [
      { label: '复制全部', cls: 'primary', fn: function (btn, mask) {
        copyText(d.keys_text || ''); return false;
      } },
      { label: '下载 CSV', cls: 'lime', fn: function () {
        downloadFile('xinglai-license-keys-' + d.batch_id + '.csv', d.csv || '', 'text/csv;charset=utf-8');
      } },
      { label: '完成', fn: function () { state.keys.items = []; renderSub(true); } }
    ], true);
  }

  /* ---------------- 设备台账 ---------------- */
  function paneDevices(force) {
    Promise.all([ensureDevices(force), ensureOverview(false)]).then(function () {
    updateHeadState();
    var dv = state.devices;
    var ov = state.overview || {};
    var html =
      '<div class="lo-stats">' +
      statCard('#38bdf8', '💻', '设备总数', num((ov.devices || {}).total || dv.total), '含已解绑/封禁') +
      statCard('#34d399', '🟢', '活跃设备', num((ov.devices || {}).active || '—'), '占用座位') +
      statCard('#38bdf8', '📡', '15 分钟在线', num((ov.devices || {}).online || '—'), '心跳会话') +
      statCard('#fbbf24', '👢', '已踢下线', num(dv.items.filter(function (x) { return x.status === 'kicked'; }).length), '本页统计') +
      statCard('#fb7185', '⛔', '已封禁', num(dv.items.filter(function (x) { return x.status === 'banned'; }).length), '本页统计') +
      statCard('#a78bfa', '🔁', '换绑可用', '—', '后台释放旧设备即可') +
      '</div>' +
      '<div class="lo-card"><div class="lo-card-h"><h3>💻 设备与在线状态</h3><span class="right">' +
      '<input class="lo-input" id="loDevQ" placeholder="搜设备名 / 指纹 / IP / Key 前缀" style="width:220px" value="' + esc(dv.q) + '">' +
      '<select class="lo-select" id="loDevStatus"><option value="">全部状态</option>' +
      ['active', 'kicked', 'banned'].map(function (s) {
        return '<option value="' + s + '"' + (dv.status === s ? ' selected' : '') + '>' +
          ({ active: '活跃', kicked: '已解绑', banned: '已封禁' }[s]) + '</option>';
      }).join('') + '</select><button class="lo-btn sm" id="loDevSearch">搜索</button></span></div>' +
      '<div class="lo-table-wrap"><table class="lo-table"><thead><tr><th>设备</th><th>OS</th><th>License</th><th>套餐</th>' +
      '<th>绑定账号</th><th>IP</th><th>首次 / 最后心跳</th><th>状态</th><th class="actions">操作</th></tr></thead><tbody>' +
      (dv.items.length ? dv.items.map(function (x) {
        return '<tr><td><div class="strong">' + esc(x.device_name || '未命名设备') + '</div>' +
          '<div class="mono lo-mini">' + esc(x.device_id.slice(0, 22)) + '…</div></td>' +
          '<td>' + esc(x.os || '—') + ' <span class="lo-mini">' + esc(x.app_version || '') + '</span></td>' +
          '<td class="mono">#' + x.license_id + '<div class="lo-mini">' + esc(x.key_masked) + '</div></td>' +
          '<td>' + planBadge(x.plan) + '</td>' +
          '<td>' + (x.account ? esc(x.account.name || x.account.phone_masked) : '—') + '</td>' +
          '<td class="mono">' + esc(x.ip || '—') + '</td>' +
          '<td class="mono">' + fmtTs(x.first_seen_str) + '<div class="lo-mini">' + fmtTs(x.last_seen_str) + '</div></td>' +
          '<td>' + statusBadge(x.status) + (x.online ? ' ' + badge('在线', 'ok') : '') + '</td>' +
          '<td class="actions">' +
          (x.status === 'active' ? '<button class="lo-btn sm" data-dev-act="kick" data-dev-id="' + x.id + '">踢下线</button>' : '') +
          (x.status !== 'banned' ? '<button class="lo-btn sm danger" data-dev-act="ban" data-dev-id="' + x.id + '">封禁</button>' : '') +
          (x.status === 'banned' ? '<button class="lo-btn sm" data-dev-act="unban" data-dev-id="' + x.id + '">解封</button>' : '') +
          '</td></tr>';
      }).join('') : '<tr><td colspan="9"><div class="lo-empty">暂无设备：客户端激活后会出现在这里</div></td></tr>') +
      '</tbody></table></div>' + pager(dv) + '</div>';
    $('#loPane').innerHTML = html;
    var doSearch = function () {
      dv.q = ($('#loDevQ') || {}).value || ''; dv.status = ($('#loDevStatus') || {}).value || '';
      dv.page = 1; dv.items = []; paneDevices(true);
    };
    $('#loDevSearch').addEventListener('click', doSearch);
    $('#loDevQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    $('#loDevStatus').addEventListener('change', doSearch);
    bindClick($('#loPane'), '[data-page]', function (b) { dv.page = parseInt(b.getAttribute('data-page'), 10); dv.items = []; paneDevices(true); });
    bindClick($('#loPane'), '[data-dev-act]', function (b) {
      var act = b.getAttribute('data-dev-act'), id = b.getAttribute('data-dev-id');
      var label = { kick: '踢下线', ban: '封禁', unban: '解封' }[act];
      if (act === 'ban' && !confirm('确认封禁该设备？封禁后该设备无法再激活。')) return;
      post('/license/ops/devices/' + id + '/' + act, { reason: act === 'ban' ? '管理员封禁' : '' })
        .then(function () { toast('已' + label); state.devices.items = []; state.overview = null; paneDevices(true); })
        .catch(function (e) { toast('失败：' + errText(e), 'err'); });
    });
    }).catch(function (e) {
      $('#loPane').innerHTML = '<div class="lo-empty">加载设备台账失败：' + esc(errText(e)) + '</div>';
    });
  }

  /* ---------------- 订单 ---------------- */
  function paneOrders(force) {
    Promise.all([ensureOrders(force), ensureOverview(false)]).then(function (arr) {
    var o = arr[0];
    updateHeadState();
      var stats = o.stats || {};
      var html =
        '<div class="lo-stats">' +
        statCard('#34d399', '💰', '已支付总额', money(stats.paid_total_cents), '历史累计') +
        statCard('#38bdf8', '📈', '本月收入', money(stats.month_revenue_cents), timeMonth()) +
        statCard('#a78bfa', '🧾', '订单总数', num(o.total), '手工 + 支付回调') +
        statCard('#fbbf24', '⏳', '待支付', num(o.items.filter(function (x) { return x.status === 'pending'; }).length), '本页统计') +
        statCard('#34d399', '🎁', '赠积分打通', '✓', 'paid 订单自动送积分') +
        statCard('#fb7185', '↩️', '退款 / 取消', num(o.items.filter(function (x) { return x.status === 'refunded' || x.status === 'cancelled'; }).length), '本页统计') +
        '</div>' +
        '<div class="lo-card"><div class="lo-card-h"><h3>🧾 购买记录</h3><span class="right">' +
        '<input class="lo-input" id="loOrdQ" placeholder="订单号 / 发票号 / 渠道" style="width:200px" value="' + esc(o.q) + '">' +
        '<select class="lo-select" id="loOrdStatus"><option value="">全部状态</option>' +
        ['paid', 'pending', 'refunded', 'cancelled'].map(function (s) {
          return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' +
            ({ paid: '已支付', pending: '待支付', refunded: '已退款', cancelled: '已取消' }[s]) + '</option>';
        }).join('') + '</select>' +
        '<button class="lo-btn sm primary" id="loOrdAdd">＋ 登记订单</button></span></div>' +
        '<div class="lo-table-wrap"><table class="lo-table"><thead><tr><th>订单号</th><th>套餐</th><th class="num">金额</th>' +
        '<th>渠道</th><th>发票号</th><th>License / 账号</th><th>状态</th><th>赠积分</th><th>时间</th><th class="actions">操作</th></tr></thead><tbody>' +
        (o.items.length ? o.items.map(function (x) {
          return '<tr><td class="mono strong">' + esc(x.order_no) + '</td><td>' + planBadge(x.plan) + '</td>' +
            '<td class="num">' + money(x.amount_cents) + '</td><td>' + esc(x.channel) + '</td>' +
            '<td class="mono">' + esc(x.invoice_no || '—') + '</td>' +
            '<td class="mono">' + (x.license_id ? '#' + x.license_id : '—') + '<div class="lo-mini">账号 ' + (x.account_id ? '#' + x.account_id : '—') + '</div></td>' +
            '<td>' + orderBadge(x.status) + '</td><td class="num">' + (x.credits ? x.credits : '—') + '</td>' +
            '<td class="mono">' + fmtTs(x.created_at_str) + '</td>' +
            '<td class="actions">' + (x.status === 'pending' ? '<button class="lo-btn sm primary" data-ord-paid="' + x.id + '">标记已支付</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="10"><div class="lo-empty">暂无订单：点「＋ 登记订单」手工登记（对接支付前）</div></td></tr>') +
        '</tbody></table></div>' + pager(o) + '</div>';
      $('#loPane').innerHTML = html;
      var doSearch = function () {
        o.q = ($('#loOrdQ') || {}).value || ''; o.status = ($('#loOrdStatus') || {}).value || '';
        o.page = 1; o.items = []; paneOrders(true);
      };
      $('#loOrdQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
      $('#loOrdStatus').addEventListener('change', doSearch);
      $('#loOrdAdd').addEventListener('click', showOrderAdd);
      bindClick($('#loPane'), '[data-page]', function (b) { o.page = parseInt(b.getAttribute('data-page'), 10); o.items = []; paneOrders(true); });
      bindClick($('#loPane'), '[data-ord-paid]', function (b) {
        post('/license/ops/orders/' + b.getAttribute('data-ord-paid') + '/status', { status: 'paid' })
          .then(function (d) { toast('已标记支付' + (d.credits_status ? ' · 积分：' + d.credits_status : '')); o.items = []; paneOrders(true); })
          .catch(function (e) { toast('失败：' + errText(e), 'err'); });
      });
    }).catch(function (e) { $('#loPane').innerHTML = '<div class="lo-empty">加载订单失败：' + esc(errText(e)) + '</div>'; });
  }

  function timeMonth() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function orderBadge(s) {
    return badge({ paid: '已支付', pending: '待支付', refunded: '已退款', cancelled: '已取消' }[s] || s,
      { paid: 'ok', pending: 'warn', refunded: 'muted', cancelled: 'muted' }[s] || 'muted');
  }
  function showOrderAdd() {
    openModal('登记 License 订单',
      '<div class="lo-note">对接支付前先手工登记；标记已支付后可给关联账号自动赠积分（调用 credits.topup）。</div>' +
      '<div class="lo-form">' +
      '<div><label>订单号（留空自动生成）</label><input id="loOrdNo" placeholder="如 202611210001"></div>' +
      '<div><label>套餐</label><select id="loOrdPlan">' +
      Object.keys(state.plans || {}).map(function (p) { return '<option value="' + p + '"' + (p === 'pro' ? ' selected' : '') + '>' + esc((state.plans[p] || {}).name || p) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>金额（元）</label><input id="loOrdAmount" type="number" min="0" step="0.01" placeholder="如 299"></div>' +
      '<div><label>月数</label><input id="loOrdMonths" type="number" min="1" max="120" value="12"></div>' +
      '<div><label>渠道</label><select id="loOrdChannel"><option value="manual">手工登记</option><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="douyin">抖音</option><option value="enterprise">对公</option></select></div>' +
      '<div><label>发票号（可选）</label><input id="loOrdInvoice"></div>' +
      '<div><label>关联账号 ID（可选）</label><input id="loOrdAccount" placeholder="如 12；右侧可搜索"></div>' +
      '<div><label>关联 License ID（可选）</label><input id="loOrdLicense"></div>' +
      '<div><label>赠积分（可选）</label><input id="loOrdCredits" type="number" min="0" step="0.1"></div>' +
      '<div><label>状态</label><select id="loOrdPaid"><option value="1">直接标记已支付</option><option value="0">先记待支付</option></select></div>' +
      '</div>',
      [{ label: '取消' }, { label: '登记', cls: 'primary', fn: function (btn, mask) {
        var body = {
          order_no: ($('#loOrdNo', mask) || {}).value || '',
          plan: ($('#loOrdPlan', mask) || {}).value || 'pro',
          amount: parseFloat(($('#loOrdAmount', mask) || {}).value || '0') || 0,
          months: parseInt(($('#loOrdMonths', mask) || {}).value || '12', 10),
          channel: ($('#loOrdChannel', mask) || {}).value || 'manual',
          invoice_no: ($('#loOrdInvoice', mask) || {}).value || '',
          credits: parseFloat(($('#loOrdCredits', mask) || {}).value || '0') || 0,
          paid: ($('#loOrdPaid', mask) || {}).value === '1'
        };
        var acc = parseInt(($('#loOrdAccount', mask) || {}).value || '0', 10);
        var lic = parseInt(($('#loOrdLicense', mask) || {}).value || '0', 10);
        if (acc > 0) body.account_id = acc;
        if (lic > 0) body.license_id = lic;
        btn.disabled = true;
        post('/license/ops/orders', body).then(function (d) {
          closeModal();
          toast('订单已登记' + (d.credits_status ? ' · ' + d.credits_status : ''));
          state.orders.items = []; state.overview = null; paneOrders(true);
        }).catch(function (e) { btn.disabled = false; toast('失败：' + errText(e), 'err', 4200); });
        return false;
      } }], true);
  }

  /* ---------------- 异常告警 ---------------- */
  function paneAlerts(force) {
    Promise.all([ensureAlerts(force), ensureOverview(false)]).then(function (arr) {
    var a = arr[0];
    updateHeadState();
      var counts = a.counts || {};
      var html =
        '<div class="lo-stats">' +
        statCard('#fb7185', '🚨', '未处理告警', num(counts.open || 0), '需人工确认') +
        statCard('#fbbf24', '🌐', '多 IP 使用', num(counts.open ? a.items.filter(function (x) { return x.kind === 'multi_ip'; }).length : 0), '同 Key 短时多 IP') +
        statCard('#a78bfa', '💻', '多设备', num(a.items.filter(function (x) { return x.kind === 'multi_device'; }).length), '超过座位数') +
        statCard('#38bdf8', '⚡', '高频激活', num(a.items.filter(function (x) { return x.kind === 'high_frequency'; }).length), '疑似批量试 Key') +
        statCard('#34d399', '✅', '已处理', num(counts.acked || 0), '运营已确认') +
        statCard((state.overview && state.overview.anomaly && state.overview.anomaly.auto_ban_enabled) ? '#fb7185' : '#8a99ad', '🛡️', '自动封禁', (state.overview && state.overview.anomaly && state.overview.anomaly.auto_ban_enabled) ? '已开启' : '未开启', '功能开关中可配置') +
        '</div>' +
        '<div class="lo-card"><div class="lo-card-h"><h3>🚨 异常告警（防盗版风控）</h3><span class="right">' +
        '<select class="lo-select" id="loAlStatus"><option value="open">未处理</option><option value="acked">已处理</option><option value="all">全部</option></select>' +
        '<button class="lo-btn sm" id="loAlMail">✉️ 邮件通道自测</button>' +
        '<button class="lo-btn sm" id="loAlRefresh">↻ 刷新</button></span></div>' +
        '<div class="lo-card-b" style="padding-bottom:0"><div class="lo-note">触发规则（可在「功能开关」调整阈值）：同 Key 在窗口内超 N 个 IP / 活跃设备数超过座位 / 高频激活尝试 → 自动告警并邮件老板；' +
        '开启「自动封禁」后高危告警会直接吊销 License 并封禁设备。</div></div>' +
        '<div class="lo-table-wrap"><table class="lo-table"><thead><tr><th>时间</th><th>类型</th><th>级别</th><th>License</th>' +
        '<th>IP / 设备</th><th>标题与详情</th><th>邮件</th><th>自动处置</th><th>状态</th><th class="actions">操作</th></tr></thead><tbody>' +
        (a.items.length ? a.items.map(function (x) {
          var detail = {};
          try { detail = JSON.parse(x.detail || '{}'); } catch (e) { detail = {}; }
          return '<tr><td class="mono">' + fmtTs(x.created_at_str) + '</td>' +
            '<td>' + alertKindBadge(x.kind) + '</td>' +
            '<td>' + badge(x.level === 'high' ? '高' : x.level === 'medium' ? '中' : '低',
              x.level === 'high' ? 'bad' : x.level === 'medium' ? 'warn' : 'muted') + '</td>' +
            '<td class="mono">#' + (x.license_id || '—') + '<div class="lo-mini">' + esc(x.key_masked || '') + '</div></td>' +
            '<td class="mono">' + esc(x.ip || '—') + '<div class="lo-mini">' + esc((x.device_id || '').slice(0, 16)) + '</div></td>' +
            '<td style="max-width:340px"><div class="strong">' + esc(x.title) + '</div>' +
            '<div class="lo-mini" style="word-break:break-all">IP ' + ((detail.distinct_ips || []).length) + ' 个 · 设备 ' +
            (detail.distinct_devices || []).length + ' 台 · 激活尝试 ' + (detail.activation_attempts || 0) + ' 次 / ' +
            (detail.window_minutes || '—') + ' 分钟</div></td>' +
            '<td>' + (x.email_status ? badge(x.email_status.indexOf('sent') === 0 ? '已发送' : x.email_status.slice(0, 4), x.email_status.indexOf('sent') === 0 ? 'ok' : 'muted', x.email_status) : '—') + '</td>' +
            '<td>' + (x.auto_action ? badge('自动封禁', 'bad', x.auto_action) : badge('仅告警', 'warn')) + '</td>' +
            '<td>' + (x.status === 'open' ? badge('待处理', 'warn') : badge('已处理', 'ok', x.acked_by)) + '</td>' +
            '<td class="actions">' + (x.status === 'open' ? '<button class="lo-btn sm primary" data-al-ack="' + x.id + '">确认处理</button>' : '') +
            (x.license_id ? '<button class="lo-btn sm" data-al-lic="' + x.license_id + '">查 License</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="10"><div class="lo-empty">🎉 暂无异常告警。验收：用同一 Key 从多个 IP 心跳（或超座位激活）即可触发。</div></td></tr>') +
        '</tbody></table></div>' + pager(a) + '</div>';
      $('#loPane').innerHTML = html;
      setBadge('alerts', counts.open || 0);
      $('#loAlStatus').value = a.status;
      var reload = function () {
        a.status = $('#loAlStatus').value; a.page = 1; a.items = []; paneAlerts(true);
      };
      $('#loAlStatus').addEventListener('change', reload);
      $('#loAlRefresh').addEventListener('click', function () { a.items = []; paneAlerts(true); });
      $('#loAlMail').addEventListener('click', function () {
        post('/license/ops/alert/test', {}).then(function (d) {
          toast('邮件已发送 → ' + (d.to || ''), 'ok', 3800);
        }).catch(function (e) { toast('邮件通道：' + errText(e), 'err', 5000); });
      });
      bindClick($('#loPane'), '[data-page]', function (b) { a.page = parseInt(b.getAttribute('data-page'), 10); a.items = []; paneAlerts(true); });
      bindClick($('#loPane'), '[data-al-ack]', function (b) {
        post('/license/ops/alerts/' + b.getAttribute('data-al-ack') + '/ack', {})
          .then(function () { toast('已确认处理'); a.items = []; state.overview = null; paneAlerts(true); })
          .catch(function (e) { toast('失败：' + errText(e), 'err'); });
      });
      bindClick($('#loPane'), '[data-al-lic]', function (b) { showKeyDetail(parseInt(b.getAttribute('data-al-lic'), 10)); });
    }).catch(function (e) { $('#loPane').innerHTML = '<div class="lo-empty">加载告警失败：' + esc(errText(e)) + '</div>'; });
  }

  function alertKindBadge(k) {
    return badge({ multi_ip: '多 IP', multi_device: '多设备', high_frequency: '高频激活' }[k] || k,
      { multi_ip: 'bad', multi_device: 'violet', high_frequency: 'warn' }[k] || 'warn');
  }

  /* ---------------- 功能开关 ---------------- */
  function paneFlags(force) {
    ensureConfig(force).then(function (d) {
      updateHeadState();
      var cfg = d.config || {};
      var feats = cfg.features || {};
      var featDefs = d.features_defs || [];
      var plans = d.plan_defs || {};
      var html =
        '<div class="lo-note">功能开关 = 云端价值的总闸：客户端从激活/心跳/features 接口拿到开关快照并缓存，' +
        '盗版本体文件拿不到有效 License Token 与开关下发，配方 / 素材库 / 云 AI / 更新全部不可用。</div>' +
        '<div class="oe-grid g2">' +
        '<div class="lo-card"><div class="lo-card-h"><h3>🛡️ 风控与异常封禁</h3><span class="right">' +
        '<span class="lo-tag info">修改后实时生效</span></span></div><div class="lo-card-b"><div class="lo-form">' +
        toggleField('loCfgAutoBan', '异常自动封禁（高危告警直接吊销 License）', cfg.auto_ban_enabled) +
        '<div><label>风控窗口（分钟）</label><input id="loCfgWin" type="number" min="5" max="1440" value="' + (cfg.anomaly_window_min || 120) + '"></div>' +
        '<div><label>窗口内最大 IP 数</label><input id="loCfgMaxIp" type="number" min="1" max="50" value="' + (cfg.anomaly_max_ips || 3) + '"></div>' +
        '<div><label>窗口内最大激活尝试</label><input id="loCfgMaxAct" type="number" min="2" max="200" value="' + (cfg.anomaly_max_activations || 8) + '"></div>' +
        '<div><label>告警邮件收件人（空=老板邮箱默认值）</label><input id="loCfgMail" placeholder="' + esc(d.alert_mail_to || '未配置') + '" value="' + esc(cfg.alert_email || '') + '"></div>' +
        '<div><label>心跳周期（秒）</label><input id="loCfgHb" type="number" min="3600" max="604800" value="' + (cfg.heartbeat_ttl || 86400) + '"></div>' +
        '<div><label>离线宽限（天）</label><input id="loCfgGrace" type="number" min="1" max="30" value="' + (cfg.grace_days || 7) + '"></div>' +
        '</div></div></div>' +
        '<div class="lo-card"><div class="lo-card-h"><h3>🎛️ 功能开关（全局）</h3><span class="right">' +
        '<span class="lo-tag ' + (d.smtp_configured ? 'ok' : 'warn') + '">SMTP ' + (d.smtp_configured ? '已配置' : '未配置') + '</span></span></div>' +
        '<div class="lo-card-b"><div class="lo-featgrid">' +
        featDefs.map(function (f) {
          var on = feats[f.key] !== false;
          return '<label class="lo-feat"><input type="checkbox" data-feat="' + f.key + '"' + (on ? ' checked' : '') + '>' +
            '<span>' + esc(f.label) + '</span><span class="lo-mini">' + esc(f.key) + '</span></label>';
        }).join('') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:11px"><button class="lo-btn primary" id="loSaveCfg">保存配置</button>' +
        '<button class="lo-btn" id="loReloadCfg">重新加载</button></div>' +
        '<div class="lo-mini" style="margin-top:9px">套餐功能矩阵：</div><div class="lo-table-wrap"><table class="lo-table" style="min-width:640px"><thead><tr><th>套餐</th><th>座位</th><th>天数</th>' +
        featDefs.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        Object.keys(plans).map(function (p) {
          var pf = (plans[p] || {}).features || {};
          return '<tr><td>' + planBadge(p) + '</td><td>' + ((plans[p] || {}).seats || '—') + '</td><td>' + ((plans[p] || {}).days || '—') + '</td>' +
            featDefs.map(function (f) { return '<td>' + (pf[f.key] ? badge('✓', 'ok') : badge('—', 'muted')) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div></div></div>' +
        '<div class="lo-card"><div class="lo-card-h"><h3>⬆️ 强制更新与隐形水印</h3></div><div class="lo-card-b"><div class="lo-form">' +
        '<div><label>强制更新版本（空=不强制）</label><input id="loCfgFUVer" placeholder="如 2.3.0" value="' + esc(cfg.force_update_version || '') + '"></div>' +
        '<div><label>更新包地址</label><input id="loCfgFUUrl" placeholder="https://…" value="' + esc(cfg.force_update_url || '') + '"></div>' +
        toggleField('loCfgFUMust', '强制更新（低于版本禁止使用云端功能）', cfg.force_update_mandatory) +
        toggleField('loCfgTrace', '隐形溯源水印发放（B 端导出）', cfg.trace_enabled) +
        '</div><div class="lo-note" style="margin:11px 0 0">B 端溯源：客户端导出时向服务端领取 16 字节不透明 payload（含 License/设备/时间/HMAC），' +
        '嵌入首帧 LSB / 音频扩频 / PNG alpha；泄露文件可用「溯源查询」反查 License → 账号 → 设备。' +
        '<button class="lo-btn sm" id="loTraceBtn" style="margin-left:8px">🔎 溯源查询</button></div></div></div>' +
        '</div>';
      $('#loPane').innerHTML = html;
      $('#loSaveCfg').addEventListener('click', saveConfig);
      $('#loReloadCfg').addEventListener('click', function () { state.config = null; paneFlags(true); });
      $('#loTraceBtn').addEventListener('click', showTrace);
    }).catch(function (e) { $('#loPane').innerHTML = '<div class="lo-empty">加载配置失败：' + esc(errText(e)) + '</div>'; });
  }

  function toggleField(id, label, on) {
    return '<div class="full"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
      '<input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + ' style="accent-color:#38bdf8"> ' + esc(label) + '</label></div>';
  }

  function saveConfig() {
    var body = {
      auto_ban_enabled: !!($('#loCfgAutoBan') || {}).checked,
      trace_enabled: !!($('#loCfgTrace') || {}).checked,
      force_update_mandatory: !!($('#loCfgFUMust') || {}).checked,
      anomaly_window_min: parseInt(($('#loCfgWin') || {}).value || '120', 10),
      anomaly_max_ips: parseInt(($('#loCfgMaxIp') || {}).value || '3', 10),
      anomaly_max_activations: parseInt(($('#loCfgMaxAct') || {}).value || '8', 10),
      alert_email: ($('#loCfgMail') || {}).value || '',
      heartbeat_ttl: parseInt(($('#loCfgHb') || {}).value || '86400', 10),
      grace_days: parseInt(($('#loCfgGrace') || {}).value || '7', 10),
      force_update_version: ($('#loCfgFUVer') || {}).value || '',
      force_update_url: ($('#loCfgFUUrl') || {}).value || '',
      features: {}
    };
    $$('[data-feat]').forEach(function (el) { body.features[el.getAttribute('data-feat')] = !!el.checked; });
    var btn = $('#loSaveCfg');
    btn.disabled = true; btn.textContent = '保存中…';
    post('/license/ops/config', body).then(function (d) {
      btn.disabled = false; btn.textContent = '保存配置';
      state.config = null; state.overview = null;
      toast('配置已保存并实时生效');
      paneFlags(true);
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '保存配置';
      toast('保存失败：' + errText(e), 'err', 4200);
    });
  }

  function showTrace() {
    openModal('🔎 隐形水印溯源查询',
      '<div class="lo-note">输入水印提取出的 trace_code（TRC-…）或 16 字节 payload 十六进制（32 位 hex），' +
      '反查 License → 绑定账号 → 设备，定位泄露源。</div>' +
      '<div class="lo-form"><div class="full"><label>trace_code</label><input id="loTraceCode" placeholder="TRC-XXXXXXXXXXXX"></div>' +
      '<div class="full"><label>payload_hex（二选一）</label><input id="loTraceHex" placeholder="a5........（32 位十六进制）"></div></div>' +
      '<div id="loTraceOut" style="margin-top:10px"></div>',
      [{ label: '关闭' }, { label: '查询', cls: 'primary', fn: function (btn, mask) {
        post('/license/ops/trace', {
          trace_code: ($('#loTraceCode', mask) || {}).value || '',
          payload_hex: ($('#loTraceHex', mask) || {}).value || ''
        }).then(function (d) {
          var out = $('#loTraceOut', mask);
          if (!d.ok) { out.innerHTML = '<div class="lo-empty">' + esc(d.hint || '未命中') + '</div>'; return false; }
          var lic = d.license || {};
          out.innerHTML = '<div class="lo-note" style="color:#34d399">命中（' + (d.matched === 'db' ? '水印记录' : 'payload 解码') + '）：' +
            esc(lic.key_masked) + ' · ' + esc(lic.status_label) + '</div><div class="lo-kv">' +
            '<div class="k">License</div><div class="v">#' + lic.id + ' ' + esc(lic.key_masked) + '</div>' +
            '<div class="k">套餐</div><div class="v">' + esc(lic.plan_name) + '</div>' +
            '<div class="k">账号</div><div class="v">' + (d.account ? esc(d.account.name || '') + '（' + esc(d.account.phone_masked) + ' / #' + d.account.id + '）' : '—') + '</div>' +
            '<div class="k">设备</div><div class="v">' + (d.device ? esc(d.device.device_name) + ' · ' + esc(d.device.device_id.slice(0, 18)) + '…' : '—') + '</div>' +
            '<div class="k">发放时间</div><div class="v">' + (d.watermark ? fmtTs(d.watermark.created_at_str) : '—') + '</div>' +
            '</div>';
          return false;
        }).catch(function (e) { toast('查询失败：' + errText(e), 'err'); return false; });
      } }], true);
  }

  /* ---------------- 导出菜单 ---------------- */
  function showExportMenu() {
    openModal('导出 CSV（运营备份 / 交给财务）',
      '<div class="lo-note">CSV 带 UTF-8 BOM，可直接用 Excel 打开；Key 列表为脱敏前缀（明文只在生成时出现一次）。</div>' +
      '<div class="lo-featgrid" style="grid-template-columns:1fr 1fr">' +
      [['keys', 'Key 台账'], ['devices', '设备台账'], ['orders', '订单'], ['alerts', '异常告警'], ['events', '事件审计']].map(function (x) {
        return '<button class="lo-btn" data-exp="' + x[0] + '" style="justify-content:center">⬇ ' + x[1] + '</button>';
      }).join('') + '</div>',
      [{ label: '关闭' }]);
    bindClick($('#loModal'), '[data-exp]', function (b) {
      var type = b.getAttribute('data-exp');
      XLAuth.api('/license/ops/export?type=' + type, { method: 'GET', timeout: 30000 }).catch(function (e) {
        toast('导出失败：' + errText(e), 'err', 4200);
      });
      closeModal();
    });
  }

  /* ---------------- 入口 ---------------- */
  function parseSubFromHash() {
    try {
      var h = (location.hash || '');
      var q = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
      var m = /(?:^|&)sub=([a-z]+)/.exec(q);
      if (m && ['overview', 'keys', 'devices', 'orders', 'alerts', 'flags'].indexOf(m[1]) >= 0) return m[1];
    } catch (e) { }
    return '';
  }

  /* 主框架 switchTab 会先把 hash 改成 #/<tab>（丢掉 ?sub=xxx），所以脚本加载时先记住深链 */
  var BOOT_SUB = parseSubFromHash();
  var BOOT_USED = false;

  window.XLLicenseOps = {
    render: function () {
      if (!BUILT && !build()) return;
      if (BOOT_SUB && !BOOT_USED) {
        state.sub = BOOT_SUB;
        BOOT_USED = true;
      } else {
        var sub = parseSubFromHash();
        if (sub) state.sub = sub;
      }
      renderSub(false);
    }
  };
})();
