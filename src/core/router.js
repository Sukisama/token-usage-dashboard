/**
 * router.js — Hash-based SPA router (global: window.Router)
 *
 * Routes:
 *   #/overview             Overview page
 *   #/agents               Agent list
 *   #/agents/:name         Agent detail
 *   #/cost                 Cost center
 *   #/settings             Settings
 *
 * Each page registers itself via Router.register(name, { mount, unmount }).
 * The router parses location.hash, unmounts the current page, and mounts the
 * target page into #page-container.
 */
(function () {
  'use strict';

  const pages = {};
  let currentPage = null;   // { name, param }
  let container = null;

  function init(el) {
    container = el;
    window.addEventListener('hashchange', handleRoute);
    // Fire once for the initial load.
    handleRoute();
  }

  function register(name, handlers) {
    pages[name] = handlers;
  }

  function parseHash() {
    const hash = location.hash.replace(/^#\/?/, ''); // strip '#/' or '#'
    const parts = hash.split('/').filter(Boolean);   // e.g. ['agents', 'codex']
    if (parts.length === 0) return { name: 'overview', param: null };
    return { name: parts[0], param: parts[1] || null };
  }

  async function handleRoute() {
    const route = parseHash();

    // Fallback to overview for unknown routes.
    if (!pages[route.name]) {
      route.name = 'overview';
      route.param = null;
    }

    // Unmount previous page.
    if (currentPage && pages[currentPage.name] && pages[currentPage.name].unmount) {
      try { pages[currentPage.name].unmount(); } catch (e) { /* best-effort */ }
    }

    // Update nav highlight.
    document.querySelectorAll('.nav-item').forEach(el => {
      const target = el.dataset.page;
      el.classList.toggle('active',
        target === route.name ||
        (route.name === 'agents' && target === 'agents')
      );
    });

    // Clear container + mount new page with a fresh enter animation.
    container.innerHTML = '';
    container.classList.remove('page-enter');
    void container.offsetWidth; // force reflow to restart animation
    container.classList.add('page-enter');

    currentPage = route;
    if (pages[route.name] && pages[route.name].mount) {
      await pages[route.name].mount(container, route.param);
    }
  }

  function go(path) {
    location.hash = path;
  }

  window.Router = { init, register, go, get current() { return currentPage; } };
})();
