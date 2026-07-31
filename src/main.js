/**
 * main.js — Application entry point
 *
 * Registers all page modules with the router, wires up the sidebar scan
 * button and global status bar, then starts the router.
 */
(function () {
  'use strict';

  const F = window.F;
  const API = window.API;

  // ---- Global status bar ---------------------------------------------------

  function setStatus(text, kind) {
    const el = document.getElementById('scanStatus');
    el.textContent = text || '';
    el.className = 'scan-status' + (kind ? ' ' + kind : '');
  }
  window.setStatus = setStatus;

  // ---- Scan button (sidebar) ----------------------------------------------

  async function scanAll() {
    const btn = document.getElementById('scanBtnSide');
    btn.classList.add('scanning');
    setStatus('正在扫描本地日志...');
    try {
      const results = await API.scanAll();
      const total = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        setStatus(`扫描完成，新增 ${total} 条。${errors.length} 个 agent 出错：${errors.map(e => e.agent).join(', ')}`, 'error');
      } else if (total > 0) {
        setStatus(`扫描完成，新增 ${total} 条记录。`, 'success');
      } else {
        setStatus('已是最新，无新增记录。', 'success');
      }
      // Refresh whatever page is currently active.
      const route = window.Router.current;
      if (route && route.name) {
        const page = route.name;
        if (window.Pages && window.Pages[page] && window.Pages[page].refresh) {
          await window.Pages[page].refresh();
        }
      }
    } catch (err) {
      setStatus('扫描失败: ' + err.message, 'error');
    } finally {
      btn.classList.remove('scanning');
    }
  }

  document.getElementById('scanBtnSide').addEventListener('click', scanAll);
  window.scanAll = scanAll;

  // ---- Register pages ------------------------------------------------------

  window.Pages = {};
  // Each page module registers itself into window.Pages via Router.register.
  // They are loaded via <script> tags in index.html before this file.

  // ---- Init ----------------------------------------------------------------

  window.Router.init(document.getElementById('page-container'));
})();
