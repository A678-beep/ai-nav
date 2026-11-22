/* 星籁 AI · 运营后台「模板市场」tab 组件（/ai-nav/ops/edit/ 引入，admin only）
 * 依赖：assets/auth.js（window.XLAuth：Bearer token + /ai-nav/api 基址 + api() 封装）
 * 功能：模板列表/搜索筛选、新建/编辑（脚本骨架 JSON、字幕样式、BGM、时长、可商用、热度、上下架）、
 *       上下架、热度调整、套用统计；写入均走后端 admin 鉴权 + 审计（tpl_ops_log）。
 * 说明：仅运营后台加载，客户端不引入；所有字段与用户端 /templates/ 共用同一份数据（templates_market.db）。
 */
(function () {
  'use strict';
  if (window.__XL_TPL_OPS__) return;
  window.__XL_TPL_OPS__ = true;

  var PREFIX = '/templates-market/ops';
  var BUILT = false;
  var state = {
    items: [], total: 0, page: 1, size: 20, q: '', industry: '', scene: '', status: '',
    stats: null, editing: null, busy: false
  };

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
    return isFinite(v) ? (v.toLocaleString ? v.toLocaleString('zh-CN') : String(v)) : '0';
  }
  function api(method, path, body) {
    return XLAuth.api(path, { method: method, body: body, timeout: 30000 });
  }
  function errText(e) { return (e && (e.message || e.hint || e.code)) || '操作失败'; }
  function toast(msg) {
    try {
      if (window.XLAuth && XLAuth.toast) { XLAuth.toast(msg); return; }
    } catch (e) {}
    var box = document.getElementById('oeToastBox');
    if (!box) { return; }
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }

  var STYLE = [
    '.tploe{display:flex;flex-direction:column;gap:14px}',
    '.tploe .tp-card{border:1px solid var(--oe-line);border-radius:12px;background:var(--oe-panel);padding:14px}',
    '.tploe .tp-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
    '.tploe .tp-h h3{margin:0;font-size:15px;color:var(--oe-txt)}',
    '.tploe .tp-h .muted{color:var(--oe-txt3);font-size:12px}',
    '.tploe .tp-h .grow{flex:1}',
    '.tploe .tp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.tploe input,.tploe select,.tploe textarea{background:var(--oe-panel2);border:1px solid var(--oe-line);border-radius:8px;color:var(--oe-txt);padding:7px 10px;font-size:12.5px;outline:none;font-family:inherit}',
    '.tploe input:focus,.tploe select:focus,.tploe textarea:focus{border-color:rgba(56,189,248,.55)}',
    '.tploe textarea{resize:vertical;line-height:1.5;min-height:70px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}',
    '.tploe .btn{border:1px solid var(--oe-line2);background:var(--oe-panel2);color:var(--oe-txt);border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;white-space:nowrap}',
    '.tploe .btn:hover{border-color:rgba(56,189,248,.5);color:#bae6fd}',
    '.tploe .btn.primary{background:linear-gradient(135deg,#0ea5e9,#6366f1);border-color:transparent;color:#031019;font-weight:700}',
    '.tploe .btn.warn{border-color:rgba(251,191,36,.5);color:#fde68a}',
    '.tploe .btn.bad{border-color:rgba(251,113,133,.5);color:#fecdd3}',
    '.tploe .btn.sm{padding:4px 9px;font-size:11.5px}',
    '.tploe .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}',
    '.tploe .st{border:1px solid var(--oe-line);border-radius:10px;padding:10px 12px;background:var(--oe-panel3)}',
    '.tploe .st b{display:block;font-size:20px;color:var(--oe-cyan);font-variant-numeric:tabular-nums}',
    '.tploe .st span{font-size:11.5px;color:var(--oe-txt3)}',
    '.tploe table{width:100%;border-collapse:collapse;font-size:12.5px}',
    '.tploe th,.tploe td{padding:8px 8px;border-bottom:1px solid var(--oe-line);text-align:left;vertical-align:middle}',
    '.tploe th{color:var(--oe-txt3);font-weight:600;font-size:11.5px;white-space:nowrap}',
    '.tploe tr:hover td{background:rgba(148,163,184,.04)}',
    '.tploe .cover{width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--oe-line);display:block;background:#0b1220}',
    '.tploe .name{font-weight:700;color:var(--oe-txt);line-height:1.35}',
    '.tploe .tiny{font-size:11px;color:var(--oe-txt3);margin-top:2px}',
    '.tploe .pill{display:inline-block;font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--oe-line);color:var(--oe-txt2);margin-right:4px;white-space:nowrap}',
    '.tploe .pill.on{color:#a7f3d0;border-color:rgba(52,211,153,.45);background:rgba(6,78,59,.35)}',
    '.tploe .pill.off{color:#fecdd3;border-color:rgba(251,113,133,.4);background:rgba(127,29,29,.3)}',
    '.tploe .pill.hot{color:#fde68a;border-color:rgba(251,191,36,.4);background:rgba(120,53,15,.32)}',
    '.tploe .empty{padding:28px;text-align:center;color:var(--oe-txt3)}',
    '.tploe .editor{border:1px solid rgba(56,189,248,.35);border-radius:12px;background:rgba(56,189,248,.05);padding:14px}',
    '.tploe .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}',
    '.tploe .grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.tploe label{display:block;font-size:11.5px;color:var(--oe-txt3);margin:0 0 4px}',
    '.tploe .field{margin:0 0 10px}',
    '.tploe .jsonrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}',
    '.tploe .hint{font-size:11px;color:var(--oe-txt3);margin-top:4px}',
    '.tploe .pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;color:var(--oe-txt3);font-size:12px}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('tploeStyle')) return;
    var s = document.createElement('style');
    s.id = 'tploeStyle';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  var INDUSTRIES = [
    ['canyin', '餐饮'], ['meiya', '美业'], ['jiazheng', '家政'], ['qixiu', '汽修'], ['hunqing', '婚庆'],
    ['jiaopei', '教培'], ['jianshen', '健身'], ['hongbei', '烘焙甜品'], ['kafei', '咖啡'], ['chayin', '茶饮'],
    ['chongwu', '宠物'], ['sheying', '摄影写真'], ['meifa', '美发造型'], ['kouqiang', '口腔牙科'], ['yimei', '医美'],
    ['yuezi', '月子母婴'], ['banjia', '搬家'], ['zhuangxiu', '装修'], ['jiadian', '家电维修'], ['lvsuo', '律师法务'],
    ['caishui', '代理记账'], ['jiaxiao', '驾校'], ['lvxing', '旅行社'], ['minsu', '民宿酒店'], ['huadian', '花店'],
    ['fuzhuang', '服装'], ['zhubao', '珠宝'], ['shuma', '数码'], ['yanjing', '眼镜'], ['taiqiu', '台球娱乐']
  ];
  var SCENES = [['tan', '探店'], ['koubo', '口播'], ['cuxiao', '促销'], ['zhaopin', '招聘'],
    ['jieri', '节日'], ['chanpin', '产品展示'], ['kepu', '知识科普']];
  var STYLES = ['稳重专业', '亲切口语', '活泼种草', '科技感', '温暖治愈'];
  var VOICES = ['女声·亲切自然', '男声·稳重专业', '女声·活泼种草', '男声·青年', '男声·成熟'];
  var BGMS = ['轻音乐', '温暖钢琴', '轻快', '科技感'];

  function opt(list, cur) {
    var html = '';
    list.forEach(function (it) {
      var v = it[0], n = it[1];
      html += '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(n) + '</option>';
    });
    return html;
  }
  function opt1(list, cur) {
    var html = '';
    list.forEach(function (v) {
      html += '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return html;
  }

  function defaultScript() {
    return {
      scene: 'koubo',
      scene_name: '口播',
      note: '3-6 段脚本骨架；占位符 {store} 店名 {p1}{p2}{p3} 卖点 {offer} 优惠 {cta} 行动',
      segments: [
        { key: 'hook', role: '开场钩子', text15: '{store}，今天说点实在的。', text30: '{store}，今天说点实在的，30 秒讲清楚。', dur15: 2.8, dur30: 5.5, visual: '老板出镜', animation: 'zoom', transition: '闪白', emphasis: true },
        { key: 'pain', role: '痛点共鸣', text15: '你是不是也遇到：{p1}？', text30: '你是不是也遇到：{p1}？很多人都在将就。', dur15: 3.0, dur30: 6.0, visual: '痛点字幕卡', animation: 'kenburns', transition: '淡入淡出' },
        { key: 'solution', role: '方案给到', text15: '我们的做法：{p1}、{p2}。', text30: '我们的做法很简单：{p1}、{p2}、{p3}，不玩虚的。', dur15: 3.2, dur30: 6.0, visual: '流程画面', animation: 'kenburns', transition: '淡入淡出', emphasis: true },
        { key: 'trust', role: '信任背书', text15: '{proof}。', text30: '{proof}，出了问题有人管。', dur15: 3.0, dur30: 6.0, visual: '资质/团队', animation: 'kenburns', transition: '淡入淡出' },
        { key: 'cta', role: '行动号召', text15: '{offer}，{cta}。', text30: '{offer}，仅限{limit}。{cta}，主页可留言。', dur15: 2.8, dur30: 6.5, visual: '地址/优惠卡', animation: 'zoom', transition: '闪白', emphasis: true }
      ]
    };
  }
  function defaultSubtitle() {
    return {
      preset: 'bold_yellow', name: '粗白字·黄高亮', font: '思源黑体 Heavy', size: 66,
      color: '#FFFFFF', stroke: '#0B1220', stroke_width: 4, highlight: '#FBBF24',
      bg: 'none', position: 'bottom-center', animation: '逐句弹出', max_chars_per_line: 12,
      desc: '粗白字 + 黄色关键词高亮'
    };
  }
  function defaultBgm() {
    return { mood: '轻快', tags: ['尤克里里', '拍手', '100-110BPM'], desc: '轻快流行' };
  }

  function blankTemplate() {
    return {
      id: '', name: '', industry: 'canyin', industry_name: '餐饮', scene: 'koubo', scene_name: '口播',
      ratio: '9:16', durations: [15, 30], default_duration: 15, desc: '', tags: [],
      script_structure: defaultScript(), subtitle_style: defaultSubtitle(),
      bgm_suggestion: defaultBgm(), commercial: 1, heat: 0, status: 'offline',
      style: '稳重专业', voice: '女声·亲切自然', bgm: '轻快', cover_url: '', preview_url: ''
    };
  }

  function render() {
    var panel = document.getElementById('panel-tplmarket');
    if (!panel) return;
    injectStyle();
    if (!BUILT) {
      panel.innerHTML = '<div class="tploe" id="tploeRoot">' +
        '<div class="tp-card"><div class="tp-h"><h3>模板市场</h3>' +
        '<span class="muted">30 行业 × 7 场景 · 用户端 /templates/ 同源数据</span><span class="grow"></span>' +
        '<button class="btn" type="button" data-act="refresh">↻ 刷新</button>' +
        '<button class="btn primary" type="button" data-act="new">＋ 新建模板</button></div>' +
        '<div class="stats" id="tploeStats"></div></div>' +
        '<div id="tploeEditorHost"></div>' +
        '<div class="tp-card"><div class="tp-row" style="margin-bottom:10px">' +
        '<input id="tploeQ" placeholder="搜索名称 / ID / 行业" style="min-width:200px;flex:1">' +
        '<select id="tploeIndustry"><option value="">全部行业</option>' + opt(INDUSTRIES, '') + '</select>' +
        '<select id="tploeScene"><option value="">全部场景</option>' + opt(SCENES, '') + '</select>' +
        '<select id="tploeStatus"><option value="">全部状态</option><option value="online">已上架</option><option value="offline">已下架</option></select>' +
        '<button class="btn" type="button" data-act="search">搜索</button></div>' +
        '<div id="tploeList"><div class="empty">加载中…</div></div>' +
        '<div class="pager" style="margin-top:10px"><span id="tploePagerText"></span>' +
        '<button class="btn sm" type="button" data-act="prev">上一页</button>' +
        '<button class="btn sm" type="button" data-act="next">下一页</button></div></div></div>';
      BUILT = true;
      bind();
      load();
    } else {
      panel.hidden = false;
    }
  }

  function bind() {
    var root = document.getElementById('tploeRoot');
    if (!root) return;
    root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) {
        var ed = e.target.closest ? e.target.closest('[data-edit]') : null;
        if (ed) { editItem(ed.getAttribute('data-edit')); return; }
        var tg = e.target.closest ? e.target.closest('[data-toggle]') : null;
        if (tg) { toggleStatus(tg.getAttribute('data-toggle')); return; }
        var ht = e.target.closest ? e.target.closest('[data-heat]') : null;
        if (ht) { bumpHeat(ht.getAttribute('data-heat')); return; }
        var sv = e.target.closest ? e.target.closest('[data-save]') : null;
        if (sv) { saveEditor(); return; }
        var cc = e.target.closest ? e.target.closest('[data-cancel]') : null;
        if (cc) { closeEditor(); return; }
        return;
      }
      var act = b.getAttribute('data-act');
      if (act === 'refresh') { load(true); }
      else if (act === 'new') { openEditor(blankTemplate(), true); }
      else if (act === 'search') { state.page = 1; load(); }
      else if (act === 'prev') { if (state.page > 1) { state.page -= 1; load(); } }
      else if (act === 'next') { state.page += 1; load(); }
    });
    var q = document.getElementById('tploeQ');
    if (q) q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { state.q = q.value.trim(); state.page = 1; load(); }
    });
    ['tploeIndustry', 'tploeScene', 'tploeStatus'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () {
        state.industry = (document.getElementById('tploeIndustry') || {}).value || '';
        state.scene = (document.getElementById('tploeScene') || {}).value || '';
        state.status = (document.getElementById('tploeStatus') || {}).value || '';
        state.page = 1;
        load();
      });
    });
  }

  function load(silent) {
    var list = document.getElementById('tploeList');
    if (list && !silent) list.innerHTML = '<div class="empty">加载中…</div>';
    var qs = ['page=' + state.page, 'size=' + state.size];
    if (state.q) qs.push('q=' + encodeURIComponent(state.q));
    if (state.industry) qs.push('industry=' + encodeURIComponent(state.industry));
    if (state.scene) qs.push('scene=' + encodeURIComponent(state.scene));
    if (state.status) qs.push('status=' + encodeURIComponent(state.status));
    return Promise.all([
      api('GET', PREFIX + '/list?' + qs.join('&')),
      api('GET', PREFIX + '/stats')
    ]).then(function (res) {
      state.items = res[0].items || [];
      state.total = res[0].total || 0;
      state.stats = res[1] || {};
      renderStats();
      renderList();
    }).catch(function (e) {
      if (list) list.innerHTML = '<div class="empty">加载失败：' + esc(errText(e)) + '</div>';
      toast('模板市场加载失败：' + errText(e));
    });
  }

  function renderStats() {
    var el = document.getElementById('tploeStats');
    if (!el) return;
    var s = state.stats || {};
    el.innerHTML =
      '<div class="st"><b>' + num(s.total) + '</b><span>模板总数</span></div>' +
      '<div class="st"><b>' + num(s.online) + '</b><span>已上架</span></div>' +
      '<div class="st"><b>' + num(s.uses) + '</b><span>累计套用</span></div>' +
      '<div class="st"><b>' + num(s.favorites) + '</b><span>累计收藏</span></div>';
  }

  function renderList() {
    var list = document.getElementById('tploeList');
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="empty">没有匹配的模板</div>';
      var pt0 = document.getElementById('tploePagerText');
      if (pt0) pt0.textContent = '共 0 条';
      return;
    }
    var html = '<table><thead><tr><th>模板</th><th>行业 / 场景</th><th>时长</th><th>热度 / 收藏 / 套用</th><th>状态</th><th>操作</th></tr></thead><tbody>';
    state.items.forEach(function (it) {
      var st = it.status === 'online'
        ? '<span class="pill on">已上架</span>' : '<span class="pill off">已下架</span>';
      html += '<tr>' +
        '<td><div style="display:flex;gap:9px;align-items:center">' +
        (it.cover_url ? '<img class="cover" loading="lazy" src="' + esc(it.cover_url) + '" alt="">' : '<div class="cover"></div>') +
        '<div style="min-width:0"><div class="name">' + esc(it.name) + '</div>' +
        '<div class="tiny">' + esc(it.id) + (it.commercial ? ' · 可商用' : '') + '</div></div></div></td>' +
        '<td><span class="pill">' + esc(it.industry_name) + '</span><span class="pill">' + esc(it.scene_name) + '</span><span class="pill">' + esc(it.ratio) + '</span></td>' +
        '<td class="tiny">' + esc((it.durations || []).join(' / ')) + ' 秒</td>' +
        '<td class="tiny"><span class="pill hot">🔥 ' + num(it.heat) + '</span>♥ ' + num(it.favorite_count) + ' · ▶ ' + num(it.use_count) + '</td>' +
        '<td>' + st + '</td>' +
        '<td style="white-space:nowrap">' +
        '<button class="btn sm" type="button" data-edit="' + esc(it.id) + '">编辑</button> ' +
        '<button class="btn sm" type="button" data-toggle="' + esc(it.id) + '" data-cur="' + esc(it.status) + '">' + (it.status === 'online' ? '下架' : '上架') + '</button> ' +
        '<button class="btn sm warn" type="button" data-heat="' + esc(it.id) + '">热度+100</button>' +
        (it.preview_url ? ' <a class="btn sm" href="' + esc(it.preview_url) + '" target="_blank" rel="noopener">预览</a>' : '') +
        '</td></tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = html;
    var pt = document.getElementById('tploePagerText');
    if (pt) {
      var pages = Math.max(1, Math.ceil(state.total / state.size));
      pt.textContent = '共 ' + num(state.total) + ' 条 · 第 ' + state.page + ' / ' + pages + ' 页';
    }
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function toggleStatus(id) {
    var it = findItem(id);
    if (!it) return;
    var next = it.status === 'online' ? 'offline' : 'online';
    api('POST', PREFIX + '/status', { id: id, status: next }).then(function () {
      toast(next === 'online' ? '已上架，用户端立即可见' : '已下架，用户端立即隐藏');
      load(true);
    }).catch(function (e) { toast('操作失败：' + errText(e)); });
  }

  function bumpHeat(id) {
    var it = findItem(id);
    if (!it) return;
    var heat = Number(it.heat || 0) + 100;
    api('POST', PREFIX + '/heat', { id: id, heat: heat }).then(function () {
      toast('热度已更新为 ' + heat);
      load(true);
    }).catch(function (e) { toast('操作失败：' + errText(e)); });
  }

  function editItem(id) {
    api('GET', PREFIX + '/list?q=' + encodeURIComponent(id) + '&size=5').then(function (d) {
      var it = (d.items || []).filter(function (x) { return x.id === id; })[0];
      if (!it) { toast('模板不存在'); return; }
      openEditor(it, false);
    }).catch(function (e) { toast('读取模板失败：' + errText(e)); });
  }

  function openEditor(it, isNew) {
    state.editing = it || blankTemplate();
    var t = state.editing;
    var host = document.getElementById('tploeEditorHost');
    if (!host) return;
    var script = JSON.stringify(t.script_structure || defaultScript(), null, 1);
    var subtitle = JSON.stringify(t.subtitle_style || defaultSubtitle(), null, 1);
    var bgm = JSON.stringify(t.bgm_suggestion || defaultBgm(), null, 1);
    host.innerHTML = '<div class="editor tploe"><div class="tp-h"><h3>' + (isNew ? '新建模板' : '编辑模板') +
      (t.id ? ' · ' + esc(t.id) : '') + '</h3><span class="grow"></span>' +
      '<button class="btn primary" type="button" data-save="1">保存' + (isNew ? '并创建' : '') + '</button>' +
      '<button class="btn" type="button" data-cancel="1">取消</button></div>' +
      '<div class="field"><label>模板名称（必填，≤24 字）</label><input id="edName" maxlength="24" value="' + esc(t.name) + '" style="width:100%"></div>' +
      '<div class="grid3">' +
      '<div><label>行业</label><select id="edIndustry" style="width:100%">' + opt(INDUSTRIES, t.industry) + '</select></div>' +
      '<div><label>场景</label><select id="edScene" style="width:100%">' + opt(SCENES, t.scene) + '</select></div>' +
      '<div><label>比例</label><select id="edRatio" style="width:100%">' + opt1(['9:16', '16:9', '1:1', '4:5'], t.ratio) + '</select></div>' +
      '<div><label>默认时长</label><select id="edDur" style="width:100%">' + opt([[15, '15 秒'], [30, '30 秒']], t.default_duration) + '</select></div>' +
      '<div><label>风格（autoedit）</label><select id="edStyle" style="width:100%">' + opt1(STYLES, t.style) + '</select></div>' +
      '<div><label>配音音色</label><select id="edVoice" style="width:100%">' + opt1(VOICES, t.voice) + '</select></div>' +
      '<div><label>BGM 情绪</label><select id="edBgm" style="width:100%">' + opt1(BGMS, t.bgm) + '</select></div>' +
      '<div><label>状态</label><select id="edStatus" style="width:100%">' + opt([['offline', '下架'], ['online', '上架']], t.status) + '</select></div>' +
      '<div><label>热度</label><input id="edHeat" type="number" value="' + esc(t.heat || 0) + '" style="width:100%"></div>' +
      '<div><label>可商用</label><select id="edCommercial" style="width:100%">' + opt([[1, '可商用'], [0, '仅供展示']], t.commercial ? 1 : 0) + '</select></div>' +
      '</div>' +
      '<div class="field"><label>一句话介绍（卡片展示）</label><input id="edDesc" maxlength="80" value="' + esc(t.desc) + '" style="width:100%"></div>' +
      '<div class="field"><label>标签（顿号或逗号分隔）</label><input id="edTags" value="' + esc((t.tags || []).join('、')) + '" style="width:100%"></div>' +
      '<div class="jsonrow">' +
      '<div class="field"><label>脚本骨架 script_structure（JSON，3-6 段；占位符 {store}{p1}{p2}{p3}{offer}{cta}）</label>' +
      '<textarea id="edScript" rows="16" style="width:100%">' + esc(script) + '</textarea>' +
      '<div class="hint">保存后端会校验：segments 必须是数组且 ≥1 段（建议 3-6 段）</div></div>' +
      '<div class="field"><label>字幕样式 subtitle_style（JSON）</label>' +
      '<textarea id="edSubtitle" rows="8" style="width:100%">' + esc(subtitle) + '</textarea>' +
      '<label style="margin-top:8px">BGM 建议 bgm_suggestion（JSON）</label>' +
      '<textarea id="edBgmJson" rows="5" style="width:100%">' + esc(bgm) + '</textarea></div>' +
      '</div></div>';
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeEditor() {
    var host = document.getElementById('tploeEditorHost');
    if (host) host.innerHTML = '';
    state.editing = null;
  }

  function saveEditor() {
    if (state.busy) return;
    var t = state.editing || {};
    var payload = {
      id: t.id || '',
      name: (($('#edName') || {}).value || '').trim(),
      industry: ($('#edIndustry') || {}).value,
      scene: ($('#edScene') || {}).value,
      ratio: ($('#edRatio') || {}).value,
      default_duration: Number((($('#edDur') || {}).value) || 15),
      style: ($('#edStyle') || {}).value,
      voice: ($('#edVoice') || {}).value,
      bgm: ($('#edBgm') || {}).value,
      status: ($('#edStatus') || {}).value,
      heat: Number((($('#edHeat') || {}).value) || 0),
      commercial: Number((($('#edCommercial') || {}).value) || 0),
      desc: (($('#edDesc') || {}).value || '').trim(),
      tags: (($('#edTags') || {}).value || '').trim(),
      script_structure: (($('#edScript') || {}).value || '').trim(),
      subtitle_style: (($('#edSubtitle') || {}).value || '').trim(),
      bgm_suggestion: (($('#edBgmJson') || {}).value || '').trim()
    };
    if (!payload.name) { toast('请填写模板名称'); return; }
    // 前端先校验 JSON，避免白跑一趟
    var bad = null;
    ['script_structure', 'subtitle_style', 'bgm_suggestion'].forEach(function (k) {
      try { JSON.parse(payload[k] || '{}'); } catch (e) { bad = k; }
    });
    if (bad) { toast('JSON 格式有误：' + bad); return; }
    state.busy = true;
    api('POST', PREFIX + '/save', payload).then(function (d) {
      var created = d.created;
      state.busy = false;
      closeEditor();
      toast(created ? '模板已创建（默认下架，检查封面后上架）' : '模板已更新，用户端立即生效');
      load(true);
    }).catch(function (e) {
      state.busy = false;
      toast('保存失败：' + errText(e));
    });
  }

  window.XLTplMarketOps = { load: function () { return Promise.resolve(); }, render: render };
})();
