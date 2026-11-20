/* 星籁 AI · 运营端「积分管理」「发票管理」组件（/ops/edit/ 引入，admin only）
 * 依赖：assets/auth.js（window.XLAuth）
 * 注意：这里可以展示真实成本 / 毛利 / 供应商名称（仅运营后台）；用户端不加载此文件。
 */
(function () {
  'use strict';
  if (window.__XL_CREDITS_OPS__) return;
  window.__XL_CREDITS_OPS__ = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.XLAuth ? XLAuth.esc(s) : String(s == null ? '' : s); }
  function fmt(n) {
    var v = Number(n || 0);
    return (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }
  function fmtTime(s) { return s ? String(s).slice(0, 19) : '—'; }
  function toast(m, k, ms) { if (window.XLAuth) XLAuth.toast(m, k || 'good', ms || 2800); }
  function api(path, opts) {
    return XLAuth.api(path, opts || {}).catch(function (e) {
      if (e && e.status === 401) { toast('登录已失效，请重新登录', 'warn', 4000); }
      else if (e && e.status === 403) { toast('需要管理员权限', 'warn', 4000); }
      throw e;
    });
  }
  function errText(e) {
    if (!e) return '操作失败';
    if (e.status === 401) return '登录已失效';
    if (e.status === 403) return '需要管理员权限';
    return (e.data && (e.data.hint || e.data.message)) || e.message || ('请求失败' + (e.status || ''));
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function btn(cls, text, act) {
    return '<button class="oe-btn ' + (cls || '') + '" type="button" data-xlc-act="' + esc(act) + '">' + esc(text) + '</button>';
  }
  function statCard(tone, icon, label, id) {
    return '<article class="oe-stat ' + tone + '"><div class="s-top"><span class="s-ico">' + icon
      + '</span><span class="s-lb">' + esc(label) + '</span></div><div class="s-v" id="' + id + '">—</div></article>';
  }

  /* ================================================================ 积分管理 */
  var CS = { built: false, ws: '', page: 1, type: '', debts: [] };

  function renderCredits() {
    var panel = $('#panel-credits');
    if (!panel) return;
    if (!CS.built) { buildCredits(panel); CS.built = true; }
    loadCreditsAll();
  }

  function buildCredits(panel) {
    panel.innerHTML =
      '<div class="oe-stats" style="margin-bottom:14px">'
      + statCard('c-cyan', '💎', '全平台积分余额', 'xlcrTotalBalance')
      + statCard('c-violet', '📉', '本月消耗（积分）', 'xlcrMonthCredits')
      + statCard('c-blue', '🧾', '本月真实成本', 'xlcrMonthCost')
      + statCard('c-lime', '📈', '本月毛利', 'xlcrMonthMargin')
      + statCard('c-amber', '⚠️', '待补扣', 'xlcrDebts')
      + statCard('c-pink', '🏦', '总户余额告警', 'xlcrAlertStat')
      + '</div>'

      + '<div class="oe-card" id="xlcrMonitorCard" style="margin-bottom:14px">'
      + '<div class="oe-card-h"><div><h2><span class="hico">🏦</span>总户余额监控（内部）</h2>'
      + '<p class="oe-sub">我们一个总 Key、客户共用：302.AI PTC 余额 / 阿里云百炼余额（查不到接口时显示运营手填值）；低于阈值红色提醒。</p></div>'
      + '<span class="oe-badge gray" id="xlcrMonBadge">加载中…</span></div>'
      + '<div class="oe-card-b" id="xlcrMonitorBody"><div class="oe-loading"><div class="sp"></div>加载…</div></div>'
      + '</div>'

      + '<div class="oe-grid g2" style="margin-bottom:14px">'
      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🔍</span>按手机号 / 工作区查询 &amp; 充值</h2>'
      + '<p class="oe-sub">输入手机号、邮箱、工作区 ID 或客户名称，查询积分余额后充值/调整（1 积分 ≈ ¥1）。</p></div></div>'
      + '<div class="oe-card-b tight">'
      + '<div class="oe-toolbar" style="margin-bottom:10px"><input class="oe-input grow" id="xlcrQ" placeholder="手机号 / 邮箱 / ws_1 / 客户名称" autocomplete="off">'
      + btn('primary', '查询', 'lookup') + '</div>'
      + '<div id="xlcrLookup" class="oe-tiny" style="color:var(--oe-txt3)">输入关键词后点「查询」</div>'
      + '<div id="xlcrCustomer" hidden style="margin-top:12px;border-top:1px solid rgba(148,163,184,.14);padding-top:12px">'
      + '<div id="xlcrCustHead" style="margin-bottom:8px"></div>'
      + '<div class="oe-toolbar" style="margin-bottom:8px"><input class="oe-input" id="xlcrTopupAmount" type="number" min="0.01" step="1" placeholder="充值积分（如 100）" style="max-width:170px">'
      + '<input class="oe-input" id="xlcrTopupPaid" type="number" min="0" step="0.01" placeholder="实收金额 ¥（默认=积分）" style="max-width:190px">'
      + '<input class="oe-input grow" id="xlcrTopupNote" placeholder="备注（必填，例如：微信收款 100 元）"></div>'
      + '<div class="oe-toolbar"><button class="oe-btn primary" type="button" data-xlc-act="topup">充值积分</button>'
      + '<input class="oe-input" id="xlcrAdjustAmount" type="number" step="0.01" placeholder="调整（可负，如 -10）" style="max-width:190px">'
      + '<input class="oe-input grow" id="xlcrAdjustNote" placeholder="调整原因（必填）">'
      + '<button class="oe-btn" type="button" data-xlc-act="adjust">调整积分</button></div>'
      + '</div></div></section>'

      + '<section class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">💱</span>用户端费率配置</h2>'
      + '<p class="oe-sub">用户端只显示「数字人/渲染」单价；真实成本在下方只读展示，仅运营可见。保存后立即生效。</p></div>'
      + '<span class="oe-badge" id="xlcrRateBadge">—</span></div>'
      + '<div class="oe-card-b tight" id="xlcrRatesBody"><div class="oe-loading"><div class="sp"></div>加载…</div></div></section>'
      + '</div>'

      + '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div><h2><span class="hico">📜</span>积分流水（含真实成本与毛利）</h2>'
      + '<p class="oe-sub">cost_real = 供应商真实人民币成本；margin = 消耗积分 − 真实成本。按工作区/类型筛选。</p></div>'
      + '<div class="oe-toolbar"><input class="oe-input" id="xlcrTxnWs" placeholder="工作区（留空=全部）" style="max-width:170px">'
      + '<select class="oe-select" id="xlcrTxnType"><option value="">全部类型</option><option value="topup">充值</option><option value="consume">消耗</option><option value="refund">退款</option><option value="adjust">调整</option></select>'
      + '<button class="oe-btn" type="button" data-xlc-act="txn-search">查询</button></div></div>'
      + '<div class="oe-table-wrap"><table class="oe-table" style="min-width:1020px"><thead><tr>'
      + '<th style="width:150px">时间</th><th style="width:110px">工作区</th><th style="width:70px">类型</th>'
      + '<th class="num" style="width:90px">积分</th><th class="num" style="width:90px">余额</th>'
      + '<th class="num" style="width:90px">真实成本</th><th class="num" style="width:90px">毛利</th>'
      + '<th style="width:220px">来源 / 备注</th><th style="width:90px">操作人</th></tr></thead>'
      + '<tbody id="xlcrTxnBody"><tr><td colspan="9" class="empty">加载中…</td></tr></tbody></table></div>'
      + '<div class="oe-pager"><span id="xlcrTxnInfo">—</span><div class="pg"><button class="oe-btn sm ghost" type="button" data-xlc-act="txn-prev">上一页</button><button class="oe-btn sm ghost" type="button" data-xlc-act="txn-next">下一页</button></div></div>'
      + '</div>'

      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">🧾</span>待补扣记录（并发结算余额不足）</h2>'
      + '<p class="oe-sub">客户余额不足时结算不产生负余额，改记「待补扣」；客户充值后可手动补扣。</p></div>'
      + '<button class="oe-btn ghost" type="button" data-xlc-act="debt-refresh">刷新</button></div>'
      + '<div class="oe-table-wrap"><table class="oe-table" style="min-width:720px"><thead><tr>'
      + '<th style="width:150px">时间</th><th style="width:110px">工作区</th><th class="num" style="width:100px">待补扣积分</th>'
      + '<th class="num" style="width:100px">真实成本</th><th>来源</th><th style="width:100px">操作</th></tr></thead>'
      + '<tbody id="xlcrDebtBody"><tr><td colspan="6" class="empty">加载中…</td></tr></tbody></table></div></div>';

    panel.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-xlc-act]') : null;
      if (!t) return;
      var act = t.getAttribute('data-xlc-act');
      if (act === 'lookup') doLookup();
      else if (act === 'topup') doTopup();
      else if (act === 'adjust') doAdjust();
      else if (act === 'txn-search') { CS.page = 1; loadTxns(); }
      else if (act === 'txn-prev') { if (CS.page > 1) { CS.page--; loadTxns(); } }
      else if (act === 'txn-next') { CS.page++; loadTxns(); }
      else if (act === 'debt-refresh') loadDebts();
      else if (act === 'debt-collect') collectDebt(t.getAttribute('data-id'));
      else if (act === 'rate-save') saveRates();
      else if (act === 'monitor-save') saveMonitor();
    });
    panel.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.id === 'xlcrQ') doLookup();
    });
  }

  function loadCreditsAll() {
    api('/credits/admin/overview', { timeout: 20000 }).then(function (d) {
      var m = d.month || {}, mon = d.monitor || {};
      setText('xlcrTotalBalance', fmt(d.total_balance) + ' 积分');
      setText('xlcrMonthCredits', fmt(m.consumed_credits) + ' 积分');
      setText('xlcrMonthCost', '¥' + fmt(m.cost_real));
      setText('xlcrMonthMargin', '¥' + fmt(m.margin));
      setText('xlcrDebts', (d.pending_debts || {}).count ? (d.pending_debts.count + ' 笔 · ' + fmt(d.pending_debts.amount) + ' 积分') : '0 笔');
      var alerts = (mon.alerts || []).length;
      setText('xlcrAlertStat', alerts ? ('⚠️ ' + alerts + ' 项告警') : '正常');
      paintMonitor(mon);
    }).catch(function (e) {
      ['xlcrTotalBalance', 'xlcrMonthCredits', 'xlcrMonthCost', 'xlcrMonthMargin', 'xlcrDebts', 'xlcrAlertStat'].forEach(function (id) { setText(id, '—'); });
      var body = $('#xlcrMonitorBody');
      if (body) body.innerHTML = '<div class="oe-info"><span class="mini">⚠️</span><div>加载失败：' + esc(errText(e)) + '</div></div>';
    });
    loadConfig();
    loadTxns();
    loadDebts();
  }

  function setText(id, text) { var e = $('#' + id); if (e) e.textContent = text; }

  function paintMonitor(mon) {
    var body = $('#xlcrMonitorBody');
    if (!body) return;
    var cj = mon.chanjing_302 || {}, ali = mon.aliyun || {};
    var badge = $('#xlcrMonBadge');
    if (badge) {
      var alerts = (mon.alerts || []);
      badge.className = 'oe-badge ' + (alerts.length ? 'bad' : 'lime');
      badge.textContent = alerts.length ? ('低于阈值 · ' + alerts.length + ' 项') : '余额正常';
    }
    function tile(p, key, unit, isPtc) {
      var days = p.days_left == null ? '—' : (fmt(p.days_left) + ' 天');
      return '<div class="oe-card" style="border-color:' + (p.alert ? 'rgba(248,113,113,.5)' : 'rgba(148,163,184,.16)') + '">'
        + '<div class="oe-card-h"><div><h2 style="font-size:14px">' + esc(p.name || key) + (p.alert ? ' <span class="oe-badge bad">低余额</span>' : ' <span class="oe-badge lime">正常</span>') + '</h2>'
        + '<p class="oe-sub">' + esc(p.hint || '') + '</p></div></div>'
        + '<div class="oe-card-b tight">'
        + '<div class="oe-mini-stats" style="grid-template-columns:repeat(3,1fr)">'
        + '<div class="oe-mini"><div class="tx"><small>当前余额</small><b style="color:' + (p.alert ? '#fca5a5' : '#6ee7b7') + '">' + fmt(p.balance) + ' ' + unit + '</b><span class="sub">' + esc(p.updated_at || '未手填') + '</span></div></div>'
        + '<div class="oe-mini"><div class="tx"><small>今日消耗</small><b>¥' + fmt(p.today_cost_cny) + '</b><span class="sub">近 7 日均 ¥' + fmt(p.daily_cost_cny) + '/天</span></div></div>'
        + '<div class="oe-mini"><div class="tx"><small>预计可用</small><b>' + days + '</b><span class="sub">按近 7 日消耗估算</span></div></div>'
        + '</div>'
        + '<div class="oe-toolbar" style="margin-top:10px">'
        + '<input class="oe-input" type="number" step="0.01" min="0" id="xlcrMon-' + key + '" placeholder="手填余额（' + unit + '）" value="' + esc(fmt(p.balance)) + '" style="max-width:170px">'
        + '<input class="oe-input" type="number" step="0.01" min="0" id="xlcrThr-' + key + '" placeholder="告警阈值" value="' + esc(fmt(p.threshold)) + '" style="max-width:150px">'
        + '</div></div></div>';
    }
    body.innerHTML = '<div class="oe-grid g2">' + tile(cj, 'ptc', 'PTC', true) + tile(ali, 'aliyun', '¥', false) + '</div>'
      + '<div class="oe-toolbar" style="margin-top:11px">'
      + '<button class="oe-btn primary" type="button" data-xlc-act="monitor-save">保存手填余额 / 阈值</button>'
      + '<span class="oe-tiny" style="color:var(--oe-txt3)">今日真实成本合计 ¥' + fmt((mon.today || {}).cost_cny) + ' · 今日消耗积分 ' + fmt((mon.today || {}).credits_charged) + ' · 其他供应商成本 ¥' + fmt(mon.other_provider_cost_today) + '</span></div>'
      + ((mon.alerts || []).length ? '<div class="oe-info" style="border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.08)"><span class="mini">⚠️</span><div><b style="color:#fca5a5">总户余额告警：</b>' + esc((mon.alerts || []).join('；')) + '</div></div>' : '');
  }

  function saveMonitor() {
    var mon = {
      ptc_balance: Number(($('#xlcrMon-ptc') || {}).value || 0),
      aliyun_balance_cny: Number(($('#xlcrMon-aliyun') || {}).value || 0),
      ptc_alert_threshold: Number(($('#xlcrThr-ptc') || {}).value || 0),
      aliyun_alert_threshold: Number(($('#xlcrThr-aliyun') || {}).value || 0)
    };
    api('/credits/admin/monitor', { method: 'POST', body: { monitor: mon }, timeout: 20000 }).then(function (d) {
      toast('总户余额已更新', 'good');
      if (d && d.monitor) paintMonitor(d.monitor);
    }).catch(function (e) { toast('保存失败：' + errText(e), 'warn', 4600); });
  }

  function loadConfig() {
    api('/credits/config', { timeout: 20000 }).then(function (d) {
      var body = $('#xlcrRatesBody');
      if (!body) return;
      var r = d.rates || {}, costs = d.costs || {};
      window.__xlcrPkgs = d.packages_raw || [];
      var badge = $('#xlcrRateBadge');
      if (badge) badge.textContent = '更新于 ' + (d.updated_at || '—');
      function row(label, id, val, unit, hint) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(148,163,184,.08)">'
          + '<div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--oe-txt)">' + esc(label) + '</div>'
          + (hint ? '<div class="oe-tiny" style="color:var(--oe-txt3)">' + esc(hint) + '</div>' : '') + '</div>'
          + '<input class="oe-input" id="' + id + '" type="number" step="0.01" min="0" value="' + esc(fmt(val)) + '" style="max-width:130px">'
          + '<span class="oe-tiny" style="width:70px;color:var(--oe-txt3)">' + esc(unit) + '</span></div>';
      }
      var html = '<div style="margin-bottom:6px"><b style="font-size:12.5px">用户端可见费率</b><span class="oe-tiny" style="margin-left:8px;color:var(--oe-txt3)">用户端文案：' + esc(d.user_rate_summary) + '</span></div>';
      html += row('数字人 · 换背景版', 'xlcrRate-chanjing', r.chanjing_per_sec, '积分/秒', '');
      html += row('数字人 · 真口型', 'xlcrRate-lipsync', r.lipsync_per_sec, '积分/秒', '');
      html += row('数字人 · 照片口播', 'xlcrRate-photo_lipsync', r.photo_lipsync_per_sec, '积分/秒', '');
      html += row('成片渲染', 'xlcrRate-render', r.render_per_item, '积分/条', '');
      html += '<div style="margin:12px 0 6px"><b style="font-size:12.5px">内部真实成本（只读，仅运营可见）</b></div>'
        + '<div class="oe-tiny" style="color:var(--oe-txt3);line-height:1.8">'
        + '302 蝉镜：' + esc(costs.chanjing_ptc_per_sec) + ' PTC/秒 × ¥' + esc(costs.ptc_cny) + '/PTC ≈ <b style="color:var(--oe-txt)">¥' + fmt(d.chanjing_cny_per_sec) + '/秒</b><br>'
        + '阿里云 VideoRetalk：¥' + esc(costs.lipsync_cny_per_sec) + '/秒（照片口播按 ¥' + esc(costs.photo_lipsync_cny_per_sec) + '/秒）<br>'
        + '自建 ffmpeg 渲染：¥' + esc(costs.render_cny_per_item) + '/条（无外部成本）</div>'
        + '<div style="margin:12px 0 6px"><b style="font-size:12.5px">充值套餐（赠送比例可改）</b></div>';
      (d.packages_raw || []).forEach(function (p, i) {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:5px 0">'
          + '<span style="width:80px;font-size:12px">¥' + fmt(p.amount) + '</span>'
          + '<input class="oe-input" id="xlcrPkgBonus-' + i + '" type="number" step="1" min="0" max="100" value="' + esc(fmt(p.bonus_pct)) + '" style="max-width:110px"><span class="oe-tiny" style="color:var(--oe-txt3)">% 赠送</span>'
          + '<input class="oe-input grow" id="xlcrPkgNote-' + i + '" value="' + esc(p.note || '') + '" placeholder="套餐说明">'
          + '</div>';
      });
      html += '<div style="margin-top:12px"><button class="oe-btn primary" type="button" data-xlc-act="rate-save">保存费率 / 套餐</button>'
        + '<span class="oe-tiny" style="margin-left:8px;color:var(--oe-txt3)">保存后用户端立即按新费率计费</span></div>';
      body.innerHTML = html;
    }).catch(function (e) {
      var body = $('#xlcrRatesBody');
      if (body) body.innerHTML = '<div class="oe-info"><span class="mini">⚠️</span><div>加载失败：' + esc(errText(e)) + '</div></div>';
    });
  }

  function saveRates() {
    var data = { rates: {}, packages: [] };
    ['chanjing', 'lipsync', 'photo_lipsync', 'render'].forEach(function (k) {
      var elm = $('#xlcrRate-' + k);
      if (elm) data.rates[k + (k === 'render' ? '_per_item' : '_per_sec')] = Number(elm.value || 0);
    });
    var pkgCount = $$('#xlcrRatesBody [id^=xlcrPkgBonus-]').length;
    var raw = (window.__xlcrPkgs || []);
    for (var i = 0; i < pkgCount; i++) {
      var b = $('#xlcrPkgBonus-' + i), n = $('#xlcrPkgNote-' + i);
      var amount = raw[i] ? raw[i].amount : [100, 500, 2000][i];
      data.packages.push({ amount: amount, bonus_pct: Number((b || {}).value || 0), note: (n || {}).value || '' });
    }
    api('/credits/config', { method: 'POST', body: data, timeout: 20000 }).then(function () {
      toast('费率 / 套餐已保存', 'good');
      loadConfig();
    }).catch(function (e) { toast('保存失败：' + errText(e), 'warn', 4600); });
  }

  function doLookup() {
    var q = (($('#xlcrQ') || {}).value || '').trim();
    if (!q) return toast('请输入手机号/工作区/名称', 'warn');
    api('/credits/lookup?q=' + encodeURIComponent(q), { timeout: 20000 }).then(function (d) {
      var host = $('#xlcrLookup');
      var items = d.items || [];
      if (!host) return;
      if (!items.length) {
        host.innerHTML = '<div class="oe-info"><span class="mini">ℹ️</span><div>没有找到匹配的客户/工作区：' + esc(q) + '</div></div>';
        var c = $('#xlcrCustomer'); if (c) c.hidden = true;
        return;
      }
      host.innerHTML = '<div style="display:flex;flex-direction:column;gap:6px">' + items.map(function (it, i) {
        return '<button type="button" class="oe-btn ghost" data-xlc-pick="' + i + '" style="justify-content:flex-start;text-align:left">'
          + '<b>' + esc(it.name || it.workspace_id) + '</b>&nbsp;·&nbsp;' + esc(it.workspace_id) + '&nbsp;·&nbsp;' + esc(it.phone || it.email || '') + '&nbsp;·&nbsp;' + esc(it.plan_name || '') + '&nbsp;·&nbsp;<span style="color:#7dd3fc">余额 ' + fmt(it.balance) + ' 积分</span></button>';
      }).join('') + '</div>';
      $$('#xlcrLookup [data-xlc-pick]').forEach(function (b) {
        b.addEventListener('click', function () {
          var it = items[Number(b.getAttribute('data-xlc-pick'))];
          selectCustomer(it);
        });
      });
      if (items.length === 1) selectCustomer(items[0]);
    }).catch(function (e) { toast('查询失败：' + errText(e), 'warn', 4600); });
  }

  function selectCustomer(it) {
    CS.ws = it.workspace_id;
    var c = $('#xlcrCustomer');
    if (c) c.hidden = false;
    var head = $('#xlcrCustHead');
    if (head) head.innerHTML = '<b style="font-size:14px">' + esc(it.name || it.workspace_id) + '</b>'
      + '<span class="oe-badge cyan" style="margin-left:8px">' + esc(it.workspace_id) + '</span>'
      + '<span class="oe-badge" style="margin-left:6px">' + esc(it.plan_name || '') + '</span>'
      + '<span class="oe-badge lime" style="margin-left:6px">余额 ' + fmt(it.balance) + ' 积分</span>'
      + '<span class="oe-tiny" style="margin-left:8px;color:var(--oe-txt3)">' + esc(it.phone || it.email || '') + '</span>';
    var amt = $('#xlcrTopupAmount'); if (amt) amt.value = '';
    var paid = $('#xlcrTopupPaid'); if (paid) paid.value = '';
    var note = $('#xlcrTopupNote'); if (note) note.value = '';
    refreshCustomerBalance();
  }

  function refreshCustomerBalance() {
    if (!CS.ws) return;
    api('/credits?workspace_id=' + encodeURIComponent(CS.ws), { timeout: 20000 }).then(function (d) {
      var it = { name: ((d.user || {}).name) || CS.ws, workspace_id: CS.ws, balance: d.balance,
                 plan_name: ((d.plan || {}).name) || '', phone: ((d.user || {}).account) || '' };
      var head = $('#xlcrCustHead');
      if (head) head.innerHTML = '<b style="font-size:14px">' + esc(it.name) + '</b>'
        + '<span class="oe-badge cyan" style="margin-left:8px">' + esc(CS.ws) + '</span>'
        + '<span class="oe-badge" style="margin-left:6px">' + esc(it.plan_name) + '</span>'
        + '<span class="oe-badge lime" style="margin-left:6px">余额 ' + fmt(d.balance) + ' 积分</span>'
        + '<span class="oe-tiny" style="margin-left:8px;color:var(--oe-txt3)">本月消耗 ' + fmt(d.month_consumed) + ' 积分</span>';
    }).catch(function () {});
  }

  function doTopup() {
    if (!CS.ws) return toast('请先查询并选择客户', 'warn');
    var amount = Number((($('#xlcrTopupAmount') || {}).value || 0));
    var paidRaw = (($('#xlcrTopupPaid') || {}).value || '').trim();
    var note = (($('#xlcrTopupNote') || {}).value || '').trim();
    if (!(amount > 0)) return toast('请输入充值积分', 'warn');
    if (!note) return toast('请填写备注（收款方式/凭证）', 'warn');
    var body = { workspace_id: CS.ws, amount: amount, note: note };
    if (paidRaw !== '') body.paid_cny = Number(paidRaw);
    api('/credits/topup', { method: 'POST', body: body, timeout: 25000 }).then(function (d) {
      toast((d && d.hint) || '充值成功', 'good', 4200);
      refreshCustomerBalance(); loadTxns(); refreshOverview();
    }).catch(function (e) { toast('充值失败：' + errText(e), 'warn', 4600); });
  }

  function doAdjust() {
    if (!CS.ws) return toast('请先查询并选择客户', 'warn');
    var amount = Number((($('#xlcrAdjustAmount') || {}).value || 0));
    var note = (($('#xlcrAdjustNote') || {}).value || '').trim();
    if (!amount) return toast('请输入调整积分（可负）', 'warn');
    if (!note) return toast('请填写调整原因', 'warn');
    api('/credits/adjust', { method: 'POST', body: { workspace_id: CS.ws, amount: amount, note: note }, timeout: 25000 })
      .then(function (d) { toast((d && d.hint) || '调整成功', 'good', 4200); refreshCustomerBalance(); loadTxns(); refreshOverview(); })
      .catch(function (e) { toast('调整失败：' + errText(e), 'warn', 4600); });
  }

  function refreshOverview() { loadCreditsAll(); }

  function loadTxns() {
    var ws = (($('#xlcrTxnWs') || {}).value || CS.ws || '').trim();
    var type = (($('#xlcrTxnType') || {}).value || '').trim();
    var q = '/credits/txns?page=' + CS.page + '&page_size=20';
    if (ws) q += '&workspace_id=' + encodeURIComponent(ws);
    if (type) q += '&type=' + encodeURIComponent(type);
    api(q, { timeout: 20000 }).then(function (d) {
      var body = $('#xlcrTxnBody');
      if (!body) return;
      var items = d.items || [];
      if (!items.length) { body.innerHTML = '<tr><td colspan="9" class="empty">没有流水</td></tr>'; }
      else {
        body.innerHTML = items.map(function (t) {
          return '<tr><td>' + esc(fmtTime(t.created_at)) + '</td><td class="mono">' + esc(t.workspace_id) + '</td>'
            + '<td>' + esc(t.type_label || t.type) + '</td>'
            + '<td class="num ' + (t.amount < 0 ? 'bad-txt' : 'ok-txt') + '">' + (t.amount > 0 ? '+' : '') + fmt(t.amount) + '</td>'
            + '<td class="num">' + fmt(t.balance_after) + '</td>'
            + '<td class="num">' + (t.cost_real ? ('¥' + fmt(t.cost_real)) : '—') + '</td>'
            + '<td class="num">' + (t.margin ? ('¥' + fmt(t.margin)) : '—') + '</td>'
            + '<td><span class="mono">' + esc(String(t.ref || '').slice(0, 60)) + '</span>'
            + (t.note ? '<div class="msub">' + esc(t.note) + '</div>' : '') + '</td>'
            + '<td>' + esc(t.operator || '') + '</td></tr>';
        }).join('');
      }
      setText('xlcrTxnInfo', '第 ' + d.page + ' 页 · 共 ' + d.total + ' 条');
    }).catch(function (e) {
      var body = $('#xlcrTxnBody');
      if (body) body.innerHTML = '<tr><td colspan="9" class="empty">加载失败：' + esc(errText(e)) + '</td></tr>';
    });
  }

  function loadDebts() {
    api('/credits/admin/debts?status=pending&page_size=20', { timeout: 20000 }).then(function (d) {
      var body = $('#xlcrDebtBody');
      if (!body) return;
      CS.debts = d.items || [];
      if (!CS.debts.length) { body.innerHTML = '<tr><td colspan="6" class="empty">没有待补扣记录</td></tr>'; return; }
      body.innerHTML = CS.debts.map(function (x) {
        return '<tr><td>' + esc(fmtTime(x.created_at)) + '</td><td class="mono">' + esc(x.workspace_id) + '</td>'
          + '<td class="num bad-txt">' + fmt(x.amount) + '</td><td class="num">¥' + fmt(x.cost_real) + '</td>'
          + '<td class="msub">' + esc(x.note || x.ref || '') + '</td>'
          + '<td>' + btn('sm primary', '补扣', 'debt-collect').replace('data-xlc-act="debt-collect"', 'data-xlc-act="debt-collect" data-id="' + esc(x.id) + '"') + '</td></tr>';
      }).join('');
    }).catch(function (e) {
      var body = $('#xlcrDebtBody');
      if (body) body.innerHTML = '<tr><td colspan="6" class="empty">加载失败：' + esc(errText(e)) + '</td></tr>';
    });
  }

  function collectDebt(id) {
    if (!id) return;
    api('/credits/admin/debts/collect', { method: 'POST', body: { id: Number(id) }, timeout: 20000 })
      .then(function (d) { toast(d && d.ok ? ('补扣成功：' + fmt(d.amount) + ' 积分') : ((d && d.hint) || '补扣失败'), d && d.ok ? 'good' : 'warn', 4200); loadDebts(); refreshOverview(); })
      .catch(function (e) { toast('补扣失败：' + errText(e), 'warn', 4600); });
  }

  /* ================================================================ 发票管理 */
  var IS = { built: false, page: 1, status: '', q: '', items: [] };

  function renderInvoices() {
    var panel = $('#panel-invoices');
    if (!panel) return;
    if (!IS.built) { buildInvoices(panel); IS.built = true; }
    loadInvoices();
    loadInvConfig();
  }

  function buildInvoices(panel) {
    panel.innerHTML =
      '<div class="oe-mini-stats" style="margin-bottom:14px">'
      + '<div class="oe-mini"><div class="ic">🧾</div><div class="tx"><small>待开票</small><b id="xlinvStatPending">—</b><span class="sub">需运营人工开具</span></div></div>'
      + '<div class="oe-mini ok"><div class="ic">✅</div><div class="tx"><small>已开票</small><b id="xlinvStatIssued">—</b><span class="sub">已上传 PDF / 已发邮箱</span></div></div>'
      + '<div class="oe-mini bad"><div class="ic">🚫</div><div class="tx"><small>已驳回</small><b id="xlinvStatRejected">—</b><span class="sub">可让客户重新申请</span></div></div>'
      + '<div class="oe-mini"><div class="ic">💰</div><div class="tx"><small>开票金额（已开）</small><b id="xlinvStatAmount">—</b><span class="sub">按实付金额</span></div></div>'
      + '</div>'
      + '<div class="oe-card" style="margin-bottom:14px"><div class="oe-card-h"><div><h2><span class="hico">🧾</span>开票申请单</h2>'
      + '<p class="oe-sub">客户在个人中心提交开票申请；这里可人工开票（填发票号/上传 PDF）、驳回或调用自动开票接口。导出 CSV 可直接给代账公司/开票平台。</p></div></div>'
      + '<div class="oe-toolbar" style="margin:0 0 10px">'
      + '<input class="oe-input" id="xlinvQ" placeholder="单号 / 抬头 / 工作区 / 邮箱 / 税号" style="max-width:280px">'
      + '<select class="oe-select" id="xlinvStatus"><option value="">全部状态</option><option value="pending">待开票</option><option value="issued">已开票</option><option value="rejected">已驳回</option></select>'
      + '<button class="oe-btn primary" type="button" data-xlc-act="inv-search">查询</button>'
      + '<button class="oe-btn" type="button" data-xlc-act="inv-export">⬇ 导出 CSV（Excel 可打开）</button>'
      + '<button class="oe-btn ghost" type="button" data-xlc-act="inv-refresh">刷新</button></div>'
      + '<div class="oe-table-wrap"><table class="oe-table" style="min-width:1180px"><thead><tr>'
      + '<th style="width:140px">申请单号</th><th style="width:100px">工作区</th><th style="width:150px">客户</th>'
      + '<th class="num" style="width:80px">金额</th><th style="width:150px">抬头 / 税号</th><th style="width:110px">类型</th>'
      + '<th style="width:80px">状态</th><th style="width:140px">申请时间</th><th style="width:140px">发票号</th>'
      + '<th style="width:180px">操作</th></tr></thead><tbody id="xlinvBody"><tr><td colspan="10" class="empty">加载中…</td></tr></tbody></table></div>'
      + '<div class="oe-pager"><span id="xlinvInfo">—</span><div class="pg"><button class="oe-btn sm ghost" type="button" data-xlc-act="inv-prev">上一页</button><button class="oe-btn sm ghost" type="button" data-xlc-act="inv-next">下一页</button></div></div>'
      + '</div>'
      + '<div class="oe-card"><div class="oe-card-h"><div><h2><span class="hico">⚙️</span>自动开票配置（服务商 Key 未配置时走人工开票）</h2>'
      + '<p class="oe-sub">默认 manual（人工开票）。拿到诺诺/百望/航信/微信电子发票 Key 后可切换自动开票；未配置时接口返回 need_config，不会假装成功。用户端不显示服务商名称。</p></div>'
      + '<span class="oe-badge" id="xlinvCfgBadge">—</span></div>'
      + '<div class="oe-card-b tight" id="xlinvCfgBody"><div class="oe-loading"><div class="sp"></div>加载…</div></div></div>';

    panel.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-xlc-act]') : null;
      var act = t && t.getAttribute('data-xlc-act');
      if (!act) return;
      if (act === 'inv-search') { IS.page = 1; IS.q = (($('#xlinvQ') || {}).value || '').trim(); loadInvoices(); }
      else if (act === 'inv-prev') { if (IS.page > 1) { IS.page--; loadInvoices(); } }
      else if (act === 'inv-next') { IS.page++; loadInvoices(); }
      else if (act === 'inv-refresh') loadInvoices();
      else if (act === 'inv-export') exportInvoices();
      else if (act === 'inv-issue') openIssueModal(Number(t.getAttribute('data-id')));
      else if (act === 'inv-reject') rejectInvoice(Number(t.getAttribute('data-id')));
      else if (act === 'inv-auto') autoIssue(Number(t.getAttribute('data-id')));
      else if (act === 'xlinv-cfg-save') saveInvConfig();
    });
  }

  function loadInvoices() {
    IS.status = (($('#xlinvStatus') || {}).value || IS.status || '').trim();
    var q = '/invoices/admin/list?page=' + IS.page + '&page_size=20';
    if (IS.status) q += '&status=' + encodeURIComponent(IS.status);
    if (IS.q) q += '&q=' + encodeURIComponent(IS.q);
    api(q, { timeout: 20000 }).then(function (d) {
      IS.items = d.items || [];
      var stats = d.stats || {};
      setText('xlinvStatPending', ((stats.pending || {}).count || 0) + ' 单');
      setText('xlinvStatIssued', ((stats.issued || {}).count || 0) + ' 单');
      setText('xlinvStatRejected', ((stats.rejected || {}).count || 0) + ' 单');
      setText('xlinvStatAmount', '¥' + fmt((stats.issued || {}).amount));
      var body = $('#xlinvBody');
      if (!body) return;
      if (!IS.items.length) { body.innerHTML = '<tr><td colspan="10" class="empty">没有开票申请</td></tr>'; }
      else {
        body.innerHTML = IS.items.map(function (x) {
          var st = x.status || 'pending';
          var badge = st === 'issued' ? 'lime' : st === 'rejected' ? 'bad' : 'amber';
          var ops = '';
          if (st === 'pending') {
            ops = '<button class="oe-btn sm primary" type="button" data-xlc-act="inv-issue" data-id="' + x.id + '">人工开票</button>'
              + '<button class="oe-btn sm" type="button" data-xlc-act="inv-auto" data-id="' + x.id + '">自动开票</button>'
              + '<button class="oe-btn sm ghost" type="button" data-xlc-act="inv-reject" data-id="' + x.id + '">驳回</button>';
          } else if (st === 'issued') {
            ops = (x.pdf_url ? '<a class="oe-btn sm ghost" href="' + esc(x.pdf_url) + '" target="_blank" rel="noopener">PDF</a>' : '')
              + '<span class="oe-tiny" style="margin-left:4px;color:var(--oe-txt3)">' + esc(x.provider_name || x.provider || '') + '</span>';
          } else {
            ops = '<span class="oe-tiny" style="color:#fda4af">' + esc(x.reject_reason || '已驳回') + '</span>';
          }
          return '<tr><td class="mono">' + esc(x.invoice_no) + '</td><td class="mono">' + esc(x.workspace_id) + '</td>'
            + '<td>' + esc(x.customer || '') + '<div class="msub">' + esc(x.customer_account || '') + '</div></td>'
            + '<td class="num strong">¥' + fmt(x.amount) + '</td>'
            + '<td>' + esc(x.title) + '<div class="msub">' + esc(x.tax_no || '（无税号）') + '</div></td>'
            + '<td>' + esc(x.invoice_type_label || '') + '</td>'
            + '<td><span class="oe-badge ' + badge + '">' + esc(x.status_label || st) + '</span></td>'
            + '<td>' + esc(fmtTime(x.created_at)) + '</td>'
            + '<td class="mono">' + esc(x.invoice_number || '—') + '</td>'
            + '<td class="actions">' + ops + '</td></tr>';
        }).join('');
      }
      setText('xlinvInfo', '第 ' + d.page + ' 页 · 共 ' + d.total + ' 条');
    }).catch(function (e) {
      var body = $('#xlinvBody');
      if (body) body.innerHTML = '<tr><td colspan="10" class="empty">加载失败：' + esc(errText(e)) + '</td></tr>';
    });
  }

  function loadInvConfig() {
    api('/invoices/admin/config', { timeout: 20000 }).then(function (d) {
      var cfg = d.config || {};
      var body = $('#xlinvCfgBody');
      if (!body) return;
      var badge = $('#xlinvCfgBadge');
      if (badge) badge.textContent = '当前：' + (cfg.provider_name || cfg.provider || 'manual');
      var pids = ['manual', 'nuonuo', 'baiwang', 'hangxin', 'wechat'];
      var html = '<div class="oe-toolbar" style="margin-bottom:8px">'
        + '<select class="oe-select" id="xlinvProvider">' + pids.map(function (p) {
          return '<option value="' + p + '"' + (cfg.provider === p ? ' selected' : '') + '>' + esc(p) + '</option>';
        }).join('') + '<option value="" disabled>—— 以下为 seller / 商品信息 ——</option></select>'
        + '<input class="oe-input" id="xlinvGoods" value="' + esc(cfg.goods_name || '') + '" placeholder="商品编码名称" style="max-width:260px">'
        + '<input class="oe-input" id="xlinvTaxRate" type="number" step="0.01" min="0" max="1" value="' + esc(fmt(cfg.tax_rate)) + '" placeholder="税率如 0.06" style="max-width:130px">'
        + '<input class="oe-input grow" id="xlinvSellerName" value="' + esc((cfg.seller || {}).name || '') + '" placeholder="销方名称" style="max-width:220px">'
        + '<input class="oe-input" id="xlinvSellerTax" value="' + esc((cfg.seller || {}).tax_no || '') + '" placeholder="销方税号" style="max-width:200px">'
        + '</div>';
      html += '<div class="oe-tiny" style="color:var(--oe-txt3);margin:6px 0 8px">'
        + '默认人工开票：待开票申请点「人工开票」上传 PDF/填发票号即可。自动开票服务商需配置 api_base/app_key/app_secret（或微信 app_id/mch_id/api_key），保存后会加密落盘。'
        + '</div>';
      (cfg.providers || []).forEach(function (p) {
        if (!p.fields || !p.fields.length) return;
        html += '<div class="oe-card" style="margin:8px 0;background:rgba(148,163,184,.04)"><div class="oe-card-h"><div><h2 style="font-size:13px">' + esc(p.name)
          + ' <span class="oe-badge ' + (p.ready ? 'lime' : 'gray') + '">' + (p.ready ? '已配置' : '未配置') + '</span></h2>'
          + '<p class="oe-sub">' + esc(p.note) + '</p></div></div><div class="oe-card-b tight"><div class="oe-toolbar">'
          + p.fields.map(function (f) {
            var val = p.configured[f] || '';
            return '<input class="oe-input" data-xlinv-p="' + p.id + '" data-f="' + f + '" value="' + esc(val) + '" placeholder="' + esc(f) + (f.indexOf('secret') >= 0 || f.indexOf('key') >= 0 ? '（留空=不修改）' : '') + '" style="max-width:220px">';
          }).join('')
          + '</div></div></div>';
      });
      html += '<div style="margin-top:10px"><button class="oe-btn primary" type="button" data-xlc-act="xlinv-cfg-save">保存开票配置</button>'
        + '<span class="oe-tiny" style="margin-left:8px;color:var(--oe-txt3)">当前 provider=' + esc(cfg.provider) + ' · 更新 ' + esc(cfg.updated_at || '—') + '</span></div>';
      body.innerHTML = html;
    }).catch(function (e) {
      var body = $('#xlinvCfgBody');
      if (body) body.innerHTML = '<div class="oe-info"><span class="mini">⚠️</span><div>加载失败：' + esc(errText(e)) + '</div></div>';
    });
  }

  function saveInvConfig() {
    var body = { provider: (($('#xlinvProvider') || {}).value || 'manual'),
                 goods_name: (($('#xlinvGoods') || {}).value || ''),
                 tax_rate: Number((($('#xlinvTaxRate') || {}).value || 0.06)),
                 seller: { name: (($('#xlinvSellerName') || {}).value || ''),
                           tax_no: (($('#xlinvSellerTax') || {}).value || '') },
                 providers: {} };
    $$('[data-xlinv-p]').forEach(function (inp) {
      var pid = inp.getAttribute('data-xlinv-p'), f = inp.getAttribute('data-f'), v = (inp.value || '').trim();
      if (!v) return;
      body.providers[pid] = body.providers[pid] || {};
      body.providers[pid][f] = v;
      body.providers[pid].enabled = true;
    });
    api('/invoices/admin/config', { method: 'POST', body: body, timeout: 20000 }).then(function () {
      toast('开票配置已保存', 'good'); loadInvConfig();
    }).catch(function (e) { toast('保存失败：' + errText(e), 'warn', 4600); });
  }

  function openIssueModal(id) {
    var item = IS.items.filter(function (x) { return x.id === id; })[0] || {};
    var mask = el('div', '');
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:grid;place-items:center;padding:18px';
    mask.innerHTML = '<div style="width:min(560px,96vw);background:#0d1522;border:1px solid rgba(148,163,184,.25);border-radius:14px;padding:20px">'
      + '<h2 style="margin:0 0 6px;font-size:17px">人工开票 · ' + esc(item.invoice_no || '') + '</h2>'
      + '<p class="oe-sub" style="margin:0 0 12px">开票金额 ¥' + fmt(item.amount) + ' · ' + esc(item.title || '') + ' · 填发票号码或上传 PDF（至少一项），保存后用户端可下载。</p>'
      + '<div class="oe-toolbar" style="margin-bottom:9px"><input class="oe-input" id="xlinvIssueCode" placeholder="发票代码（选填）" style="max-width:200px">'
      + '<input class="oe-input grow" id="xlinvIssueNumber" placeholder="发票号码（如 01100260012345678）"></div>'
      + '<div class="oe-toolbar" style="margin-bottom:9px"><input type="file" id="xlinvIssuePdf" accept="application/pdf" class="oe-input grow"><input class="oe-input grow" id="xlinvIssuePdfUrl" placeholder="或粘贴 PDF 链接（https:// 或 /ai-nav/）"></div>'
      + '<div class="oe-toolbar" style="margin-bottom:12px"><input class="oe-input grow" id="xlinvIssueNote" placeholder="备注（选填，内部可见）"></div>'
      + '<div class="oe-toolbar"><button class="oe-btn primary" type="button" id="xlinvIssueConfirm">确认标记已开票</button><button class="oe-btn ghost" type="button" id="xlinvIssueCancel">取消</button></div>'
      + '</div>';
    document.body.appendChild(mask);
    $('#xlinvIssueCancel').onclick = function () { mask.remove(); };
    mask.addEventListener('click', function (ev) { if (ev.target === mask) mask.remove(); });
    $('#xlinvIssueConfirm').onclick = function () {
      var number = (($('#xlinvIssueNumber') || {}).value || '').trim();
      var code = (($('#xlinvIssueCode') || {}).value || '').trim();
      var note = (($('#xlinvIssueNote') || {}).value || '').trim();
      var pdfUrl = (($('#xlinvIssuePdfUrl') || {}).value || '').trim();
      var file = (($('#xlinvIssuePdf') || {}).files || [])[0];
      if (!number && !pdfUrl && !file) return toast('请填写发票号码或上传 PDF', 'warn');
      var done = function (pdfB64) {
        var body = { invoice_number: number, invoice_code: code, note: note };
        if (pdfUrl) body.pdf_url = pdfUrl;
        if (pdfB64) body.pdf_base64 = pdfB64;
        api('/invoices/admin/' + id + '/issue', { method: 'POST', body: body, timeout: 40000 }).then(function (d) {
          toast((d && d.hint) || '已标记开票完成', 'good', 4000);
          mask.remove(); loadInvoices();
        }).catch(function (e) { toast('开票失败：' + errText(e), 'warn', 5000); });
      };
      if (file) {
        var fr = new FileReader();
        fr.onload = function () { done(String(fr.result || '').split(',', 2).pop()); };
        fr.readAsDataURL(file);
      } else done('');
    };
  }

  function rejectInvoice(id) {
    var reason = window.prompt('填写驳回原因（客户可见）：', '抬头信息不完整，请补充后重新提交');
    if (!reason) return;
    api('/invoices/admin/' + id + '/reject', { method: 'POST', body: { reason: reason }, timeout: 20000 })
      .then(function (d) { toast((d && d.hint) || '已驳回', 'good'); loadInvoices(); })
      .catch(function (e) { toast('驳回失败：' + errText(e), 'warn', 4600); });
  }

  function autoIssue(id) {
    api('/invoices/issue', { method: 'POST', body: { invoice_id: id }, timeout: 60000 }).then(function (d) {
      toast((d && d.hint) || '自动开票成功', 'good', 4200); loadInvoices();
    }).catch(function (e) {
      var hint = errText(e);
      if (e && e.code === 'need_config') hint = '未配置自动开票服务商：' + hint;
      toast(hint, 'warn', 6000);
    });
  }

  function exportInvoices() {
    var url = XLAuth.apiBase + '/invoices/admin/export.csv';
    var qs = [];
    if (IS.status) qs.push('status=' + encodeURIComponent(IS.status));
    if (qs.length) url += '?' + qs.join('&');
    fetch(url, { headers: { Authorization: 'Bearer ' + XLAuth.token() } })
      .then(function (r) {
        if (!r.ok) throw new Error('导出失败 HTTP ' + r.status);
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'invoices-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
        toast('CSV 已导出（Excel 可直接打开）', 'good', 3200);
      })
      .catch(function (e) { toast('导出失败：' + (e.message || e), 'warn', 4600); });
  }

  window.XLCreditsOps = { render: renderCredits };
  window.XLInvoicesOps = { render: renderInvoices };
})();
