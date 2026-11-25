/*!
 * xl-motion.js · 星籁「科幻动效层」 v1.1.0
 * ------------------------------------------------------------------
 * 原创组件：墨黑赤金 / 国潮科幻。零第三方依赖；
 * 3D 星云为可选增强，使用同目录本地 three.module.min.js。
 * 作为 ES Module 使用；需要 <script defer> 传统引入时请用 xl-motion.iife.js。
 * License: MIT（本组件代码） / three.js: MIT（Copyright three.js authors）
 * ------------------------------------------------------------------
 * 自动初始化（DOMContentLoaded 后）：
 *   [data-xlm-nebula] 3D 星云画布      [data-count] 数字滚动
 *   [data-tilt] 卡片倾斜                [data-xlm-reveal] 错峰入场
 *   [data-flow] SVG 流光虚线
 * 也可手动：XLMotion.init(root) / XLMotion.getState() / XLMotion.configure({...})
 */

const VERSION = '1.1.0';

const win = typeof window !== 'undefined' ? window : null;
const doc = typeof document !== 'undefined' ? document : null;
const MODULE_URL = import.meta.url;

/* ---------------- 环境与全局配置 ---------------- */

const reduceMQ = win && win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
const fineMQ = win && win.matchMedia ? win.matchMedia('(hover: hover) and (pointer: fine)') : null;
const compactMQ = win && win.matchMedia ? win.matchMedia('(max-width: 767px)') : null;

const DEFAULTS = {
  autoInit: true,
  /** 3D 粒子数：桌面 / 小屏（上限 maxParticles=3000） */
  particles: 2200,
  mobileParticles: 1200,
  maxParticles: 3000,
  /** 渲染分辨率上限（超过则降采样，护性能） */
  pixelRatio: 1.5,
  /** 性能守卫：连续 fpsSamples 个 1s 采样低于 fpsThreshold → 关闭 3D */
  fpsGuard: true,
  fpsThreshold: 30,
  fpsSamples: 2,
  fpsWarmup: 2200,
  /** three.js 地址；默认同目录 three.module.min.js（相对本模块） */
  threeSrc: '',
  /** 调试：强制使用 CSS 渐变兜底 */
  forceFallback: false,
  /** 调试：打印内部事件 */
  debug: false,
  /** 动态背景：localStorage 记忆键 */
  bgStorageKey: 'xl-motion:bg',
};

let config = Object.assign({}, DEFAULTS, (win && win.XLMOTION_CONFIG && typeof win.XLMOTION_CONFIG === 'object') ? win.XLMOTION_CONFIG : {});

const state = {
  version: VERSION,
  initialized: false,
  reducedMotion: !!(reduceMQ && reduceMQ.matches),
  three: 'idle', // idle | loading | on | fallback | degraded | blocked
  fallbackReason: '',
  fps: 0,
  fpsSamples: [],
  particles: 0,
  degraded: false,
  errors: [],
};

/* ---------------- 小工具 ---------------- */

function emit(name, detail) {
  if (!doc) return;
  let ev;
  try {
    ev = new CustomEvent(name, { detail: detail || {} });
  } catch (e) {
    ev = doc.createEvent('CustomEvent');
    ev.initCustomEvent(name, false, false, detail || {});
  }
  doc.dispatchEvent(ev);
}

function warn(...args) {
  if (win && win.console) console.warn('[xl-motion]', ...args);
}

function set3dStatus(status) {
  if (doc && doc.documentElement) {
    doc.documentElement.setAttribute('data-xlm-3d', status);
    if (status === 'on') doc.documentElement.classList.add('xlm-3d-on');
    else doc.documentElement.classList.remove('xlm-3d-on');
  }
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function qa(root, sel) {
  if (!root || !root.querySelectorAll) return [];
  const list = [];
  if (root.nodeType === 1 && root.matches && root.matches(sel)) list.push(root);
  root.querySelectorAll(sel).forEach((el) => list.push(el));
  return list;
}

function debounceFrame(fn) {
  let raf = 0;
  return function (...args) {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; fn.apply(null, args); });
  };
}

function formatNumber(value, decimals, separator) {
  const fixed = Number(value).toFixed(decimals);
  const parts = fixed.split('.');
  const int = separator ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, separator) : parts[0];
  return parts.length > 1 ? int + '.' + parts[1] : int;
}

/* ---------------- WebGL 能力探测 ---------------- */

let webglSupport = null;
function hasWebGL() {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    webglSupport = !!gl;
    if (gl) {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) {
    webglSupport = false;
  }
  return webglSupport;
}

/* ---------------- 初始化标记 ---------------- */

const marks = {
  count: new WeakSet(),
  tilt: new WeakSet(),
  reveal: new WeakSet(),
  flow: new WeakSet(),
  nebula: new WeakSet(),
};

/* ==================================================================
 * 3D 星云背景（three.js 本地加载 / 鼠标视差 / FPS 守卫 / CSS 兜底）
 * ================================================================== */

const nebulas = [];
let primaryNebula = null;
/** 当前存活的 WebGL 上下文数量（用于验收：切换后必须归零/至多 1 个） */
let liveWebglContexts = 0;

function resolveThreeSrc(custom) {
  if (custom) {
    try { return new URL(custom, doc.baseURI).href; } catch (e) { return custom; }
  }
  return new URL('three.module.min.js', MODULE_URL).href;
}

class Nebula {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts || {};
    this.wrap = canvas.closest('[data-xlm-nebula-wrap]') || canvas.parentElement || canvas;
    this.particles = clamp(
      Number(opts.particles) || (compactMQ && compactMQ.matches ? Number(config.mobileParticles) : Number(config.particles)) || 2000,
      300, Number(config.maxParticles) || 3000
    );
    this.guard = !!opts.guard;
    this.threshold = Number(opts.fpsThreshold) || Number(config.fpsThreshold);
    this.sampleTarget = Math.max(1, Number(opts.fpsSamples) || Number(config.fpsSamples));
    this.threeSrc = opts.threeSrc || '';
    this.forcedFallback = !!(opts.forceFallback) || !!(canvas.hasAttribute && canvas.hasAttribute('data-force-fallback'));

    this.THREE = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.root = null;
    this.dust = null;
    this.embers = null;
    this.glows = [];
    this.glowTexture = null;

    this.dead = false;
    this.running = false;
    this.inView = true;
    this.lastTs = 0;
    this.t = 0;
    this.rafId = 0;
    this.pointer = { x: 0, y: 0 };
    this.parallax = { x: 0, y: 0 };
    this.frameCount = 0;
    this.fpsT0 = 0;
    this.strikes = 0;
    this.lastFps = 0;

    this._tick = this.tick.bind(this);
    this._onPointer = (e) => {
      this.pointer.x = (e.clientX / Math.max(1, win.innerWidth)) * 2 - 1;
      this.pointer.y = (e.clientY / Math.max(1, win.innerHeight)) * 2 - 1;
    };
    this._onResize = debounceFrame(() => this.resize());
    this._onVisibility = () => this.handleVisibility();
    this._onLost = (e) => { e.preventDefault(); this.fallback('context-lost'); };
  }

  async start() {
    if (this.dead) return;
    if (config.forceFallback || this.forcedFallback) return this.fallback('forced');
    if (state.reducedMotion) return this.fallback('reduced-motion');
    if (!hasWebGL()) return this.fallback('webgl-unavailable');

    state.three = 'loading';
    set3dStatus('loading');
    if (this.canvas) this.canvas.classList.add('xlm-nebula--loading');

    const src = resolveThreeSrc(this.threeSrc);
    let THREE;
    try {
      THREE = await import(/* @vite-ignore */ src);
    } catch (err) {
      this.recordError(err);
      return this.fallback('three-load-failed', err);
    }
    if (this.dead) return;

    try {
      this.THREE = THREE;
      this.build();
      this.bind();
      this.run();
    } catch (err) {
      this.recordError(err);
      return this.fallback('renderer-failed', err);
    }

    if (this.canvas) {
      this.canvas.classList.remove('xlm-nebula--loading');
      this.canvas.classList.add('xlm-nebula--live');
      this.canvas.setAttribute('aria-hidden', 'true');
    }
    if (this.wrap) this.wrap.classList.add('xlm-nebula--on');
    state.three = 'on';
    state.particles = this.particles;
    set3dStatus('on');
    emit('xlm:3d-ready', { particles: this.particles });
  }

  recordError(err) {
    const msg = err && err.message ? err.message : String(err);
    state.errors.push(msg);
    warn('3D 星云启动失败：', msg);
  }

  build() {
    const THREE = this.THREE;
    const width = Math.max(1, this.canvas.clientWidth || this.wrap.clientWidth || win.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || this.wrap.clientHeight || win.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.contextLive = true;
    liveWebglContexts++;
    this.renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, Number(config.pixelRatio) || 1.5));
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0908, 0.019);

    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 180);
    this.camera.position.set(0, 0, 31);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    const total = this.particles;
    const dustCount = Math.round(total * 0.8);
    const emberCount = total - dustCount;

    this.dust = this.makeLayer(dustCount, {
      size: 0.085,
      opacity: 0.82,
      radiusMin: 1.1,
      radiusMax: 24.5,
      flat: 0.56,
      depth: 10,
      coreRatio: 0.14,
      brightness: 0.5,
    });
    this.embers = this.makeLayer(emberCount, {
      size: 0.2,
      opacity: 0.95,
      radiusMin: 3,
      radiusMax: 23.5,
      flat: 0.6,
      depth: 12,
      coreRatio: 0.02,
      brightness: 0.78,
    });
    this.root.add(this.dust, this.embers);

    // 柔光星云团：程序化生成贴图（无外部资源），增强 Nebula 的体积感
    this.glows = this.makeGlowSprites();
    this.glows.forEach((glow) => this.root.add(glow));
  }

  makeGlowSprites() {
    const THREE = this.THREE;
    const canvas = doc.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,241,206,0.9)');
    gradient.addColorStop(0.22, 'rgba(230,194,122,0.34)');
    gradient.addColorStop(0.6, 'rgba(197,59,50,0.08)');
    gradient.addColorStop(1, 'rgba(230,194,122,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    this.glowTexture = texture;

    const defs = [
      { color: 0xb8892f, size: 44, x: -9, y: 1, z: -32, opacity: 0.14 },
      { color: 0xe6c27a, size: 30, x: 10, y: 6, z: -26, opacity: 0.12 },
      { color: 0xc53b32, size: 26, x: 15, y: -4, z: -28, opacity: 0.11 },
      { color: 0xf4dfae, size: 18, x: 0, y: 8, z: -20, opacity: 0.1 },
      { color: 0x8c6a2c, size: 54, x: -16, y: 5, z: -36, opacity: 0.1 },
    ];
    return defs.map((def, index) => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: def.color,
        transparent: true,
        opacity: def.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(def.x, def.y, def.z);
      sprite.scale.set(def.size, def.size, 1);
      sprite.renderOrder = -1;
      sprite.userData.xlmBaseOpacity = def.opacity;
      sprite.userData.xlmPhase = index * 1.7;
      return sprite;
    });
  }

  makeLayer(count, opts) {
    const THREE = this.THREE;
    count = Math.max(1, count);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = ['#f6e7c4', '#eed49a', '#e6c27a', '#d3a850', '#b8892f', '#c53b32', '#e06351'];
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const isCore = Math.random() < opts.coreRatio;
      const r = isCore
        ? 0.8 + Math.random() * 3.4
        : opts.radiusMin + Math.pow(Math.random(), 0.7) * (opts.radiusMax - opts.radiusMin);
      const arm = i % 3;
      const theta = arm * ((Math.PI * 2) / 3) + r * 0.16 + (Math.random() - 0.5) * 0.85;
      const jitter = 1.4 + r * 0.06;

      positions[i * 3] = Math.cos(theta) * r + (Math.random() - 0.5) * jitter * 2;
      positions[i * 3 + 1] = Math.sin(theta) * r * opts.flat + (Math.random() - 0.5) * jitter * 1.7;
      positions[i * 3 + 2] = (Math.random() - 0.5) * opts.depth;

      color.set(palette[(Math.random() * palette.length) | 0]);
      color.offsetHSL((Math.random() - 0.5) * 0.015, 0, (Math.random() - 0.5) * 0.12);
      color.multiplyScalar(opts.brightness + Math.random() * 0.6);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: opts.size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  bind() {
    win.addEventListener('pointermove', this._onPointer, { passive: true });
    win.addEventListener('resize', this._onResize, { passive: true });
    doc.addEventListener('visibilitychange', this._onVisibility);
    this.canvas.addEventListener('webglcontextlost', this._onLost, false);

    if ('IntersectionObserver' in win) {
      this._io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          this.inView = entry.isIntersecting;
          if (this.inView) this.run();
          else this.pause();
        }
      }, { threshold: 0.01 });
      this._io.observe(this.canvas);
    }
  }

  unbind() {
    win.removeEventListener('pointermove', this._onPointer);
    win.removeEventListener('resize', this._onResize);
    doc.removeEventListener('visibilitychange', this._onVisibility);
    if (this.canvas) this.canvas.removeEventListener('webglcontextlost', this._onLost);
    if (this._io) { this._io.disconnect(); this._io = null; }
  }

  run() {
    if (this.dead || this.running || !this.renderer) return;
    if (doc.hidden || !this.inView) return;
    this.running = true;
    this.lastTs = 0;
    this.rafId = requestAnimationFrame(this._tick);
  }

  pause() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  handleVisibility() {
    if (this.dead) return;
    if (doc.hidden) this.pause();
    else this.run();
  }

  tick(ts) {
    if (!this.running || this.dead) return;
    this.rafId = requestAnimationFrame(this._tick);
    if (!this.lastTs) this.lastTs = ts;
    const dtMs = Math.min(64, ts - this.lastTs);
    this.lastTs = ts;
    this.t += dtMs / 1000;

    this.sampleFps(ts);

    if (this.dead || !this.renderer || !this.root || !this.dust || !this.embers) return;

    const p = this.parallax;
    p.x = lerp(p.x, this.pointer.x, 0.045);
    p.y = lerp(p.y, this.pointer.y, 0.045);
    this.root.rotation.x = p.y * 0.07 + Math.sin(this.t * 0.07) * 0.008;
    this.root.rotation.y = p.x * 0.09;
    this.dust.rotation.z = this.t * 0.028;
    this.embers.rotation.z = -this.t * 0.018;
    for (const glow of this.glows) {
      glow.material.opacity = glow.userData.xlmBaseOpacity + Math.sin(this.t * 0.24 + glow.userData.xlmPhase) * 0.03;
    }
    this.camera.position.x = p.x * 0.8;
    this.camera.position.y = -p.y * 0.6;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  sampleFps(ts) {
    if (!this.guard) return;
    this.frameCount++;
    if (!this.fpsT0) this.fpsT0 = ts;
    const elapsed = ts - this.fpsT0;
    if (elapsed < 1000) return;

    const fps = (this.frameCount * 1000) / elapsed;
    this.frameCount = 0;
    this.fpsT0 = ts;
    this.lastFps = fps;
    state.fps = Math.round(fps * 10) / 10;
    state.fpsSamples.push(state.fps);
    if (state.fpsSamples.length > 12) state.fpsSamples.shift();
    emit('xlm:fps', { fps: state.fps });

    if (!config.fpsGuard) return;
    if (this.t * 1000 < Number(config.fpsWarmup)) return;

    if (fps < this.threshold) {
      this.strikes++;
      if (this.strikes >= this.sampleTarget) this.degrade(fps);
    } else {
      this.strikes = 0;
    }
  }

  degrade(fps) {
    if (this.dead) return;
    state.degraded = true;
    this.fallback('fps', null, fps);
    emit('xlm:fps-degraded', {
      fps: Math.round(fps * 10) / 10,
      threshold: this.threshold,
      samples: this.sampleTarget,
    });
    if (win && win.console) {
      console.info('[xl-motion] 性能守卫触发：3D 星云已降级为 CSS 渐变（FPS ' + fps.toFixed(1) + ' < ' + this.threshold + '）');
    }
  }

  fallback(reason, err, fps) {
    if (this.dead) return;
    if (err) this.recordError(err);
    this.dead = true;
    this.pause();
    this.unbind();
    this.dispose();

    if (this.wrap && !this.wrap.querySelector('.xlm-nebula__fallback') && doc) {
      const fallbackEl = doc.createElement('div');
      fallbackEl.className = 'xlm-nebula__fallback';
      fallbackEl.setAttribute('aria-hidden', 'true');
      this.wrap.appendChild(fallbackEl);
    }
    if (this.canvas) {
      this.canvas.classList.remove('xlm-nebula--loading', 'xlm-nebula--live');
      this.canvas.classList.add('xlm-nebula--off');
    }
    if (this.wrap) {
      this.wrap.classList.add('xlm-nebula--fallback');
      this.wrap.setAttribute('data-xlm-3d', reason === 'fps' ? 'degraded' : 'fallback');
    }

    if (reason === 'fps') {
      state.three = 'degraded';
    } else if (reason === 'reduced-motion') {
      state.three = 'blocked';
    } else {
      state.three = 'fallback';
    }
    state.fallbackReason = reason;
    set3dStatus(state.three);
    emit('xlm:3d-fallback', { reason, fps: fps || 0, error: err ? String(err.message || err) : '' });
  }

  dispose() {
    if (this.contextLive) {
      this.contextLive = false;
      liveWebglContexts = Math.max(0, liveWebglContexts - 1);
    }
    try {
      for (const layer of [this.dust, this.embers]) {
        if (layer) {
          if (layer.geometry) layer.geometry.dispose();
          if (layer.material) layer.material.dispose();
        }
      }
      for (const glow of this.glows) {
        if (glow.material) glow.material.dispose();
      }
      if (this.glowTexture) {
        this.glowTexture.dispose();
        this.glowTexture = null;
      }
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
        this.renderer = null;
      }
    } catch (e) {
      this.recordError(e);
    }
    this.scene = null;
    this.camera = null;
    this.root = null;
    this.dust = null;
    this.embers = null;
    this.glows = [];
  }

  resize() {
    if (this.dead || !this.renderer) return;
    const width = Math.max(1, this.canvas.clientWidth || this.wrap.clientWidth || win.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || this.wrap.clientHeight || win.innerHeight);
    this.renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, Number(config.pixelRatio) || 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.pause();
    this.unbind();
    this.dispose();
  }
}

function initNebula(root) {
  qa(root, '[data-xlm-nebula]').forEach((canvas) => {
    if (marks.nebula.has(canvas)) return;
    marks.nebula.add(canvas);
    const dataset = canvas.dataset || {};
    const instance = new Nebula(canvas, {
      particles: parseInt(dataset.particles, 10) || 0,
      fpsThreshold: parseFloat(dataset.fpsThreshold) || 0,
      fpsSamples: parseInt(dataset.fpsSamples, 10) || 0,
      threeSrc: dataset.threeSrc || '',
      guard: !primaryNebula,
    });
    if (!primaryNebula) primaryNebula = instance;
    nebulas.push(instance);
    instance.start();
  });
}

/* ==================================================================
 * 数字滚动 count-up（data-count，进入视口触发）
 * ================================================================== */

function setupCount(el, force) {
  const raw = String(el.getAttribute('data-count') || el.textContent || '0').replace(/,/g, '');
  const target = parseFloat(raw);
  if (!isFinite(target)) return;

  const dotIndex = raw.indexOf('.');
  const decimals = el.hasAttribute('data-decimals')
    ? clamp(parseInt(el.dataset.decimals, 10) || 0, 0, 4)
    : (dotIndex >= 0 ? raw.length - dotIndex - 1 : 0);
  const sepAttr = el.getAttribute('data-sep');
  const separator = sepAttr !== null ? sepAttr : (Math.abs(target) >= 1000 ? ',' : '');
  const prefix = el.getAttribute('data-count-prefix') || '';
  const suffix = el.getAttribute('data-count-suffix') || '';
  const duration = clamp(parseInt(el.getAttribute('data-count-duration') || '1400', 10) || 1400, 200, 6000);
  const delay = Math.max(0, parseInt(el.getAttribute('data-count-delay') || '0', 10) || 0);

  const render = (v) => { el.textContent = prefix + formatNumber(v, decimals, separator) + suffix; };
  el.setAttribute('aria-label', prefix + formatNumber(target, decimals, separator) + suffix);

  if (state.reducedMotion) { render(target); return; }
  if (!force && el.hasAttribute('data-xlm-counted')) return;
  el.setAttribute('data-xlm-counted', '1');
  render(0);

  const start = () => {
    const t0 = performance.now() + delay;
    const tick = (now) => {
      const p = clamp((now - t0) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      render(target * eased);
      if (p < 1) requestAnimationFrame(tick);
      else render(target);
    };
    requestAnimationFrame(tick);
  };

  if (!('IntersectionObserver' in win)) { start(); return; }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.disconnect();
      start();
    }
  }, { threshold: 0.3 });
  io.observe(el);
}

function initCountUp(root) {
  qa(root, '[data-count]').forEach((el) => {
    if (marks.count.has(el)) return;
    marks.count.add(el);
    setupCount(el);
  });
}

function countUp(el) {
  if (!el) return;
  marks.count.delete(el);
  el.removeAttribute('data-xlm-counted');
  marks.count.add(el);
  setupCount(el, true);
}

/* ==================================================================
 * 卡片 3D 倾斜（data-tilt，鼠标跟随 ≤6°，移动端 / 减少动态禁用）
 * ================================================================== */

function tiltAllowed() {
  if (state.reducedMotion) return false;
  if (compactMQ && compactMQ.matches) return false;
  if (fineMQ && !fineMQ.matches) return false;
  return (win.innerWidth || 0) >= 900;
}

function initTilt(root) {
  qa(root, '[data-tilt]').forEach((el) => {
    if (marks.tilt.has(el)) return;
    marks.tilt.add(el);

    const max = clamp(parseFloat(el.getAttribute('data-tilt-max') || el.getAttribute('data-tilt')) || 6, 0, 6);
    el.classList.add('xlm-tilt');
    el.style.setProperty('--xlm-rx', '0deg');
    el.style.setProperty('--xlm-ry', '0deg');
    el.style.setProperty('--xlm-px', '50%');
    el.style.setProperty('--xlm-py', '50%');

    let raf = 0;
    let pending = null;
    let current = { px: 0.5, py: 0.5 };

    const apply = () => {
      raf = 0;
      if (!pending) return;
      current = pending;
      pending = null;
      const rx = (-(current.py - 0.5) * 2 * max).toFixed(2);
      const ry = ((current.px - 0.5) * 2 * max).toFixed(2);
      el.style.setProperty('--xlm-rx', rx + 'deg');
      el.style.setProperty('--xlm-ry', ry + 'deg');
      el.style.setProperty('--xlm-px', (current.px * 100).toFixed(1) + '%');
      el.style.setProperty('--xlm-py', (current.py * 100).toFixed(1) + '%');
    };

    const onMove = (e) => {
      if (!tiltAllowed()) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pending = {
        px: clamp((e.clientX - rect.left) / rect.width, 0, 1),
        py: clamp((e.clientY - rect.top) / rect.height, 0, 1),
      };
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onEnter = () => {
      if (!tiltAllowed()) return;
      el.classList.add('xlm-tilting');
    };

    const reset = () => {
      el.classList.remove('xlm-tilting');
      el.style.setProperty('--xlm-rx', '0deg');
      el.style.setProperty('--xlm-ry', '0deg');
      el.style.setProperty('--xlm-px', '50%');
      el.style.setProperty('--xlm-py', '50%');
    };

    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', reset, { passive: true });
    el.addEventListener('pointercancel', reset, { passive: true });
  });
}

/* ==================================================================
 * 滚动错峰入场（IntersectionObserver + stagger）
 * ================================================================== */

function initReveal(root) {
  const els = qa(root, '[data-xlm-reveal]');
  if (!els.length) return;

  const counters = new Map();
  const delayFor = (el) => {
    const own = parseInt(el.getAttribute('data-xlm-delay') || '', 10);
    if (!isNaN(own)) return own;
    const group = el.parentElement ? el.parentElement.closest('[data-xlm-stagger]') : null;
    if (!group) return 0;
    const step = clamp(parseInt(group.getAttribute('data-xlm-stagger') || '70', 10) || 70, 0, 400);
    const index = counters.get(group) || 0;
    counters.set(group, index + 1);
    return index * step;
  };

  const reveal = (el) => {
    el.classList.add('xlm-in');
    el.removeAttribute('data-xlm-pending');
  };

  const io = 'IntersectionObserver' in win
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          if (!marks.reveal.has(el)) continue;
          reveal(el);
          io.unobserve(el);
        }
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    : null;

  els.forEach((el) => {
    if (marks.reveal.has(el)) return;
    marks.reveal.add(el);
    el.classList.add('xlm-reveal');
    el.style.setProperty('--xlm-delay', delayFor(el) + 'ms');
    if (state.reducedMotion || !io) { reveal(el); return; }
    io.observe(el);
  });
}

/* ==================================================================
 * SVG 流光虚线（data-flow）
 * ================================================================== */

const flowItemSelector = 'path, line, polyline';

function initFlow(root) {
  qa(root, '[data-flow]').forEach((container) => {
    if (marks.flow.has(container)) return;
    marks.flow.add(container);

    const tag = container.tagName ? container.tagName.toLowerCase() : '';
    if (tag !== 'svg') {
      container.classList.add('xlm-flow-wrap');
      return;
    }

    const speed = container.getAttribute('data-flow');
    if (speed && /^[\d.]+m?s$/.test(speed.trim())) {
      container.style.setProperty('--xlm-flow-dur', speed.trim());
    }
    const customSelector = container.getAttribute('data-flow-items');
    const items = customSelector ? container.querySelectorAll(customSelector) : container.querySelectorAll(flowItemSelector);
    items.forEach((item, index) => {
      if (item.hasAttribute('data-flow-skip')) return;
      item.classList.add('xlm-flow-line');
      item.style.setProperty('--xlm-flow-index', String(index));
    });
    container.classList.add('xlm-flow-ready');
  });
}

/* ==================================================================
 * 动态背景系统：7 套可切换背景 + xl-bg-switcher + FPS 静态降级
 * ------------------------------------------------------------------
 * 深色：nebula（three.js 3D）/ matrix（Canvas 2D）/ city（2D 分层视差）/ ink（CSS）
 * 浅色：dawn（CSS）/ silk（CSS）/ lineflow（Canvas 2D）
 * 任意时刻只挂载、只运行一套背景；切换时销毁旧背景（WebGL 显式释放上下文）。
 * ================================================================== */

const BACKGROUNDS = Object.freeze([
  { id: 'nebula', name: '星云粒子', en: 'NEBULA', theme: 'dark', desc: '3D 粒子深空' },
  { id: 'matrix', name: '数据矩阵', en: 'MATRIX', theme: 'dark', desc: '细密数据流' },
  { id: 'city', name: '城市夜巡', en: 'CITY', theme: 'dark', desc: '分层霓虹视差' },
  { id: 'ink', name: '水墨金晕', en: 'INK', theme: 'dark', desc: '墨迹与金晕' },
  { id: 'dawn', name: '晨光云海', en: 'DAWN', theme: 'light', desc: '柔和云层晨光' },
  { id: 'silk', name: '金丝纸纹', en: 'SILK', theme: 'light', desc: '丝绸纸纹微动' },
  { id: 'lineflow', name: '细线流光', en: 'LINE', theme: 'light', desc: '极简细线流光' },
]);
const BG_INDEX = new Map(BACKGROUNDS.map((bg) => [bg.id, bg]));
const BG_DEFAULT = Object.freeze({ dark: 'nebula', light: 'dawn' });
const BG_THEME_ATTR = 'data-xlm-theme';
const BG_GLYPHS = '01010101010{}[]<>/\\|=+-_#%&';

let bgManager = null;
let bgSwitcher = null;
const bgMarks = new WeakSet();

/* ---------- 工具 ---------- */

function bgThemeNow() {
  if (!doc || !doc.documentElement) return 'dark';
  return doc.documentElement.getAttribute(BG_THEME_ATTR) === 'light' ? 'light' : 'dark';
}

function setBgTheme(theme) {
  if (!doc || !doc.documentElement) return;
  doc.documentElement.setAttribute(BG_THEME_ATTR, theme);
}

function readBgStore(key) {
  try {
    const raw = win.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch (e) {
    return null;
  }
}

function writeBgStore(key, value) {
  try {
    win.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* 隐私模式下静默失败 */ }
}

function makeRng(seed) {
  let s = Math.abs(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return function rnd() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ---------- 城市夜景（原创国潮天际线，SVG 分层 + CSS 视差） ---------- */

function buildPagoda(cx, baseY, scale) {
  scale = scale || 1;
  let out = '';
  let y = baseY;
  let w = 168 * scale;
  for (let t = 0; t < 4; t++) {
    const body = 42 * scale;
    const roof = 24 * scale;
    out += `<rect x="${(cx - w / 2).toFixed(1)}" y="${(y - body).toFixed(1)}" width="${w.toFixed(1)}" height="${body.toFixed(1)}" fill="#060504"/>`;
    const rw = w + 48 * scale;
    out += `<path d="M${(cx - rw / 2).toFixed(1)},${(y - body + 2).toFixed(1)} Q${cx.toFixed(1)},${(y - body - roof).toFixed(1)} ${(cx + rw / 2).toFixed(1)},${(y - body + 2).toFixed(1)} L${(cx + rw / 2 - 12 * scale).toFixed(1)},${(y - body + 10 * scale).toFixed(1)} Q${cx.toFixed(1)},${(y - body - roof + 10 * scale).toFixed(1)} ${(cx - rw / 2 + 12 * scale).toFixed(1)},${(y - body + 10 * scale).toFixed(1)} Z" fill="#060504" stroke="rgba(230,194,122,0.2)" stroke-width="1"/>`;
    out += `<path d="M${(cx - rw / 2).toFixed(1)},${(y - body + 2).toFixed(1)} q-10,-1 -16,-12 M${(cx + rw / 2).toFixed(1)},${(y - body + 2).toFixed(1)} q10,-1 16,-12" stroke="rgba(230,194,122,0.3)" stroke-width="1.4" fill="none"/>`;
    out += `<circle cx="${(cx - rw / 2 + 4).toFixed(1)}" cy="${(y - body + 8).toFixed(1)}" r="${(2.2 * scale).toFixed(1)}" fill="rgba(197,59,50,0.85)"/>`;
    out += `<circle cx="${(cx + rw / 2 - 4).toFixed(1)}" cy="${(y - body + 8).toFixed(1)}" r="${(2.2 * scale).toFixed(1)}" fill="rgba(197,59,50,0.85)"/>`;
    y -= body + roof - 6 * scale;
    w -= 30 * scale;
  }
  out += `<path d="M${(cx - 3).toFixed(1)},${(y - 2).toFixed(1)} L${cx.toFixed(1)},${(y - 34 * scale).toFixed(1)} L${(cx + 3).toFixed(1)},${(y - 2).toFixed(1)} Z" fill="#060504"/>`;
  out += `<circle cx="${cx.toFixed(1)}" cy="${(y - 38 * scale).toFixed(1)}" r="${(2.8 * scale).toFixed(1)}" fill="rgba(244,223,174,0.75)"/>`;
  return `<g class="xlm-city__pagoda">${out}</g>`;
}

function buildCityMarkup() {
  const W = 1600;
  const H = 600;
  const rnd = makeRng(20261125);

  // 远景天际线
  let far = `M0,${H} L0,470`;
  let x = 0;
  while (x < W) {
    const bw = 44 + rnd() * 86;
    const bh = 26 + rnd() * 130;
    far += ` L${x.toFixed(0)},470 L${x.toFixed(0)},${(470 - bh).toFixed(0)} L${(x + bw).toFixed(0)},${(470 - bh).toFixed(0)} L${(x + bw).toFixed(0)},470`;
    x += bw + 6 + rnd() * 16;
  }
  far += ` L${W},470 L${W},${H} Z`;

  // 中景楼宇 + 灯火
  let mid = '';
  x = 16;
  while (x < W - 80) {
    const bw = 52 + rnd() * 92;
    const bh = 96 + rnd() * 190;
    const top = 522 - bh;
    let windows = '';
    const cols = Math.max(2, Math.floor(bw / 20));
    const rows = Math.max(3, Math.floor(bh / 24));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() < 0.4) continue;
        const warm = rnd() > 0.1;
        const alpha = 0.32 + rnd() * 0.58;
        windows += `<rect x="${(x + 8 + (c * (bw - 16)) / cols).toFixed(0)}" y="${(top + 12 + (r * (bh - 20)) / rows).toFixed(0)}" width="${(2 + rnd() * 3).toFixed(0)}" height="${(3 + rnd() * 4).toFixed(0)}" fill="${warm ? 'rgba(246,224,175,' + alpha.toFixed(2) + ')' : 'rgba(214,72,58,' + (alpha * 0.85).toFixed(2) + ')'}"/>`;
      }
    }
    const roof = rnd() > 0.45 ? `<rect x="${(x + bw * 0.16).toFixed(0)}" y="${(top - 4).toFixed(0)}" width="${(bw * 0.68).toFixed(0)}" height="2" fill="rgba(230,116,92,0.7)"/>` : '';
    mid += `<g><rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${bw.toFixed(0)}" height="${(522 - top).toFixed(0)}" fill="#0f0c08"/>${windows}${roof}</g>`;
    x += bw + 18 + rnd() * 40;
  }

  // 近景剪影 + 塔楼 + 栏杆
  const near = `
    <path d="M0,600 L0,556 L180,556 L180,570 L340,570 L340,600 Z" fill="#080706"/>
    <path d="M980,600 L980,540 L1080,540 L1080,560 L1220,560 L1220,600 Z" fill="#080706"/>
    ${buildPagoda(1370, 612)}
    <path d="M0,600 L1600,600 L1600,588 L0,588 Z" fill="#060504"/>
    <path d="M0,556 L180,556 M980,540 L1080,540 M1080,560 L1220,560" stroke="rgba(230,194,122,0.35)" stroke-width="1.4" fill="none"/>
    <path d="M0,600 L0,556" stroke="rgba(230,194,122,0.22)" fill="none"/>
    <path d="M1220,600 L1220,560" stroke="rgba(224,99,81,0.28)" fill="none"/>
  `;

  const embers = Array.from({ length: 16 }, () => {
    const left = (rnd() * 100).toFixed(1);
    const delay = (-rnd() * 20).toFixed(1);
    const dur = (12 + rnd() * 18).toFixed(1);
    const size = (1 + rnd() * 2).toFixed(1);
    return `<i style="--x:${left}%;--d:${dur}s;--delay:${delay}s;--s:${size}px"></i>`;
  }).join('');

  return `
    <div class="xlm-city">
      <div class="xlm-city__sky"></div>
      <div class="xlm-city__moon"></div>
      <div class="xlm-city__horizon"></div>
      <div class="xlm-city__world">
        <svg class="xlm-city__layer xlm-city__layer--far" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <path d="${far}" fill="#13100b"/>
        </svg>
        <svg class="xlm-city__layer xlm-city__layer--mid" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${mid}</svg>
        <svg class="xlm-city__layer xlm-city__layer--near" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${near}</svg>
        <div class="xlm-city__streaks"><i></i><i></i><i></i></div>
        <div class="xlm-city__embers">${embers}</div>
      </div>
      <div class="xlm-bg__grain"></div>
    </div>`;
}

/* ---------- 水墨金晕 / 晨光云海 / 金丝纸纹 ---------- */

function buildInkMarkup() {
  const blobs = [
    [14, 20, 46, 42, -3],
    [72, 28, 38, 58, -9],
    [47, 75, 52, 46, -15],
    [86, 70, 34, 38, -21],
    [28, 88, 32, 34, -27],
    [62, 10, 28, 36, -33],
  ];
  return `
    <div class="xlm-ink">
      ${blobs.map(([px, py, size, dur, delay]) => `<i class="xlm-ink__blob" style="--x:${px}%;--y:${py}%;--s:${size}vmax;--d:${dur}s;--delay:${delay}s"></i>`).join('')}
      <div class="xlm-ink__halo"></div>
      <div class="xlm-bg__grain"></div>
    </div>`;
}

function buildDawnMarkup() {
  const clouds = [
    [18, 16, 540, 180, 78],
    [66, 24, 430, 150, 92],
    [33, 38, 620, 200, 104],
    [12, 54, 470, 150, 82],
    [58, 62, 560, 180, 96],
    [82, 46, 360, 130, 74],
    [42, 30, 300, 110, 64],
    [54, 78, 720, 220, 116],
    [82, 88, 560, 200, 102],
    [18, 92, 640, 210, 110],
    [72, 56, 400, 140, 88],
  ];
  return `
    <div class="xlm-dawn">
      <div class="xlm-dawn__sun"></div>
      <div class="xlm-dawn__haze"></div>
      <div class="xlm-dawn__sea"></div>
      ${clouds.map(([px, py, w, h, dur], i) => `<i class="xlm-dawn__cloud" style="--x:${px}%;--y:${py}%;--w:${w}px;--h:${h}px;--d:${dur}s;--delay:-${(i * 13 + 7)}s"></i>`).join('')}
      <div class="xlm-dawn__veil"></div>
      <div class="xlm-bg__grain"></div>
    </div>`;
}

function buildSilkMarkup() {
  return `
    <div class="xlm-silk">
      <div class="xlm-silk__sheen"></div>
      <div class="xlm-silk__fold"></div>
      <div class="xlm-bg__grain"></div>
    </div>`;
}

/* ---------- Canvas 2D 适配器：数据矩阵 / 细线流光 ---------- */

function make2dCanvas(className) {
  const canvas = doc.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}

function mountMatrixAdapter(manager) {
  const canvas = make2dCanvas('xlm-bg-canvas');
  manager.scene.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w = 1;
  let h = 1;
  const dpr = Math.min(win.devicePixelRatio || 1, 1.25);
  let cols = [];
  const gap = 16;
  const fontSize = 14;
  const chars = BG_GLYPHS;

  const resize = () => {
    const rect = manager.stage.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'top';
    const count = Math.ceil(w / gap);
    cols = Array.from({ length: count }, (unused, i) => ({
      x: i * gap + 4,
      y: Math.random() * h,
      speed: 34 + Math.random() * 150,
      red: Math.random() < 0.09,
    }));
  };
  resize();
  const onResize = debounceFrame(resize);
  win.addEventListener('resize', onResize, { passive: true });

  return {
    type: 'canvas2d',
    resize,
    frame(dt) {
      const step = Math.min(dt, 64) / 1000;
      ctx.fillStyle = 'rgba(10,9,8,0.11)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fontSize}px "Bahnschrift", "Consolas", "Courier New", monospace`;
      for (const col of cols) {
        col.y += col.speed * step;
        if (col.y > h + 40) {
          col.y = -Math.random() * h * 0.6;
          col.speed = 34 + Math.random() * 150;
          col.red = Math.random() < 0.09;
        }
        const ch = chars[(Math.random() * chars.length) | 0];
        ctx.fillStyle = col.red ? 'rgba(232,116,98,0.95)' : 'rgba(248,231,190,0.95)';
        ctx.fillText(ch, col.x, col.y);
        ctx.fillStyle = col.red ? 'rgba(197,59,50,0.48)' : 'rgba(230,194,122,0.52)';
        ctx.fillText(chars[(Math.random() * chars.length) | 0], col.x, col.y - fontSize * 2.2);
        ctx.fillStyle = col.red ? 'rgba(197,59,50,0.2)' : 'rgba(230,194,122,0.22)';
        ctx.fillText(chars[(Math.random() * chars.length) | 0], col.x, col.y - fontSize * 4.6);
      }
    },
    destroy() { win.removeEventListener('resize', onResize); },
    degrade() { /* 静态时由 CSS 隐藏画布，露出静态底色 */ },
  };
}

function mountLineflowAdapter(manager) {
  const canvas = make2dCanvas('xlm-bg-canvas');
  manager.scene.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w = 1;
  let h = 1;
  let t = 0;
  const dpr = Math.min(win.devicePixelRatio || 1, 1.25);
  const lines = 15;

  const resize = () => {
    const rect = manager.stage.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const onResize = debounceFrame(resize);
  win.addEventListener('resize', onResize, { passive: true });

  const yAt = (line, x) => {
    const base = h * (0.16 + line * 0.05);
    const amp = 12 + line * 3.2;
    const phase = line * 0.9 + t * (0.12 + line * 0.014);
    return base + Math.sin(x * 0.0042 + phase) * amp + Math.sin(x * 0.0013 - phase * 0.6) * amp * 0.4;
  };

  return {
    type: 'canvas2d',
    resize,
    frame(dt) {
      t += Math.min(dt, 64) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < lines; i++) {
        ctx.beginPath();
        for (let x = -20; x <= w + 20; x += 22) {
          const y = yAt(i, x);
          if (x === -20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const gold = i % 3 === 0;
        ctx.strokeStyle = gold ? 'rgba(176,132,54,0.26)' : 'rgba(27,23,18,0.12)';
        ctx.lineWidth = gold ? 1.1 : 0.8;
        ctx.stroke();
      }
      for (let d = 0; d < 4; d++) {
        const line = d * 4;
        const x = ((t * (26 + d * 9) + d * (w / 4)) % (w + 240)) - 120;
        const y = yAt(line, x);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(176,132,54,0.75)';
        ctx.arc(x, y, d % 2 === 0 ? 1.8 : 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(176,132,54,0.18)';
        ctx.lineWidth = 4;
        ctx.moveTo(Math.max(0, x - 46), yAt(line, Math.max(0, x - 46)));
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    },
    destroy() { win.removeEventListener('resize', onResize); },
    degrade() { /* 静态时由 CSS 隐藏画布，露出静态底色 */ },
  };
}

/* ==================================================================
 * BackgroundManager
 * ================================================================== */

class BackgroundManager {
  constructor(stage, opts) {
    this.stage = stage;
    this.opts = opts || {};
    this.storageKey = this.opts.storageKey || config.bgStorageKey || 'xl-motion:bg';
    this.themeSync = this.opts.themeSync !== undefined
      ? !!this.opts.themeSync
      : stage.hasAttribute('data-xlm-bg-theme-sync');
    this.threshold = Number(this.opts.fpsThreshold) || Number(config.fpsThreshold) || 30;
    this.sampleTarget = Math.max(1, Number(this.opts.fpsSamples) || Number(config.fpsSamples) || 2);
    this.mode = 'auto';
    this.theme = 'dark';
    this.id = '';
    this.static = false;
    this.staticReason = '';
    this.fps = 0;
    this.fpsSamples = [];
    this.mounts = 0;
    this.scene = null;
    this.active = null;
    this.running = false;
    this.rafId = 0;
    this.lastTs = 0;
    this.frames = 0;
    this.fpsT0 = 0;
    this.warmStart = 0;
    this.strikes = 0;
    this.ptr = { x: 0, y: 0 };
    this.par = { x: 0, y: 0 };
    this.resizeHandler = debounceFrame(() => this.resize());
    this.onVisibility = () => this.handleVisibility();
    this.onReduce = () => {
      if (reduceMQ && reduceMQ.matches) this.enterStatic('reduced-motion', 0);
    };
    this.onPointer = (e) => {
      this.ptr.x = (e.clientX / Math.max(1, win.innerWidth)) * 2 - 1;
      this.ptr.y = (e.clientY / Math.max(1, win.innerHeight)) * 2 - 1;
    };
    this.init();
  }

  init() {
    this.stage.classList.add('xlm-bg');
    this.stage.setAttribute('data-xlm-bg', this.stage.getAttribute('data-xlm-bg') || 'auto');
    this.stage.setAttribute('role', 'presentation');

    const stored = readBgStore(this.storageKey);
    const attr = (this.stage.getAttribute('data-xlm-bg') || '').trim();
    let mode = stored && (stored.mode === 'auto' || stored.mode === 'fixed') ? stored.mode
      : (attr && attr !== 'auto' && BG_INDEX.has(attr) ? 'fixed' : 'auto');
    let theme = stored && (stored.theme === 'light' || stored.theme === 'dark') ? stored.theme : bgThemeNow();
    if (this.themeSync) setBgTheme(theme); else theme = bgThemeNow();
    this.theme = theme;
    this.mode = mode;

    let id;
    if (mode === 'fixed') {
      id = stored && BG_INDEX.has(stored.id) ? stored.id : (BG_INDEX.has(attr) ? attr : BG_DEFAULT[theme]);
    } else {
      id = BG_DEFAULT[theme];
    }
    if (this.themeSync && BG_INDEX.has(id) && BG_INDEX.get(id).theme !== theme) {
      theme = BG_INDEX.get(id).theme;
      this.theme = theme;
      setBgTheme(theme);
    }

    this.bind();
    this.mount(id, 'init');
    emit('xlm:bg-ready', this.getState());
  }

  bind() {
    win.addEventListener('pointermove', this.onPointer, { passive: true });
    win.addEventListener('resize', this.resizeHandler, { passive: true });
    doc.addEventListener('visibilitychange', this.onVisibility);
    if (reduceMQ && reduceMQ.addEventListener) reduceMQ.addEventListener('change', this.onReduce);
    if (this.themeSync && win.MutationObserver) {
      this.themeObserver = new MutationObserver(() => {
        const theme = bgThemeNow();
        if (theme !== this.theme) this.handleExternalTheme(theme);
      });
      this.themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: [BG_THEME_ATTR] });
    }
  }

  unbind() {
    win.removeEventListener('pointermove', this.onPointer);
    win.removeEventListener('resize', this.resizeHandler);
    doc.removeEventListener('visibilitychange', this.onVisibility);
    if (reduceMQ && reduceMQ.removeEventListener) reduceMQ.removeEventListener('change', this.onReduce);
    if (this.themeObserver) { this.themeObserver.disconnect(); this.themeObserver = null; }
  }

  setStageTheme(theme) {
    this.stage.classList.remove('xlm-bg--dark', 'xlm-bg--light');
    this.stage.classList.add('xlm-bg--' + theme);
    this.stage.setAttribute('data-xlm-bg-theme', theme);
  }

  /* ---------- 挂载 / 卸载 ---------- */

  mount(id, reason) {
    const meta = BG_INDEX.get(id) || BG_INDEX.get(BG_DEFAULT[this.theme]);
    this.unmount();
    this.id = meta.id;
    this.static = false;
    this.staticReason = '';
    this.fps = 0;
    this.fpsSamples = [];
    this.frames = 0;
    this.fpsT0 = 0;
    this.warmStart = 0;
    this.strikes = 0;
    this.stage.classList.remove('xlm-bg--static', 'xlm-bg--nebula', 'xlm-bg--matrix', 'xlm-bg--city', 'xlm-bg--ink', 'xlm-bg--dawn', 'xlm-bg--silk', 'xlm-bg--lineflow');
    this.stage.classList.add('xlm-bg--' + meta.id);
    this.setStageTheme(meta.theme);
    this.stage.setAttribute('data-xlm-bg-current', meta.id);

    this.scene = doc.createElement('div');
    this.scene.className = 'xlm-bg__scene';
    this.scene.setAttribute('aria-hidden', 'true');
    this.stage.appendChild(this.scene);

    let adapter = null;
    try {
      switch (meta.id) {
        case 'nebula': adapter = this.mountNebula(); break;
        case 'matrix': adapter = mountMatrixAdapter(this); break;
        case 'city': this.scene.innerHTML = buildCityMarkup(); adapter = { type: 'css', destroy() {} }; break;
        case 'ink': this.scene.innerHTML = buildInkMarkup(); adapter = { type: 'css', destroy() {} }; break;
        case 'dawn': this.scene.innerHTML = buildDawnMarkup(); adapter = { type: 'css', destroy() {} }; break;
        case 'silk': this.scene.innerHTML = buildSilkMarkup(); adapter = { type: 'css', destroy() {} }; break;
        case 'lineflow': adapter = this.mountLineflow(); break;
        default: adapter = { type: 'css', destroy() {} };
      }
    } catch (err) {
      state.errors.push(String(err && err.message || err));
      warn('背景挂载失败：', err);
      adapter = { type: 'css', destroy() {} };
    }
    this.active = adapter || { type: 'css', destroy() {} };
    this.mounts++;

    if (state.reducedMotion) {
      this.enterStatic('reduced-motion', 0, true);
    } else {
      this.startLoop();
    }
    emit('xlm:bg-change', this.getState());
  }

  unmount() {
    this.stopLoop();
    if (this.active) {
      try { if (this.active.destroy) this.active.destroy(); } catch (err) { warn(err); }
      if (this.active.type === 'webgl' && state.three !== 'blocked') {
        state.three = 'off';
        state.fallbackReason = '';
        set3dStatus('off');
      }
      this.active = null;
    }
    if (this.scene) {
      this.scene.remove();
      this.scene = null;
    }
  }

  mountNebula() {
    const wrap = doc.createElement('div');
    wrap.className = 'xlm-nebula-wrap xlm-bg__nebula';
    wrap.setAttribute('data-xlm-nebula-wrap', '');
    const canvas = doc.createElement('canvas');
    canvas.className = 'xlm-nebula';
    canvas.setAttribute('aria-hidden', 'true');
    const fallback = doc.createElement('div');
    fallback.className = 'xlm-nebula__fallback';
    fallback.setAttribute('aria-hidden', 'true');
    wrap.appendChild(canvas);
    wrap.appendChild(fallback);
    this.scene.appendChild(wrap);

    if (state.reducedMotion) {
      wrap.classList.add('xlm-nebula--fallback');
      return { type: 'static', destroy() {}, degrade() {} };
    }

    const nebula = new Nebula(canvas, { particles: 0, guard: false });
    nebula.start();
    return {
      type: 'webgl',
      nebula,
      destroy() { nebula.destroy(); },
      degrade() { nebula.fallback('fps'); },
      resize() { nebula.resize(); },
    };
  }

  mountLineflow() {
    this.scene.innerHTML = '<div class="xlm-lineflow"><div class="xlm-lineflow__rules"></div><div class="xlm-bg__grain"></div></div>';
    const host = this.scene.querySelector('.xlm-lineflow');
    const adapter = mountLineflowAdapter(this);
    const canvas = this.scene.querySelector('.xlm-bg-canvas');
    host.insertBefore(canvas, host.firstChild);
    return adapter;
  }

  /* ---------- 运行循环 / FPS 守卫 ---------- */

  startLoop() {
    if (this.running || this.static || !this.active) return;
    this.running = true;
    this.lastTs = 0;
    this._tick = this._tick || this.tick.bind(this);
    this.rafId = requestAnimationFrame(this._tick);
  }

  stopLoop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  tick(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._tick);
    if (doc.hidden) return;
    const dt = this.lastTs ? Math.min(64, now - this.lastTs) : 16;
    this.lastTs = now;

    if (this.active && this.active.frame) {
      try { this.active.frame(dt, now); } catch (err) { this.recordError(err); }
    }

    this.par.x = lerp(this.par.x, this.ptr.x, 0.05);
    this.par.y = lerp(this.par.y, this.ptr.y, 0.05);
    this.stage.style.setProperty('--xlm-bg-px', this.par.x.toFixed(4));
    this.stage.style.setProperty('--xlm-bg-py', this.par.y.toFixed(4));

    this.frames++;
    if (!this.fpsT0) this.fpsT0 = now;
    const elapsed = now - this.fpsT0;
    if (elapsed < 1000) return;
    const fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.fpsT0 = now;
    this.fps = fps;
    this.fpsSamples.push(Math.round(fps * 10) / 10);
    if (this.fpsSamples.length > 10) this.fpsSamples.shift();
    emit('xlm:bg-fps', { id: this.id, fps: Math.round(fps * 10) / 10 });

    if (config.fpsGuard === false) return;
    if (!this.warmStart) this.warmStart = now;
    if (now - this.warmStart < Number(config.fpsWarmup)) return;
    if (fps < this.threshold) {
      this.strikes++;
      if (this.strikes >= this.sampleTarget) this.enterStatic('fps', fps);
    } else {
      this.strikes = 0;
    }
  }

  enterStatic(reason, fps, silent) {
    if (this.static) return;
    this.static = true;
    this.staticReason = reason;
    this.stage.classList.add('xlm-bg--static');
    if (this.active && this.active.degrade) {
      try { this.active.degrade(reason, fps); } catch (err) { this.recordError(err); }
    }
    this.stopLoop();
    this.fps = reason === 'fps' ? Math.round(fps * 10) / 10 : 0;
    if (!silent) {
      emit('xlm:bg-static', { id: this.id, reason, fps: Math.round((fps || 0) * 10) / 10 });
      console.info('[xl-motion] 动态背景已切换静态降级：' + this.id + '（' + reason + '）');
    }
  }

  handleVisibility() {
    if (doc.hidden) {
      this.stopLoop();
    } else if (!this.static) {
      this.startLoop();
    }
  }

  resize() {
    if (this.active && this.active.resize) {
      try { this.active.resize(); } catch (err) { this.recordError(err); }
    }
  }

  recordError(err) {
    const msg = err && err.message ? err.message : String(err);
    state.errors.push(msg);
    warn('背景运行异常：', msg);
  }

  /* ---------- 主题 / 切换 / 记忆 ---------- */

  handleExternalTheme(theme) {
    this.theme = theme;
    if (this.mode === 'auto' || this.themeSync) {
      const target = BG_DEFAULT[theme];
      if (target !== this.id) this.mount(target, 'theme');
      this.persist();
    }
    emit('xlm:bg-theme', { theme });
  }

  setTheme(theme, options) {
    theme = theme === 'light' ? 'light' : 'dark';
    this.theme = theme;
    setBgTheme(theme);
    if (this.mode === 'auto' || this.themeSync) {
      const target = BG_DEFAULT[theme];
      if (target !== this.id) this.mount(target, 'theme');
    }
    if (!options || options.persist !== false) this.persist();
    emit('xlm:bg-theme', { theme });
    return theme;
  }

  switchTo(id) {
    const meta = BG_INDEX.get(id);
    if (!meta) return false;
    this.mode = 'fixed';
    if (this.themeSync && this.theme !== meta.theme) {
      this.theme = meta.theme;
      setBgTheme(meta.theme);
      emit('xlm:bg-theme', { theme: meta.theme });
    }
    this.mount(meta.id, 'switch');
    this.persist();
    return true;
  }

  setMode(mode) {
    if (mode !== 'auto' && mode !== 'fixed') return false;
    this.mode = mode;
    if (mode === 'auto') {
      const target = BG_DEFAULT[this.theme];
      if (target !== this.id) this.mount(target, 'auto');
    }
    this.persist();
    return true;
  }

  persist() {
    writeBgStore(this.storageKey, {
      mode: this.mode,
      id: this.id,
      theme: this.theme,
    });
  }

  getState() {
    const meta = BG_INDEX.get(this.id);
    return {
      initialized: !!(this.scene || this.id),
      id: this.id,
      name: meta ? meta.name : '',
      theme: this.theme,
      mode: this.mode,
      static: this.static,
      staticReason: this.staticReason,
      fps: Math.round(this.fps * 10) / 10,
      fpsSamples: this.fpsSamples.slice(),
      mounts: this.mounts,
      themeSync: this.themeSync,
      activeType: this.active ? this.active.type : 'none',
      webglContexts: liveWebglContexts,
      canvases: doc ? doc.querySelectorAll('.xlm-bg canvas').length : 0,
      badge: (doc && doc.documentElement && doc.documentElement.getAttribute(BG_THEME_ATTR)) || 'dark',
    };
  }

  destroy() {
    this.unbind();
    this.unmount();
    if (this.scene) this.scene.remove();
    this.scene = null;
  }
}

/* ---------- xl-bg-switcher ---------- */

function createSwitcher(manager, host) {
  const root = doc.createElement('div');
  root.className = 'xlm-bg-switcher';
  const options = BACKGROUNDS.map((bg) => `
    <button type="button" class="xlm-bg-option" data-xlm-bg-id="${bg.id}" aria-pressed="false">
      <span class="xlm-bg-thumb xlm-bg-thumb--${bg.id}" aria-hidden="true"><i></i></span>
      <span class="xlm-bg-option__meta"><b>${bg.name}</b><em>${bg.en} · ${bg.theme === 'light' ? '浅色' : '深色'}</em></span>
    </button>`).join('');
  root.innerHTML = `
    <button type="button" class="xlm-bg-switcher__toggle" aria-expanded="false" aria-controls="xlm-bg-panel" aria-label="切换动态背景">
      <span class="xlm-bg-switcher__grid" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="xlm-bg-switcher__txt">背景</span>
    </button>
    <div class="xlm-bg-switcher__panel" id="xlm-bg-panel" hidden>
      <div class="xlm-bg-panel__head">
        <div><b>动态背景</b><em>SCENES · 7</em></div>
        <span class="xlm-bg-panel__hint">深色 4 · 浅色 3</span>
      </div>
      <div class="xlm-bg-panel__grid">
        <button type="button" class="xlm-bg-option xlm-bg-option--auto" data-xlm-bg-auto aria-pressed="false">
          <span class="xlm-bg-thumb xlm-bg-thumb--auto" aria-hidden="true"><i></i></span>
          <span class="xlm-bg-option__meta"><b>跟随主题</b><em>AUTO · 默认</em></span>
        </button>
        ${options}
        <button type="button" class="xlm-bg-option xlm-bg-option--theme" data-xlm-bg-theme-toggle aria-pressed="false">
          <span class="xlm-bg-thumb xlm-bg-thumb--theme" aria-hidden="true"><i></i></span>
          <span class="xlm-bg-option__meta"><b data-xlm-theme-label>浅色主题</b><em>THEME · 深/浅</em></span>
        </button>
      </div>
      <p class="xlm-bg-panel__foot">选择后立即切换并记忆 · 默认跟随主题</p>
    </div>`;

  const toggle = root.querySelector('.xlm-bg-switcher__toggle');
  const panel = root.querySelector('.xlm-bg-switcher__panel');
  const themeLabel = root.querySelector('[data-xlm-theme-label]');

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('is-open', open);
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  panel.addEventListener('click', (e) => {
    const option = e.target.closest('[data-xlm-bg-id]');
    if (option) {
      manager.switchTo(option.getAttribute('data-xlm-bg-id'));
      setOpen(false);
      return;
    }
    if (e.target.closest('[data-xlm-bg-auto]')) {
      manager.setMode('auto');
      setOpen(false);
      return;
    }
    if (e.target.closest('[data-xlm-bg-theme-toggle]')) {
      manager.setTheme(bgThemeNow() === 'light' ? 'dark' : 'light');
      return;
    }
  });

  const onDocClick = (e) => {
    if (!root.contains(e.target)) setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  };
  doc.addEventListener('click', onDocClick, true);
  doc.addEventListener('keydown', onKey);

  const update = () => {
    const state = manager.getState();
    root.querySelectorAll('[data-xlm-bg-id]').forEach((el) => {
      const active = state.mode === 'fixed' && state.id === el.getAttribute('data-xlm-bg-id');
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const auto = root.querySelector('[data-xlm-bg-auto]');
    if (auto) {
      const active = state.mode === 'auto';
      auto.classList.toggle('is-active', active);
      auto.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (themeLabel) themeLabel.textContent = state.theme === 'light' ? '深色主题' : '浅色主题';
    root.setAttribute('data-xlm-bg-active', state.id);
  };
  const onChange = () => update();
  doc.addEventListener('xlm:bg-change', onChange);
  doc.addEventListener('xlm:bg-theme', onChange);
  update();

  const destroy = () => {
    doc.removeEventListener('click', onDocClick, true);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('xlm:bg-change', onChange);
    doc.removeEventListener('xlm:bg-theme', onChange);
    root.remove();
  };

  root._xlmUpdate = update;
  root._xlmDestroy = destroy;
  (host && host !== manager.stage ? host : doc.body).appendChild(root);
  return root;
}

function initBackgrounds(root) {
  if (!doc) return;
  qa(root, '[data-xlm-bg]').forEach((stage) => {
    if (bgMarks.has(stage)) return;
    bgMarks.add(stage);
    if (bgManager) return; // 页面级单例：只允许一套背景
    bgManager = new BackgroundManager(stage, {});
  });
  if (bgManager && !bgSwitcher) {
    const hosts = qa(root, '[data-xlm-bg-switcher]');
    bgSwitcher = createSwitcher(bgManager, hosts[0] || null);
  }
}

/* ==================================================================
 * 自动初始化 / 公共 API
 * ================================================================== */

function init(root) {
  if (!doc) return api;
  const target = root || doc;
  try { initBackgrounds(target); } catch (e) { state.errors.push(String(e && e.message || e)); warn(e); }
  try { initNebula(target); } catch (e) { state.errors.push(String(e && e.message || e)); warn(e); }
  try { initCountUp(target); } catch (e) { state.errors.push(String(e && e.message || e)); warn(e); }
  try { initTilt(target); } catch (e) { state.errors.push(String(e && e.message || e)); warn(e); }
  try { initReveal(target); } catch (e) { state.errors.push(String(e && e.message || e)); warn(e); }
  try { initFlow(target); } catch (e) { state.errors.push(String(e && e.message || e)); warn(e); }

  if (!state.initialized) {
    state.initialized = true;
    if (doc.documentElement) doc.documentElement.setAttribute('data-xlm-ready', '1');
    emit('xlm:ready', { version: VERSION });
  }
  return api;
}

function configure(next) {
  if (next && typeof next === 'object') Object.assign(config, next);
  return Object.assign({}, config);
}

function getConfig() { return Object.assign({}, config); }

function getState() {
  return {
    version: VERSION,
    initialized: state.initialized,
    reducedMotion: state.reducedMotion,
    three: state.three,
    fallbackReason: state.fallbackReason,
    fps: state.fps,
    fpsSamples: state.fpsSamples.slice(),
    particles: state.particles,
    degraded: state.degraded,
    errors: state.errors.slice(),
    webgl: hasWebGL(),
    nebulas: nebulas.length,
    webglContexts: liveWebglContexts,
    backgrounds: bgManager ? bgManager.getState() : null,
    backgroundSwitcher: !!bgSwitcher,
  };
}

function destroyAll() {
  nebulas.forEach((n) => n.destroy());
  nebulas.length = 0;
  primaryNebula = null;
  if (bgSwitcher && bgSwitcher._xlmDestroy) bgSwitcher._xlmDestroy();
  bgSwitcher = null;
  if (bgManager) {
    bgManager.destroy();
    bgManager = null;
  }
  state.initialized = false;
  marks.count = new WeakSet();
  marks.tilt = new WeakSet();
  marks.reveal = new WeakSet();
  marks.flow = new WeakSet();
  marks.nebula = new WeakSet();
}

const backgrounds = {
  list() { return BACKGROUNDS.map((bg) => Object.assign({}, bg)); },
  getState() { return bgManager ? bgManager.getState() : null; },
  switchTo(id) { return bgManager ? bgManager.switchTo(id) : false; },
  setMode(mode) { return bgManager ? bgManager.setMode(mode) : false; },
  setTheme(theme) { return bgManager ? bgManager.setTheme(theme) : false; },
};

const api = {
  version: VERSION,
  VERSION,
  init,
  configure,
  getConfig,
  getState,
  initNebula,
  initCountUp,
  initTilt,
  initReveal,
  initFlow,
  initBackgrounds,
  backgrounds,
  countUp,
  destroyAll,
};

/* ---------------- 页面可见性 / 减少动态（全局） ---------------- */

if (doc) {
  const syncVisibility = () => {
    const hidden = !!doc.hidden;
    if (doc.documentElement) doc.documentElement.classList.toggle('xlm-page-hidden', hidden);
    emit('xlm:visibility', { hidden });
  };
  doc.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();

  if (reduceMQ) {
    if (doc.documentElement) doc.documentElement.classList.toggle('xlm-reduced', reduceMQ.matches);
    const onReduceChange = () => {
      state.reducedMotion = reduceMQ.matches;
      if (doc.documentElement) doc.documentElement.classList.toggle('xlm-reduced', reduceMQ.matches);
      if (reduceMQ.matches) {
        nebulas.forEach((n) => n.fallback('reduced-motion'));
        qa(doc, '[data-xlm-reveal]').forEach((el) => el.classList.add('xlm-in'));
      }
    };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduceChange);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReduceChange);
  }
}

/* ---------------- 全局挂载 + 自动启动 ---------------- */

if (win) {
  win.XLMotion = api;
}

if (win && doc && config.autoInit !== false) {
  const boot = () => init(doc);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}

/* ---------------- ESM 导出 ---------------- */

export {
  VERSION,
  init,
  configure,
  getConfig,
  getState,
  initNebula,
  initCountUp,
  initTilt,
  initReveal,
  initFlow,
  initBackgrounds,
  backgrounds,
  countUp,
  destroyAll,
  api as XLMotion,
};

export default api;
