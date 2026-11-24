/*!
 * xl-motion.js · 星籁「科幻动效层」 v1.0.0
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

const VERSION = '1.0.0';

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
 * 自动初始化 / 公共 API
 * ================================================================== */

function init(root) {
  if (!doc) return api;
  const target = root || doc;
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
  };
}

function destroyAll() {
  nebulas.forEach((n) => n.destroy());
  nebulas.length = 0;
  primaryNebula = null;
  state.initialized = false;
  marks.count = new WeakSet();
  marks.tilt = new WeakSet();
  marks.reveal = new WeakSet();
  marks.flow = new WeakSet();
  marks.nebula = new WeakSet();
}

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
  countUp,
  destroyAll,
  api as XLMotion,
};

export default api;
