/**
 * Slide deck helpers (Marp-like).
 *
 * Features:
 * - detectSlidesEnabled(mdText): Enable slides only when front matter contains marp/slides/mheSlides set true.
 * - splitMarkdownSlides(mdText): Split markdown into slides on '---' separators outside code fences.
 *   Front matter is returned separately and not rendered within slides.
 * - ensureSlideStyles(addStyle): Inject minimal CSS for slide deck rendering.
 * - initSlideDeck(root): Initialize navigation (keyboard arrows, click to advance) and hash deep-linking.
 *
 * Notes:
 * - This helper is renderer-agnostic: it does not depend on Marked directly. The caller should render
 *   each slide's markdown to HTML and wrap in <section class="mhe-slide">.
 */

/**
 * Parse YAML front matter block if present, return { frontMatter, content, flags }
 * flags: { marp?: boolean, slides?: boolean, mheSlides?: boolean }
 * This is a tolerant extractor, not a full YAML parser.
 * @param {string} md
 */
function extractFrontMatter(md) {
  const fmMatch = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!fmMatch) return { frontMatter: '', content: md, flags: {} };
  const fm = fmMatch[1];
  const content = md.slice(fmMatch[0].length);
  const flags = {};
  try {
    const lines = fm.split('\n');
    for (const l of lines) {
      const m = l.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+)\s*$/);
      if (!m) continue;
      const k = m[1].toLowerCase();
      let v = m[2].trim();
      v = v.replace(/^['"]|['"]$/g, '');
      const truthy = /^(1|true|yes|on)$/i.test(v);
      if (k === 'marp' || k === 'slides' || k === 'mheslides') {
        flags[k === 'mheslides' ? 'mheSlides' : k] = truthy;
      }
    }
  } catch (_) {}
  return { frontMatter: fmMatch[0], content, flags };
}

/**
 * Determine whether slides should be enabled for a given markdown text.
 * - Enabled ONLY when front matter flags marp/slides/mheSlides are true.
 *   This avoids accidental activation when a document contains a horizontal rule ('---')
 *   that is not intended as a slide boundary, preventing cross-slide separation of
 *   footnote definitions and other content.
 * @param {string} md
 * @returns {boolean}
 */
export function detectSlidesEnabled(md) {
  try {
    const { flags } = extractFrontMatter(md);
    return !!(flags.marp || flags.slides || flags.mheSlides);
  } catch (_) {
    return false;
  }
}

/**
 * Split markdown into slides on lines that are exactly '---' (outside code fences),
 * preserving YAML front matter by keeping it attached to the first slide.
 * @param {string} md
 * @returns {{ slides: string[], frontMatter: string }}
 */
export function splitMarkdownSlides(md) {
  const { frontMatter, content } = extractFrontMatter(md);

  // Shield code fences
  const blocks = [];
  let tmp = content.replace(/```[\s\S]*?```/g, (m) => {
    const idx = blocks.push(m) - 1;
    return `%%SL_BLOCK_${idx}%%`;
  });

  // Split on lines containing only '---'
  const rawParts = tmp.split(/\r?\n(?:(?:\s*)---(?:\s*))\r?\n/g);

  // Restore code blocks in each part and trim leading/trailing blank lines
  const restore = (s) =>
    s
      .replace(/%%SL_BLOCK_(\d+)%%/g, (_, i) => blocks[Number(i)] || '')
      .replace(/^\s+|\s+$/g, '');

  const slides = rawParts.map(restore);

  // Do not attach front matter to slides; frontMatter is returned separately to avoid rendering metadata.

  return { slides, frontMatter };
}

/**
 * Inject minimal slide styles for basic deck layout.
 * @param {(id:string, css:string)=>void} addStyle
 */
export function ensureSlideStyles(addStyle) {
  try {
    addStyle(
      'mhe-slide-styles',
      `
      .mhe-slides { position: relative; width: 100%; height: 100%; }
      .mhe-slides .mhe-slide {
        display: none;
        box-sizing: border-box;
        padding: 24px;
        min-height: 60vh;
      }
      .mhe-slides .mhe-slide.is-active { display: block; }
      /* Simple deck framing (opt-in feel) */
      .mhe-slides .mhe-slide {
        background: var(--mhe-slide-bg, transparent);
      }
      /* Two-column auto layout when enabled */
      .mhe-slides .mhe-slide.two-col {
        /* Cross-browser multi-column with balanced fill to avoid content dropping */
        -webkit-column-count: 2;
        -moz-column-count: 2;
        column-count: 2;
        -webkit-column-gap: 24px;
        -moz-column-gap: 24px;
        column-gap: 24px;
        /* Use 'balance' for consistent distribution; many browsers ignore 'auto' */
        column-fill: balance;
        direction: ltr; /* ensure left-to-right column order even if page uses rtl */
        /* Constrain height when enabled to viewport-derived max; allow vertical scroll if overflow */
        max-height: var(--mhe-slide-max-h, auto);
        overflow-y: auto;
        overflow-x: visible;
      }
      /* Avoid splitting only truly large, block-level elements that render poorly when broken */
      .mhe-slides .mhe-slide.two-col pre,
      .mhe-slides .mhe-slide.two-col table,
      .mhe-slides .mhe-slide.two-col .mermaid,
      .mhe-slides .mhe-slide.two-col figure,
      .mhe-slides .mhe-slide.two-col img {
        break-inside: avoid;
        -webkit-column-break-inside: avoid;
        -moz-column-break-inside: avoid;
        page-break-inside: avoid;
      }
      /* Navigation hint */
      .mhe-slide-nav-hint {
        position: absolute;
        right: 12px;
        bottom: 8px;
        font-size: 12px;
        opacity: 0.6;
        user-select: none;
        pointer-events: none;
      }
    `
    );
  } catch (_) {}
}

/**
 * Initialize slide deck interactions: keyboard and click navigation, hash deep-linking.
 * @param {HTMLElement} root Element with class 'mhe-slides' containing section.mhe-slide*
 */
export function initSlideDeck(root) {
  if (!root) return;

  const slides = Array.from(root.querySelectorAll('.mhe-slide'));

  if (!slides.length) return;

  const getIndexFromHash = () => {
    const m = String(location.hash || '').match(/slide-(\d+)/i);
    const n = m ? parseInt(m[1], 10) : 1;
    return isFinite(n) && n >= 1 && n <= slides.length ? n - 1 : 0;
  };

  let idx = getIndexFromHash();

  const setActive = (i, pushState = false) => {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, j) => {
      if (j === idx) s.classList.add('is-active');
      else s.classList.remove('is-active');
    });
    const newHash = `#slide-${idx + 1}`;
    try {
      if (pushState) {
        history.replaceState(null, '', newHash);
      } else {
        // For initial set, avoid adding history entry
        if (location.hash !== newHash) history.replaceState(null, '', newHash);
      }
    } catch (_) {}
  };

  setActive(idx, false);

  // Auto two-column evaluation utilities
  // Width threshold for enabling two-column layout (px).
  // Can be overridden via window.MHE_TWO_COL_MIN_WIDTH, which boot.js sets from
  // the <script data-two-col-min-width="..."> attribute when provided.
  const TWO_COL_MIN_WIDTH = (() => {
    try {
      if (typeof window !== 'undefined' && 'MHE_TWO_COL_MIN_WIDTH' in window) {
        const n = parseInt(String(window.MHE_TWO_COL_MIN_WIDTH), 10);
        if (isFinite(n) && n > 0) return n;
      }
    } catch (_) {}
    return 1000;
  })();
  let twoColObserver = null;
  const evaluateActiveTwoCol = () => {
    const s = slides[idx];
    if (!s) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const wideEnough = vw >= TWO_COL_MIN_WIDTH;
    if (!wideEnough) {
      s.classList.remove('two-col');
      try { s.style.removeProperty('--mhe-slide-max-h'); } catch (_) {}
      return;
    }
    // Temporarily remove two-col to measure true content height
    const hadTwo = s.classList.contains('two-col');
    try {
      if (hadTwo) s.classList.remove('two-col');
      void s.offsetHeight; // force reflow before measuring
    } catch (_) {}
    // Compare content height against viewport to avoid page scrolling
    const paddingY = 48; // approximate vertical padding and nav-hint space
    const available = Math.max(0, vh - paddingY);
    const contentHeight = s.scrollHeight;

    // Avoid two-col when an unbreakable block exceeds available height (would clip in multicol)
    const oversized = Array.from(s.querySelectorAll('pre, table, .mermaid, figure, img'))
      .some((el) => {
        try { return el.scrollHeight > available - 16; } catch (_) { return false; }
      });

    // Enable two-col only when total content can fit into two columns without clipping
    const enableTwo = (contentHeight > available + 8) && (contentHeight <= (available * 2 - 16)) && !oversized;

    if (enableTwo) {
      s.classList.add('two-col');
      try { s.style.setProperty('--mhe-slide-max-h', `${available}px`); } catch (_) {}
    } else {
      s.classList.remove('two-col');
      try { s.style.removeProperty('--mhe-slide-max-h'); } catch (_) {}
    }
  };
  const observeActiveSlide = () => {
    try {
      if (twoColObserver && typeof twoColObserver.disconnect === 'function') twoColObserver.disconnect();
      const s = slides[idx];
      if (!s) return;
      if (typeof ResizeObserver !== 'undefined') {
        twoColObserver = new ResizeObserver(() => {
          try { evaluateActiveTwoCol(); } catch (_) {}
        });
        twoColObserver.observe(s);
        // Observe nested content to react to async rendering (images, mermaid SVGs)
        s.querySelectorAll('*').forEach((el) => {
          try { twoColObserver.observe(el); } catch (_) {}
        });
      }
      s.querySelectorAll('img').forEach((img) => {
        img.addEventListener('load', () => evaluateActiveTwoCol());
      });
    } catch (_) {}
  };
  observeActiveSlide();
  evaluateActiveTwoCol();

  const onKey = (e) => {
    if (e.defaultPrevented) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
      setActive(idx + 1, true);
      observeActiveSlide();
      evaluateActiveTwoCol();
      e.preventDefault();
    } else if (k === 'ArrowLeft' || k === 'PageUp' || (k === 'Backspace' && !/input|textarea/i.test(e.target.tagName))) {
      setActive(idx - 1, true);
      observeActiveSlide();
      evaluateActiveTwoCol();
      e.preventDefault();
    } else if (k === 'Home') {
      setActive(0, true);
      observeActiveSlide();
      evaluateActiveTwoCol();
      e.preventDefault();
    } else if (k === 'End') {
      setActive(slides.length - 1, true);
      observeActiveSlide();
      evaluateActiveTwoCol();
      e.preventDefault();
    }
  };

  const onClick = (e) => {
    // Advance on click if the click target isn't an interactive element
    const t = e.target;
    if (t && (t.closest('a,button,input,textarea,select,details,summary'))) return;
    setActive(idx + 1, true);
    observeActiveSlide();
    evaluateActiveTwoCol();
  };

  const onHashChange = () => {
    setActive(getIndexFromHash(), false);
    observeActiveSlide();
    evaluateActiveTwoCol();
  };

  // Add a subtle nav hint
  try {
    const hint = document.createElement('div');
    hint.className = 'mhe-slide-nav-hint';
    hint.textContent = '← → to navigate';
    root.appendChild(hint);
  } catch (_) {}

  document.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('resize', () => { evaluateActiveTwoCol(); });

  // Cleanup if the deck is removed from DOM
  const obs = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHashChange);
      try { obs.disconnect(); } catch (_) {}
    }
  });
  try { obs.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
}