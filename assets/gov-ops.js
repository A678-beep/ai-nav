/* 星籁政务 · 运营后台「政企智能体」tab 组件（/ops/edit/ 引入，admin only）
 * 依赖：assets/auth.js（window.XLAuth，Bearer token + /ai-nav/api 基址）。
 * 能力：概览与安全审计卡 / 示例政策知识库管理与检索测试 / 问答日志 / 未命中问题池 /
 *       预约演示线索 / 安全与审计（权限矩阵·审计日志·脱敏开关演示）。
 * 合规：知识库为虚构示例（江州市）；所有写操作由后端审计并记录 gov_audit。
 */
(function () {
  'use strict';
  if (window.__XL_GOV_OPS__) return;
  window.__XL_GOV_OPS__ = true;

  var BUILT = false;
  var state = { tab: 'overview', data: {}, loading: {} };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    if (window.XLAuth && XLAuth.esc) return XLAuth.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(path, opts) {
    if (!window.XLAuth || !XLAuth.api) return Promise.reject(new Error('auth.js 未加载'));
    return XLAuth.api(path, opts || {});
  }
  function errText(e) {
    if (!e) return '操作失败';
    if (e.status === 401) return '登录已失效，请重新登录';
    if (e.status === 403) return '需要管理员权限';
    if (e.status === 429) return (e.data && e.data.hint) || '请求过于频繁';
    return (e.data && (e.data.hint || e.data.message || e.data.error)) || e.message || ('请求失败' + (e.status || ''));
  }
  function num(n, d) {
    n = Number(n || 0);
    return n.toLocaleString ? n.toLocaleString('zh-CN', { maximumFractionDigits: d == null ? 0 : d }) : String(n);
  }
  function fmtTs(s) { return s ? String(s).slice(0, 16) : '—'; }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  var TOAST_T = null;
  function toast(msg, kind, ms) {
    var box = $('#govOpsToast');
    if (!box) {
      box = el('div', 'oe-toastbox');
      box.id = 'govOpsToast';
      document.body.appendChild(box);
    }
    var t = el('div', 'oe-toast', esc(msg));
    t.style.cssText = 'margin-top:8px;padding:9px 13px;border-radius:9px;font-size:12.5px;' +
      'background:' + (kind === 'err' ? 'rgba(190,60,60,.92)' : 'rgba(24,36,52,.95)') + ';color:#fff;' +
      'box-shadow:0 10px 26px -16px rgba(0,0,0,.7)';
    box.appendChild(t);
    clearTimeout(TOAST_T);
    TOAST_T = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 2600);
  }
  function injectCss() {
    if ($('#gov-ops-style')) return;
    var s = document.createElement('style');
    s.id = 'gov-ops-style';
    s.textContent = [
      '#panel-gov{padding:0}',
      '#panel-gov .go-head{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;margin:2px 0 12px}',
      '#panel-gov .go-head .grow{flex:1;min-width:200px}',
      '#panel-gov .go-title{font-size:17px;font-weight:800;letter-spacing:.01em}',
      '#panel-gov .go-sub{font-size:11.5px;color:var(--oe-txt3,#8a99ad);margin-top:3px;line-height:1.6}',
      '#panel-gov .go-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--oe-line,#243244);margin-bottom:14px;padding-bottom:0}',
      '#panel-gov .go-tabs button{border:0;background:transparent;color:var(--oe-txt2,#9fb0c4);padding:9px 12px;font-size:12.5px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}',
      '#panel-gov .go-tabs button.on{color:var(--oe-cyan,#38bdf8);border-bottom-color:var(--oe-cyan,#38bdf8)}',
      '#panel-gov .go-card{background:var(--oe-panel,#111a26);border:1px solid var(--oe-line,#243244);border-radius:12px;padding:14px;margin-bottom:12px}',
      '#panel-gov .go-card h4{margin:0 0 8px;font-size:13.5px;font-weight:800;display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '#panel-gov .go-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}',
      '#panel-gov .go-stat{background:var(--oe-bg2,#0c1420);border:1px solid var(--oe-line,#243244);border-radius:10px;padding:11px 12px}',
      '#panel-gov .go-stat .v{font-size:19px;font-weight:800}',
      '#panel-gov .go-stat .l{font-size:11px;color:var(--oe-txt3,#8a99ad);margin-top:2px}',
      '#panel-gov .go-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
      '#panel-gov .go-table{width:100%;border-collapse:collapse;font-size:12px}',
      '#panel-gov .go-table th{text-align:left;color:var(--oe-txt3,#8a99ad);font-weight:700;padding:7px 8px;border-bottom:1px solid var(--oe-line,#243244);white-space:nowrap}',
      '#panel-gov .go-table td{padding:7px 8px;border-bottom:1px dashed var(--oe-line,#243244);vertical-align:top;line-height:1.6}',
      '#panel-gov .go-table td.mono{font-family:Consolas,monospace;font-size:11px}',
      '#panel-gov .go-table tr:hover td{background:var(--oe-soft,rgba(148,163,184,.05))}',
      '#panel-gov .go-q{max-width:420px;white-space:normal;min-width:220px}',
      '#panel-gov .go-ans{max-width:520px;white-space:normal;color:var(--oe-txt2,#9fb0c4)}',
      '#panel-gov .go-tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;background:rgba(148,163,184,.12);color:var(--oe-txt2,#9fb0c4);white-space:nowrap}',
      '#panel-gov .go-tag.ok{background:rgba(52,211,153,.14);color:#34d399}',
      '#panel-gov .go-tag.warn{background:rgba(251,191,36,.15);color:#fbbf24}',
      '#panel-gov .go-tag.bad{background:rgba(251,113,133,.15);color:#fb7185}',
      '#panel-gov .go-tag.info{background:rgba(56,189,248,.14);color:#38bdf8}',
      '#panel-gov .go-btn{border:1px solid var(--oe-line,#243244);background:var(--oe-btn-bg,rgba(148,163,184,.08));color:var(--oe-txt,#e6edf5);border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}',
      '#panel-gov .go-btn:hover{border-color:var(--oe-cyan,#38bdf8);color:var(--oe-cyan,#38bdf8)}',
      '#panel-gov .go-btn.primary{background:linear-gradient(135deg,#2f6fb3,#2563a8);border-color:transparent;color:#fff}',
      '#panel-gov .go-btn.danger{color:#fb7185;border-color:rgba(251,113,133,.4)}',
      '#panel-gov .go-btn:disabled{opacity:.5;cursor:not-allowed}',
      '#panel-gov .go-input,#panel-gov .go-select,#panel-gov .go-textarea{background:var(--oe-bg2,#0c1420);border:1px solid var(--oe-line,#243244);border-radius:8px;color:var(--oe-txt,#e6edf5);padding:7px 9px;font-size:12.5px;min-width:0}',
      '#panel-gov .go-input:focus,#panel-gov .go-select:focus,#panel-gov .go-textarea:focus{outline:none;border-color:var(--oe-cyan,#38bdf8)}',
      '#panel-gov .go-textarea{width:100%;min-height:96px;resize:vertical;line-height:1.6}',
      '#panel-gov .go-form{display:grid;grid-template-columns:1fr 1fr;gap:9px}',
      '#panel-gov .go-form .full{grid-column:1/-1}',
      '#panel-gov .go-form label{font-size:11.5px;color:var(--oe-txt3,#8a99ad);font-weight:700;display:block;margin-bottom:4px}',
      '#panel-gov .go-note{font-size:11.5px;color:var(--oe-txt3,#8a99ad);line-height:1.7;margin-top:6px}',
      '#panel-gov .go-note b{color:var(--oe-txt2,#9fb0c4)}',
      '#panel-gov .go-link{color:var(--oe-cyan,#38bdf8);text-decoration:none;font-size:11.5px;font-weight:700;margin-right:10px}',
      '#panel-gov .go-bars{display:flex;align-items:flex-end;gap:6px;height:96px;margin-top:10px}',
      '#panel-gov .go-bars .b{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%}',
      '#panel-gov .go-bars .b i{display:block;width:100%;max-width:34px;background:linear-gradient(180deg,#38bdf8,#2f6fb3);border-radius:4px 4px 0 0;min-height:3px}',
      '#panel-gov .go-bars .b span{font-size:10px;color:var(--oe-txt3,#8a99ad);white-space:nowrap}',
      '#panel-gov .go-kv{display:grid;grid-template-columns:110px 1fr;gap:5px 10px;font-size:12px}',
      '#panel-gov .go-kv .k{color:var(--oe-txt3,#8a99ad)}',
      '#panel-gov .go-kv .v{color:var(--oe-txt,#e6edf5)}',
      '#panel-gov .go-switch{position:relative;display:inline-block;width:42px;height:23px;vertical-align:middle}',
      '#panel-gov .go-switch input{opacity:0;width:100%;height:100%;margin:0;position:relative;z-index:2;cursor:pointer}',
      '#panel-gov .go-switch .tr{position:absolute;inset:0;border-radius:999px;background:rgba(148,163,184,.2);border:1px solid var(--oe-line,#243244);transition:.18s}',
      '#panel-gov .go-switch .tr::after{content:"";position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;transition:.18s}',
      '#panel-gov .go-switch input:checked+.tr{background:#2f6fb3;border-color:transparent}',
      '#panel-gov .go-switch input:checked+.tr::after{transform:translateX(19px)}',
      '#panel-gov .go-empty{padding:22px 8px;text-align:center;color:var(--oe-txt3,#8a99ad);font-size:12px}',
      '@media(max-width:900px){#panel-gov .go-grid{grid-template-columns:1fr 1fr}#panel-gov .go-form{grid-template-columns:1fr}#panel-gov .go-q,#panel-gov .go-ans{max-width:none}}',
      '@media(max-width:560px){#panel-gov .go-grid{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------------- 数据加载 ---------------- */
  var LOADERS = {
    overview: function () {
      return Promise.all([
        api('/gov/ops/stats?days=7'),
        api('/gov/ops/security')
      ]).then(function (arr) {
        state.data.stats = arr[0];
        state.data.security = arr[1];
      });
    },
    kb: function () {
      return api('/gov/kb/docs').then(function (d) { state.data.kb = d; });
    },
    logs: function () {
      var f = state.data.logFilter || {};
      var q = '?limit=60' + (f.kind ? '&kind=' + encodeURIComponent(f.kind) : '') +
        (f.missed ? '&missed=1' : '') + (f.q ? '&q=' + encodeURIComponent(f.q) : '');
      return api('/gov/ops/logs' + q).then(function (d) { state.data.logs = d; });
    },
    missed: function () {
      return api('/gov/ops/missed?status=' + encodeURIComponent((state.data.missedFilter || 'open')) + '&limit=100')
        .then(function (d) { state.data.missed = d; });
    },
    leads: function () {
      return api('/gov/ops/leads?limit=100').then(function (d) { state.data.leads = d; });
    },
    security: function () {
      return Promise.all([
        api('/gov/ops/security'),
        api('/gov/ops/audit')
      ]).then(function (arr) {
        state.data.security = arr[0];
        state.data.audit = arr[1];
      });
    }
  };

  function renderTab(tab) {
    state.tab = tab;
    var pane = $('#govOpsPane');
    if (!pane) return;
    $$('#govOpsTabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-go') === tab);
    });
    pane.innerHTML = '<div class="oe-loading" style="padding:22px"><div class="sp"></div>加载中…</div>';
    (LOADERS[tab] || function () { return Promise.resolve(); })().then(function () {
      PANES[tab]();
    }).catch(function (e) {
      pane.innerHTML = '<div class="go-card"><h4>加载失败</h4><div class="go-note">' + esc(errText(e)) +
        '</div><div class="go-row" style="margin-top:10px"><button class="go-btn" type="button" id="govOpsRetry">重试</button></div></div>';
      var b = $('#govOpsRetry');
      if (b) b.addEventListener('click', function () { renderTab(tab); });
    });
  }

  /* ---------------- 概览 + 安全审计卡 ---------------- */
  function paneOverview() {
    var pane = $('#govOpsPane');
    var s = state.data.stats || {};
    var sec = state.data.security || {};
    var t = s.totals || {};
    var kb = s.kb || {};
    var stats = [
      ['近 7 日调用', num(t.calls), 'policy / doc / ticket / lead'],
      ['今日调用', num(t.calls_today), '演示额度上限 ' + num((sec.config || {}).daily_max || 300) + ' 次/日'],
      ['未命中率', ((t.miss_rate || 0) * 100).toFixed(1) + '%', '转人工 ' + num(t.handoff) + ' 次'],
      ['平均耗时', num(t.avg_latency_ms) + 'ms', '演示环境实时调用'],
      ['tokens（7日）', num(t.tokens), '内部计量'],
      ['成本估算（7日）', '¥' + Number(t.cost_cny || 0).toFixed(3), '按 tokens 保守估算'],
      ['示例政策文档', num(kb.docs), num(kb.chunks) + ' 个切片'],
      ['预约演示线索', num(s.leads), '未处理未命中 ' + num(s.open_missed)]
    ];
    var html = '<div class="go-grid">' + stats.map(function (x) {
      return '<div class="go-stat"><div class="v">' + esc(String(x[1])) + '</div><div class="l">' + esc(x[0]) +
        ' · ' + esc(x[2]) + '</div></div>';
    }).join('') + '</div>';

    var days = s.by_day || [];
    var max = 1;
    days.forEach(function (d) { if (d.calls > max) max = d.calls; });
    html += '<div class="go-card" style="margin-top:12px"><h4>7 日调用趋势</h4><div class="go-bars">' +
      (days.length ? days.map(function (d) {
        return '<div class="b" title="' + esc(d.date) + ' 调用 ' + d.calls + ' 次"><i style="height:' +
          Math.max(3, Math.round(d.calls / max * 78)) + '%"></i><span>' + esc(String(d.date).slice(5)) + '</span></div>';
      }).join('') : '<div class="go-empty">暂无数据</div>') + '</div></div>';

    var top = (s.top_questions || []).slice(0, 6);
    html += '<div class="go-card"><h4>高频政策问题 Top 6</h4>' + (top.length ?
      '<table class="go-table"><thead><tr><th>问题</th><th style="width:70px">次数</th></tr></thead><tbody>' +
      top.map(function (x) {
        return '<tr><td class="go-q">' + esc(x.q) + '</td><td>' + num(x.n) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="go-empty">暂无数据</div>') + '</div>';

    /* 安全与审计小卡（演示时可直接讲） */
    var roles = sec.roles || [];
    var audits = (sec.audit_samples || []).slice(-6);
    html += '<div class="go-card"><h4>🛡️ 安全与审计 <span class="go-tag info">演示卡</span>' +
      '<span class="go-tag warn">等保 / 密评：规划中</span>' +
      '<span style="flex:1"></span><a class="go-link" href="/ai-nav/gov/security.html" target="_blank" rel="noopener">打开安全演示页 ↗</a></h4>' +
      '<div style="display:grid;grid-template-columns:1.1fr 1fr;gap:12px">' +
      '<div><div style="font-size:12px;font-weight:700;margin-bottom:6px">权限矩阵（RBAC + ABAC）</div>' +
      '<table class="go-table"><thead><tr><th>角色</th><th>数据范围</th><th>权限</th></tr></thead><tbody>' +
      (roles.length ? roles.map(function (r) {
        return '<tr><td>' + esc(r.role) + '</td><td>' + esc(r.data_scope) + '</td><td>' + esc(r.perms) + '</td></tr>';
      }).join('') : '<tr><td colspan="3">加载中…</td></tr>') + '</tbody></table></div>' +
      '<div><div style="font-size:12px;font-weight:700;margin-bottom:6px">审计日志样例（最近 6 条）</div>' +
      '<div style="font-size:11.5px;color:var(--oe-txt2,#9fb0c4);line-height:1.9">' +
      (audits.length ? audits.map(function (a) {
        return '<div>' + esc(a.time) + ' · ' + esc(a.actor) + ' · ' + esc(a.action) + ' · ' +
          esc(a.target) + ' · ' + esc(a.result) + '</div>';
      }).join('') : '<div class="go-empty">暂无审计样例</div>') + '</div></div></div>' +
      '<div class="go-row" style="margin-top:12px;border-top:1px dashed var(--oe-line,#243244);padding-top:12px">' +
      '<span style="font-size:12px;font-weight:700">数据脱敏开关（演示）</span>' +
      '<label class="go-switch"><input type="checkbox" id="govMaskSwitch"' +
      ((sec.masking || {}).enabled ? ' checked' : '') + '><span class="tr"></span></label>' +
      '<span id="govMaskState" style="font-size:11.5px;color:var(--oe-txt3,#8a99ad)">' +
      ((sec.masking || {}).enabled ? '已开启：示例数据按脱敏形式展示' : '已关闭：仅影响安全演示页示例数据，真实数据始终脱敏') + '</span>' +
      '<span style="flex:1"></span><span class="go-tag">真实日志 / 线索始终脱敏</span></div>' +
      '<div class="go-note">说明：权限矩阵、审计日志、脱敏开关均为演示样例；真实环境的权限与审计由后端 RBAC/ABAC 与 gov_audit 表管理。' +
      '最近写操作可在「安全与审计」页查看真实审计记录。</div></div>';

    html += '<div class="go-card"><h4>对外入口</h4><div class="go-row">' +
      '<a class="go-link" href="/ai-nav/gov/" target="_blank" rel="noopener">方案页 /gov/ ↗</a>' +
      '<a class="go-link" href="/ai-nav/gov/security.html" target="_blank" rel="noopener">安全演示 ↗</a>' +
      '<a class="go-link" href="/ai-nav/gov/demo/policy.html" target="_blank" rel="noopener">政策问答原型 ↗</a>' +
      '<a class="go-link" href="/ai-nav/gov/demo/doc.html" target="_blank" rel="noopener">公文助手原型 ↗</a>' +
      '<a class="go-link" href="/ai-nav/gov/demo/ticket.html" target="_blank" rel="noopener">工单分派原型 ↗</a>' +
      '</div></div>';
    pane.innerHTML = html;
    var sw = $('#govMaskSwitch');
    if (sw) {
      sw.addEventListener('change', function () {
        var on = !!sw.checked;
        api('/gov/ops/config', { method: 'POST', body: { masking_enabled: on } }).then(function () {
          var st = $('#govMaskState');
          if (st) st.textContent = on ? '已开启：示例数据按脱敏形式展示' : '已关闭：仅影响安全演示页示例数据，真实数据始终脱敏';
          toast('已保存：脱敏演示开关 ' + (on ? '开启' : '关闭'), 'ok');
        }).catch(function (e) { toast('保存失败：' + errText(e), 'err'); });
      });
    }
  }

  /* ---------------- 知识库 ---------------- */
  function paneKb() {
    var pane = $('#govOpsPane');
    var d = state.data.kb || {};
    var items = d.items || [];
    var html = '<div class="go-card"><h4>知识库文档（虚构示例政策 · 江州市）<span class="go-tag info">共 ' + items.length + ' 篇</span></h4>' +
      '<div class="go-row">' +
      '<button class="go-btn primary" type="button" id="govKbNew">＋ 新建政策文档</button>' +
      '<button class="go-btn" type="button" id="govKbSeed">补种示例文档</button>' +
      '<button class="go-btn" type="button" id="govKbReindex">重建索引</button>' +
      '<span style="flex:1"></span>' +
      '<input class="go-input" id="govKbQ" placeholder="检索测试：输入问题，看命中片段与分数" style="width:300px">' +
      '<button class="go-btn" type="button" id="govKbSearch">检索</button>' +
      '</div>' +
      '<div id="govKbSearchOut"></div>' +
      '<div id="govKbFormOut"></div>' +
      '<table class="go-table" style="margin-top:8px"><thead><tr><th>ID</th><th>标题</th><th>分类</th><th>状态</th>' +
      '<th>切片</th><th>向量</th><th>更新时间</th><th style="width:190px">操作</th></tr></thead><tbody>' +
      (items.length ? items.map(function (x) {
        return '<tr><td class="mono">' + x.id + '</td><td class="go-q">' + esc(x.title) + '</td><td>' +
          esc(x.category) + '</td><td>' + (x.enabled ? '<span class="go-tag ok">启用</span>' : '<span class="go-tag">停用</span>') +
          '</td><td>' + x.chunks + '</td><td>' + x.embeddings + '</td><td class="mono">' + fmtTs(x.updated_at) + '</td>' +
          '<td><button class="go-btn" data-kbact="view" data-id="' + x.id + '" type="button">预览</button> ' +
          '<button class="go-btn" data-kbact="edit" data-id="' + x.id + '" type="button">编辑</button> ' +
          '<button class="go-btn danger" data-kbact="del" data-id="' + x.id + '" type="button">删除</button></td></tr>';
      }).join('') : '<tr><td colspan="8"><div class="go-empty">暂无文档，可点「补种示例文档」初始化 7 篇虚构示例政策</div></td></tr>') +
      '</tbody></table><div class="go-note">说明：新增 / 修改文档会自动切片并向量化（embedding 不可用时回退关键词检索）；' +
      '知识库内容请仅放已公开 / 已脱敏材料，涉密材料不要录入本演示环境。</div></div>';
    pane.innerHTML = html;

    var bind = function (sel, fn) { var b = $(sel); if (b) b.addEventListener('click', fn); };
    bind('#govKbSeed', function () {
      api('/gov/kb/seed', { method: 'POST', body: {} }).then(function (r) {
        toast('补种完成：新增 ' + r.added + ' 篇 / 跳过 ' + r.skipped + ' 篇', 'ok');
        state.data.kb = null; renderTab('kb');
      }).catch(function (e) { toast('失败：' + errText(e), 'err'); });
    });
    bind('#govKbReindex', function () {
      api('/gov/kb/reindex', { method: 'POST', body: {} }).then(function (r) {
        toast('重建完成：' + r.docs + ' 篇 / ' + r.chunks + ' 切片', 'ok');
        state.data.kb = null; renderTab('kb');
      }).catch(function (e) { toast('失败：' + errText(e), 'err'); });
    });
    bind('#govKbNew', function () { kbForm(null); });
    bind('#govKbSearch', function () {
      var q = ($('#govKbQ') || {}).value || '';
      if (!q.trim()) { toast('请输入检索问题', 'err'); return; }
      api('/gov/kb/search?q=' + encodeURIComponent(q)).then(function (r) {
        var out = $('#govKbSearchOut');
        if (!out) return;
        out.innerHTML = '<div class="go-card" style="margin:10px 0"><h4>检索结果（阈值 ' + r.threshold + '）</h4>' +
          (r.items.length ? '<table class="go-table"><thead><tr><th>文档</th><th>分数</th><th>片段</th></tr></thead><tbody>' +
            r.items.map(function (x) {
              return '<tr><td>' + esc(x.title) + '</td><td>' + x.score + '</td><td class="go-ans">' + esc(x.snippet) + '</td></tr>';
            }).join('') + '</tbody></table>' : '<div class="go-empty">未命中（低于阈值）：正式环境会提示转人工</div>') + '</div>';
      }).catch(function (e) { toast('检索失败：' + errText(e), 'err'); });
    });
    $$('[data-kbact]', pane).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = parseInt(b.getAttribute('data-id'), 10);
        var act = b.getAttribute('data-kbact');
        if (act === 'view') {
          api('/gov/kb/docs/' + id).then(function (r) { kbView(r); }).catch(function (e) { toast('加载失败：' + errText(e), 'err'); });
        } else if (act === 'edit') {
          api('/gov/kb/docs/' + id).then(function (r) { kbForm(r); }).catch(function (e) { toast('加载失败：' + errText(e), 'err'); });
        } else if (act === 'del') {
          if (!window.confirm('确认删除《' + (b.closest('tr').children[1].textContent || '') + '》？删除后无法恢复。')) return;
          api('/gov/kb/docs/' + id, { method: 'DELETE' }).then(function () {
            toast('已删除', 'ok'); state.data.kb = null; renderTab('kb');
          }).catch(function (e) { toast('删除失败：' + errText(e), 'err'); });
        }
      });
    });

    function kbView(r) {
      var doc = r.doc || {};
      var out = $('#govKbFormOut');
      out.innerHTML = '<div class="go-card"><h4>预览：' + esc(doc.title) + ' <span class="go-tag info">' +
        esc(doc.category) + '</span><span class="go-tag">' + r.chunk_count + ' 个切片</span>' +
        '<span style="flex:1"></span><button class="go-btn" type="button" id="govKbClose">关闭</button></h4>' +
        '<textarea class="go-textarea" readonly style="min-height:150px">' + esc(doc.content) + '</textarea>' +
        '<div style="font-size:12px;font-weight:700;margin:10px 0 6px">切片预览</div>' +
        (r.chunks || []).map(function (c) {
          return '<div style="border:1px dashed var(--oe-line,#243244);border-radius:8px;padding:8px;margin-bottom:6px;font-size:11.5px">' +
            '<b>#' + c.seq + '</b> ' + (c.has_embedding ? '<span class="go-tag ok">向量</span>' : '<span class="go-tag warn">仅关键词</span>') +
            '<div style="color:var(--oe-txt2,#9fb0c4);margin-top:4px;line-height:1.65">' + esc(c.content) + '</div>' +
            '<div class="go-note">关键词：' + esc(c.keywords) + '</div></div>';
        }).join('') + '</div>';
      var cb = $('#govKbClose');
      if (cb) cb.addEventListener('click', function () { out.innerHTML = ''; });
    }

    function kbForm(r) {
      var doc = (r && r.doc) || {};
      var isEdit = !!doc.id;
      var out = $('#govKbFormOut');
      out.innerHTML = '<div class="go-card"><h4>' + (isEdit ? '编辑政策文档 #' + doc.id : '新建政策文档') +
        '<span style="flex:1"></span><button class="go-btn" type="button" id="govKbCancel">取消</button></h4>' +
        '<div class="go-form">' +
        '<div class="full"><label>标题 *</label><input class="go-input" id="govKbTitle" style="width:100%" maxlength="120" value="' + esc(doc.title || '') + '"></div>' +
        '<div><label>分类</label><input class="go-input" id="govKbCat" style="width:100%" maxlength="30" value="' + esc(doc.category || '政策文件') + '"></div>' +
        '<div><label>优先级（0-100）</label><input class="go-input" id="govKbPrio" style="width:100%" type="number" min="0" max="100" value="' + (doc.priority == null ? 50 : doc.priority) + '"></div>' +
        '<div class="full"><label>正文内容 *（≥20 字，建议分条）</label><textarea class="go-textarea" id="govKbContent" style="min-height:160px">' + esc(doc.content || '') + '</textarea></div>' +
        '<div class="full" style="display:flex;gap:10px;align-items:center"><label style="margin:0">启用</label>' +
        '<label class="go-switch"><input type="checkbox" id="govKbEnabled"' + (isEdit ? (doc.enabled ? ' checked' : '') : ' checked') + '><span class="tr"></span></label>' +
        '<span style="flex:1"></span><button class="go-btn primary" type="button" id="govKbSave">' + (isEdit ? '保存修改' : '创建并索引') + '</button></div>' +
        '</div><div class="go-note">创建 / 修改会同步重建切片与向量索引，稍等 1-3 秒。</div></div>';
      var cancel = $('#govKbCancel');
      if (cancel) cancel.addEventListener('click', function () { out.innerHTML = ''; });
      var save = $('#govKbSave');
      if (save) save.addEventListener('click', function () {
        var body = {
          title: ($('#govKbTitle') || {}).value || '',
          category: ($('#govKbCat') || {}).value || '政策文件',
          priority: parseInt(($('#govKbPrio') || {}).value || '50', 10),
          content: ($('#govKbContent') || {}).value || '',
          enabled: !!($('#govKbEnabled') && $('#govKbEnabled').checked)
        };
        save.disabled = true; save.textContent = '保存中…';
        var req = isEdit ? api('/gov/kb/docs/' + doc.id, { method: 'PUT', body: body })
          : api('/gov/kb/docs', { method: 'POST', body: body });
        req.then(function (res) {
          toast(isEdit ? '已保存并重建索引（' + (res.chunks || 0) + ' 切片）' : '已创建并索引（' + (res.chunks || 0) + ' 切片）', 'ok');
          out.innerHTML = '';
          state.data.kb = null; renderTab('kb');
        }).catch(function (e) {
          save.disabled = false; save.textContent = isEdit ? '保存修改' : '创建并索引';
          toast('保存失败：' + errText(e), 'err');
        });
      });
    }
  }

  /* ---------------- 问答日志 ---------------- */
  function paneLogs() {
    var pane = $('#govOpsPane');
    var d = state.data.logs || {};
    var items = d.items || [];
    var f = state.data.logFilter || {};
    var kinds = [['', '全部类型'], ['policy', '政策问答'], ['doc', '公文助手'], ['ticket', '工单分派'], ['lead', '预约留资']];
    var html = '<div class="go-card"><h4>问答日志 <span class="go-tag info">最近 ' + items.length + ' 条</span></h4>' +
      '<div class="go-row">' +
      '<select class="go-select" id="govLogKind">' + kinds.map(function (k) {
        return '<option value="' + k[0] + '"' + (f.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>';
      }).join('') + '</select>' +
      '<label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="govLogMiss"' +
      (f.missed ? ' checked' : '') + '> 只看未命中</label>' +
      '<input class="go-input" id="govLogQ" placeholder="搜索问题 / 回答" style="width:230px" value="' + esc(f.q || '') + '">' +
      '<button class="go-btn" type="button" id="govLogGo">查询</button>' +
      '<span style="flex:1"></span><span class="go-tag">回答均脱敏展示</span></div>' +
      '<table class="go-table"><thead><tr><th>时间</th><th>类型</th><th>问题</th><th>回答摘要</th><th>置信度</th>' +
      '<th>引用</th><th>tokens</th><th>耗时</th><th>转人工</th></tr></thead><tbody>' +
      (items.length ? items.map(function (x) {
        var kindName = { policy: '政策问答', doc: '公文助手', ticket: '工单分派', lead: '预约留资' }[x.kind] || x.kind;
        return '<tr><td class="mono">' + fmtTs(x.created_at) + '</td><td>' + esc(kindName) + '</td>' +
          '<td class="go-q">' + esc(x.question) + '</td><td class="go-ans">' + esc(x.answer) + '</td>' +
          '<td>' + Math.round(Number(x.confidence || 0) * 100) + '%</td>' +
          '<td>' + (x.sources || []).map(function (s) { return esc(s.title); }).join('<br>') +
          (x.guard === 'kb_miss' ? '<span class="go-tag warn">未命中</span>' : '') + '</td>' +
          '<td class="mono">' + num(x.prompt_tokens) + '+' + num(x.completion_tokens) + '</td>' +
          '<td class="mono">' + num(x.latency_ms) + 'ms</td>' +
          '<td>' + (x.need_handoff ? '<span class="go-tag warn">是</span>' : '<span class="go-tag">否</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="9"><div class="go-empty">暂无日志；可先在 /gov/demo/ 体验一次原型。</div></td></tr>') +
      '</tbody></table></div>';
    pane.innerHTML = html;
    var go = $('#govLogGo');
    if (go) go.addEventListener('click', function () {
      state.data.logFilter = {
        kind: ($('#govLogKind') || {}).value || '',
        missed: !!($('#govLogMiss') && $('#govLogMiss').checked),
        q: ($('#govLogQ') || {}).value || ''
      };
      renderTab('logs');
    });
  }

  /* ---------------- 未命中问题池 ---------------- */
  function paneMissed() {
    var pane = $('#govOpsPane');
    var d = state.data.missed || {};
    var items = d.items || [];
    var f = state.data.missedFilter || 'open';
    var html = '<div class="go-card"><h4>未命中问题池（知识库外问题）<span class="go-tag info">' + items.length + ' 条</span></h4>' +
      '<div class="go-row"><select class="go-select" id="govMissFilter">' +
      [['open', '待处理'], ['all', '全部'], ['resolved', '已解决'], ['ignored', '已忽略']].map(function (x) {
        return '<option value="' + x[0] + '"' + (f === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
      }).join('') + '</select><span class="go-tag">展示脱敏问题</span></div>' +
      '<table class="go-table"><thead><tr><th>时间</th><th>问题</th><th>原因</th><th>状态</th><th style="width:300px">处理</th></tr></thead><tbody>' +
      (items.length ? items.map(function (x) {
        var st = { open: '<span class="go-tag warn">待处理</span>', resolved: '<span class="go-tag ok">已解决</span>', ignored: '<span class="go-tag">已忽略</span>' }[x.status] || x.status;
        return '<tr><td class="mono">' + fmtTs(x.created_at) + '</td><td class="go-q">' + esc(x.question) + '</td><td>' +
          esc(x.reason) + '</td><td>' + st + '</td><td>' +
          '<button class="go-btn" data-missact="kb" data-id="' + x.id + '" type="button">补录知识库</button> ' +
          '<button class="go-btn" data-missact="resolved" data-id="' + x.id + '" type="button">标记解决</button> ' +
          '<button class="go-btn" data-missact="ignored" data-id="' + x.id + '" type="button">忽略</button></td></tr>';
      }).join('') : '<tr><td colspan="5"><div class="go-empty">暂无未命中问题</div></td></tr>') +
      '</tbody></table></div><div id="govMissFormOut"></div>';
    pane.innerHTML = html;
    var sel = $('#govMissFilter');
    if (sel) sel.addEventListener('change', function () {
      state.data.missedFilter = sel.value; renderTab('missed');
    });
    $$('[data-missact]', pane).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var act = b.getAttribute('data-missact');
        if (act === 'kb') {
          var out = $('#govMissFormOut');
          out.innerHTML = '<div class="go-card"><h4>补录到知识库（未命中 #' + id + '）<span style="flex:1"></span>' +
            '<button class="go-btn" type="button" id="govMissCancel">取消</button></h4>' +
            '<div class="go-form"><div class="full"><label>标题</label><input class="go-input" id="govMissTitle" style="width:100%" placeholder="如：补充问答：XX 补贴申请材料"></div>' +
            '<div><label>分类</label><input class="go-input" id="govMissCat" style="width:100%" value="补充问答"></div>' +
            '<div></div><div class="full"><label>回答内容（≥20 字，建议写清条件 / 材料 / 时限）</label>' +
            '<textarea class="go-textarea" id="govMissContent" style="min-height:120px"></textarea></div>' +
            '<div class="full" style="display:flex;justify-content:flex-end"><button class="go-btn primary" type="button" id="govMissSave">保存并标记已解决</button></div>' +
            '</div></div>';
          var cancel = $('#govMissCancel');
          if (cancel) cancel.addEventListener('click', function () { out.innerHTML = ''; });
          var save = $('#govMissSave');
          if (save) save.addEventListener('click', function () {
            var content = ($('#govMissContent') || {}).value || '';
            if (content.trim().length < 20) { toast('回答内容至少 20 字', 'err'); return; }
            save.disabled = true; save.textContent = '保存中…';
            api('/gov/ops/missed/' + id, {
              method: 'POST',
              body: {
                status: 'resolved',
                note: '运营补录知识库',
                create_doc: {
                  title: ($('#govMissTitle') || {}).value || '',
                  category: ($('#govMissCat') || {}).value || '补充问答',
                  content: content
                }
              }
            }).then(function () {
              toast('已补录知识库并标记解决', 'ok');
              state.data.missed = null; renderTab('missed');
            }).catch(function (e) {
              save.disabled = false; save.textContent = '保存并标记已解决';
              toast('失败：' + errText(e), 'err');
            });
          });
        } else {
          api('/gov/ops/missed/' + id, { method: 'POST', body: { status: act } }).then(function () {
            toast(act === 'resolved' ? '已标记解决' : '已忽略', 'ok');
            state.data.missed = null; renderTab('missed');
          }).catch(function (e) { toast('失败：' + errText(e), 'err'); });
        }
      });
    });
  }

  /* ---------------- 预约演示线索 ---------------- */
  function paneLeads() {
    var pane = $('#govOpsPane');
    var d = state.data.leads || {};
    var items = d.items || [];
    var stMap = { new: '待联系', contacted: '已联系', converted: '已转化', invalid: '无效', closed: '已关闭' };
    var html = '<div class="go-card"><h4>预约演示线索 <span class="go-tag info">' + items.length + ' 条</span>' +
      '<span style="flex:1"></span><span class="go-tag">手机号默认脱敏</span></h4>' +
      '<table class="go-table"><thead><tr><th>时间</th><th>称呼</th><th>单位 / 部门</th><th>职务</th><th>城市</th>' +
      '<th>手机号</th><th>想看的场景</th><th>需求</th><th>状态</th></tr></thead><tbody>' +
      (items.length ? items.map(function (x) {
        return '<tr><td class="mono">' + fmtTs(x.created_at) + '</td><td>' + esc(x.name) + '</td>' +
          '<td class="go-q">' + esc(x.org || '—') + '</td><td>' + esc(x.role || '—') + '</td><td>' + esc(x.city || '—') + '</td>' +
          '<td class="mono">' + esc(x.phone) + '</td><td>' + esc(x.demo || '—') + '</td><td class="go-ans">' + esc(x.need || '—') + '</td>' +
          '<td><select class="go-select" data-leadid="' + x.id + '">' +
          Object.keys(stMap).map(function (k) {
            return '<option value="' + k + '"' + (x.status === k ? ' selected' : '') + '>' + stMap[k] + '</option>';
          }).join('') + '</select></td></tr>';
      }).join('') : '<tr><td colspan="9"><div class="go-empty">暂无预约线索；可到 /gov/ 首页提交一次预约演示表单。</div></td></tr>') +
      '</tbody></table></div>';
    pane.innerHTML = html;
    $$('[data-leadid]', pane).forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.getAttribute('data-leadid');
        api('/gov/ops/leads/' + id, { method: 'POST', body: { status: sel.value } }).then(function () {
          toast('线索状态已更新', 'ok');
        }).catch(function (e) { toast('更新失败：' + errText(e), 'err'); });
      });
    });
  }

  /* ---------------- 安全与审计（完整页） ---------------- */
  function paneSecurity() {
    var pane = $('#govOpsPane');
    var sec = state.data.security || {};
    var audit = (state.data.audit || {}).items || [];
    var roles = sec.roles || [];
    var matrix = sec.matrix || [];
    var config = sec.config || {};
    var html = '<div class="go-card"><h4>🛡️ 安全与审计 <span class="go-tag info">演示卡</span>' +
      '<span style="flex:1"></span><a class="go-link" href="/ai-nav/gov/security.html" target="_blank" rel="noopener">打开对外安全演示页 ↗</a></h4>' +
      '<div class="go-note">演示口径：本卡用于向政府客户讲解安全能力；等保三级 / 密评 / 信创适配为「规划中」，' +
      '未取得正式证书，不作为资质承诺。</div>' +
      '<div class="go-grid" style="margin-top:10px">' +
      '<div class="go-stat"><div class="v">' + (config.masking_enabled ? '已开启' : '已关闭') + '</div><div class="l">数据脱敏（演示开关）</div></div>' +
      '<div class="go-stat"><div class="v">' + num(config.audit_retention_days || 180) + ' 天</div><div class="l">审计留存</div></div>' +
      '<div class="go-stat"><div class="v">' + num(config.rate_max || 20) + ' 次</div><div class="l">每 IP 演示额度（10 分钟）</div></div>' +
      '<div class="go-stat"><div class="v">' + num(config.daily_max || 300) + ' 次</div><div class="l">每日演示额度</div></div>' +
      '</div>' +
      '<div class="go-row" style="margin-top:12px"><span style="font-size:12px;font-weight:700">脱敏演示开关</span>' +
      '<label class="go-switch"><input type="checkbox" id="govSecMask"' + (config.masking_enabled ? ' checked' : '') + '><span class="tr"></span></label>' +
      '<span class="go-tag">仅影响安全演示页示例数据展示；真实日志 / 线索始终脱敏</span></div></div>';

    html += '<div class="go-card"><h4>权限矩阵（RBAC + ABAC）</h4><table class="go-table"><thead><tr><th>角色</th>' +
      '<th>数据范围</th><th>可做操作</th><th>敏感数据</th></tr></thead><tbody>' +
      (roles.length ? roles.map(function (r) {
        return '<tr><td>' + esc(r.role) + '</td><td>' + esc(r.data_scope) + '</td><td>' + esc(r.perms) + '</td><td>' + esc(r.sensitive) + '</td></tr>';
      }).join('') : '<tr><td colspan="4">加载中…</td></tr>') + '</tbody></table></div>';

    html += '<div class="go-card"><h4>安全能力矩阵</h4><table class="go-table"><thead><tr><th>能力</th><th>说明</th><th>状态</th></tr></thead><tbody>' +
      (matrix.length ? matrix.map(function (x) {
        var st = String(x.status || '').indexOf('规划中') >= 0 ? '<span class="go-tag warn">规划中</span>' : '<span class="go-tag ok">已实现（演示）</span>';
        return '<tr><td>' + esc(x.capability) + '</td><td>' + esc(x.desc) + '</td><td>' + st + '</td></tr>';
      }).join('') : '<tr><td colspan="3">加载中…</td></tr>') + '</tbody></table></div>';

    html += '<div class="go-card"><h4>真实操作审计（gov_audit）<span class="go-tag info">最近 ' + audit.length + ' 条</span>' +
      '<span style="flex:1"></span><span class="go-tag">运营端写操作留痕</span></h4>' +
      '<table class="go-table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th><th>IP（哈希）</th><th>结果</th></tr></thead><tbody>' +
      (audit.length ? audit.map(function (x) {
        return '<tr><td class="mono">' + fmtTs(x.created_at) + '</td><td>' + esc(x.actor) + '</td><td>' + esc(x.action) + '</td>' +
          '<td>' + esc(x.target) + '</td><td class="go-ans">' + esc(x.note || '—') + '</td><td class="mono">' + esc(x.ip_hash) + '</td>' +
          '<td>' + (x.result === 'ok' ? '<span class="go-tag ok">ok</span>' : '<span class="go-tag warn">' + esc(x.result) + '</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="7"><div class="go-empty">暂无审计记录；在知识库 / 配置 / 线索页面做一次写操作后会出现。</div></td></tr>') +
      '</tbody></table></div>';

    html += '<div class="go-card"><h4>部署与免责说明</h4><div class="go-kv">' +
      '<div class="k">演示环境</div><div class="v">星籁政务 · 政企智能体平台（同一底座、独立视觉与独立导航）</div>' +
      '<div class="k">正式交付</div><div class="v">私有化部署到客户内网 / 政务云；独立域名（规划 gov.xinglaiai.com）与独立运维</div>' +
      '<div class="k">数据声明</div><div class="v">知识库为虚构示例（江州市），不含任何真实政务数据</div>' +
      '<div class="k">合规口径</div><div class="v">等保三级 / 密评 / 信创适配 / 算法备案均为「规划中」，未取得正式证书</div>' +
      '</div></div>';
    pane.innerHTML = html;
    var sw = $('#govSecMask');
    if (sw) sw.addEventListener('change', function () {
      api('/gov/ops/config', { method: 'POST', body: { masking_enabled: !!sw.checked } }).then(function () {
        toast('已保存脱敏演示开关', 'ok');
      }).catch(function (e) { toast('保存失败：' + errText(e), 'err'); });
    });
  }

  var PANES = { overview: paneOverview, kb: paneKb, logs: paneLogs, missed: paneMissed, leads: paneLeads, security: paneSecurity };

  function build() {
    var panel = $('#panel-gov');
    if (!panel) return false;
    injectCss();
    var tabs = [
      ['overview', '概览与安全审计'], ['kb', '知识库（示例政策）'], ['logs', '问答日志'],
      ['missed', '未命中问题池'], ['leads', '预约演示线索'], ['security', '安全与审计']
    ];
    panel.innerHTML =
      '<div class="go-head"><div class="grow">' +
      '<div class="go-title">政企智能体 · 演示空间运营</div>' +
      '<div class="go-sub">对外方案页 /gov/、安全演示 /gov/security.html、3 个原型 /gov/demo/*；' +
      '知识库为虚构示例（江州市），接口 /ai-nav/api/gov/*。演示环境 · 示例数据 · 不含任何真实政务数据。</div>' +
      '</div><div class="go-row" style="margin:0">' +
      '<button class="go-btn" type="button" id="govOpsRefresh">↻ 刷新</button>' +
      '<a class="go-btn" href="/ai-nav/gov/" target="_blank" rel="noopener">方案页 ↗</a>' +
      '<a class="go-btn" href="/ai-nav/gov/security.html" target="_blank" rel="noopener">安全演示 ↗</a>' +
      '</div></div>' +
      '<div class="go-tabs" id="govOpsTabs">' + tabs.map(function (t) {
        return '<button type="button" data-go="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div id="govOpsPane"></div>';
    $$('#govOpsTabs button').forEach(function (b) {
      b.addEventListener('click', function () { renderTab(b.getAttribute('data-go')); });
    });
    var rf = $('#govOpsRefresh');
    if (rf) rf.addEventListener('click', function () { state.data = {}; renderTab(state.tab); });
    BUILT = true;
    return true;
  }

  window.XLGovOps = {
    render: function () {
      if (!BUILT && !build()) return;
      renderTab(state.tab);
    }
  };
})();
