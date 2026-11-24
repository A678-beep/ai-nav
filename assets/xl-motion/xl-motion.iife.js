/*!
 * xl-motion.iife.js · 星籁「科幻动效层」IIFE 入口 v1.0.0
 * ------------------------------------------------------------------
 * 供传统 <script defer src="xl-motion.iife.js"></script> 使用：
 * 内部以动态 import() 加载同目录 ES Module，自动初始化后把 API 挂到
 * window.XLMotion（与模块方式行为一致）。
 * 若页面已通过 <script type="module"> 引入 xl-motion.js，无需再引入本文件。
 */
(function () {
  'use strict';
  if (window.XLMotion && window.XLMotion.version) return; // 模块已加载
  var current = document.currentScript;
  var base = (current && current.src) ? current.src : window.location.href;
  var moduleURL;
  try {
    moduleURL = new URL('xl-motion.js', base).href;
  } catch (e) {
    moduleURL = 'xl-motion.js';
  }
  import(moduleURL).then(function (mod) {
    if (mod && mod.XLMotion && !window.XLMotion) window.XLMotion = mod.XLMotion;
  }).catch(function (err) {
    if (window.console) console.error('[xl-motion] 模块加载失败，请检查路径与静态服务：', err);
  });
})();
