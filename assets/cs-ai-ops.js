/* 星籁 AI · 运营端「AI 客服」组件（/ops/edit/ 引入，admin only）
 * 依赖：assets/auth.js（window.XLAuth）
 * 能力：知识库（三层来源：商家定制 > 行业模板 > 对话回流）、会话列表/详情、留资转人工、
 *      未命中问题池（一键补充知识库）、成交漏斗回填、数据看板、规则与人设配置。
 * P0 范围：网页挂件；企业微信/抖音官方接口为 P1 预留（不抓取/不群发）。
 */
(function () {
  'use strict';
  if (window.__XL_CS_AI_OPS__) return;
  window.__XL_CS_AI_OPS__ = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.XLAuth ? XLAuth.esc(s) : String(s == null ? '' : s); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function fmtN(n) {
    n = Number(n || 0);
    return n >= 10000 ? (Math.round(n / 100) / 100) + 'w' : (Math.round(n * 100) / 100).toString();
  }
  function fmtTime(s) { return s ? String(s).slice(0, 16) : '—'; }
  function fmtCny(n) {
    n = Number(n || 0);
    return '¥' + (n >= 1 ? (Math.round(n * 100) / 100) : n.toFixed(4));
  }
  function api(path, opts) {
    opts = opts || {};
    if (!window.XLAuth) return Promise.reject(new Error('auth.js 未加载'));
    return XLAuth.api(path, opts);
  }
  function errText(e) {
    if (!e) return '操作失败';
    if (e.status === 401) return '登录已失效，请重新登录';
    if (e.status === 403) return '需要管理员权限';
    return (e.data && (e.data.hint || e.data.message || e.data.error)) || e.message || ('请求失败' + (e.status || ''));
  }
  var TOAST_T = null;
  function injectCss() {
    if (document.getElementById('csai-style')) return;
    var s = document.createElement('style');
    s.id = 'csai-style';
    s.textContent = [
      '#panel-csai .oe-table{min-width:840px}',
      '#panel-csai .oe-table th,#panel-csai .oe-table td{white-space:nowrap;vertical-align:middle;padding:6px 6px;font-size:12px}',
      '#panel-csai .oe-table td:nth-child(2){min-width:230px;white-space:normal}',
      '#panel-csai .oe-table td .msub{max-width:320px;white-space:normal;line-height:1.45;color:var(--oe-txt2)}',
      '#panel-csai .oe-table td.mono{font-size:11px}',
      '#panel-csai .oe-table td .mname{white-space:normal}',
      '#panel-csai .oe-form-grid{gap:12px}',
      '#panel-csai .oe-stats{margin-bottom:14px}',
      '#panel-csai .oe-chiprow{flex-wrap:wrap}',
      '#panel-csai .oe-textarea{font-family:inherit;font-size:13px;line-height:1.6;border-radius:10px;border:1px solid var(--oe-line,#263341);background:var(--oe-bg2,#0b1220);color:var(--oe-txt,#e5edf5);padding:10px}',
      '#panel-csai .oe-kv{padding:5px 0;border-bottom:1px dashed rgba(148,163,184,.16)}',
      '#panel-csai .oe-kv:last-child{border-bottom:0}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function toast(msg, kind, ms) {
    var box = $('#csaiToast');
    if (!box) {
      box = el('div', 'oe-toastbox', '');
      box.id = 'csaiToast';
      document.body.appendChild(box);
    }
    var t = el('div', 'oe-toast ' + (kind === 'bad' ? 'bad' : kind === 'warn' ? 'warn' : 'ok'),
      '<span>' + (kind === 'bad' ? '⚠️' : kind === 'warn' ? '⚠️' : '✅') + '</span><span>' + esc(msg) + '</span>');
    box.appendChild(t);
    clearTimeout(TOAST_T);
    TOAST_T = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 3200);
  }

  var S = {
    built: false, ws: '', workspaces: [], tab: 'kb', loading: false,
    kb: null, sessions: null, stats: null, config: null, missed: null,
    sessFilter: { status: '', level: '', q: '', lead: '' }
  };

  function headHtml() {
    return '' +
      '<div class="oe-card" style="margin-bottom:14px">' +
      '  <div class="oe-card-h"><div><h2><span class="hico">🤖</span>AI 智能客服 <span class="oe-badge cyan">P0 · 网页挂件</span></h2>' +
      '  <p class="oe-sub">知识库三层来源（商家定制 &gt; 行业模板 &gt; 对话回流）+ DeepSeek 对话 + 留资/转人工；<b>P0 默认含在套餐内、不扣客户积分</b>，仅记录内部成本。企微/抖音官方接口 P1 预留。</p></div>' +
      '  <div class="right" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '    <select class="oe-select" id="csaiWs" aria-label="选择工作区" style="min-width:190px"><option value="">加载工作区…</option></select>' +
      '    <a class="oe-btn ghost sm" id="csaiOpenStore" target="_blank" rel="noopener" href="#">打开商家承接页 ↗</a>' +
      '    <button class="oe-btn sm" type="button" id="csaiRefresh">↻ 刷新</button>' +
      '  </div></div>' +
      '  <div class="oe-card-b tight"><div id="csaiHeadNote" class="oe-tiny" style="color:var(--oe-txt2)">加载中…</div></div>' +
      '</div>' +
      '<div class="oe-stats" id="csaiStats" style="margin-bottom:14px"></div>' +
      '<div class="oe-sumline" id="csaiSubtabs" style="margin-bottom:14px">' +
      '  <button class="oe-chip on" type="button" data-cs-tab="kb">📚 知识库</button>' +
      '  <button class="oe-chip" type="button" data-cs-tab="sessions">💬 会话</button>' +
      '  <button class="oe-chip" type="button" data-cs-tab="missed">❓ 未命中<span id="csaiMissedN" class="n" hidden></span></button>' +
      '  <button class="oe-chip" type="button" data-cs-tab="stats">📊 数据看板</button>' +
      '  <button class="oe-chip" type="button" data-cs-tab="config">⚙️ 规则与人设</button>' +
      '  <span class="right" id="csaiSubNote"></span>' +
      '</div>' +
      '<div id="csaiView"><div class="oe-loading"><div class="sp"></div>加载 AI 客服数据…</div></div>';
  }

  function render(panel) {
    if (!panel) return;
    injectCss();
    if (!S.built) {
      panel.innerHTML = headHtml();
      S.built = true;
      bind(panel);
      loadWorkspaces(true);
    } else {
      loadAll(false);
    }
  }

  function bind(panel) {
    panel.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-cs-tab]') : null;
      if (t) { switchTab(t.getAttribute('data-cs-tab')); }
    });
    panel.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'csaiWs') {
        S.ws = ev.target.value;
        S.kb = S.sessions = S.stats = S.config = S.missed = null;
        loadAll(true);
      }
      if (ev.target && ev.target.id === 'csaiSessStatus') { S.sessFilter.status = ev.target.value; loadSessions(); }
      if (ev.target && ev.target.id === 'csaiSessLevel') { S.sessFilter.level = ev.target.value; loadSessions(); }
      if (ev.target && ev.target.id === 'csaiSessLead') { S.sessFilter.lead = ev.target.value; loadSessions(); }
    });
    panel.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.id === 'csaiSessQ') {
        S.sessFilter.q = ev.target.value.trim();
        loadSessions();
      }
    });
    var btn = $('#csaiRefresh');
    if (btn) btn.addEventListener('click', function () { loadAll(true); });
  }

  function switchTab(tab) {
    S.tab = tab;
    $$('#csaiSubtabs .oe-chip').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-cs-tab') === tab);
    });
    var v = $('#csaiView');
    if (!v) return;
    if (tab === 'kb') renderKb(v);
    else if (tab === 'sessions') loadSessions(true);
    else if (tab === 'missed') loadMissed(true);
    else if (tab === 'stats') loadStatsView(true);
    else if (tab === 'config') loadConfig(true);
  }

  function setSubNote(text) { var n = $('#csaiSubNote'); if (n) n.textContent = text || ''; }

  function loadWorkspaces(initial) {
    api('/cs/workspaces', { timeout: 20000 }).then(function (d) {
      S.workspaces = d.items || [];
      var sel = $('#csaiWs');
      if (!sel) return;
      var cur = S.ws || (_storedWs());
      sel.innerHTML = S.workspaces.map(function (w) {
        return '<option value="' + esc(w.workspace_id) + '">' + esc(w.name || w.workspace_id) +
          '（' + esc(w.workspace_id) + '）' + (w.enabled ? ' · AI已启用' : '') + '</option>';
      }).join('') || '<option value="">暂无商家工作区</option>';
      if (cur && S.workspaces.some(function (w) { return w.workspace_id === cur; })) sel.value = cur;
      else if (S.workspaces.length) sel.value = S.workspaces[0].workspace_id;
      S.ws = sel.value;
      try { localStorage.setItem('xl_csai_ws', S.ws); } catch (e) {}
      loadAll(true);
    }).catch(function (e) {
      var v = $('#csaiView');
      if (v) v.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' +
        esc(errText(e)) + '（/cs/workspaces 需要管理员登录）</span></div>';
    });
  }
  function _storedWs() { try { return localStorage.getItem('xl_csai_ws') || ''; } catch (e) { return ''; } }

  function loadAll(force) {
    if (!S.ws) return;
    loadHeadNote();
    loadStats(force);
    if (S.tab === 'kb') loadKb(force);
    else if (S.tab === 'sessions') loadSessions();
    else if (S.tab === 'missed') loadMissed(true);
    else if (S.tab === 'config') loadConfig(true);
  }

  function loadHeadNote() {
    var w = S.workspaces.filter(function (x) { return x.workspace_id === S.ws; })[0] || {};
    var note = $('#csaiHeadNote');
    if (!note) return;
    note.innerHTML = '当前工作区：<b>' + esc(w.name || S.ws) + '</b>　' +
      (w.slug ? '承接页 slug：<code>' + esc(w.slug) + '</code>' : '（该工作区暂无承接页，挂件不会展示）') +
      '　·　渠道：网页挂件（P0）｜企业微信、抖音私信官方接口：P1 预留' +
      '　·　会话记录保留 ≥180 天，按工作区隔离。';
    var link = $('#csaiOpenStore');
    if (link) link.href = w.slug ? ('../../store/?slug=' + encodeURIComponent(w.slug)) : '../../store/';
  }

  /* ---------------- KPI ---------------- */
  function loadStats(force) {
    if (!S.ws) return;
    if (S.stats && !force) { paintStats(); return; }
    api('/cs/stats?workspace_id=' + encodeURIComponent(S.ws) + '&days=7', { timeout: 25000 }).then(function (d) {
      S.stats = d;
      paintStats();
      setSubNote('统计窗口：近 7 天 · 更新于 ' + fmtTime(new Date().toISOString()));
      var badge = $('#oeCsAiBadge');
      if (badge && d.missed) {
        var n = Number(d.missed.open || 0);
        badge.textContent = n;
        badge.hidden = !n;
      }
      var mn = $('#csaiMissedN');
      if (mn) { mn.textContent = String((d.missed && d.missed.open) || 0); mn.hidden = !(d.missed && d.missed.open); }
    }).catch(function (e) {
      var box = $('#csaiStats');
      if (box) box.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' + esc(errText(e)) + '</span></div>';
    });
  }

  function statCard(tone, icon, label, value, id) {
    return '<article class="oe-stat ' + tone + '"><div class="s-top"><span class="s-ico">' + icon +
      '</span><span class="s-lb">' + esc(label) + '</span></div><div class="s-v" id="' + id + '">' + value + '</div></article>';
  }

  function paintStats() {
    var d = S.stats || {};
    var box = $('#csaiStats');
    if (!box) return;
    var t = d.today_stats || {}, r = d.range || {}, rates = d.rates || {};
    box.innerHTML =
      statCard('c-cyan', '💬', '今日会话', fmtN(t.sessions), 'csaiK1') +
      statCard('c-lime', '✅', '自动解决率', (rates.auto_resolve_rate || 0) + '%', 'csaiK2') +
      statCard('c-violet', '📞', '留资率', (rates.lead_rate || 0) + '%', 'csaiK3') +
      statCard('c-blue', '⚡', '平均响应', (rates.avg_latency_ms || 0) + 'ms', 'csaiK4') +
      statCard('c-amber', '💰', '今日成本', fmtCny(t.cost_cny || 0), 'csaiK5') +
      statCard('c-pink', '🎯', '建议跟进会话', fmtN((r.handoff_recommended || 0)), 'csaiK6');
  }

  /* ---------------- 知识库 ---------------- */
  function loadKb(force) {
    if (!S.ws) return;
    if (S.kb && !force) { paintKb(); return; }
    var v = $('#csaiView');
    if (v) v.innerHTML = '<div class="oe-loading"><div class="sp"></div>加载知识库…</div>';
    api('/cs/kb?workspace_id=' + encodeURIComponent(S.ws), { timeout: 30000 }).then(function (d) {
      S.kb = d;
      paintKb();
    }).catch(function (e) {
      if (v) v.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' + esc(errText(e)) + '</span></div>';
    });
  }

  function paintKb() {
    var d = S.kb || {}, v = $('#csaiView');
    if (!v) return;
    var st = d.stats || {};
    var docs = d.docs || [];
    var rows = docs.map(function (x) {
      var sw = x.enabled ? '<span class="oe-badge lime">启用</span>' : '<span class="oe-badge gray">停用</span>';
      var layer = x.source === 'merchant' ? '<span class="oe-badge cyan">商家定制</span>' :
        x.source === 'template' ? '<span class="oe-badge violet">行业模板</span>' :
          '<span class="oe-badge amber">对话回流</span>';
      var assets = (x.asset_urls || []).length ? '<span class="oe-tiny" title="素材挂接">🖼 ' + (x.asset_urls || []).length + '</span>' : '';
      return '<tr><td class="num">' + x.id + '</td>' +
        '<td class="strong"><div class="mname">' + esc(x.title) + '</div><div class="msub clamp2">' + esc(String(x.content || '').slice(0, 90)) + '</div></td>' +
        '<td>' + layer + '</td><td class="num">' + (x.chunks || 0) + '</td><td>' + sw + ' ' + assets + '</td>' +
        '<td class="num">' + (x.priority || 0) + '</td><td class="num">' + fmtTime(x.updated_at) + '</td>' +
        '<td class="actions">' +
        '<button class="oe-btn xs ghost" data-cs-act="doc-edit" data-id="' + x.id + '">编辑</button>' +
        '<button class="oe-btn xs ghost" data-cs-act="doc-toggle" data-id="' + x.id + '">' + (x.enabled ? '停用' : '启用') + '</button>' +
        '<button class="oe-btn xs danger" data-cs-act="doc-del" data-id="' + x.id + '">删除</button>' +
        '</td></tr>';
    }).join('') || '<tr><td colspan="8"><div class="empty">还没有知识库。点右上角「一键生成知识库」：会从商家承接页字段 + 行业字典 + 工作区资料自动生成，并启用网页挂件。</div></td></tr>';
    var rules = (d.rules || []).map(function (r) {
      return '<tr><td class="num">' + r.id + '</td><td class="strong">' + esc(r.question || '') + '</td>' +
        '<td class="msub" style="max-width:420px">' + esc(r.answer || '') + '</td>' +
        '<td class="oe-tiny">' + esc(r.keywords || '') + '</td>' +
        '<td>' + (r.enabled ? '<span class="oe-badge lime">启用</span>' : '<span class="oe-badge gray">停用</span>') + '</td>' +
        '<td class="actions"><button class="oe-btn xs ghost" data-cs-act="rule-edit" data-id="' + r.id + '">编辑</button>' +
        '<button class="oe-btn xs danger" data-cs-act="rule-del" data-id="' + r.id + '">删除</button></td></tr>';
    }).join('') || '<tr><td colspan="6"><div class="empty">还没有问答规则。一键生成知识库会自动写入 11 条行业常见问答。</div></td></tr>';
    var embed = d.embedding || {};
    v.innerHTML =
      '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div><h2><span class="hico">📚</span>知识库管理</h2>' +
      '<p class="oe-sub">三层来源：<b>商家定制</b>（承接页/手动/导入，检索优先）&gt; <b>行业模板</b>（行业字典）&gt; <b>对话回流</b>（未命中补充）。切片 500 字 / overlap 80，检索 top5 注入 prompt。' +
      (embed.available ? '语义检索：SiliconFlow ' + esc(embed.model || 'bge-m3') + '（已缓存向量，失败回退关键词）。' : '语义检索不可用：当前仅关键词检索。') + '</p></div>' +
      '<div class="right" style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="oe-btn primary sm" data-cs-act="kb-generate">⚡ 一键生成知识库</button>' +
      '<button class="oe-btn sm" data-cs-act="doc-new">＋ 新增文档</button>' +
      '<button class="oe-btn sm" data-cs-act="kb-import">⬆ 批量导入</button></div></div>' +
      '<div class="oe-card-b tight"><div class="oe-sumline"><span>文档 <b>' + (st.docs || 0) + '</b></span><span class="sep">·</span>' +
      '<span>切片 <b>' + (st.chunks || 0) + '</b></span><span class="sep">·</span>' +
      '<span>启用 <b>' + (st.enabled_docs || 0) + '</b></span><span class="sep">·</span>' +
      '<span>商家定制 <b>' + (st.merchant_docs || 0) + '</b></span><span class="sep">·</span>' +
      '<span>行业模板 <b>' + (st.template_docs || 0) + '</b></span><span class="sep">·</span>' +
      '<span>对话回流 <b>' + (st.feedback_docs || 0) + '</b></span><span class="sep">·</span>' +
      '<span>问答规则 <b>' + (st.rules || 0) + '</b></span><span class="sep">·</span>' +
      '<span>行业匹配：<b>' + esc((d.industry && d.industry.name) || '—') + '</b>' +
      (d.industry && d.industry.template_id ? '（' + esc(d.industry.template_id) + '）' : '') + '</span>' +
      '<span class="right">挂件状态：' + (d.enabled ? '<b style="color:var(--oe-ok,#34d399)">已启用</b>' : '<b style="color:var(--oe-warn,#fbbf24)">未启用</b>') + '</span>' +
      '</div></div></div>' +
      '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div><h2><span class="hico">📄</span>知识库文档</h2>' +
      '<p class="oe-sub">可编辑/启停/删除；启用状态即时影响挂件回答（无需重启服务）。</p></div></div>' +
      '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table"><thead><tr>' +
      '<th>ID</th><th>标题 / 内容摘要</th><th>来源层</th><th>切片</th><th>状态</th><th>优先级</th><th>更新时间</th><th class="actions">操作</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div></div>' +
      '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🧩</span>问答规则（关键词命中直接作为标准回答注入）</h2>' +
      '<p class="oe-sub">行业常见问答由「一键生成」自动写入；可手动新增/编辑，用于价格、预约、范围等高频道问题的稳定口径。</p></div>' +
      '<div class="right"><button class="oe-btn sm" data-cs-act="rule-new">＋ 新增问答</button></div></div>' +
      '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table"><thead><tr>' +
      '<th>ID</th><th>问题</th><th>标准回答</th><th>关键词</th><th>状态</th><th class="actions">操作</th>' +
      '</tr></thead><tbody>' + rules + '</tbody></table></div></div></div>';
    setSubNote('知识库生成于 ' + fmtTime(d.generated_at || (d.config && d.config.updated_at)) + ' · 共 ' + (st.docs || 0) + ' 篇');
  }

  /* ---------------- 会话 ---------------- */
  function sessQuery() {
    var q = ['workspace_id=' + encodeURIComponent(S.ws), 'limit=40'];
    if (S.sessFilter.status) q.push('status=' + encodeURIComponent(S.sessFilter.status));
    if (S.sessFilter.level) q.push('level=' + encodeURIComponent(S.sessFilter.level));
    if (S.sessFilter.q) q.push('q=' + encodeURIComponent(S.sessFilter.q));
    if (S.sessFilter.lead) q.push('lead=1');
    return '/cs/sessions?' + q.join('&');
  }

  function loadSessions(renderView) {
    if (!S.ws) return;
    var v = $('#csaiView');
    if (renderView && v) v.innerHTML = '<div class="oe-loading"><div class="sp"></div>加载会话…</div>';
    api(sessQuery(), { timeout: 30000 }).then(function (d) {
      S.sessions = d;
      paintSessions();
    }).catch(function (e) {
      if (v) v.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' + esc(errText(e)) + '</span></div>';
    });
  }

  function paintSessions() {
    var d = S.sessions || {}, v = $('#csaiView');
    if (!v) return;
    var rows = (d.sessions || []).map(function (s) {
      var st = s.status === 'handoff' ? '<span class="oe-status bad"><i></i>转人工</span>' :
        s.status === 'closed' ? '<span class="oe-status gray"><i></i>已结束</span>' :
          '<span class="oe-status ok"><i></i>进行中</span>';
      var level = s.intent_level === 'high' ? '<span class="oe-badge red">高意向</span>' :
        s.intent_level === 'medium' ? '<span class="oe-badge amber">中意向</span>' : '<span class="oe-badge gray">低意向</span>';
      return '<tr><td class="mono tiny">' + esc(String(s.id || '').slice(0, 20)) + '</td>' +
        '<td><div class="mname">' + esc(s.contact_name || s.visitor || '访客') + '</div><div class="msub">' + esc(s.last_user || '—') + '</div></td>' +
        '<td>' + st + (s.handoff_recommended ? ' <span class="oe-badge violet" title="高意向，建议尽快跟进">建议跟进</span>' : '') + '</td>' +
        '<td>' + level + '<div class="msub" style="margin-top:2px">' + esc(s.funnel_label || '—') + '</div></td>' +
        '<td class="num">' + (s.messages || 0) + ' 条' + (s.has_lead ? '<div class="msub" style="margin-top:2px">已留资</div>' : '') + '</td>' +
        '<td class="num">' + fmtCny(s.cost_cny || 0) + '</td>' +
        '<td class="num">' + fmtTime(s.last_message_at || s.created_at) + '</td>' +
        '<td class="actions"><button class="oe-btn xs ghost" data-cs-act="sess-detail" data-id="' + esc(s.id) + '">详情</button></td></tr>';
    }).join('') || '<tr><td colspan="8"><div class="empty">暂无会话。商家启用挂件后，访客在承接页右下角咨询即可产生会话。</div></td></tr>';
    v.innerHTML =
      '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">💬</span>会话列表</h2>' +
      '<p class="oe-sub">共 <b>' + (d.total || 0) + '</b> 条；访客手机号在会话记录中自动打码，真实号码只写入线索台账。P0 转人工 = 商家在后台看到会话/线索后人工跟进。</p></div></div>' +
      '<div class="oe-card-b tight"><div class="oe-toolbar">' +
      '<select class="oe-select" id="csaiSessStatus"><option value="">全部状态</option><option value="open">进行中</option><option value="handoff">转人工</option><option value="closed">已结束</option></select>' +
      '<select class="oe-select" id="csaiSessLevel"><option value="">全部意向</option><option value="high">高意向</option><option value="medium">中意向</option><option value="low">低意向</option></select>' +
      '<select class="oe-select" id="csaiSessLead"><option value="">全部留资</option><option value="1">仅已留资</option></select>' +
      '<input class="oe-input grow" id="csaiSessQ" placeholder="搜索会话ID/访客/内容，回车筛选">' +
      '<button class="oe-btn sm" data-cs-act="sess-reload">查询</button></div>' +
      '<div class="oe-table-wrap"><table class="oe-table"><thead><tr>' +
      '<th>会话</th><th>访客 / 最后一句</th><th>状态</th><th>意向 / 漏斗</th><th>消息</th><th>成本</th><th>最后活动</th><th class="actions">操作</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
    var leadSel = $('#csaiSessLead');
    if (leadSel) leadSel.value = S.sessFilter.lead ? '1' : '';
    setSubNote('数据来自 cs_sessions / cs_messages（本地 SQLite，按工作区隔离）');
  }

  function openSessionDetail(sid) {
    api('/cs/session/' + encodeURIComponent(sid) + '?workspace_id=' + encodeURIComponent(S.ws), { timeout: 30000 })
      .then(function (d) { drawSessionModal(d); })
      .catch(function (e) { toast(errText(e), 'bad'); });
  }

  function drawSessionModal(d) {
    var s = d.session || {};
    var msgs = (d.messages || []).map(function (m) {
      var user = m.role === 'user';
      return '<div style="display:flex;justify-content:' + (user ? 'flex-end' : 'flex-start') + ';margin:7px 0">' +
        '<div style="max-width:82%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;' +
        (user ? 'background:rgba(34,211,238,.14);border:1px solid rgba(34,211,238,.25)' : 'background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.2)') + '">' +
        esc(m.content) + '</div></div>';
    }).join('') || '<div class="empty">暂无消息</div>';
    var leadHtml = d.lead ? ('<div class="oe-kv"><span>线索 ID</span><b>' + esc(d.lead.id) + '</b></div>' +
      '<div class="oe-kv"><span>称呼 / 手机</span><b>' + esc(d.lead.nickname || '') + ' / ' + esc(d.lead.phone || '') + '</b></div>' +
      '<div class="oe-kv"><span>需求</span><b>' + esc(d.lead.need || '—') + '</b></div>' +
      '<div class="oe-kv"><span>来源</span><b>' + esc(d.lead.platform || '') + ' · ' + esc(d.lead.source || '') + '</b></div>') :
      '<div class="oe-tiny" style="color:var(--oe-txt2)">本会话暂未留资（访客未提供手机号，或已被邮箱/微信等其他方式承接）。</div>';
    var stages = (d.funnel_stages || []).map(function (f) {
      return '<option value="' + esc(f.id) + '"' + (s.funnel_stage === f.id ? ' selected' : '') + '>' + esc(f.label) + '</option>';
    }).join('');
    var body =
      '<div class="oe-grid g21">' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🧾</span>对话记录</h2>' +
      '<p class="oe-sub">' + esc(String(s.id || '')) + ' · ' + esc(s.channel || 'web') + ' · ' + fmtTime(s.created_at) +
      ' · 消息 ' + (s.messages || 0) + ' 条 · tokens ' + (s.tokens || 0) + ' · 成本 ' + fmtCny(s.cost_cny || 0) + '</p></div></div>' +
      '<div class="oe-card-b" style="max-height:420px;overflow:auto">' + msgs + '</div></section>' +
      '<div>' +
      '<section class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div><h2><span class="hico">👤</span>留资与线索</h2>' +
      '<p class="oe-sub">高意向（问价/问地址/要预约/留手机号）会自动标记「建议跟进」。</p></div></div>' +
      '<div class="oe-card-b tight">' + leadHtml +
      '<div class="oe-kv"><span>意向等级</span><b>' + esc(s.intent_level_label || '—') + '</b></div>' +
      '<div class="oe-kv"><span>建议跟进</span><b>' + (s.handoff_recommended ? '是' : '否') + '</b></div>' +
      '<div class="oe-kv"><span>转人工</span><b>' + (s.handoff ? '是' : '否') + (s.handoff_reason ? '（' + esc(s.handoff_reason) + '）' : '') + '</b></div>' +
      '</div></section>' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🎯</span>成交漏斗回填</h2>' +
      '<p class="oe-sub">到店 / 成交等阶段由运营或商家手动回填，用于成交归因。</p></div></div>' +
      '<div class="oe-card-b tight">' +
      '<div class="oe-field"><label class="oe-label">当前阶段</label><select class="oe-select" id="csaiFunnel">' + stages + '</select></div>' +
      '<div class="oe-field"><label class="oe-label">结果（选填）</label><input class="oe-input" id="csaiOutcome" placeholder="如：已到店 / 已成交 / 流失" value="' + esc(s.outcome || '') + '"></div>' +
      '<div class="oe-field"><label class="oe-label">备注</label><input class="oe-input" id="csaiOutcomeNote" placeholder="跟进备注" value="' + esc(s.outcome_note || '') + '"></div>' +
      '<div class="oe-field"><button class="oe-btn primary sm" data-cs-act="sess-outcome" data-id="' + esc(s.id) + '">保存漏斗与结果</button></div>' +
      '</div></section></div></div>';
    openModal('会话详情', body, '');
  }

  /* ---------------- 未命中 ---------------- */
  function loadMissed(renderView) {
    if (!S.ws) return;
    var v = $('#csaiView');
    if (renderView && v) v.innerHTML = '<div class="oe-loading"><div class="sp"></div>加载未命中问题…</div>';
    api('/cs/missed?workspace_id=' + encodeURIComponent(S.ws) + '&status=open&limit=200', { timeout: 25000 })
      .then(function (d) { S.missed = d; paintMissed(); })
      .catch(function (e) {
        if (v) v.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' + esc(errText(e)) + '</span></div>';
      });
  }

  function paintMissed() {
    var d = S.missed || {}, v = $('#csaiView');
    if (!v) return;
    var rows = (d.items || []).map(function (x) {
      return '<tr><td class="strong">' + esc(x.question) + '</td><td class="num">' + (x.count || 1) + '</td>' +
        '<td class="num">' + fmtTime(x.last_at) + '</td>' +
        '<td class="actions"><button class="oe-btn xs primary" data-cs-act="missed-tokb" data-id="' + x.id + '">一键补充知识库</button>' +
        '<button class="oe-btn xs ghost" data-cs-act="missed-ignore" data-id="' + x.id + '">忽略</button></td></tr>';
    }).join('') || '<tr><td colspan="4"><div class="empty">暂无未命中问题。AI 回答不确定/走兜底时会自动收集到这里，可一键补充为「对话回流」知识库。</div></td></tr>';
    v.innerHTML =
      '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">❓</span>未命中问题池</h2>' +
      '<p class="oe-sub">来自 AI 低置信/兜底回答的访客问题；补充后生成 <b>对话回流</b> 知识库文档（检索优先级低于商家定制与行业模板），AI 即时生效。</p></div>' +
      '<div class="right"><button class="oe-btn sm" data-cs-act="missed-reload">↻ 刷新</button></div></div>' +
      '<div class="oe-card-b tight"><div class="oe-toolbar"><span class="count">待处理 <b>' + (d.total || 0) + '</b> 条</span></div>' +
      '<div class="oe-table-wrap"><table class="oe-table"><thead><tr><th>访客原问题</th><th>出现次数</th><th>最近时间</th><th class="actions">操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div></div>';
  }

  /* ---------------- 数据看板 ---------------- */
  function loadStatsView(force) {
    if (!S.ws) return;
    var v = $('#csaiView');
    if (S.stats && !force) { paintStatsView(); return; }
    if (v) v.innerHTML = '<div class="oe-loading"><div class="sp"></div>加载看板…</div>';
    api('/cs/stats?workspace_id=' + encodeURIComponent(S.ws) + '&days=7', { timeout: 25000 }).then(function (d) {
      S.stats = d;
      paintStats();
      paintStatsView();
    }).catch(function (e) {
      if (v) v.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' + esc(errText(e)) + '</span></div>';
    });
  }

  function paintStatsView() {
    var d = S.stats || {}, v = $('#csaiView');
    if (!v) return;
    var r = d.range || {}, rates = d.rates || {}, daily = d.daily || [];
    var maxS = Math.max(1, Math.max.apply(null, daily.map(function (x) { return x.sessions || 0; })));
    var dailyRows = daily.map(function (x) {
      var w1 = Math.round((x.sessions || 0) / maxS * 100);
      var w2 = Math.round((x.leads || 0) / maxS * 100);
      return '<div class="oe-dist-row"><span class="sw" style="background:rgba(34,211,238,.5)"></span><span class="nm">' + esc(x.date) + '</span>' +
        '<div class="track" style="flex:1;height:8px;border-radius:5px;background:rgba(148,163,184,.15);overflow:hidden;margin:0 8px">' +
        '<i style="display:block;height:100%;width:' + w1 + '%;background:linear-gradient(90deg,#22d3ee,#38bdf8)"></i></div>' +
        '<b>' + (x.sessions || 0) + '</b><small>会话 · 留资 ' + (x.leads || 0) + ' · 转人工 ' + (x.handoff || 0) + ' · ' + fmtCny(x.cost_cny || 0) + '</small></div>';
    }).join('') || '<div class="empty">暂无数据</div>';
    var funnels = (d.funnel || []).map(function (f) {
      var w = Math.round((f.count || 0) / Math.max(1, (d.funnel && d.funnel[0] && d.funnel[0].count) || 1) * 100);
      return '<div class="oe-barrow"><span class="bl"><b>' + esc(f.label) + '</b><span>' + (f.count || 0) + '</span></span>' +
        '<div class="track"><i style="width:' + w + '%"></i></div></div>';
    }).join('');
    var intents = (d.intents || []).map(function (x) {
      return '<div class="oe-kv"><span>' + esc(x.label) + '</span><b>' + (x.count || 0) + '</b></div>';
    }).join('') || '<div class="empty">暂无</div>';
    var levels = (d.intent_levels || []).map(function (x) {
      return '<div class="oe-kv"><span>' + esc(x.label) + '</span><b>' + (x.count || 0) + '</b></div>';
    }).join('') || '<div class="empty">暂无</div>';
    var hits = (d.script_hits && d.script_hits.top || []).map(function (x) {
      return '<div class="oe-kv"><span>' + esc(x.question) + '</span><b>' + x.count + '</b></div>';
    }).join('') || '<div class="empty">暂无话术命中</div>';
    var topMissed = (d.missed && d.missed.top || []).map(function (x) {
      return '<div class="oe-kv"><span>' + esc(x.question) + '</span><b>' + x.count + '</b></div>';
    }).join('') || '<div class="empty">暂无</div>';
    v.innerHTML =
      '<div class="oe-grid g2" style="margin-bottom:14px">' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">📈</span>近 ' + (d.days || 7) + ' 天会话与留资</h2>' +
      '<p class="oe-sub">柱长 = 当日会话量（按自然日 0 点切分）；右侧数字与成本来自 cs_messages 真实记录。</p></div></div>' +
      '<div class="oe-card-b tight">' + dailyRows + '</div></section>' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🎯</span>成交漏斗（近 ' + (d.days || 7) + ' 天）</h2>' +
      '<p class="oe-sub">咨询 → AI 接待 → 留资 → 预约为自动推进；到店/成交由运营在会话详情手动回填。</p></div></div>' +
      '<div class="oe-card-b tight">' + funnels + '</div></section></div>' +
      '<div class="oe-grid g3" style="margin-bottom:14px">' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🧠</span>访客意图分布</h2></div></div><div class="oe-card-b tight">' + intents + '</div></section>' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🔥</span>意向分级</h2></div></div><div class="oe-card-b tight">' + levels + '</div></section>' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🗣️</span>话术命中 Top</h2><p class="oe-sub">cs_script_hits</p></div></div><div class="oe-card-b tight">' + hits + '</div></section>' +
      '</div>' +
      '<div class="oe-grid g2">' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">❓</span>未命中问题 Top</h2><p class="oe-sub">可在「未命中」页一键补充知识库</p></div></div><div class="oe-card-b tight">' + topMissed + '</div></section>' +
      '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">💰</span>成本口径</h2><p class="oe-sub">P0 默认含在套餐内不扣客户积分，仅内部成本估算</p></div></div>' +
      '<div class="oe-card-b tight">' +
      '<div class="oe-kv"><span>近 ' + (d.days || 7) + ' 天 tokens</span><b>' + fmtN(r.tokens || 0) + '</b></div>' +
      '<div class="oe-kv"><span>输入 / 输出 tokens</span><b>' + fmtN(r.prompt_tokens || 0) + ' / ' + fmtN(r.completion_tokens || 0) + '</b></div>' +
      '<div class="oe-kv"><span>近 ' + (d.days || 7) + ' 天成本</span><b>' + fmtCny(r.cost_cny || 0) + '</b></div>' +
      '<div class="oe-kv"><span>单会话均成本</span><b>' + fmtCny(rates.avg_cost_per_session || 0) + '</b></div>' +
      '<div class="oe-kv"><span>费率（CNY / 1M tokens）</span><b>输入 ' + esc((d.cost && d.cost.input_cny_per_mtok) || 0) + ' · 输出 ' + esc((d.cost && d.cost.output_cny_per_mtok) || 0) + '</b></div>' +
      '<div class="oe-kv"><span>计费模式</span><b>' + (d.cost && d.cost.charge_mode === 'credits' ? '扣积分' : '套餐内（仅记成本）') + '</b></div>' +
      '<div class="oe-info" style="margin-top:10px"><span class="mini">💡</span><div>' + esc((d.cost && d.cost.note) || '') +
      '<br>对话记录按工作区隔离保留 ≥' + ((d.retention && d.retention.days) || 180) + ' 天。</div></div>' +
      '</div></section></div>';
    setSubNote('近 ' + (d.days || 7) + ' 天：会话 ' + (r.sessions || 0) + ' · 留资 ' + (r.leads || 0) + ' · 转人工 ' + (r.handoff || 0));
  }

  /* ---------------- 配置 ---------------- */
  function loadConfig(renderView) {
    if (!S.ws) return;
    var v = $('#csaiView');
    if (S.config && !renderView) { paintConfig(); return; }
    if (v) v.innerHTML = '<div class="oe-loading"><div class="sp"></div>加载配置…</div>';
    api('/cs/config?workspace_id=' + encodeURIComponent(S.ws), { timeout: 25000 }).then(function (d) {
      S.config = d;
      paintConfig();
    }).catch(function (e) {
      if (v) v.innerHTML = '<div class="oe-errbar dyn"><span>⚠️</span><span class="grow">' + esc(errText(e)) + '</span></div>';
    });
  }

  function paintConfig() {
    var d = S.config || {}, c = d.config || {}, v = $('#csaiView');
    if (!v) return;
    var p = c.persona || {}, h = c.handoff || {}, ra = c.rate || {}, co = c.cost || {}, kb = c.kb || {};
    v.innerHTML =
      '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div><h2><span class="hico">⚙️</span>AI 客服规则与人设</h2>' +
      '<p class="oe-sub">保存后立即生效（无需重启服务）。人设影响系统提示词；敏感词/越界问题由服务端护栏强制拦截改写，不依赖模型自觉。</p></div>' +
      '<div class="right"><span class="oe-badge ' + (c.enabled ? 'lime' : 'gray') + '">' + (c.enabled ? '挂件已启用' : '挂件未启用') + '</span></div></div>' +
      '<div class="oe-card-b"><div class="oe-form-grid">' +
      fieldSwitch('csaiCfgEnabled', '启用网页 AI 客服挂件（承接页右下角）', c.enabled) +
      fieldInput('csaiCfgWelcome', '欢迎语', c.welcome || '', 'span2', '展示在挂件顶部，建议 30-80 字') +
      fieldSelect('csaiCfgTone', '语气', p.tone || '亲切', [['亲切', '亲切'], ['专业', '专业'], ['热情', '热情']]) +
      fieldSelect('csaiCfgAddr', '称呼', p.address || '您', [['您', '您'], ['你', '你']]) +
      fieldInput('csaiCfgName', 'AI 身份名', p.name || 'AI 客服助理', '', '如：AI 客服助理（不得冒充真人）') +
      fieldInput('csaiCfgForbidden', '禁止承诺事项（逗号分隔）', (p.forbidden || []).join('，'), 'span2', '如：保证达标，永久不反弹，最低价') +
      fieldInput('csaiCfgHandoffKw', '转人工关键词（逗号分隔）', (h.keywords || []).join('，'), 'span2', '命中即转人工，如：转人工，找人工，投诉，退款') +
      fieldInput('csaiCfgMaxTurns', '未解决几轮提示转人工', h.max_turns || 3, '', '默认 3 轮') +
      fieldInput('csaiCfgContact', '转人工提示语', h.contact_hint || '', 'span2', '如：请留下称呼和手机号，商家会尽快联系您') +
      fieldInput('csaiCfgSensitive', '额外敏感词（逗号分隔）', (c.sensitive_words || []).join('，'), 'span2', '命中直接转人工（在系统敏感规则之外追加）') +
      fieldInput('csaiCfgQuick', '挂件快捷问题（逗号分隔，最多 8 个）', (c.quick_questions || []).join('，'), 'span2', '为空时由知识库问答自动生成') +
      fieldInput('csaiCfgRateMax', '限流：每会话/每 IP 条数', ra.max_msgs || 20, '', '默认 20 条 / 10 分钟') +
      fieldInput('csaiCfgWindow', '限流窗口（秒）', ra.window_sec || 600, '', '默认 600 秒') +
      fieldInput('csaiCfgDaily', '单工作区每日上限（条）', ra.daily_max || 300, '', '防刷成本，默认 300') +
      fieldInput('csaiCfgInRate', '成本费率：输入（CNY/1M tokens）', co.input_cny_per_mtok || 0.5, '', '仅内部成本估算') +
      fieldInput('csaiCfgOutRate', '成本费率：输出（CNY/1M tokens）', co.output_cny_per_mtok || 2.0, '', '仅内部成本估算') +
      fieldSelect('csaiCfgCharge', '计费模式', co.charge_mode || 'internal', [['internal', '套餐内（仅记成本，P0 默认）'], ['credits', '按积分计费（P1 预留）']]) +
      fieldSwitch('csaiCfgSemantic', '启用语义检索（SiliconFlow embedding，失败自动回退关键词）', kb.semantic !== false) +
      '</div><div class="oe-field" style="margin-top:12px"><button class="oe-btn primary" data-cs-act="cfg-save">保存配置</button>' +
      '<span class="oe-tiny" style="margin-left:10px;color:var(--oe-txt2)">P1 预留：企业微信客服、抖音企业号私信、独立坐席工作台、多轮坐席接管（P0 不抓取/不群发）。</span></div></div></div>' +
      '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🛡️</span>合规与数据</h2></div></div>' +
      '<div class="oe-card-b tight">' +
      '<div class="oe-kv"><span>对话记录保留</span><b>≥' + ((d.retention && d.retention.days) || 180) + ' 天（按工作区隔离）</b></div>' +
      '<div class="oe-kv"><span>AI 标识</span><b>挂件头部 + 每条回答均标注「AI 生成」，页脚提示以商家确认为准</b></div>' +
      '<div class="oe-kv"><span>敏感拦截</span><b>投诉/退款/医疗/法律/人身安全 → 转人工；绝对化用语/越界承诺 → 服务端改写</b></div>' +
      '<div class="oe-kv"><span>官方接口</span><b>企业微信活码复用 cs_hub（P0 仅返回已建活码）；抖音/企微客服会话为 P1</b></div>' +
      '</div></div>';
    setSubNote('配置更新于 ' + fmtTime(c.updated_at));
  }

  function fieldInput(id, label, value, span, hint) {
    return '<div class="oe-field ' + (span || '') + '"><label class="oe-label" for="' + id + '">' + esc(label) +
      (hint ? ' <small>' + esc(hint) + '</small>' : '') + '</label>' +
      '<input class="oe-input" id="' + id + '" value="' + esc(value == null ? '' : value) + '"></div>';
  }
  function fieldSelect(id, label, value, options) {
    return '<div class="oe-field"><label class="oe-label" for="' + id + '">' + esc(label) + '</label>' +
      '<select class="oe-select" id="' + id + '">' + options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></div>';
  }
  function fieldSwitch(id, label, on) {
    return '<div class="oe-field span2"><label class="oe-check" style="display:flex;gap:8px;align-items:center;cursor:pointer">' +
      '<input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + ' style="width:18px;height:18px">' + esc(label) + '</label></div>';
  }

  function saveConfig() {
    function val(id) { var e = $('#' + id); return e ? e.value : ''; }
    function chk(id) { var e = $('#' + id); return !!(e && e.checked); }
    var body = {
      workspace_id: S.ws,
      config: {
        enabled: chk('csaiCfgEnabled'),
        welcome: val('csaiCfgWelcome'),
        quick_questions: splitList(val('csaiCfgQuick')),
        sensitive_words: splitList(val('csaiCfgSensitive')),
        persona: { tone: val('csaiCfgTone'), address: val('csaiCfgAddr'), name: val('csaiCfgName'),
                   forbidden: splitList(val('csaiCfgForbidden')) },
        handoff: { keywords: splitList(val('csaiCfgHandoffKw')), max_turns: Number(val('csaiCfgMaxTurns')) || 3,
                   contact_hint: val('csaiCfgContact') },
        rate: { max_msgs: Number(val('csaiCfgRateMax')) || 20, window_sec: Number(val('csaiCfgWindow')) || 600,
                daily_max: Number(val('csaiCfgDaily')) || 300 },
        cost: { input_cny_per_mtok: Number(val('csaiCfgInRate')) || 0.5,
                output_cny_per_mtok: Number(val('csaiCfgOutRate')) || 2.0,
                charge_mode: val('csaiCfgCharge') },
        kb: { semantic: chk('csaiCfgSemantic') }
      }
    };
    api('/cs/config', { method: 'POST', body: body, timeout: 25000 }).then(function (d) {
      toast('配置已保存并立即生效');
      S.config = { ok: true, config: (d && d.config) || body.config, retention: { days: 180 } };
      paintConfig();
      loadStats(true);
    }).catch(function (e) { toast('保存失败：' + errText(e), 'bad', 5000); });
  }
  function splitList(v) {
    return String(v || '').split(/[,，;；\n]+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 100);
  }

  /* ---------------- 操作 ---------------- */
  function handleAct(act, node) {
    var id = node ? Number(node.getAttribute('data-id')) : 0;
    if (act === 'kb-generate') {
      if (!confirm('从商家承接页 + 行业字典 + 工作区资料一键生成知识库？会覆盖之前自动生成的文档与问答（手动/导入文档保留），并自动启用挂件。')) return;
      node.disabled = true;
      api('/cs/kb/generate', { method: 'POST', body: { workspace_id: S.ws, regenerate: true }, timeout: 90000 })
        .then(function () { toast('知识库已生成并启用，挂件即时生效'); S.kb = null; loadKb(true); loadStats(true); })
        .catch(function (e) { toast('生成失败：' + errText(e), 'bad', 6000); })
        .then(function () { node.disabled = false; });
      return;
    }
    if (act === 'doc-new') { openDocModal(null); return; }
    if (act === 'doc-edit') {
      var doc = (S.kb && S.kb.docs || []).filter(function (x) { return Number(x.id) === id; })[0];
      openDocModal(doc); return;
    }
    if (act === 'doc-toggle') {
      var d2 = (S.kb && S.kb.docs || []).filter(function (x) { return Number(x.id) === id; })[0];
      if (!d2) return;
      api('/cs/kb/docs/' + id, { method: 'PUT', body: { workspace_id: S.ws, enabled: !d2.enabled }, timeout: 20000 })
        .then(function () { toast(d2.enabled ? '已停用' : '已启用'); S.kb = null; loadKb(true); })
        .catch(function (e) { toast(errText(e), 'bad'); });
      return;
    }
    if (act === 'doc-del') {
      if (!confirm('删除该知识库文档？切片会一并删除，AI 将不再引用。')) return;
      api('/cs/kb/docs/' + id + '?workspace_id=' + encodeURIComponent(S.ws), { method: 'DELETE', timeout: 20000 })
        .then(function () { toast('已删除'); S.kb = null; loadKb(true); })
        .catch(function (e) { toast(errText(e), 'bad'); });
      return;
    }
    if (act === 'kb-import') { openImportModal(); return; }
    if (act === 'rule-new') { openRuleModal(null); return; }
    if (act === 'rule-edit') {
      var rule = (S.kb && S.kb.rules || []).filter(function (x) { return Number(x.id) === id; })[0];
      openRuleModal(rule); return;
    }
    if (act === 'rule-del') {
      if (!confirm('删除该问答规则？')) return;
      api('/cs/rules/' + id + '?workspace_id=' + encodeURIComponent(S.ws), { method: 'DELETE', timeout: 20000 })
        .then(function () { toast('已删除'); S.kb = null; loadKb(true); })
        .catch(function (e) { toast(errText(e), 'bad'); });
      return;
    }
    if (act === 'sess-reload') { loadSessions(); return; }
    if (act === 'sess-detail') { openSessionDetail(node.getAttribute('data-id')); return; }
    if (act === 'sess-outcome') { saveOutcome(node.getAttribute('data-id')); return; }
    if (act === 'missed-reload') { loadMissed(true); return; }
    if (act === 'missed-tokb') { openMissedModal(id); return; }
    if (act === 'missed-ignore') {
      api('/cs/missed/' + id + '/ignore', { method: 'POST', body: { workspace_id: S.ws }, timeout: 15000 })
        .then(function () { toast('已忽略'); loadMissed(true); loadStats(true); })
        .catch(function (e) { toast(errText(e), 'bad'); });
      return;
    }
    if (act === 'cfg-save') { saveConfig(); return; }
  }

  function saveOutcome(sid) {
    var stage = $('#csaiFunnel') ? $('#csaiFunnel').value : '';
    var outcome = $('#csaiOutcome') ? $('#csaiOutcome').value : '';
    var note = $('#csaiOutcomeNote') ? $('#csaiOutcomeNote').value : '';
    api('/cs/session/' + encodeURIComponent(sid) + '/outcome', {
      method: 'POST', timeout: 15000,
      body: { workspace_id: S.ws, funnel_stage: stage, outcome: outcome, note: note }
    }).then(function (d) {
      toast('漏斗已回填：' + ((d && d.funnel_label) || stage));
      closeModal();
      loadSessions();
      loadStats(true);
    }).catch(function (e) { toast('保存失败：' + errText(e), 'bad'); });
  }

  /* ---------------- Modal 工具 ---------------- */
  function openModal(title, bodyHtml, footerHtml) {
    closeModal();
    var mask = el('div', 'oe-mask on');
    mask.id = 'csaiMask';
    var box = el('div', 'oe-modal on');
    box.style.cssText = 'position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);width:min(920px,94vw);max-height:88vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;background:var(--oe-card,#111827);border:1px solid var(--oe-line,#263341);box-shadow:0 30px 80px rgba(0,0,0,.5)';
    box.innerHTML =
      '<div class="oe-modal-h" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--oe-line,#263341)">' +
      '<h3 style="margin:0;font-size:16px">' + esc(title) + '</h3>' +
      '<button class="oe-btn xs ghost" type="button" data-cs-act="modal-close">✕ 关闭</button></div>' +
      '<div class="oe-modal-b" style="padding:16px;overflow:auto;flex:1;min-height:0">' + bodyHtml + '</div>' +
      (footerHtml ? '<div class="oe-modal-f" style="padding:12px 16px;border-top:1px solid var(--oe-line,#263341)">' + footerHtml + '</div>' : '');
    mask.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(2,8,12,.62);backdrop-filter:blur(2px)';
    document.body.appendChild(mask);
    document.body.appendChild(box);
    mask.addEventListener('click', closeModal);
    box.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('[data-cs-act="modal-close"]')) closeModal();
    });
    return box;
  }
  function closeModal() {
    var m = $('#csaiMask');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    var ms = document.querySelectorAll('.oe-modal.on');
    Array.prototype.forEach.call(ms, function (x) { if (x.parentNode) x.parentNode.removeChild(x); });
  }

  function openDocModal(doc) {
    var isNew = !doc;
    var d = doc || { title: '', content: '', enabled: true, priority: 20, asset_urls: [] };
    var assets = (d.asset_urls || []).map(function (a) { return a.url || a; }).join('\n');
    openModal(isNew ? '新增知识库文档' : '编辑知识库文档',
      '<div class="oe-form-grid">' +
      fieldInput('csaiDocTitle', '标题', d.title || '', 'span2') +
      '<div class="oe-field span2"><label class="oe-label">内容（500 字/片自动切片；问答也可直接写）</label>' +
      '<textarea class="oe-textarea" id="csaiDocContent" style="width:100%;min-height:220px">' + esc(d.content || '') + '</textarea></div>' +
      fieldInput('csaiDocAssets', '素材挂接 URL（每行一个，图片/视频/案例链接；挂件会展示图片或链接卡片）', assets, 'span2') +
      fieldInput('csaiDocPriority', '优先级（越大越靠前）', d.priority == null ? 20 : d.priority, '', '0-100') +
      fieldSwitch('csaiDocEnabled', '启用', d.enabled !== false) +
      '</div>',
      '<button class="oe-btn primary" type="button" data-cs-act="doc-save" data-id="' + (d.id || '') + '">' +
      (isNew ? '创建并切片' : '保存修改') + '</button>');
  }

  function saveDoc(id) {
    function val(x) { var e = $('#' + x); return e ? e.value : ''; }
    var body = {
      workspace_id: S.ws, title: val('csaiDocTitle'), content: val('csaiDocContent'),
      asset_urls: val('csaiDocAssets'), priority: Number(val('csaiDocPriority')) || 0,
      enabled: $('#' + 'csaiDocEnabled') ? $('#csaiDocEnabled').checked : true
    };
    if (!body.title.trim()) { toast('请填写标题', 'warn'); return; }
    if (!body.content.trim()) { toast('请填写内容', 'warn'); return; }
    var req = id ? api('/cs/kb/docs/' + id, { method: 'PUT', body: body, timeout: 90000 })
      : api('/cs/kb/docs', { method: 'POST', body: body, timeout: 90000 });
    req.then(function (d) {
      toast('已保存（切片 ' + ((d && d.doc && d.doc.chunks) || 0) + ' 片）');
      closeModal(); S.kb = null; loadKb(true);
    }).catch(function (e) { toast('保存失败：' + errText(e), 'bad', 5000); });
  }

  function openImportModal() {
    openModal('批量导入知识库',
      '<div class="oe-field"><label class="oe-label">格式</label><select class="oe-select" id="csaiImpFormat">' +
      '<option value="faq">FAQ 文本（Q: ... A: ... 或 问：... 答：...）</option>' +
      '<option value="csv">CSV（表头：title,content 或 question,answer）</option>' +
      '<option value="text">纯文本（空行分段，每段一篇文档）</option></select></div>' +
      '<div class="oe-field"><label class="oe-label">模式</label><select class="oe-select" id="csaiImpMode">' +
      '<option value="append">追加（保留现有手动文档）</option><option value="replace">覆盖（替换现有手动/导入文档）</option></select></div>' +
      '<div class="oe-field span2"><label class="oe-label">粘贴内容</label>' +
      '<textarea class="oe-textarea" id="csaiImpText" style="width:100%;min-height:240px" placeholder="Q: 你们能开发票吗？\nA: 可以，具体开票信息请与商家确认。\n\nQ: 周末上班吗？\nA: 营业时间周一至周日 09:00-18:00。"></textarea></div>',
      '<button class="oe-btn primary" type="button" data-cs-act="import-go">开始导入</button>');
  }

  function doImport() {
    var fmt = $('#csaiImpFormat').value, mode = $('#csaiImpMode').value, text = $('#csaiImpText').value;
    if (!text.trim()) { toast('请粘贴导入内容', 'warn'); return; }
    api('/cs/kb/import', { method: 'POST', timeout: 120000, body: { workspace_id: S.ws, format: fmt, mode: mode, text: text } })
      .then(function (d) {
        toast('已导入 ' + ((d && d.imported) || 0) + ' 篇文档并切片');
        closeModal(); S.kb = null; loadKb(true);
      }).catch(function (e) { toast('导入失败：' + errText(e), 'bad', 6000); });
  }

  function openRuleModal(rule) {
    var r = rule || { question: '', answer: '', keywords: '', enabled: true };
    openModal(rule ? '编辑问答规则' : '新增问答规则',
      '<div class="oe-form-grid">' +
      fieldInput('csaiRuleQ', '问题', r.question || '', 'span2') +
      '<div class="oe-field span2"><label class="oe-label">标准回答</label>' +
      '<textarea class="oe-textarea" id="csaiRuleA" style="width:100%;min-height:120px">' + esc(r.answer || '') + '</textarea></div>' +
      fieldInput('csaiRuleKw', '命中关键词（逗号分隔）', r.keywords || '', 'span2', '关键词命中时直接把标准回答注入 prompt') +
      fieldSwitch('csaiRuleOn', '启用', r.enabled !== false) +
      '</div>',
      '<button class="oe-btn primary" type="button" data-cs-act="rule-save" data-id="' + (r.id || '') + '">保存</button>');
  }

  function saveRule(id) {
    function val(x) { var e = $('#' + x); return e ? e.value : ''; }
    var body = { workspace_id: S.ws, question: val('csaiRuleQ'), answer: val('csaiRuleA'), keywords: val('csaiRuleKw'),
      enabled: $('#csaiRuleOn') ? $('#csaiRuleOn').checked : true };
    if (!body.question.trim()) { toast('请填写问题', 'warn'); return; }
    var req = id ? api('/cs/rules/' + id, { method: 'PUT', body: body, timeout: 20000 })
      : api('/cs/rules', { method: 'POST', body: body, timeout: 20000 });
    req.then(function () { toast('规则已保存'); closeModal(); S.kb = null; loadKb(true); })
      .catch(function (e) { toast('保存失败：' + errText(e), 'bad'); });
  }

  function openMissedModal(id) {
    var item = (S.missed && S.missed.items || []).filter(function (x) { return Number(x.id) === id; })[0] || {};
    openModal('补充未命中问题到知识库',
      '<div class="oe-field"><label class="oe-label">访客问题</label><div class="oe-input" style="height:auto;padding:9px 10px">' + esc(item.question || '') + '</div></div>' +
      '<div class="oe-field"><label class="oe-label">标准回答（可留空，生成后到知识库编辑）</label>' +
      '<textarea class="oe-textarea" id="csaiMissedA" style="width:100%;min-height:130px" placeholder="如：我们支持开票，具体开票信息请与商家确认。"></textarea></div>' +
      '<div class="oe-info"><span class="mini">💡</span><div>补充生成的文档会标记为「对话回流」，检索优先级低于商家定制与行业模板，用于覆盖长尾问题。</div></div>',
      '<button class="oe-btn primary" type="button" data-cs-act="missed-save" data-id="' + id + '">生成文档并标记已处理</button>');
  }

  function saveMissed(id) {
    var a = $('#csaiMissedA') ? $('#csaiMissedA').value : '';
    api('/cs/missed/' + id + '/to-kb', { method: 'POST', timeout: 30000, body: { workspace_id: S.ws, answer: a } })
      .then(function () { toast('已补充为「对话回流」知识库文档，AI 即时生效'); closeModal(); S.kb = null; loadMissed(true); loadStats(true); })
      .catch(function (e) { toast('补充失败：' + errText(e), 'bad'); });
  }

  /* modal 内按钮事件（document 级委托） */
  document.addEventListener('click', function (ev) {
    if (!window.__XL_CS_AI_OPS__) return;
    var node = ev.target.closest ? ev.target.closest('[data-cs-act]') : null;
    if (!node) return;
    var act = node.getAttribute('data-cs-act');
    if (act === 'doc-save') { saveDoc(Number(node.getAttribute('data-id')) || 0); return; }
    if (act === 'import-go') { doImport(); return; }
    if (act === 'rule-save') { saveRule(Number(node.getAttribute('data-id')) || 0); return; }
    if (act === 'missed-save') { saveMissed(Number(node.getAttribute('data-id')) || 0); return; }
    if (act === 'sess-outcome') { saveOutcome(node.getAttribute('data-id')); return; }
    if (act === 'modal-close') { closeModal(); return; }
    var panel = document.getElementById('panel-csai');
    if (panel && panel.contains(node)) handleAct(act, node);
  });

  window.XLCsAiOps = {
    render: function () {
      var panel = document.getElementById('panel-csai');
      if (panel) render(panel);
    },
    state: S
  };
})();
