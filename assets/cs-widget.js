/* 星籁 AI · 商家承接页 AI 客服挂件（cs-widget.js）
 * 依赖：承接页（/ai-nav/store/?slug=xxx）已加载；后端 /api/cs/widget + /api/cs/chat。
 * 设计：不依赖外部 CDN；深浅主题沿用站点 CSS 变量；气泡位于底部留资条上方（--leadbar-h 让位）。
 * P0 渠道仅网页；企业微信/抖音官方接口为 P1 预留。
 */
(function () {
  'use strict';
  if (window.__XL_CS_WIDGET__) return;
  window.__XL_CS_WIDGET__ = true;

  var qs = new URLSearchParams(location.search);
  var SLUG = (qs.get('slug') || '').trim();
  if (!SLUG) return;

  var API = window.__CSAI_API_BASE__ || '/ai-nav/api';
  var VISITOR_KEY = 'xl_cs_visitor';
  var SID_KEY = 'xl_cs_sid_' + SLUG;
  var MAX_LEN = 500;
  var OPEN_KEY = 'xl_cs_open_' + SLUG;

  var ST = {
    enabled: false,
    busy: false,
    welcome: '',
    quick: [],
    name: '',
    sessionId: '',
    visitorId: '',
    leadId: '',
    handoffShown: false,
    lastReply: '',
    inputH: 40
  };
  var el = {};
  var styleInjected = false;

  function id(x) { return document.getElementById(x); }
  function mk(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k, d) { try { var v = sessionStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    if (opts.body != null) headers['Content-Type'] = 'application/json';
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, opts.timeout || 60000) : null;
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  /* ---------------- 样式 ---------------- */
  var CSS = [
    '.xlcs{--xlcs-bg:var(--card,#fff);--xlcs-ink:var(--ink,#10201d);--xlcs-mut:var(--muted,#63706c);',
    '--xlcs-line:var(--line,#e6e1d7);--xlcs-brand:var(--brand,#0e5c52);--xlcs-accent:var(--accent,#c47a12);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}',
    '.xlcs *{box-sizing:border-box}',
    '.xlcs-bubble{position:fixed;right:16px;z-index:46;display:flex;align-items:center;gap:8px;border:0;cursor:pointer;',
    'min-height:48px;padding:0 16px 0 13px;border-radius:999px;color:#fff;font-size:14px;font-weight:700;letter-spacing:.2px;',
    'background:linear-gradient(145deg,#167c6c,#0e5c52);box-shadow:0 10px 26px rgba(14,92,82,.34),inset 0 0 0 1px rgba(255,255,255,.16);',
    'bottom:calc(var(--leadbar-h,0px) + 14px + env(safe-area-inset-bottom));transition:bottom .32s cubic-bezier(.4,0,.2,1),transform .15s ease,box-shadow .2s ease}',
    '.xlcs-bubble:active{transform:scale(.97)}',
    '.xlcs-bubble:focus-visible{outline:2px solid #f5b942;outline-offset:3px}',
    '.xlcs-bubble svg{width:21px;height:21px;flex:0 0 auto}',
    '.xlcs-bubble .xlcs-dot{position:absolute;left:9px;top:9px;width:9px;height:9px;border-radius:50%;background:#54d3a5;box-shadow:0 0 0 3px rgba(84,211,165,.22);display:none}',
    '.xlcs-bubble.has-unread .xlcs-dot{display:block;animation:xlcsPulse 1.6s infinite}',
    '@keyframes xlcsPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:.6}}',
    '.xlcs-panel{position:fixed;right:16px;z-index:47;display:flex;flex-direction:column;width:min(380px,calc(100vw - 24px));',
    'height:min(560px,calc(100vh - var(--leadbar-h,0px) - 92px - env(safe-area-inset-bottom)));',
    'bottom:calc(var(--leadbar-h,0px) + 74px + env(safe-area-inset-bottom));background:var(--xlcs-bg);color:var(--xlcs-ink);',
    'border:1px solid var(--xlcs-line);border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(8,20,17,.28),0 2px 8px rgba(8,20,17,.08);',
    'transform-origin:right bottom;animation:xlcsIn .22s cubic-bezier(.2,.9,.3,1.2)}',
    '@keyframes xlcsIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}',
    '.xlcs-panel[hidden]{display:none!important}',
    '.xlcs-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#10574e,#0b3d38);color:#f3f8f5;flex:0 0 auto}',
    '.xlcs-ava{width:36px;height:36px;border-radius:12px;background:linear-gradient(145deg,#f7cf7c,#e8a94b);color:#221707;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:0 0 auto}',
    '.xlcs-hinfo{min-width:0;flex:1;line-height:1.25}',
    '.xlcs-hinfo b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.xlcs-hinfo span{display:flex;align-items:center;gap:6px;font-size:11px;color:#bfe3d8;margin-top:2px}',
    '.xlcs-ai{font-style:normal;font-size:10px;line-height:1;padding:3px 5px;border-radius:5px;background:rgba(245,185,66,.18);color:#ffd98d;border:1px solid rgba(245,185,66,.35)}',
    '.xlcs-head button{border:0;background:rgba(255,255,255,.1);color:#e8f3ef;border-radius:9px;min-width:34px;min-height:34px;font-size:13px;cursor:pointer}',
    '.xlcs-head button:hover{background:rgba(255,255,255,.18)}',
    '.xlcs-close{font-size:20px;line-height:1;padding:0 8px}',
    '.xlcs-body{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px 12px 6px;display:flex;flex-direction:column;gap:9px;background:linear-gradient(180deg,rgba(14,92,82,.035),transparent 120px)}',
    '.xlcs-msg{display:flex;gap:7px;align-items:flex-end;max-width:100%}',
    '.xlcs-msg .xlcs-bub{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.62;word-break:break-word;white-space:pre-wrap;position:relative}',
    '.xlcs-msg.ai{justify-content:flex-start}.xlcs-msg.ai .xlcs-bub{background:var(--xlcs-bg);border:1px solid var(--xlcs-line);color:var(--xlcs-ink);border-bottom-left-radius:5px;box-shadow:0 3px 10px rgba(16,32,29,.05)}',
    '.xlcs-msg.user{justify-content:flex-end}.xlcs-msg.user .xlcs-bub{background:linear-gradient(145deg,#167c6c,#0e5c52);color:#fff;border-bottom-right-radius:5px}',
    '.xlcs-msg .xlcs-ava2{width:24px;height:24px;border-radius:8px;background:linear-gradient(145deg,#f7cf7c,#e8a94b);color:#221707;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:0 0 auto}',
    '.xlcs-meta{display:flex;gap:6px;align-items:center;margin-top:4px;font-size:10px;color:var(--xlcs-mut)}',
    '.xlcs-fb{border:0;background:transparent;padding:2px 3px;cursor:pointer;font-size:12px;line-height:1;opacity:.55}',
    '.xlcs-fb:hover{opacity:1}.xlcs-fb.on{opacity:1;filter:saturate(1.4)}',
    '.xlcs-typing{display:inline-flex;gap:4px;align-items:center;padding:11px 13px;border-radius:14px;background:var(--xlcs-bg);border:1px solid var(--xlcs-line)}',
    '.xlcs-typing i{width:6px;height:6px;border-radius:50%;background:#9bb3aa;animation:xlcsTy 1.1s infinite}',
    '.xlcs-typing i:nth-child(2){animation-delay:.16s}.xlcs-typing i:nth-child(3){animation-delay:.32s}',
    '@keyframes xlcsTy{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}',
    '.xlcs-sys{align-self:center;max-width:92%;text-align:center;font-size:11.5px;color:var(--xlcs-mut);background:rgba(128,140,134,.1);padding:5px 10px;border-radius:999px;line-height:1.5}',
    '.xlcs-chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 8px;flex:0 0 auto}',
    '.xlcs-chip{border:1px solid var(--xlcs-line);background:var(--xlcs-bg);color:var(--xlcs-brand);border-radius:999px;padding:7px 11px;font-size:12.5px;line-height:1;cursor:pointer;min-height:34px}',
    '.xlcs-chip:hover{border-color:var(--xlcs-brand);background:rgba(14,92,82,.06)}',
    '.xlcs-hand{flex:0 0 auto;margin:0 12px 8px;padding:10px;border:1px dashed var(--xlcs-line);border-radius:12px;background:rgba(196,122,18,.05)}',
    '.xlcs-hand[hidden]{display:none!important}',
    '.xlcs-hand-t{font-size:12px;color:var(--xlcs-ink);font-weight:700;margin-bottom:7px}',
    '.xlcs-hand-row{display:flex;gap:6px;margin-top:6px}',
    '.xlcs-inp{min-width:0;flex:1;height:38px;border:1px solid var(--xlcs-line);border-radius:9px;padding:0 9px;font-size:14px;background:var(--xlcs-bg);color:var(--xlcs-ink)}',
    '.xlcs-inp:focus{outline:none;border-color:var(--xlcs-brand);box-shadow:0 0 0 3px rgba(14,92,82,.1)}',
    '.xlcs-btn{border:0;border-radius:9px;min-height:38px;padding:0 12px;font-size:13px;font-weight:700;cursor:pointer;background:linear-gradient(145deg,#167c6c,#0e5c52);color:#fff}',
    '.xlcs-btn.ghost{background:transparent;border:1px solid var(--xlcs-line);color:var(--xlcs-ink);font-weight:500}',
    '.xlcs-btn:disabled{opacity:.6}',
    '.xlcs-qr{margin-top:8px;display:none}.xlcs-qr.show{display:block}',
    '.xlcs-qr img{width:132px;height:132px;object-fit:contain;background:#fff;border-radius:8px;border:1px solid var(--xlcs-line)}',
    '.xlcs-qr p{margin:4px 0 0;font-size:11px;color:var(--xlcs-mut);line-height:1.5}',
    '.xlcs-cards{display:flex;flex-direction:column;gap:6px;margin-top:7px}',
    '.xlcs-card{display:flex;gap:8px;align-items:center;border:1px solid var(--xlcs-line);border-radius:10px;padding:6px;text-decoration:none;color:inherit;background:var(--xlcs-bg)}',
    '.xlcs-card img{width:56px;height:42px;object-fit:cover;border-radius:7px;flex:0 0 auto}',
    '.xlcs-card span{font-size:12px;line-height:1.45;color:var(--xlcs-brand);font-weight:600;word-break:break-all}',
    '.xlcs-inputbar{display:flex;gap:7px;align-items:flex-end;padding:8px 10px 6px;border-top:1px solid var(--xlcs-line);background:var(--xlcs-bg);flex:0 0 auto}',
    '.xlcs-inputbar textarea{flex:1;min-width:0;min-height:40px;max-height:96px;resize:none;border:1px solid var(--xlcs-line);border-radius:11px;padding:9px 10px;font-size:14px;line-height:1.45;background:var(--xlcs-bg);color:var(--xlcs-ink);font-family:inherit}',
    '.xlcs-inputbar textarea:focus{outline:none;border-color:var(--xlcs-brand);box-shadow:0 0 0 3px rgba(14,92,82,.1)}',
    '.xlcs-send{flex:0 0 auto;min-width:58px;height:40px;border:0;border-radius:11px;background:linear-gradient(145deg,#167c6c,#0e5c52);color:#fff;font-size:14px;font-weight:700;cursor:pointer}',
    '.xlcs-send:disabled{opacity:.5}',
    '.xlcs-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 12px 8px;font-size:10px;color:var(--xlcs-mut);flex:0 0 auto}',
    '.xlcs-foot a,.xlcs-foot button{border:0;background:none;color:var(--xlcs-brand);font-size:11px;cursor:pointer;padding:2px 0;text-decoration:underline;text-underline-offset:2px}',
    'html[data-theme="dark"] .xlcs{--xlcs-bg:#151e1b;--xlcs-ink:#e9f1ed;--xlcs-mut:#9db0a9;--xlcs-line:#28332e;--xlcs-brand:#3bb8a2;--xlcs-accent:#e2a94e}',
    'html[data-theme="dark"] .xlcs-head{background:linear-gradient(135deg,#0d211e,#0a1917)}',
    'html[data-theme="dark"] .xlcs-msg.ai .xlcs-bub{box-shadow:none}',
    'html[data-theme="dark"] .xlcs-bubble{box-shadow:0 12px 30px rgba(0,0,0,.5)}',
    'html[data-theme="dark"] .xlcs-panel{box-shadow:0 24px 60px rgba(0,0,0,.62)}',
    '@media (max-width:430px){',
    '.xlcs-bubble{right:12px;padding:0 13px 0 11px;font-size:13.5px;min-height:46px}',
    '.xlcs-panel{right:10px;left:10px;width:auto;border-radius:18px;bottom:calc(var(--leadbar-h,0px) + 68px + env(safe-area-inset-bottom));',
    'height:min(72vh,calc(100vh - var(--leadbar-h,0px) - 84px - env(safe-area-inset-bottom)))}',
    '.xlcs-msg .xlcs-bub{max-width:88%}',
    '}',
    '@media (prefers-reduced-motion:reduce){.xlcs-bubble,.xlcs-panel{transition:none;animation:none}}',
    '.xlcs-toast{position:fixed;left:50%;transform:translateX(-50%);z-index:48;background:rgba(10,24,20,.92);color:#fff;font-size:12.5px;padding:9px 14px;border-radius:999px;max-width:86vw;text-align:center;bottom:calc(var(--leadbar-h,0px) + 84px + env(safe-area-inset-bottom));opacity:0;transition:opacity .2s ease;pointer-events:none}',
    '.xlcs-toast.show{opacity:1}'
  ].join('');

  function injectStyle() {
    if (styleInjected) return;
    var s = document.createElement('style');
    s.id = 'xlcs-style';
    s.textContent = CSS;
    document.head.appendChild(s);
    styleInjected = true;
  }

  /* ---------------- DOM ---------------- */
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.6a8.4 8.4 0 0 1-8.6 8.3 9.3 9.3 0 0 1-3.4-.6L4 21l1.4-4.2a8.2 8.2 0 0 1-1-4A8.4 8.4 0 0 1 13 4.5a8.4 8.4 0 0 1 8 7.1z"/><path d="M8.4 11.5h.01M12 11.5h.01M15.6 11.5h.01"/></svg>';

  function build() {
    injectStyle();
    var root = mk('div', 'xlcs');
    root.id = 'xlcsRoot';
    root.hidden = true;
    root.innerHTML =
      '<button type="button" class="xlcs-bubble" id="xlcsBubble" aria-label="打开 AI 在线客服">' +
      '<i class="xlcs-dot"></i>' + ICON_CHAT + '<span class="xlcs-btext">在线咨询</span></button>' +
      '<section class="xlcs-panel" id="xlcsPanel" role="dialog" aria-label="AI 在线客服" hidden>' +
      '<header class="xlcs-head"><div class="xlcs-ava">AI</div>' +
      '<div class="xlcs-hinfo"><b id="xlcsName">AI 客服</b><span><i class="xlcs-ai">AI</i><span id="xlcsStatus">在线 · 秒回</span></span></div>' +
      '<button type="button" id="xlcsEnd" title="结束会话">结束</button>' +
      '<button type="button" class="xlcs-close" id="xlcsClose" aria-label="收起客服">×</button></header>' +
      '<div class="xlcs-body" id="xlcsBody"><div class="xlcs-msgs" id="xlcsMsgs"></div></div>' +
      '<div class="xlcs-chips" id="xlcsChips"></div>' +
      '<div class="xlcs-hand" id="xlcsHand" hidden>' +
      '<div class="xlcs-hand-t" id="xlcsHandT">转人工 / 留个电话，商家尽快联系您</div>' +
      '<button type="button" class="xlcs-btn" id="xlcsHExpand" style="width:100%">📞 留个电话，商家尽快联系我</button>' +
      '<div id="xlcsHForm" hidden>' +
      '<div class="xlcs-hand-row"><input class="xlcs-inp" id="xlcsHName" maxlength="20" placeholder="称呼（选填）" autocomplete="off">' +
      '<input class="xlcs-inp" id="xlcsHPhone" maxlength="11" inputmode="numeric" placeholder="手机号" autocomplete="off"></div>' +
      '<div class="xlcs-hand-row"><button type="button" class="xlcs-btn" id="xlcsHSubmit">提交并转人工</button>' +
      '<button type="button" class="xlcs-btn ghost" id="xlcsHCall">一键拨号</button>' +
      '<button type="button" class="xlcs-btn ghost" id="xlcsHCancel">取消</button></div>' +
      '</div>' +
      '<div class="xlcs-qr" id="xlcsQr"><img id="xlcsQrImg" alt="企业微信活码" loading="lazy"><p>扫码添加商家企业微信</p></div>' +
      '</div>' +
      '<form class="xlcs-inputbar" id="xlcsForm"><textarea id="xlcsInput" rows="1" maxlength="' + MAX_LEN + '" placeholder="输入问题，例如：多少钱？怎么预约？" aria-label="输入问题"></textarea>' +
      '<button type="submit" class="xlcs-send" id="xlcsSend">发送</button></form>' +
      '<div class="xlcs-foot"><span>AI 生成 · 重要信息以商家确认为准</span><button type="button" id="xlcsHuman">转人工</button></div>' +
      '</section><div class="xlcs-toast" id="xlcsToast" role="status"></div>';
    document.body.appendChild(root);
    el.root = root;
    el.bubble = id('xlcsBubble');
    el.panel = id('xlcsPanel');
    el.msgs = id('xlcsMsgs');
    el.body = id('xlcsBody');
    el.chips = id('xlcsChips');
    el.hand = id('xlcsHand');
    el.qr = id('xlcsQr');
    el.toast = id('xlcsToast');
    el.input = id('xlcsInput');
    el.sendBtn = id('xlcsSend');
    bind();
  }

  function bind() {
    el.bubble.addEventListener('click', function () { openPanel(true); });
    id('xlcsClose').addEventListener('click', function () { closePanel(); });
    id('xlcsEnd').addEventListener('click', function () { endSession(); });
    id('xlcsHuman').addEventListener('click', function () { showHandoff(''); });
    id('xlcsHCall').addEventListener('click', function () {
      var phone = (ST.phone || '').replace(/[^\d+]/g, '');
      if (phone) location.href = 'tel:' + phone; else toast('商家暂未提供电话，请留个联系方式');
    });
    id('xlcsHCancel').addEventListener('click', function () { el.hand.hidden = true; });
    id('xlcsHExpand').addEventListener('click', function () { expandHandoff(); });
    id('xlcsHSubmit').addEventListener('click', submitHandoff);
    id('xlcsForm').addEventListener('submit', function (e) { e.preventDefault(); send(el.input.value); });
    el.input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 96) + 'px';
    });
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(el.input.value); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.panel.hidden) closePanel();
    });
    // 留资条展开/收起时跟随移动（--leadbar-h 变化由承接页写入，这里只兜底监听）
    window.addEventListener('resize', function () {
      if (ST.inputH && el.input) el.input.style.height = 'auto', el.input.style.height = Math.min(el.input.scrollHeight, 96) + 'px';
    });
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 2400);
  }

  /* ---------------- 数据 ---------------- */
  function loadWidget() {
    return api('/cs/widget?slug=' + encodeURIComponent(SLUG), { timeout: 12000 }).then(function (res) {
      var d = res.body || {};
      if (!d.ok || !d.enabled) { ST.enabled = false; return; }
      ST.enabled = true;
      ST.welcome = d.welcome || '';
      ST.quick = d.quick_questions || [];
      ST.name = (d.store && d.store.name) || 'AI 客服';
      ST.handoff = d.handoff || {};
      ST.phone = ST.handoff.phone || '';
      id('xlcsName').textContent = ST.name + ' · AI 客服';
      el.root.hidden = false;
      if (ST.welcome) {
        var w = mk('div', 'xlcs-sys', esc(ST.welcome));
        el.msgs.appendChild(w);
      }
      renderChips(ST.quick);
      if (lsGet(OPEN_KEY, '') === '1') setTimeout(function () { openPanel(false); }, 400);
    }).catch(function () { ST.enabled = false; });
  }

  function renderChips(list) {
    if (!el.chips) return;
    el.chips.innerHTML = '';
    (list || []).slice(0, 5).forEach(function (q) {
      var b = mk('button', 'xlcs-chip', esc(q));
      b.type = 'button';
      b.addEventListener('click', function () { send(q); });
      el.chips.appendChild(b);
    });
  }

  function visitor() {
    if (ST.visitorId) return ST.visitorId;
    ST.visitorId = lsGet(VISITOR_KEY, '') || ('v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    lsSet(VISITOR_KEY, ST.visitorId);
    return ST.visitorId;
  }

  function scrollBottom() {
    try { el.body.scrollTop = el.body.scrollHeight + 40; } catch (e) {}
  }

  function addMsg(role, text, opts) {
    opts = opts || {};
    var wrap = mk('div', 'xlcs-msg ' + (role === 'user' ? 'user' : 'ai'));
    if (role !== 'user' && opts.avatar !== false) {
      var av = mk('div', 'xlcs-ava2', 'AI');
      wrap.appendChild(av);
    }
    var bub = mk('div', 'xlcs-bub', esc(text));
    wrap.appendChild(bub);
    if (role !== 'user') {
      if (opts.meta !== false) {
        var meta = mk('div', 'xlcs-meta');
        meta.appendChild(mk('span', '', 'AI 生成'));
        var up = mk('button', 'xlcs-fb', '👍');
        var down = mk('button', 'xlcs-fb', '👎');
        up.type = 'button'; down.type = 'button';
        up.title = '有帮助'; down.title = '没帮助 / 反馈纠正';
        up.addEventListener('click', function () { feedback(1, up, down); });
        down.addEventListener('click', function () { feedback(-1, up, down); });
        meta.appendChild(up);
        meta.appendChild(down);
        var holder = mk('div', '');
        holder.appendChild(wrap);
        holder.appendChild(meta);
        el.msgs.appendChild(holder);
      } else {
        el.msgs.appendChild(wrap);
      }
      if (opts.cards && opts.cards.length) {
        var cards = mk('div', 'xlcs-cards');
        opts.cards.forEach(function (a) {
          var link = mk('a', 'xlcs-card');
          link.href = a.url; link.target = '_blank'; link.rel = 'noopener nofollow';
          if (a.type === 'image') {
            var img = mk('img'); img.src = a.url; img.alt = a.title || '商家案例'; img.loading = 'lazy';
            img.addEventListener('error', function () { img.style.display = 'none'; });
            link.appendChild(img);
          }
          link.appendChild(mk('span', '', esc(a.title || (a.type === 'image' ? '查看案例图' : '查看详情') + ' ↗')));
          cards.appendChild(link);
        });
        el.msgs.appendChild(cards);
      }
    } else {
      el.msgs.appendChild(wrap);
    }
    scrollBottom();
    return wrap;
  }

  function addSys(text) {
    el.msgs.appendChild(mk('div', 'xlcs-sys', esc(text)));
    scrollBottom();
  }

  function showTyping() {
    var t = mk('div', 'xlcs-msg ai');
    t.appendChild(mk('div', 'xlcs-ava2', 'AI'));
    t.appendChild(mk('div', 'xlcs-typing', '<i></i><i></i><i></i>'));
    t.id = 'xlcsTyping';
    el.msgs.appendChild(t);
    scrollBottom();
    return t;
  }
  function hideTyping() {
    var t = id('xlcsTyping');
    if (t && t.parentNode) t.parentNode.removeChild(t);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function splitSentences(text) {
    var s = String(text || '').replace(/\r/g, '');
    var arr = s.split(/(?<=[。！？!?；;])/).filter(function (x) { return x && x.trim(); });
    if (!arr.length) arr = [s];
    var out = [];
    arr.forEach(function (p) {
      p = p.trim();
      if (!/[0-9A-Za-z\u4e00-\u9fa5]/.test(p)) return;
      if (p === '•' || p === '·' || p === '-' || p === '。' || p === '.') return;
      while (p.length > 110) {
        var cut = p.slice(0, 110);
        var idx = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf(','));
        if (idx < 40) idx = 108;
        out.push(p.slice(0, idx + 1));
        p = p.slice(idx + 1);
      }
      if (p) out.push(p);
    });
    if (!out.length) out = [s];
    return out.slice(0, 5);
  }

  function playReply(res) {
    var sentences = splitSentences(res.reply || '');
    if (!sentences.length) { sentences = ['收到，我帮您确认一下。']; }
    var cards = (res.assets && res.assets.length) ? res.assets : null;
    var chain = Promise.resolve();
    sentences.forEach(function (s, i) {
      chain = chain.then(function () { return sleep(i === 0 ? 260 : 520 + Math.random() * 320); }).then(function () {
        var t = showTyping();
        return sleep(Math.min(1100, 220 + s.length * 16)).then(function () {
          hideTyping();
          addMsg('assistant', s, (i === sentences.length - 1) ? { cards: cards, meta: true } : { meta: false, avatar: false });
        });
      });
    });
    return chain.then(function () {
      ST.lastReply = res.reply || '';
      if (res.lead_id && !ST.leadId) {
        ST.leadId = res.lead_id;
        addSys('已记录您的联系方式，商家会尽快联系您 ✅');
      }
      if (res.need_handoff && res.handoff) {
        showHandoff(res.handoff);
      } else if (res.handoff_recommended && !ST.handoffShown) {
        showHandoff(res.handoff || null, true);
      }
      if (res.suggestions && res.suggestions.length ) renderChips(res.suggestions);
      if (res.intent_level === 'high') id('xlcsStatus').textContent = '已识别高意向 · 可转人工';
    });
  }

  function feedback(sign, up, down) {
    if (!ST.sessionId) return;
    var rating = sign > 0 ? 'up' : 'down';
    api('/cs/feedback', {
      method: 'POST', timeout: 8000,
      body: { slug: SLUG, session_id: ST.sessionId, visitor_id: visitor(), rating: rating, message_id: ST.lastMsgId || 0 }
    }).catch(function () {});
    up.classList.toggle('on', sign > 0);
    down.classList.toggle('on', sign < 0);
    toast(sign > 0 ? '感谢反馈 👍' : '已记录，我们会优化回答');
  }

  function send(text) {
    text = String(text || '').trim();
    if (!text || ST.busy) return;
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
    ST.busy = true;
    el.sendBtn.disabled = true;
    el.input.value = '';
    el.input.style.height = 'auto';
    addMsg('user', text);
    if (el.chips) el.chips.innerHTML = '';
    var typing = showTyping();
    var body = { slug: SLUG, message: text, visitor_id: visitor(), channel: 'web' };
    if (ST.sessionId) body.session_id = ST.sessionId;
    api('/cs/chat', { method: 'POST', body: body, timeout: 90000 }).then(function (res) {
      hideTyping();
      var d = res.body || {};
      if (res.status !== 200 || !d.ok) {
        var hint = d.hint || (res.status === 429 ? '发送太频繁，请稍后再试' : '客服暂时不可用，请稍后重试或直接拨打商家电话');
        addSys(hint);
        ST.busy = false; el.sendBtn.disabled = false;
        return;
      }
      ST.sessionId = d.session_id || ST.sessionId;
      ST.lastMsgId = d.message_id || 0;
      if (d.visitor_id) { ST.visitorId = d.visitor_id; lsSet(VISITOR_KEY, d.visitor_id); }
      ssSet(SID_KEY, ST.sessionId);
      el.sendBtn.disabled = true;
      return playReply(d).then(function () {
        ST.busy = false; el.sendBtn.disabled = false;
      });
    }).catch(function () {
      hideTyping();
      addSys('网络开小差了，请稍后重试；也可以直接拨打商家电话或留个联系方式。');
      ST.busy = false; el.sendBtn.disabled = false;
    });
    scrollBottom();
  }

  function expandHandoff() {
    var form = id('xlcsHForm');
    if (form) form.hidden = false;
    var ex = id('xlcsHExpand');
    if (ex) ex.hidden = true;
    try { id('xlcsHPhone').focus({ preventScroll: true }); } catch (e) { try { id('xlcsHPhone').focus(); } catch (e2) {} }
  }

  function showHandoff(payload, soft) {
    payload = payload || ST.handoff || {};
    ST.handoff = payload;
    ST.phone = payload.phone || ST.phone;
    el.hand.hidden = false;
    ST.handoffShown = true;
    var form = id('xlcsHForm'), ex = id('xlcsHExpand');
    if (soft) {
      if (form) form.hidden = true;
      if (ex) ex.hidden = false;
      var title = id('xlcsHandT');
      if (title) title.textContent = '问题需要确认？留个电话，商家直接联系您';
    } else {
      if (form) form.hidden = false;
      if (ex) ex.hidden = true;
      var title2 = id('xlcsHandT');
      if (title2) title2.textContent = '已为您转人工：请留下称呼和手机号';
    }
    if (payload.wechat_qr_url) {
      el.qr.classList.add('show');
      var img = id('xlcsQrImg');
      img.src = payload.wechat_qr_url;
      img.addEventListener('error', function () { el.qr.classList.remove('show'); });
    }
    scrollBottom();
    if (!soft) expandHandoff();
  }

  function submitHandoff() {
    var phone = (id('xlcsHPhone').value || '').replace(/\D/g, '');
    var name = (id('xlcsHName').value || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入 11 位手机号，方便商家联系您'); return; }
    var btn = id('xlcsHSubmit');
    btn.disabled = true;
    api('/cs/handoff', {
      method: 'POST', timeout: 20000,
      body: { slug: SLUG, session_id: ST.sessionId, visitor_id: visitor(), phone: phone, name: name, reason: '网页挂件留资转人工' }
    }).then(function (res) {
      btn.disabled = false;
      var d = res.body || {};
      if (res.status === 200 && d.ok) {
        ST.leadId = d.lead_id || ST.leadId;
        el.hand.hidden = true;
        addSys('已收到您的联系方式，商家会尽快联系您 ✅');
        if (d.reply) addMsg('assistant', d.reply);
        localStorage.removeItem(SID_KEY);
      } else {
        toast(d.hint || '提交失败，请稍后重试');
      }
    }).catch(function () { btn.disabled = false; toast('网络异常，请稍后重试或直接拨打电话'); });
  }

  function endSession() {
    if (!ST.sessionId) { closePanel(); return; }
    api('/cs/end', { method: 'POST', timeout: 8000, body: { slug: SLUG, session_id: ST.sessionId, visitor_id: visitor() } })
      .catch(function () {});
    ST.sessionId = '';
    ST.leadId = '';
    ST.handoffShown = false;
    localRemove(SID_KEY);
    el.msgs.innerHTML = '';
    el.hand.hidden = true;
    if (ST.welcome) el.msgs.appendChild(mk('div', 'xlcs-sys', esc(ST.welcome)));
    renderChips(ST.quick);
    closePanel();
    toast('会话已结束，欢迎再次咨询');
  }
  function localRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function openPanel(focus) {
    if (!ST.enabled) return;
    el.panel.hidden = false;
    el.root.classList.add('open');
    el.bubble.classList.remove('has-unread');
    lsSet(OPEN_KEY, '1');
    scrollBottom();
    if (focus) { try { el.input.focus({ preventScroll: true }); } catch (e) { try { el.input.focus(); } catch (e2) {} } }
  }
  function closePanel() {
    el.panel.hidden = true;
    el.root.classList.remove('open');
    lsSet(OPEN_KEY, '0');
  }

  /* ---------------- 启动：等待承接页数据渲染完再出现 ---------------- */
  function waitApp(cb) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var app = document.getElementById('app');
      if (app && app.classList.contains('show')) { clearInterval(timer); cb(); }
      else if (tries > 40) { clearInterval(timer); cb(); }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { waitApp(boot); });
  } else {
    waitApp(boot);
  }

  function boot() {
    var saved = ssGet(SID_KEY, '');
    if (saved) ST.sessionId = saved;
    build();
    loadWidget();
  }

  window.XLCSWidget = {
    open: function () { openPanel(true); },
    send: function (t) { send(t); },
    state: ST,
    enabled: function () { return ST.enabled; }
  };
})();
