/**
 * Sidebar Collapsible Table of Contents (ToC) helpers.
 *
 * Responsibilities:
 * - ensureTocStyles({ moduleUrl, loadCSS }): load local ToC CSS (lib/toc.css) once.
 * - initSidebarToc(container): build a collapsible sidebar ToC from headings within a given container,
 *   ensure stable ids, and highlight the current section based on scroll position.
 *
 * Notes:
 * - This module replaces the legacy IIFE; it is renderer-agnostic and expects the caller
 *   to provide the root markdown container element where headings are located.
 * - The sidebar is appended to document.body (outside the markdown container).
 * - ToC visibility is toggled via a body attribute (html-show-sidebar-toc) persisted in localStorage.
 */

const LEVELS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const BODY_ATTR = 'html-show-sidebar-toc';
const TOC_NAV_ID = 'generated-toc';
const TOC_BTN_ID = 'sidebar-toc-btn';
const STORAGE_KEY = 'html-show-sidebar-toc';

/**
 * Load sidebar ToC CSS from local file using provided resolver/loader.
 * @param {{ moduleUrl: (p:string)=>string, loadCSS: (href:string)=>void }} deps
 * @returns {void}
 */
export function ensureTocStyles({ moduleUrl, loadCSS }) {
  try {
    const href = moduleUrl('lib/toc.css');
    loadCSS(href);
  } catch (_) {
    // ignore failures; ToC will still function without styles
  }
}

/**
 * Ensure every heading has a stable id (slug from text or a random fallback).
 * @param {HTMLElement[]} headings
 * @returns {HTMLElement[]}
 */
function ensureIds(headings) {
  headings.forEach((h) => {
    const text = (h.textContent || '').trim();
    if (!h.id) {
      const id = text.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '');
      h.id = id || `section-${Math.random().toString(36).slice(2)}`;
    }
  });
  return headings;
}

/**
 * Build a nested tree from headings based on their level.
 * @param {HTMLElement[]} headings
 * @returns {Array}
 */
function buildTree(headings) {
  const root = { children: [], level: 0 };
  const stack = [root];
  headings.forEach((h) => {
    const level = LEVELS[h.tagName] || 6;
    const node = { level, text: (h.textContent || '').trim(), id: h.id, children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root.children;
}

/**
 * Render nested nodes as a list of links with collapsible groups.
 * @param {Array} nodes
 * @returns {HTMLElement} ul element
 */
function renderNodes(nodes) {
  const ul = document.createElement('ul');
  nodes.forEach((n) => {
    const li = document.createElement('li');
    if (n.children.length > 0) {
      const details = document.createElement('details');
      details.open = n.level <= 2; // open top levels by default
      const summary = document.createElement('summary');
      const a = document.createElement('a');
      a.href = '#' + n.id;
      a.textContent = n.text;
      summary.appendChild(a);
      details.appendChild(summary);
      details.appendChild(renderNodes(n.children));
      li.appendChild(details);
    } else {
      const a = document.createElement('a');
      a.href = '#' + n.id;
      a.textContent = n.text;
      li.appendChild(a);
    }
    ul.appendChild(li);
  });
  return ul;
}

/**
 * Create or reuse the sidebar toggle button.
 * @returns {HTMLElement} button-like div
 */
function createToggleButton() {
  let btn = document.getElementById(TOC_BTN_ID);
  if (!btn) {
    btn = document.createElement('div');
    btn.id = TOC_BTN_ID;
    btn.setAttribute('aria-label', 'Toggle Table of Contents');
    btn.setAttribute('title', 'Tampilkan/Sembunyikan Daftar Isi');
    btn.textContent = '☰';
    document.body.appendChild(btn);
  }
  return btn;
}

/**
 * Create or reuse the sidebar container and nav element.
 * @returns {HTMLElement} nav element
 */
function createSidebar() {
  let aside = document.querySelector('aside.md-sidebar-toc');
  let nav = document.getElementById(TOC_NAV_ID);

  if (!aside) {
    aside = document.createElement('aside');
    aside.className = 'md-sidebar-toc';
    document.body.appendChild(aside);
  }
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'md-toc';
    nav.id = TOC_NAV_ID;
    aside.appendChild(nav);
  }
  return nav;
}

/**
 * Restore persisted visibility state for the sidebar ToC.
 * @returns {void}
 */
function restoreState() {
  try {
    const show = localStorage.getItem(STORAGE_KEY) === 'true';
    if (show) document.body.setAttribute(BODY_ATTR, '');
  } catch (_) {
    // localStorage might be unavailable; ignore
  }
}

/**
 * Wire toggle button to body attribute and persistence.
 * @param {HTMLElement} btn
 * @returns {void}
 */
function setupToggle(btn) {
  btn.addEventListener('click', () => {
    const isShown = document.body.hasAttribute(BODY_ATTR);
    try {
      if (isShown) {
        document.body.removeAttribute(BODY_ATTR);
        localStorage.setItem(STORAGE_KEY, 'false');
      } else {
        document.body.setAttribute(BODY_ATTR, '');
        localStorage.setItem(STORAGE_KEY, 'true');
      }
    } catch (_) {
      // ignore storage errors
      if (isShown) document.body.removeAttribute(BODY_ATTR);
      else document.body.setAttribute(BODY_ATTR, '');
    }
  });
}

/**
 * Setup live highlight of current section in the ToC.
 * @param {HTMLElement[]} headings
 * @param {HTMLElement} tocEl
 */
function setupHighlight(headings, tocEl) {
  let lastActiveId = null;

  function setActive(id) {
    if (lastActiveId === id) return;
    // Clear previous actives
    tocEl.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
    // Set new active
    if (id) {
      tocEl.querySelectorAll('a[href="#' + id + '"]').forEach((a) => a.classList.add('active'));
    }
    lastActiveId = id;
  }

  // Visibility check to avoid selecting headings from hidden slides or containers
  const isVisible = (el) => {
    try {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rects = el.getClientRects && el.getClientRects();
      return !!(rects && rects.length > 0);
    } catch (_) {
      // Fallback: assume visible
      return true;
    }
  };

  function computeActive() {
    const scrollPos = window.scrollY || document.documentElement.scrollTop || 0;
    // Consider only visible headings (important for slides mode)
    const visibleHeads = headings.filter(isVisible);

    // Pick the last visible heading whose top is above the current scroll position (+ small offset)
    let active = null;
    for (let i = 0; i < visibleHeads.length; i++) {
      const h = visibleHeads[i];
      if (h.offsetTop <= scrollPos + 10) {
        active = h.id;
      } else {
        break;
      }
    }
    // Fallback to the first visible heading
    if (!active && visibleHeads.length) active = visibleHeads[0].id;
    setActive(active);
  }

  // Initialize and bind listeners (throttled via rAF)
  computeActive();
  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          computeActive();
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true }
  );

  window.addEventListener('resize', computeActive);

  // Update active link on hash changes (e.g., deep-linking or navigation)
  window.addEventListener('hashchange', () => {
    const id = String(location.hash || '').replace(/^#/, '');
    setActive(id);
  });
}

/**
 * Initialize the sidebar ToC for headings inside the given container.
 * Excludes any heading with id "daftar-isi" or text "Daftar Isi".
 * Safe to call multiple times; it will re-render the ToC content.
 *
 * @param {HTMLElement} container Root element containing the rendered markdown (e.g., #outputId with 'markdown-body' class)
 * @returns {void}
 */
export function initSidebarToc(container) {
  if (!container || !(container instanceof HTMLElement)) return;

  restoreState();

  const btn = createToggleButton();
  setupToggle(btn);

  const tocNav = createSidebar();

  // Collect and ensure IDs from headings inside the provided container
  const allHeadings = ensureIds(
    Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  );

  // Exclude the inline "Daftar Isi" section from the sidebar ToC
  const headings = allHeadings.filter(
    (h) =>
      h.id !== 'daftar-isi' &&
      (h.textContent || '').trim().toLowerCase() !== 'daftar isi'
  );

  const tree = buildTree(headings);

  // Render ToC
  tocNav.innerHTML = '';
  tocNav.appendChild(renderNodes(tree));

  // Live highlight
  setupHighlight(headings, tocNav);

  // Slides-aware ToC navigation: if a slide deck exists, activate the slide containing target heading
  try {
    const deck = document.querySelector('.mhe-slides');
    if (deck) {
      const slides = Array.from(deck.querySelectorAll('.mhe-slide'));
      tocNav.addEventListener('click', (e) => {
        const a = e.target && e.target.closest('a[href^="#"]');
        if (!a) return;
        const hash = a.getAttribute('href') || '';
        const id = hash.replace(/^#/, '');
        const target = document.getElementById(id);
        if (!target) return;
        const slideEl = target.closest('.mhe-slide');
        if (!slideEl) return;
        const idx = slides.indexOf(slideEl);
        if (idx < 0) return;

        // Intercept to switch slides and then scroll to the heading
        e.preventDefault();
        try { location.hash = `#slide-${idx + 1}`; } catch (_) {}
        // After initSlideDeck's hashchange handler activates the slide, scroll to the heading
        setTimeout(() => {
          try { target.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
        }, 60);
      });
    }
  } catch (_) {}

}