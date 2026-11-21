/* 星籁剪辑 · 运营端「商用素材库」组件（/ops/edit/ 引入，admin only）
 * 依赖：assets/auth.js（window.XLAuth）
 * 功能：素材总览 / 行业统计 / 抓取任务 / 审核下架 / 授权台账 / 使用统计 / 行业素材包
 * 说明：仅运营后台加载，用户端不加载此文件。
 */
(function () {
  'use strict';
  if (window.__XL_ASSETS_OPS__) return;
  window.__XL_ASSETS_OPS__ = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.XLAuth && XLAuth.esc ? XLAuth.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { n = Number(n || 0); return n.toLocaleString('zh-CN'); }
  function fmtSize(n) {
    n = Number(n || 0);
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? Math.round(n) : n.toFixed(1)) + u[i];
  }
  function fmtTime(s) { return s ? String(s).slice(0, 19) : '—'; }
  function toast(m, k, ms) { if (window.XLAuth && XLAuth.toast) XLAuth.toast(m, k || 'good', ms || 2800); }
  function api(path, opts) {
    return XLAuth.api(path, opts || {}).catch(function (e) {
      if (e && e.status === 401) toast('登录已失效，请重新登录', 'warn', 4000);
      else if (e && e.status === 403) toast('需要管理员权限', 'warn', 4000);
      throw e;
    });
  }
  function errText(e) {
    if (!e) return '操作失败';
    if (e.status === 401) return '登录已失效';
    if (e.status === 403) return '需要管理员权限';
    return (e.data && (e.data.hint || e.data.message)) || e.message || ('请求失败' + (e.status || ''));
  }
  function statCard(tone, icon, label, id) {
    return '<article class="oe-stat ' + tone + '"><div class="s-top"><span class="s-ico">' + icon +
      '</span><span class="s-lb">' + esc(label) + '</span></div><div class="s-v" id="' + id + '">—</div></article>';
  }
  function badge(text, tone) {
    return '<span class="oe-badge ' + (tone || 'gray') + '">' + esc(text) + '</span>';
  }
  function typeName(t) {
    return { image: '图片', video: '视频', music: '音乐', sfx: '音效', font: '字体' }[t] || t;
  }
  function statusName(s) { return { active: '上架中', offline: '已下架', deleted: '已删除' }[s] || s; }

  var AS = {
    built: false, view: 'overview', ov: null,
    review: { page: 1, type: '', status: '', industry: '', q: '', total: 0 },
    lic: { page: 1, code: '', q: '', total: 0 },
    packsLoaded: false
  };

  /* ------------------------------------------------------------ 构建面板 */
  function build(panel) {
    panel.innerHTML =
      '<div class="oe-stats" style="margin-bottom:14px">'
      + statCard('c-cyan', '🎬', '素材总数', 'asTotal')
      + statCard('c-blue', '🖼️', '图片', 'asImage')
      + statCard('c-violet', '📹', '视频', 'asVideo')
      + statCard('c-lime', '🎵', '音乐', 'asMusic')
      + statCard('c-amber', '🔔', '音效', 'asSfx')
      + statCard('c-pink', '🔤', '字体', 'asFont')
      + statCard('c-teal', '📜', '授权台账', 'asLic')
      + statCard('c-orange', '☁️', 'OSS 占用', 'asStorage')
      + '</div>'
      + '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div>'
      + '<h2><span class="hico">📈</span>首批目标进度（全部免费可商用）</h2>'
      + '<p class="oe-sub">目标：视频 3000 / 图片 8000 / 音乐 500 / 音效 1000；定时管线每天 03:30 自动按缺口补齐。</p></div>'
      + '<div class="oe-toolbar"><button class="oe-btn ghost" type="button" data-as-act="refresh">刷新全部</button></div></div>'
      + '<div class="oe-card-b tight" id="asGap"></div></div>'

      + '<div class="oe-toolbar" id="asTabs" style="margin-bottom:14px">'
      + '<button class="oe-btn primary" type="button" data-as-tab="overview">总览 / 行业统计</button>'
      + '<button class="oe-btn ghost" type="button" data-as-tab="jobs">抓取任务</button>'
      + '<button class="oe-btn ghost" type="button" data-as-tab="review">审核 / 下架</button>'
      + '<button class="oe-btn ghost" type="button" data-as-tab="licenses">授权台账</button>'
      + '<button class="oe-btn ghost" type="button" data-as-tab="usage">使用统计</button>'
      + '<button class="oe-btn ghost" type="button" data-as-tab="packs">行业素材包</button>'
      + '</div>'

      + '<div data-as-view="overview">'
      + '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div>'
      + '<h2><span class="hico">🏷️</span>按行业统计</h2><p class="oe-sub">30 个行业 × 5 种素材类型；数量来自 asset.db 实时统计。</p></div>'
      + '<div class="oe-toolbar"><span class="oe-badge" id="asIndInfo">—</span></div></div>'
      + '<div class="oe-table-wrap"><table class="oe-table" style="min-width:900px"><thead><tr>'
      + '<th style="width:150px">行业</th><th class="num">图片</th><th class="num">视频</th><th class="num">音乐</th>'
      + '<th class="num">音效</th><th class="num">字体</th><th class="num">合计</th><th style="width:220px">覆盖度</th></tr></thead>'
      + '<tbody id="asIndBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody></table></div></div>'
      + '<div class="oe-grid g2" style="margin-bottom:14px">'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🧾</span>来源分布</h2>'
      + '<p class="oe-sub">Pixabay / ccMixter / OpenGameArt / 官方字体源 等；授权台账逐条可查。</p></div></div>'
      + '<div class="oe-card-b tight" id="asSrc"></div></section>'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🔐</span>授权分布</h2>'
      + '<p class="oe-sub">只收录明确允许商用的授权；需署名素材会在 API 返回 attribution。</p></div></div>'
      + '<div class="oe-card-b tight" id="asLicDist"></div></section></div>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🗂️</span>最近抓取任务</h2>'
      + '<p class="oe-sub">点「抓取任务」可手动触发或查看进度。</p></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table" style="min-width:760px"><thead><tr>'
      + '<th style="width:70px">ID</th><th style="width:110px">类型</th><th style="width:120px">状态</th>'
      + '<th style="width:150px">开始</th><th style="width:150px">结束</th><th>结果摘要</th></tr></thead>'
      + '<tbody id="asRecentJobs"><tr><td colspan="6" class="empty">加载中…</td></tr></tbody></table></div></div></div>'
      + '</div>'

      + '<div data-as-view="jobs" hidden>'
      + '<div class="oe-grid g2" style="margin-bottom:14px">'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">▶️</span>手动触发抓取</h2>'
      + '<p class="oe-sub">遵守源站速率（Pixabay API ≤100 req/min）；可多天分批补齐。</p></div></div>'
      + '<div class="oe-card-b tight">'
      + '<div class="oe-toolbar" style="margin-bottom:10px;flex-wrap:wrap">'
      + '<label class="oe-tiny"><input type="checkbox" data-as-limit="image" checked> 图片</label>'
      + '<input class="oe-input" id="asLimImage" type="number" min="1" value="1000" style="max-width:110px">'
      + '<label class="oe-tiny"><input type="checkbox" data-as-limit="video" checked> 视频</label>'
      + '<input class="oe-input" id="asLimVideo" type="number" min="1" value="300" style="max-width:110px">'
      + '<label class="oe-tiny"><input type="checkbox" data-as-limit="music"> 音乐</label>'
      + '<input class="oe-input" id="asLimMusic" type="number" min="1" value="100" style="max-width:110px">'
      + '<label class="oe-tiny"><input type="checkbox" data-as-limit="sfx"> 音效</label>'
      + '<input class="oe-input" id="asLimSfx" type="number" min="1" value="200" style="max-width:110px">'
      + '</div>'
      + '<div class="oe-toolbar"><input class="oe-input grow" id="asJobNote" placeholder="备注（选填，仅审计记录）">'
      + '<button class="oe-btn primary" type="button" data-as-act="run-job">开始抓取</button>'
      + '<button class="oe-btn ghost" type="button" data-as-act="reload-jobs">刷新任务</button></div>'
      + '<p class="oe-tiny" style="margin-top:8px;color:var(--oe-txt3);line-height:1.7">'
      + '提示：大批量建议每批 ≤2000 条、分批多天跑；后台任务异步执行，可离开页面。</p>'
      + '</div></section>'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">⏱️</span>运行中</h2>'
      + '<p class="oe-sub">同一时间最多 2 个抓取任务；每 15 秒自动刷新。</p></div>'
      + '<button class="oe-btn ghost" type="button" data-as-act="reload-jobs">刷新</button></div>'
      + '<div class="oe-card-b tight" id="asRunning"></div></section></div>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">📜</span>抓取任务历史</h2>'
      + '<p class="oe-sub">asset_jobs：每次抓取的类型/限额/成功数/失败原因。</p></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table" style="min-width:980px"><thead><tr>'
      + '<th style="width:60px">ID</th><th style="width:90px">触发</th><th style="width:110px">类型</th>'
      + '<th style="width:100px">状态</th><th style="width:140px">开始</th><th style="width:140px">结束</th>'
      + '<th style="width:110px">新增</th><th>统计 / 错误</th></tr></thead>'
      + '<tbody id="asJobBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody></table></div></div></div>'
      + '</div>'

      + '<div data-as-view="review" hidden>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">✅</span>审核 / 下架</h2>'
      + '<p class="oe-sub">自动入库（授权已校验）默认上架；可疑/投诉素材可下架，下架后 API 立即 410。</p></div>'
      + '<div class="oe-toolbar">'
      + '<select class="oe-select" id="asRevType"><option value="">全部类型</option>'
      + '<option value="image">图片</option><option value="video">视频</option>'
      + '<option value="music">音乐</option><option value="sfx">音效</option><option value="font">字体</option></select>'
      + '<select class="oe-select" id="asRevStatus"><option value="">全部状态</option>'
      + '<option value="active">上架中</option><option value="offline">已下架</option></select>'
      + '<input class="oe-input" id="asRevQ" placeholder="标题 / 标签 / ID" style="max-width:220px">'
      + '<button class="oe-btn" type="button" data-as-act="review-search">查询</button></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table" style="min-width:1080px"><thead><tr>'
      + '<th style="width:64px">ID</th><th style="width:72px">预览</th><th>标题</th><th style="width:80px">类型</th>'
      + '<th style="width:90px">行业</th><th style="width:100px">授权</th><th style="width:90px">状态</th>'
      + '<th style="width:80px">下载</th><th style="width:200px">操作</th></tr></thead>'
      + '<tbody id="asRevBody"><tr><td colspan="9" class="empty">加载中…</td></tr></tbody></table></div>'
      + '<div class="oe-pager"><span id="asRevInfo">—</span><div class="pg">'
      + '<button class="oe-btn sm ghost" type="button" data-as-act="review-prev">上一页</button>'
      + '<button class="oe-btn sm ghost" type="button" data-as-act="review-next">下一页</button></div></div></div></div>'
      + '</div>'

      + '<div data-as-view="licenses" hidden>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">📜</span>授权台账</h2>'
      + '<p class="oe-sub">每条素材一条台账：授权协议 / 是否可商用 / 是否需署名 / 署名文本 / 证据 JSON。</p></div>'
      + '<div class="oe-toolbar">'
      + '<select class="oe-select" id="asLicCode"><option value="">全部授权</option>'
      + '<option value="pixabay">Pixabay License</option><option value="cc0">CC0</option>'
      + '<option value="cc-by-3.0">CC BY 3.0</option><option value="cc-by-4.0">CC BY 4.0</option>'
      + '<option value="ofl-1.1">SIL OFL 1.1</option></select>'
      + '<input class="oe-input" id="asLicQ" placeholder="标题 / 作者 / ID" style="max-width:220px">'
      + '<button class="oe-btn" type="button" data-as-act="lic-search">查询</button>'
      + '<button class="oe-btn ghost" type="button" data-as-act="lic-export">导出 CSV</button></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table" style="min-width:1100px"><thead><tr>'
      + '<th style="width:64px">素材</th><th>标题</th><th style="width:80px">类型</th><th style="width:90px">行业</th>'
      + '<th style="width:160px">授权协议</th><th style="width:80px">可商用</th><th style="width:80px">需署名</th>'
      + '<th style="width:150px">记录时间</th><th style="width:90px">操作</th></tr></thead>'
      + '<tbody id="asLicBody"><tr><td colspan="9" class="empty">加载中…</td></tr></tbody></table></div>'
      + '<div class="oe-pager"><span id="asLicInfo">—</span><div class="pg">'
      + '<button class="oe-btn sm ghost" type="button" data-as-act="lic-prev">上一页</button>'
      + '<button class="oe-btn sm ghost" type="button" data-as-act="lic-next">下一页</button></div></div></div></div>'
      + '</div>'

      + '<div data-as-view="usage" hidden>'
      + '<div class="oe-stats" style="margin-bottom:14px">'
      + statCard('c-cyan', '⬇️', '今日下载', 'asDownToday')
      + statCard('c-blue', '📊', '近 7 天下载', 'asDown7')
      + statCard('c-violet', '🔥', '总使用事件', 'asUsageTotal')
      + '</div>'
      + '<div class="oe-grid g2" style="margin-bottom:14px">'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">📅</span>按天使用量</h2></div></div>'
      + '<div class="oe-card-b tight" id="asUseDay"></div></section>'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🔥</span>热门素材 Top20</h2></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table"><thead><tr>'
      + '<th style="width:64px">ID</th><th>标题</th><th style="width:80px">类型</th><th class="num" style="width:80px">下载</th></tr></thead>'
      + '<tbody id="asTopBody"><tr><td colspan="4" class="empty">加载中…</td></tr></tbody></table></div></div></section></div>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🧾</span>操作审计（最近 20 条）</h2>'
      + '<p class="oe-sub">审核/下架/补标签/触发抓取/素材包生成都会留痕。</p></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table"><thead><tr>'
      + '<th style="width:150px">时间</th><th style="width:120px">操作人</th><th style="width:140px">动作</th>'
      + '<th style="width:80px">素材</th><th>详情</th></tr></thead>'
      + '<tbody id="asAuditBody"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody></table></div></div></div>'
      + '</div>'

      + '<div data-as-view="packs" hidden>'
      + '<div class="oe-grid g2" style="margin-bottom:14px">'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">📦</span>生成行业素材包</h2>'
      + '<p class="oe-sub">把一个行业的素材打包成 zip 存 OSS，桌面端可整包预下载（离线使用）。</p></div></div>'
      + '<div class="oe-card-b tight">'
      + '<div class="oe-toolbar" style="margin-bottom:10px">'
      + '<select class="oe-select" id="asPackIndustry"></select>'
      + '<select class="oe-select" id="asPackType"><option value="image">图片</option>'
      + '<option value="video">视频</option><option value="music">音乐</option>'
      + '<option value="sfx">音效</option><option value="font">字体</option></select>'
      + '<button class="oe-btn primary" type="button" data-as-act="pack-build">生成素材包</button>'
      + '<button class="oe-btn ghost" type="button" data-as-act="packs-refresh">刷新</button></div>'
      + '<p class="oe-tiny" style="color:var(--oe-txt3)">单包最多 150 个素材；生成需要 1~3 分钟（从 OSS 拉取后重新打包）。</p>'
      + '</div></section>'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">ℹ️</span>说明</h2></div></div>'
      + '<div class="oe-card-b tight"><p class="oe-sub" style="line-height:1.9">'
      + '· 素材包内的素材同样全部免费可商用，manifest.json 里带每条素材的授权与署名要求。<br>'
      + '· 桌面端也可以通过 <code>GET /api/assets/pack/manifest?industry=餐饮&amp;type=image</code> 拿到清单后逐个下载。<br>'
      + '· zip 下载链接为 OSS 短时效签名 URL，1 小时过期。</p></div></section></div>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">📚</span>已生成素材包</h2></div></div>'
      + '<div class="oe-card-b tight"><div class="oe-table-wrap"><table class="oe-table" style="min-width:900px"><thead><tr>'
      + '<th style="width:60px">ID</th><th style="width:110px">行业</th><th style="width:80px">类型</th>'
      + '<th style="width:90px">状态</th><th class="num" style="width:80px">数量</th><th class="num" style="width:100px">大小</th>'
      + '<th style="width:150px">生成时间</th><th style="width:120px">操作</th></tr></thead>'
      + '<tbody id="asPackBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody></table></div></div></div>'
      + '</div>';

    panel.addEventListener('click', function (ev) {
      var tab = ev.target.closest ? ev.target.closest('[data-as-tab]') : null;
      if (tab) { switchView(tab.getAttribute('data-as-tab')); return; }
      var act = ev.target.closest ? ev.target.closest('[data-as-act]') : null;
      if (!act) return;
      var a = act.getAttribute('data-as-act');
      if (a === 'refresh') { loadOverview(true); }
      else if (a === 'run-job') { runJob(); }
      else if (a === 'reload-jobs') { loadJobs(); }
      else if (a === 'review-search') { AS.review.page = 1; loadReview(); }
      else if (a === 'review-prev') { if (AS.review.page > 1) { AS.review.page--; loadReview(); } }
      else if (a === 'review-next') { AS.review.page++; loadReview(); }
      else if (a === 'lic-search') { AS.lic.page = 1; loadLicenses(); }
      else if (a === 'lic-prev') { if (AS.lic.page > 1) { AS.lic.page--; loadLicenses(); } }
      else if (a === 'lic-next') { AS.lic.page++; loadLicenses(); }
      else if (a === 'lic-export') { exportLicenses(); }
      else if (a === 'pack-build') { buildPack(); }
      else if (a === 'packs-refresh') { loadPacks(); }
      else if (a === 'rev-offline') { setStatus(act.getAttribute('data-id'), 'offline'); }
      else if (a === 'rev-active') { setStatus(act.getAttribute('data-id'), 'active'); }
      else if (a === 'rev-retag') { retag(act.getAttribute('data-id')); }
    });
    // 填充行业下拉
    api('/assets/industries').then(function (d) {
      var sel = $('#asPackIndustry');
      if (!sel) return;
      sel.innerHTML = (d.industries || []).filter(function (x) { return x.count > 0 || true; })
        .map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.name) + '（' + fmt(x.count) + '）</option>'; }).join('');
    }).catch(function () {});
    AS.built = true;
  }

  function switchView(v) {
    AS.view = v;
    $$('[data-as-view]').forEach(function (el) { el.hidden = el.getAttribute('data-as-view') !== v; });
    $$('#asTabs [data-as-tab]').forEach(function (b) {
      b.className = 'oe-btn ' + (b.getAttribute('data-as-tab') === v ? 'primary' : 'ghost');
    });
    if (v === 'jobs') loadJobs();
    else if (v === 'review') loadReview();
    else if (v === 'licenses') loadLicenses();
    else if (v === 'usage') loadUsage();
    else if (v === 'packs') loadPacks();
    else loadOverview();
  }

  /* ------------------------------------------------------------ 总览 */
  function loadOverview(force) {
    if (AS.ov && !force) { renderOverview(AS.ov); return; }
    api('/assets/ops/overview').then(function (d) {
      AS.ov = d; renderOverview(d);
    }).catch(function (e) {
      toast('素材库总览加载失败：' + errText(e), 'warn', 5000);
    });
  }

  function setText(id, v) { var el = $('#' + id); if (el) el.innerHTML = v; }

  function renderOverview(d) {
    var bt = d.by_type || {};
    setText('asTotal', fmt(d.total));
    setText('asImage', fmt(bt.image || 0));
    setText('asVideo', fmt(bt.video || 0));
    setText('asMusic', fmt(bt.music || 0));
    setText('asSfx', fmt(bt.sfx || 0));
    setText('asFont', fmt(bt.font || 0));
    setText('asLic', fmt(d.license_records || 0));
    setText('asStorage', esc((d.storage || {}).total_human || '—'));
    setText('asDownToday', fmt((d.usage || {}).downloads_today || 0));
    setText('asDown7', fmt((d.usage || {}).downloads_7d || 0));

    // 目标进度
    var tg = d.targets || {}, miss = d.missing || {};
    var gaps = ['image', 'video', 'music', 'sfx'].map(function (t) {
      var cur = bt[t] || 0, target = tg[t] || 0;
      var pct = target ? Math.min(100, Math.round(cur * 100 / target)) : 100;
      return '<div style="margin-bottom:10px"><div class="oe-toolbar" style="justify-content:space-between;margin-bottom:4px">'
        + '<span class="oe-tiny">' + typeName(t) + '：' + fmt(cur) + ' / ' + fmt(target) + '</span>'
        + '<span class="oe-tiny" style="color:var(--oe-txt3)">' + (miss[t] ? ('还差 ' + fmt(miss[t])) : '✅ 已达标') + '</span></div>'
        + '<div style="height:8px;border-radius:99px;background:rgba(148,163,184,.14);overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#38bdf8,#a78bfa)"></div></div></div>';
    }).join('');
    setText('asGap', gaps);

    // 行业统计
    var detail = d.industry_detail || [];
    var map = {};
    detail.forEach(function (x) { (map[x.industry] = map[x.industry] || {})[x.type] = x.count; });
    var inds = (d.by_industry || []).map(function (x) { return x.industry; });
    var rows = inds.map(function (ind) {
      var m = map[ind] || {};
      var total = (m.image || 0) + (m.video || 0) + (m.music || 0) + (m.sfx || 0) + (m.font || 0);
      var pct = Math.min(100, Math.round(total * 100 / 60));
      return '<tr><td><b>' + esc(ind) + '</b></td>'
        + '<td class="num">' + fmt(m.image || 0) + '</td><td class="num">' + fmt(m.video || 0) + '</td>'
        + '<td class="num">' + fmt(m.music || 0) + '</td><td class="num">' + fmt(m.sfx || 0) + '</td>'
        + '<td class="num">' + fmt(m.font || 0) + '</td><td class="num"><b>' + fmt(total) + '</b></td>'
        + '<td><div style="height:6px;border-radius:99px;background:rgba(148,163,184,.14)">'
        + '<div style="height:100%;width:' + pct + '%;border-radius:99px;background:linear-gradient(90deg,#34d399,#38bdf8)"></div></div></td></tr>';
    }).join('');
    setText('asIndBody', rows || '<tr><td colspan="8" class="empty">暂无素材</td></tr>');
    setText('asIndInfo', '覆盖行业 ' + inds.length + ' 个');

    // 来源分布
    var src = d.by_source || {};
    var srcRows = Object.keys(src).sort(function (a, b) { return src[b] - src[a]; }).map(function (k) {
      return '<div class="oe-toolbar" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08)">'
        + '<span>' + esc(k) + '</span><b>' + fmt(src[k]) + '</b></div>';
    }).join('');
    setText('asSrc', srcRows || '<div class="empty">暂无</div>');

    // 授权分布
    var lic = d.licenses || [];
    var licRows = lic.map(function (x) {
      return '<div class="oe-toolbar" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08)">'
        + '<span>' + esc(x.license_name) + ' ' + (x.attribution_required ? badge('需署名', 'amber') : badge('免署名', 'green')) + '</span>'
        + '<b>' + fmt(x.count) + '</b></div>';
    }).join('');
    setText('asLicDist', licRows || '<div class="empty">暂无</div>');

    // 最近任务
    var jobs = (d.jobs || []).slice(0, 5);
    setText('asRecentJobs', jobs.map(function (j) {
      return '<tr><td>' + j.id + '</td><td>' + esc(j.job_type) + '</td><td>' + jobStatus(j.status) + '</td>'
        + '<td>' + fmtTime(j.started_at) + '</td><td>' + fmtTime(j.finished_at) + '</td>'
        + '<td class="oe-tiny">' + esc(jobSummary(j)) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="empty">暂无任务</td></tr>');

    // 使用统计里的审计
    setText('asAuditBody', (d.audit || []).map(function (l) {
      return '<tr><td>' + fmtTime(l.ts) + '</td><td>' + esc(l.actor) + '</td><td>' + esc(l.action) + '</td>'
        + '<td>' + (l.asset_id ? ('#' + l.asset_id) : '—') + '</td><td class="oe-tiny">' + esc((l.detail || '').slice(0, 160)) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty">暂无</td></tr>');
  }

  function jobStatus(s) {
    if (s === 'running') return badge('运行中', 'blue');
    if (s === 'done') return badge('完成', 'green');
    if (s === 'partial') return badge('部分完成', 'amber');
    if (s === 'failed') return badge('失败', 'red');
    return badge(s || '—', 'gray');
  }

  function jobSummary(j) {
    try {
      var s = typeof j.stats === 'string' ? JSON.parse(j.stats || '{}') : (j.stats || {});
      if (s.per_type) {
        return Object.keys(s.per_type).map(function (t) {
          var x = s.per_type[t] || {};
          return typeName(t) + '+（入库 ' + (x.inserted || 0) + ' / 失败 ' + (x.failed || 0) + '）';
        }).join('；').slice(0, 200);
      }
      if (j.error) return '错误：' + j.error;
    } catch (e) { }
    return j.error || '—';
  }

  /* ------------------------------------------------------------ 抓取任务 */
  function loadJobs() {
    api('/assets/ops/jobs?limit=30').then(function (d) {
      var running = d.running || [];
      setText('asRunning', running.length
        ? running.map(function (k) { return '<div class="oe-toolbar" style="justify-content:space-between;padding:6px 0"><span>' + esc(k) + '</span>' + badge('运行中', 'blue') + '</div>'; }).join('')
        : '<div class="oe-empty">当前没有运行中的抓取任务</div>');
      var rows = (d.jobs || []).map(function (j) {
        var s = j.stats || {};
        return '<tr><td>' + j.id + '</td><td>' + esc(j.job_type) + '</td>'
          + '<td class="oe-tiny">' + esc((s.types || []).join(',')) + '</td><td>' + jobStatus(j.status) + '</td>'
          + '<td>' + fmtTime(j.started_at) + '</td><td>' + fmtTime(j.finished_at) + '</td>'
          + '<td class="num">' + fmt((s.per_type && Object.keys(s.per_type).reduce(function (a, t) { return a + ((s.per_type[t] || {}).inserted || 0); }, 0)) || 0) + '</td>'
          + '<td class="oe-tiny">' + esc(jobSummary(j)) + (j.error ? ('<br><span style="color:var(--oe-red)">' + esc(j.error) + '</span>') : '') + '</td></tr>';
      }).join('');
      setText('asJobBody', rows || '<tr><td colspan="8" class="empty">暂无任务</td></tr>');
    }).catch(function (e) { toast('任务列表加载失败：' + errText(e), 'warn'); });
  }

  function runJob() {
    var types = [], limits = {};
    ['image', 'video', 'music', 'sfx'].forEach(function (t) {
      var cb = document.querySelector('[data-as-limit="' + t + '"]');
      if (cb && cb.checked) {
        types.push(t);
        var input = $('#asLim' + t.charAt(0).toUpperCase() + t.slice(1));
        limits[t] = parseInt((input && input.value) || '0', 10) || 100;
      }
    });
    if (!types.length) { toast('请至少勾选一种素材类型', 'warn'); return; }
    if (!window.confirm('确认开始抓取？\n类型：' + types.map(typeName).join('、') +
      '\n数量：' + types.map(function (t) { return typeName(t) + ' ' + limits[t]; }).join('，'))) return;
    api('/assets/ops/jobs/run', { method: 'POST', body: { types: types, limits: limits, max_seconds: 3600 }, timeout: 30000 })
      .then(function (d) {
        toast((d && d.hint) || '抓取任务已启动', 'good', 4000);
        loadJobs();
      }).catch(function (e) { toast('启动失败：' + errText(e), 'warn', 5000); });
  }

  /* ------------------------------------------------------------ 审核 */
  function loadReview() {
    AS.review.type = ($('#asRevType') || {}).value || '';
    AS.review.status = ($('#asRevStatus') || {}).value || '';
    AS.review.q = (($('#asRevQ') || {}).value || '').trim();
    var qs = '?page=' + AS.review.page + '&limit=20';
    if (AS.review.type) qs += '&type=' + encodeURIComponent(AS.review.type);
    if (AS.review.status) qs += '&status=' + encodeURIComponent(AS.review.status);
    if (AS.review.q) qs += '&q=' + encodeURIComponent(AS.review.q);
    api('/assets/ops/assets' + qs).then(function (d) {
      AS.review.total = d.total || 0;
      setText('asRevInfo', '共 ' + fmt(d.total) + ' 条 · 第 ' + d.page + ' 页');
      var rows = (d.items || []).map(function (x) {
        var thumb = x.thumb_url ? ('<img src="' + esc(x.thumb_url) + '" loading="lazy" style="width:56px;height:36px;object-fit:cover;border-radius:6px">') : '—';
        var op = x.status === 'offline'
          ? '<button class="oe-btn sm" type="button" data-as-act="rev-active" data-id="' + x.id + '">上架</button>'
          : '<button class="oe-btn sm ghost" type="button" data-as-act="rev-offline" data-id="' + x.id + '">下架</button>';
        return '<tr><td>' + x.id + '</td><td>' + thumb + '</td>'
          + '<td class="oe-tiny">' + esc((x.title || '').slice(0, 70)) + '</td>'
          + '<td>' + typeName(x.type) + '</td><td>' + esc(x.industry) + '</td>'
          + '<td class="oe-tiny">' + esc(x.license_code) + (x.attribution_required ? ' ⚠️' : '') + '</td>'
          + '<td>' + (x.status === 'offline' ? badge('已下架', 'amber') : badge('上架中', 'green')) + '</td>'
          + '<td class="num">' + fmt(x.downloads) + '</td>'
          + '<td>' + op + ' <button class="oe-btn sm ghost" type="button" data-as-act="rev-retag" data-id="' + x.id + '">补标签</button></td></tr>';
      }).join('');
      setText('asRevBody', rows || '<tr><td colspan="9" class="empty">没有符合条件的素材</td></tr>');
    }).catch(function (e) { toast('素材列表加载失败：' + errText(e), 'warn'); });
  }

  function setStatus(id, status) {
    var reason = '';
    if (status === 'offline') {
      reason = window.prompt('下架原因（会记入审计）：', '运营人工复核/版权投诉');
      if (reason === null) return;
    }
    api('/assets/ops/assets/' + id + '/status', { method: 'POST', body: { status: status, reason: reason } })
      .then(function (d) { toast((d && d.hint) || '操作成功', 'good'); loadReview(); })
      .catch(function (e) { toast('操作失败：' + errText(e), 'warn', 4600); });
  }

  function retag(id) {
    var tags = window.prompt('补充中文标签（逗号分隔，桌面端可搜到）：', '');
    if (tags === null) return;
    var ind = window.prompt('行业（中文，留空不改）：', '');
    var body = { tags_zh: tags };
    if (ind) body.industry = ind;
    api('/assets/ops/assets/' + id + '/tags', { method: 'POST', body: body })
      .then(function (d) { toast((d && d.hint) || '已更新', 'good'); loadReview(); })
      .catch(function (e) { toast('更新失败：' + errText(e), 'warn', 4600); });
  }

  /* ------------------------------------------------------------ 授权台账 */
  function loadLicenses() {
    AS.lic.code = ($('#asLicCode') || {}).value || '';
    AS.lic.q = (($('#asLicQ') || {}).value || '').trim();
    var qs = '?page=' + AS.lic.page + '&limit=30';
    if (AS.lic.code) qs += '&license=' + encodeURIComponent(AS.lic.code);
    if (AS.lic.q) qs += '&q=' + encodeURIComponent(AS.lic.q);
    api('/assets/ops/licenses' + qs).then(function (d) {
      setText('asLicInfo', '共 ' + fmt(d.total) + ' 条 · 第 ' + d.page + ' 页');
      var rows = (d.licenses || []).map(function (x) {
        return '<tr><td>#' + x.asset_id + '</td><td class="oe-tiny">' + esc((x.title || '').slice(0, 60)) + '</td>'
          + '<td>' + typeName(x.type) + '</td><td>' + esc(x.industry) + '</td>'
          + '<td>' + esc(x.license_name) + '</td>'
          + '<td>' + (x.commercial_ok ? badge('可商用', 'green') : badge('不可', 'red')) + '</td>'
          + '<td>' + (x.attribution_required ? badge('需署名', 'amber') : badge('免署名', 'green')) + '</td>'
          + '<td>' + fmtTime(x.recorded_at) + '</td>'
          + '<td><a class="oe-btn sm ghost" target="_blank" rel="noopener" href="/ai-nav/api/assets/license/' + x.asset_id + '?format=text">说明</a></td></tr>';
      }).join('');
      setText('asLicBody', rows || '<tr><td colspan="9" class="empty">没有记录</td></tr>');
    }).catch(function (e) { toast('授权台账加载失败：' + errText(e), 'warn'); });
  }

  function exportLicenses() {
    var base = (window.XLAuth && XLAuth.apiBase) || '/ai-nav/api';
    var url = base + '/assets/ops/licenses?format=csv';
    var qs = [];
    if (AS.lic.code) qs.push('license=' + encodeURIComponent(AS.lic.code));
    if (AS.lic.q) qs.push('q=' + encodeURIComponent(AS.lic.q));
    if (qs.length) url += '&' + qs.join('&');
    fetch(url, { headers: { Authorization: 'Bearer ' + XLAuth.token() } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'asset-licenses-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
        toast('授权台账 CSV 已导出', 'good');
      }).catch(function (e) { toast('导出失败：' + (e.message || e), 'warn'); });
  }

  /* ------------------------------------------------------------ 使用统计 */
  function loadUsage() {
    api('/assets/ops/usage?days=7').then(function (d) {
      var days = {};
      (d.by_day || []).forEach(function (x) { days[x.d] = (days[x.d] || 0) + x.n; });
      var keys = Object.keys(days).sort();
      setText('asUseDay', keys.length ? keys.map(function (k) {
        return '<div class="oe-toolbar" style="justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08)">'
          + '<span>' + esc(k) + '</span><b>' + fmt(days[k]) + '</b></div>';
      }).join('') : '<div class="oe-empty">近 7 天暂无使用记录</div>');
      setText('asUsageTotal', fmt(d.total || 0));
      setText('asTopBody', (d.top_assets || []).map(function (x) {
        return '<tr><td>#' + x.id + '</td><td class="oe-tiny">' + esc((x.title || '').slice(0, 60)) + '</td>'
          + '<td>' + typeName(x.type) + '</td><td class="num">' + fmt(x.downloads) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="empty">暂无下载</td></tr>');
    }).catch(function (e) { toast('统计加载失败：' + errText(e), 'warn'); });
  }

  /* ------------------------------------------------------------ 素材包 */
  function loadPacks() {
    api('/assets/ops/packs').then(function (d) {
      var rows = (d.packs || []).map(function (p) {
        var op = p.status === 'done'
          ? '<a class="oe-btn sm" target="_blank" rel="noopener" href="' + esc(p.download_url || '#') + '">下载 zip</a>'
          : (p.status === 'building' ? badge('生成中', 'blue') : badge('失败：' + (p.error || '').slice(0, 30), 'red'));
        return '<tr><td>' + p.id + '</td><td>' + esc(p.industry) + '</td><td>' + typeName(p.type) + '</td>'
          + '<td>' + (p.status === 'done' ? badge('已完成', 'green') : (p.status === 'building' ? badge('生成中', 'blue') : badge('失败', 'red'))) + '</td>'
          + '<td class="num">' + fmt(p.count) + '</td><td class="num">' + esc(p.size_human || '—') + '</td>'
          + '<td>' + fmtTime(p.created_at) + '</td><td>' + op + '</td></tr>';
      }).join('');
      setText('asPackBody', rows || '<tr><td colspan="8" class="empty">还没有生成过素材包</td></tr>');
    }).catch(function (e) { toast('素材包列表加载失败：' + errText(e), 'warn'); });
  }

  function buildPack() {
    var ind = ($('#asPackIndustry') || {}).value;
    var type = ($('#asPackType') || {}).value || 'image';
    if (!ind) { toast('请选择行业', 'warn'); return; }
    api('/assets/ops/packs/build', { method: 'POST', body: { industry: ind, type: type }, timeout: 30000 })
      .then(function (d) {
        toast((d && d.hint) || '素材包生成任务已启动', 'good', 4000);
        setTimeout(loadPacks, 2000);
      }).catch(function (e) { toast('生成失败：' + errText(e), 'warn', 4600); });
  }

  /* ------------------------------------------------------------ 入口 */
  function render(panel) {
    if (!AS.built) build(panel);
    switchView(AS.view || 'overview');
  }

  window.XLAssetsOps = { render: render };
  // 兜底：即使 switchTab 未被 patch，点击菜单也能加载
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('#oeMenu .oe-menu-item[data-tab="assetlib"]') : null;
    if (btn) setTimeout(function () { render($('#panel-assetlib')); }, 30);
  }, true);
})();
