/* 星籁 AI · 用户端积分 / 发票组件（account/dashboard.html、account/index.html 引入）
 * 依赖：assets/auth.js（window.XLAuth）
 * 用户端只出现「积分 / 数字人 / 渲染」等中性叫法，不出现任何供应商/成本字段。
 */
(function () {
  'use strict';
  if (window.__XL_CREDITS_WIDGET__) return;
  window.__XL_CREDITS_WIDGET__ = true;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return window.XLAuth ? XLAuth.esc(s) : String(s == null ? '' : s); }
  function fmt(n) {
    var v = Number(n || 0);
    return (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }
  function fmtTime(s) { return s ? String(s).slice(0, 16) : '—'; }
  function toast(msg, kind, ms) {
    if (window.XLAuth) XLAuth.toast(msg, kind || 'good', ms || 3000);
    else alert(msg);
  }
  function api(path, opts) {
    if (!window.XLAuth) return Promise.reject(new Error('登录组件加载中'));
    return XLAuth.api(path, opts || {});
  }
  function errText(e) {
    if (!e) return '操作失败，请稍后再试';
    if (e.status === 401) return '登录已失效，请重新登录';
    if (e.status === 402) return (e.data && e.data.hint) || '积分不足，请充值';
    if (e.status === 403) return '没有权限';
    if (e.code === 'NOT_READY') return '积分服务升级中，请稍后刷新';
    if (e.code === 'NETWORK' || e.code === 'TIMEOUT') return '网络异常，请稍后再试';
    return (e.data && (e.data.hint || e.data.message)) || e.message || '操作失败';
  }

  /* ---------------------------------------------------------------- 样式 */
  function injectStyle() {
    if ($('#xlcStyle')) return;
    var st = document.createElement('style');
    st.id = 'xlcStyle';
    st.textContent = [
      '.xlc-sec .xlc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px}',
      '.xlc-sec h2{font-size:19px;margin:0 0 5px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}',
      '.xlc-sec .xlc-sub{margin:0;font-size:12.5px;color:var(--txt3);line-height:1.65}',
      '.xlc-sec .xlc-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid var(--line2);color:var(--txt2);background:rgba(255,255,255,.03)}',
      '.xlc-bal{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:2px 0 14px}',
      '.xlc-bal b{font-size:38px;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;background:linear-gradient(90deg,#38bdf8,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}',
      '.xlc-bal span{font-size:13px;color:var(--txt3)}',
      '.xlc-metas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px}',
      '.xlc-meta{padding:11px 13px;border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.02)}',
      '.xlc-meta small{display:block;font-size:11px;color:var(--txt3);margin-bottom:3px}',
      '.xlc-meta b{font-size:16px;font-variant-numeric:tabular-nums}',
      '.xlc-h3{font-size:13px;font-weight:800;margin:18px 0 9px;display:flex;align-items:center;gap:7px}',
      '.xlc-pkgs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
      '.xlc-pkg{position:relative;padding:14px 13px;border-radius:13px;border:1px solid var(--line2);background:linear-gradient(180deg,rgba(56,189,248,.07),rgba(139,92,246,.05));display:flex;flex-direction:column;gap:4px}',
      '.xlc-pkg.hot{border-color:rgba(56,189,248,.45);box-shadow:inset 0 0 0 1px rgba(56,189,248,.15)}',
      '.xlc-pkg .tag{position:absolute;right:9px;top:9px;font-size:10px;font-weight:800;color:#7dd3fc;background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.3);border-radius:99px;padding:1px 7px}',
      '.xlc-pkg .price{font-size:24px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
      '.xlc-pkg .price i{font-size:12px;font-style:normal;color:var(--txt3);font-weight:600}',
      '.xlc-pkg .credits{font-size:12px;color:var(--txt2)}',
      '.xlc-pkg .note{font-size:10.5px;color:var(--txt3);min-height:28px;line-height:1.45}',
      '.xlc-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid rgba(56,189,248,.35);background:rgba(56,189,248,.12);color:#bae6fd;font-size:12px;font-weight:700;padding:8px 10px;border-radius:9px;cursor:pointer;min-height:36px}',
      '.xlc-btn:hover{background:rgba(56,189,248,.2)}',
      '.xlc-btn.ghost{border-color:var(--line2);background:transparent;color:var(--txt2)}',
      '.xlc-btn.primary{background:linear-gradient(135deg,#0ea5e9,#7c3aed);border-color:transparent;color:#fff}',
      '.xlc-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.xlc-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.xlc-table th{text-align:left;font-size:10.5px;letter-spacing:.04em;color:var(--txt3);font-weight:800;padding:8px 8px;border-bottom:1px solid var(--line2);white-space:nowrap}',
      '.xlc-table td{padding:9px 8px;border-bottom:1px solid rgba(148,163,184,.10);color:var(--txt2);vertical-align:middle}',
      '.xlc-table tr:last-child td{border-bottom:0}',
      '.xlc-table .num{text-align:right;font-variant-numeric:tabular-nums}',
      '.xlc-table .ok{color:#6ee7b7}.xlc-table .wait{color:#fcd34d}.xlc-table .bad{color:#fda4af}',
      '.xlc-empty{padding:22px 10px;text-align:center;color:var(--txt3);font-size:12px}',
      '.xlc-note{margin-top:12px;font-size:11.5px;color:var(--txt3);line-height:1.7}',
      '.xlc-note b{color:var(--txt2)}',
      '.xlc-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin-top:10px}',
      '.xlc-form .full{grid-column:1/-1}',
      '.xlc-form label{display:block;font-size:11.5px;color:var(--txt3);margin-bottom:4px}',
      '.xlc-form .xlc-input,.xlc-form select{width:100%;box-sizing:border-box;min-height:40px;border-radius:9px;border:1px solid var(--line2);background:rgba(255,255,255,.03);color:var(--txt);padding:8px 10px;font-size:13px}',
      '.xlc-form .xlc-input:focus,.xlc-form select:focus{outline:none;border-color:rgba(56,189,248,.55)}',
      '.xlc-eligible{display:flex;flex-direction:column;gap:2px;max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:11px;padding:6px}',
      '.xlc-eligible label{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;font-size:12px;color:var(--txt2);cursor:pointer}',
      '.xlc-eligible label:hover{background:rgba(148,163,184,.07)}',
      '.xlc-eligible .t{flex:1;min-width:0}.xlc-eligible .t small{display:block;color:var(--txt3);font-size:10.5px}',
      '.xlc-eligible .amt{font-weight:800;color:var(--txt);font-variant-numeric:tabular-nums}',
      '.xlc-total{margin:10px 0 0;font-size:13px;color:var(--txt2)}',
      '.xlc-total b{font-size:18px;color:var(--txt)}',
      '.xlc-inv-status{display:inline-block;font-size:11px;font-weight:700;border-radius:99px;padding:2px 8px}',
      '.xlc-inv-status.pending{color:#fcd34d;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3)}',
      '.xlc-inv-status.issued{color:#6ee7b7;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3)}',
      '.xlc-inv-status.rejected{color:#fda4af;background:rgba(251,113,133,.12);border:1px solid rgba(251,113,133,.3)}',
      '.xlc-alert{margin-bottom:10px;padding:9px 11px;border-radius:10px;border:1px dashed var(--line2);color:var(--txt3);font-size:11.5px;line-height:1.65}',
      '.xlc-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}',
      '@media(max-width:640px){.xlc-metas{grid-template-columns:1fr}.xlc-pkgs{grid-template-columns:1fr}.xlc-form{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- 积分卡 */
  function mountCredits() {
    var box = $('#creditsCard');
    if (!box || box.getAttribute('data-mounted') === '1') return;
    box.setAttribute('data-mounted', '1');
    injectStyle();
    box.classList.add('xlc-sec');
    box.innerHTML = '<div class="xlc-head"><div><h2>💎 积分余额</h2>'
      + '<p class="xlc-sub">按量付费：数字人 0.3–0.8 积分/秒、成片渲染 2 积分/条；1 积分 ≈ ¥1。</p></div>'
      + '<button class="xlc-btn ghost" type="button" id="xlcRefreshCredits">↻ 刷新</button></div>'
      + '<div id="xlcCreditsBody"><div class="xlc-empty">正在读取积分…</div></div>';
    var body = $('#xlcCreditsBody');
    var refresh = $('#xlcRefreshCredits');
    if (refresh) refresh.addEventListener('click', function () { load(); });
    load();

    function load() {
      body.innerHTML = '<div class="xlc-empty">正在读取积分…</div>';
      api('/credits', { timeout: 15000 }).then(function (d) {
        paint(d || {});
      }).catch(function (e) {
        body.innerHTML = '<div class="xlc-alert">' + esc(errText(e)) + '</div>';
        if (e && e.status === 401) {
          var link = esc(XLAuth.rootUrl('account/index.html') + '?next=' + encodeURIComponent(location.pathname + location.search + '#creditsCard'));
          body.innerHTML += '<a class="xlc-btn" href="' + link + '">去登录</a>';
        }
      });
    }

    function paint(d) {
      var rates = d.rates || {};
      var pkgs = d.packages || [];
      var recent = d.recent || [];
      var plan = d.plan || {};
      var rateText = rates.summary || ('数字人 ' + fmt(rates.chanjing_per_sec) + '–' + fmt(rates.lipsync_per_sec) + ' 积分/秒 · 成片渲染 ' + fmt(rates.render_per_item) + ' 积分/条');
      var html = '';
      html += '<div class="xlc-bal"><b>' + fmt(d.balance) + '</b><span>积分余额 ≈ ¥' + fmt(d.balance) + '</span>'
        + '<span class="xlc-badge">' + esc(d.workspace_id || '') + '</span></div>';
      html += '<div class="xlc-metas">'
        + '<div class="xlc-meta"><small>本月消耗</small><b>' + fmt(d.month_consumed) + ' 积分</b></div>'
        + '<div class="xlc-meta"><small>套餐含积分</small><b>' + fmt(plan.included_credits) + ' 积分/月</b></div>'
        + '<div class="xlc-meta"><small>计费口径</small><b style="font-size:12px">' + esc(rateText) + '</b></div>'
        + '</div>';
      html += '<div class="xlc-h3">🎁 充值套餐 <span class="xlc-badge">在线支付接入中 · 可联系客服充值</span></div>';
      html += '<div class="xlc-pkgs">';
      (pkgs || []).forEach(function (p, i) {
        var hot = (p.bonus_pct || 0) > 0 && (i === 1 || (pkgs.length === 1));
        html += '<div class="xlc-pkg' + (hot ? ' hot' : '') + '">' + (hot ? '<span class="tag">推荐</span>' : '')
          + '<div class="price">¥' + fmt(p.price_cny) + '</div>'
          + '<div class="credits">到账 <b>' + fmt(p.credits) + '</b> 积分'
          + ((p.bonus_pct || 0) > 0 ? '（赠送 ' + fmt(p.bonus_pct) + '%）' : '')
          + '</div><div class="note">' + esc(p.note || '') + '</div>'
          + '<button class="xlc-btn primary" type="button" data-buy="' + esc(p.amount) + '">立即充值</button></div>';
      });
      html += '</div>';
      html += '<div class="xlc-h3">🧾 最近流水</div>';
      if (!recent.length) {
        html += '<div class="xlc-empty">还没有积分流水：充值或生成成片后会在这里显示</div>';
      } else {
        html += '<div style="overflow:auto"><table class="xlc-table"><thead><tr><th>时间</th><th>类型</th><th class="num">积分</th><th class="num">余额</th><th>说明</th></tr></thead><tbody>';
        recent.forEach(function (t) {
          var cls = t.amount < 0 ? 'bad' : (t.type === 'topup' ? 'ok' : '');
          html += '<tr><td>' + esc(fmtTime(t.created_at)) + '</td><td>' + esc(t.type_label || t.type) + '</td>'
            + '<td class="num ' + cls + '">' + (t.amount > 0 ? '+' : '') + fmt(t.amount) + '</td>'
            + '<td class="num">' + fmt(t.balance_after) + '</td><td>' + esc(t.note || t.ref || '') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '<div class="xlc-note"><b>积分说明：</b>1 积分 ≈ ¥1；充值后即时到账，用于数字人视频与成片渲染等按量付费能力。'
        + '生成失败不扣积分；在线支付通道接入中，暂请联系客服充值。充值积分可用于申请发票（见下方「申请发票」）。</div>';
      body.innerHTML = html;
      Array.prototype.forEach.call(body.querySelectorAll('[data-buy]'), function (btn) {
        btn.addEventListener('click', function () {
          toast('在线支付正在接入中：请联系平台客服充值（提供工作区 ' + (d.workspace_id || '') + ' 与金额），客服确认后即时到账', 'warn', 5600);
        });
      });
    }
  }

  /* ---------------------------------------------------------------- 发票卡 */
  function mountInvoices() {
    var box = $('#invoicesCard');
    if (!box || box.getAttribute('data-mounted') === '1') return;
    box.setAttribute('data-mounted', '1');
    injectStyle();
    box.classList.add('xlc-sec');
    box.innerHTML = '<div class="xlc-head"><div><h2>🧾 申请发票</h2>'
      + '<p class="xlc-sub">选择可开票的充值流水，填写抬头信息提交；电子发票 1–3 个工作日内开具，可在本页下载。</p></div>'
      + '<button class="xlc-btn ghost" type="button" id="xlcRefreshInvoices">↻ 刷新</button></div>'
      + '<div id="xlcInvoiceBody"><div class="xlc-empty">正在读取发票信息…</div></div>';
    var body = $('#xlcInvoiceBody');
    var cfg = null, sel = {};
    var refresh = $('#xlcRefreshInvoices');
    if (refresh) refresh.addEventListener('click', function () { load(); });
    load();

    function load() {
      body.innerHTML = '<div class="xlc-empty">正在读取发票信息…</div>';
      api('/invoices', { timeout: 15000 }).then(function (d) {
        cfg = d.config || {};
        paint(d || {});
      }).catch(function (e) {
        body.innerHTML = '<div class="xlc-alert">' + esc(errText(e)) + '</div>';
      });
    }

    function paint(d) {
      sel = {};
      var eligible = d.eligible || [];
      var invoices = d.invoices || [];
      var html = '';
      html += '<div class="xlc-alert">📌 <b>发票说明：</b>' + esc(cfg.notice || '') + '</div>';
      html += '<div class="xlc-h3">1. 选择可开票充值流水（实付金额）</div>';
      if (!eligible.length) {
        html += '<div class="xlc-empty">暂无可开票的充值流水。充值到账且未开票后，可在这里选择申请。</div>';
      } else {
        html += '<div class="xlc-eligible" id="xlcEligible">';
        eligible.forEach(function (t) {
          html += '<label><input type="checkbox" value="' + esc(t.txn_id) + '" data-amount="' + Number(t.paid_cny || 0) + '">'
            + '<span class="t">充值 +' + fmt(t.amount) + ' 积分<small>' + esc(fmtTime(t.created_at)) + ' · ' + esc(t.note || '充值到账') + '</small></span>'
            + '<span class="amt">¥' + fmt(t.paid_cny) + '</span></label>';
        });
        html += '</div>';
      }
      html += '<div class="xlc-h3">2. 填写抬头信息</div>';
      html += '<div class="xlc-form" id="xlcInvForm">'
        + '<div><label>抬头类型 *</label><select id="xlInvoiceTitleType"><option value="company">企业</option><option value="personal">个人</option></select></div>'
        + '<div><label>发票类型 *</label><select id="xlInvoiceType"><option value="normal">增值税普通发票</option><option value="special">增值税专用发票</option></select></div>'
        + '<div class="full"><label>发票抬头（企业全称 / 个人姓名）*</label><input class="xlc-input" id="xlInvoiceTitle" maxlength="120" placeholder="例如：北京某某科技有限公司"></div>'
        + '<div><label>纳税人识别号（税号）</label><input class="xlc-input" id="xlInvoiceTaxNo" maxlength="40" placeholder="企业建议填写；专票必填"></div>'
        + '<div><label>注册地址及电话（专票必填）</label><input class="xlc-input" id="xlInvoiceAddr" maxlength="160" placeholder="例如：北京市朝阳区xx路1号 010-88888888"></div>'
        + '<div><label>开户行（专票必填）</label><input class="xlc-input" id="xlInvoiceBank" maxlength="120" placeholder="例如：中国工商银行北京分行"></div>'
        + '<div><label>银行账号（专票必填）</label><input class="xlc-input" id="xlInvoiceBankAccount" maxlength="80" placeholder="例如：020000xxxxxxxxxxx"></div>'
        + '<div class="full"><label>接收邮箱 *（电子发票发送到该邮箱）</label><input class="xlc-input" id="xlInvoiceEmail" type="email" maxlength="120" placeholder="例如：caiwu@example.com"></div>'
        + '<div class="full"><label>备注（选填）</label><input class="xlc-input" id="xlInvoiceRemark" maxlength="200" placeholder="例如：发票备注栏内容"></div>'
        + '</div>'
        + '<div class="xlc-total">开票金额：<b id="xlInvoiceAmount">¥0</b> <span style="color:var(--txt3)">（按实付充值金额开具，赠送积分不开票）</span></div>'
        + '<div style="margin-top:10px"><button class="xlc-btn primary" type="button" id="xlInvoiceSubmit" disabled>提交开票申请</button></div>';
      html += '<div class="xlc-h3">3. 我的发票</div>';
      if (!invoices.length) {
        html += '<div class="xlc-empty">还没有提交过开票申请</div>';
      } else {
        html += '<div style="overflow:auto"><table class="xlc-table"><thead><tr><th>申请单号</th><th class="num">金额</th><th>类型</th><th>状态</th><th>申请时间</th><th>发票号码</th><th>操作</th></tr></thead><tbody>';
        invoices.forEach(function (it) {
          var st = it.status || 'pending';
          var label = { pending: '待开票', issued: '已开票', rejected: '已驳回' }[st] || st;
          var op = '';
          if (st === 'issued') {
            op = it.pdf_url ? '<a class="xlc-btn ghost" style="min-height:30px;padding:4px 8px" href="' + esc(it.pdf_url) + '" target="_blank" rel="noopener">下载 PDF</a>' : '电子发票已发送至邮箱';
          } else if (st === 'rejected') {
            op = '<span style="color:#fda4af;font-size:11.5px">' + esc(it.reject_reason || '已驳回') + '</span>';
          } else {
            op = '<span style="color:var(--txt3);font-size:11.5px">1–3 个工作日内开具</span>';
          }
          html += '<tr><td>' + esc(it.invoice_no) + '</td><td class="num">¥' + fmt(it.amount) + '</td>'
            + '<td>' + esc(it.invoice_type_label || '') + '</td>'
            + '<td><span class="xlc-inv-status ' + st + '">' + label + '</span></td>'
            + '<td>' + esc(fmtTime(it.created_at)) + '</td>'
            + '<td>' + esc(it.invoice_number || '—') + '</td><td>' + op + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
      body.innerHTML = html;
      bind();
    }

    function picked() {
      var sum = 0, ids = [];
      Array.prototype.forEach.call(body.querySelectorAll('#xlcEligible input:checked'), function (c) {
        sum += Number(c.getAttribute('data-amount') || 0);
        ids.push(Number(c.value));
      });
      return { ids: ids, amount: Math.round(sum * 100) / 100 };
    }
    function updateTotal() {
      var p = picked();
      var el = $('#xlInvoiceAmount');
      if (el) el.textContent = '¥' + fmt(p.amount);
      var btn = $('#xlInvoiceSubmit');
      if (btn) {
        btn.disabled = !p.ids.length;
        btn.textContent = p.ids.length ? ('提交开票申请（¥' + fmt(p.amount) + '）') : '提交开票申请';
      }
    }
    function bind() {
      var elig = $('#xlcEligible');
      if (elig) elig.addEventListener('change', updateTotal);
      var submit = $('#xlInvoiceSubmit');
      if (submit) submit.addEventListener('click', doSubmit);
      updateTotal();
      var eth = $('#xlInvoiceEmail');
      if (eth && XLAuth.user && XLAuth.user()) {
        var u = XLAuth.user() || {};
        if (u.email) eth.value = u.email;
        var addr = $('#xlInvoiceAddr');
        if (addr && !addr.value) addr.value = u.city || '';
      }
    }
    function doSubmit() {
      var p = picked();
      if (!p.ids.length) return toast('请先选择可开票充值流水', 'warn');
      var data = {
        txn_ids: p.ids,
        title_type: ($('#xlInvoiceTitleType') || {}).value || 'company',
        invoice_type: ($('#xlInvoiceType') || {}).value || 'normal',
        title: (($('#xlInvoiceTitle') || {}).value || '').trim(),
        tax_no: (($('#xlInvoiceTaxNo') || {}).value || '').trim(),
        addr: (($('#xlInvoiceAddr') || {}).value || '').trim(),
        bank: (($('#xlInvoiceBank') || {}).value || '').trim(),
        bank_account: (($('#xlInvoiceBankAccount') || {}).value || '').trim(),
        email: (($('#xlInvoiceEmail') || {}).value || '').trim(),
        remark: (($('#xlInvoiceRemark') || {}).value || '').trim()
      };
      if (!data.title) return toast('请填写发票抬头', 'warn');
      if (!data.email || data.email.indexOf('@') < 0) return toast('请填写正确的接收邮箱', 'warn');
      var btn = $('#xlInvoiceSubmit');
      if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
      api('/invoices/apply', { method: 'POST', body: data, timeout: 20000 }).then(function (r) {
        toast((r && r.hint) || '开票申请已提交', 'good', 4200);
        load();
      }).catch(function (e) {
        toast(errText(e), 'warn', 4800);
        if (btn) { btn.disabled = false; updateTotal(); }
      });
    }
  }

  /* ---------------------------------------------------------------- 登录页余额条 */
  function mountLoginBar() {
    var bar = $('#loggedBar');
    if (!bar || !window.XLAuth) return;
    if (!XLAuth.token()) return;
    api('/credits', { timeout: 12000 }).then(function (d) {
      if (!$('#loggedBar')) return;
      var host = $('#loggedBar');
      if (!host || host.querySelector('.xlc-login-bal')) return;
      var span = document.createElement('span');
      span.className = 'xlc-login-bal';
      span.style.cssText = 'display:block;margin-top:6px;font-size:12px;color:#a7f3d0';
      span.innerHTML = '💎 积分余额：<b>' + fmt(d.balance) + '</b> 积分 · '
        + '<a style="color:var(--xl-ok);text-decoration:underline" href="'
        + esc(XLAuth.rootUrl('account/dashboard.html') + '#creditsCard') + '">查看详情 / 充值</a>';
      host.appendChild(span);
    }).catch(function () {});
  }

  function boot() {
    if (!window.XLAuth) { setTimeout(boot, 250); return; }
    try { mountCredits(); } catch (e) { console.warn('[credits-widget] credits failed', e); }
    try { mountInvoices(); } catch (e) { console.warn('[credits-widget] invoices failed', e); }
    try { mountLoginBar(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
