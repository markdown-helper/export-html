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
      /* Two-column auto layout when enabled (grid-based, left-first fill) */
      /* Active slides use grid; non-active slides remain hidden via display:none */
      .mhe-slides .mhe-slide.is-active.two-col {
        display: grid;
      }
      .mhe-slides .mhe-slide.two-col {
        grid-template-columns: 1fr 1fr;
        grid-column-gap: 24px;
        column-gap: 24px; /* alias for older engines */
        direction: ltr; /* ensure left-to-right column order even if page uses rtl */
        /* Constrain height when enabled to viewport-derived max; allow vertical scroll if overflow */
        max-height: var(--mhe-slide-max-h, auto);
        overflow-y: auto;
        overflow-x: visible;
      }
      .mhe-slides .mhe-slide.two-col .mhe-col {
        display: block;
      }
      /* Avoid splitting truly large, block-level elements that render poorly when broken */
      .mhe-slides .mhe-slide.two-col .mhe-col pre,
      .mhe-slides .mhe-slide.two-col .mhe-col table,
      .mhe-slides .mhe-slide.two-col .mhe-col .mermaid,
      .mhe-slides .mhe-slide.two-col .mhe-col figure,
      .mhe-slides .mhe-slide.two-col .mhe-col img {
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
    // Request active-slide Mermaid render (handled by markdown.js)
    try { window.dispatchEvent(new CustomEvent('mhe:render-active-mermaid')); } catch (_) {}
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
  // Flatten current slide children into a single list (preserving rendered Mermaid/SVG content)
  const flattenSlideChildren = (s) => {
    try {
      const left = s.querySelector('.mhe-col-left');
      const right = s.querySelector('.mhe-col-right');
      if (left || right) {
        const a = left ? Array.from(left.childNodes) : [];
        const b = right ? Array.from(right.childNodes) : [];
        return a.concat(b);
      }
    } catch (_) {}
    return Array.from(s.childNodes);
  };
  // Ensure Mermaid diagrams inside a slide are rendered or re-rendered
  const renderMermaidInSlide = (s) => {
    try {
      if (!s || !window.mermaid) return;
      const nodes = Array.from(s.querySelectorAll('.mermaid'));
      if (!nodes.length) return;

      // Reset nodes to their raw source if previously rendered or error state
      nodes.forEach((node) => {
        try {
          const hasSVG = !!node.querySelector('svg');
          const hasError =
            !!node.querySelector('.error') ||
            /Syntax error/i.test(node.textContent || '');
          if (!hasError) return; // keep already-rendered SVGs intact
          const raw =
            (node.dataset && node.dataset.raw)
              ? node.dataset.raw
              : (node.textContent || '');
          if (raw && raw.trim()) {
            node.innerHTML = '';
            node.textContent = raw;
          }
        } catch (_) {}
      });

      // Determine which nodes still need rendering (no SVG yet)
      const freshNodes = nodes.filter((n) => {
        try { return !n.querySelector('svg'); } catch (_) { return true; }
      });
      if (!freshNodes.length) return;

      // Schedule render after layout settles (double RAF) to avoid transient parsing issues
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            // Initialize Mermaid with current theme; safe to call multiple times
            const forceLight = (typeof window !== 'undefined') && !!window.MHE_FORCE_LIGHT_THEME;
            const isDark = !forceLight && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
            try { mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose' }); } catch (_) {}

            let p = null;
            if (typeof mermaid.run === 'function') {
              p = mermaid.run({ nodes: freshNodes });
            } else if (typeof mermaid.init === 'function') {
              mermaid.init(undefined, freshNodes);
            }
            const after = () => {
              try { window.dispatchEvent(new CustomEvent('mhe:diagrams-rendered')); } catch (_) {}
            };
            if (p && typeof p.then === 'function') {
              p.then(after).catch(after);
            } else {
              setTimeout(after, 0);
            }
          } catch (_) {}
        });
      });
    } catch (_) {}
  };
  const evaluateActiveTwoCol = () => {
    const s = slides[idx];
    if (!s) return;

    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const wideEnough = vw >= TWO_COL_MIN_WIDTH;

    // Helpers for layout and restoration
    const restoreSingle = () => {
      try {
        // If we have an original snapshot, restore from it
        if (s.__origChildren) {
          s.innerHTML = '';
          s.__origChildren.forEach((n) => s.appendChild(n));
        } else {
          // Fallback: unwrap columns if present
          const left = s.querySelector('.mhe-col-left');
          const right = s.querySelector('.mhe-col-right');
          if (left || right) {
            const fr = document.createDocumentFragment();
            [left, right].forEach((col) => {
              if (col) Array.from(col.childNodes).forEach((n) => fr.appendChild(n));
            });
            s.innerHTML = '';
            s.appendChild(fr);
          }
        }
      } catch (_) {}
      s.classList.remove('two-col');
      try { s.style.removeProperty('--mhe-slide-max-h'); } catch (_) {}
      s.__twoColApplied = false;
    };

    const ensureOriginalSnapshot = () => {
      try {
        if (!s.__origChildren) {
          s.__origChildren = Array.from(s.childNodes);
        }
        if (s.__twoColApplied) {
          // Ensure measurements are done on original flow
          restoreSingle();
        }
      } catch (_) {}
    };

    const applyTwoCol = (available) => {
      try {
        const orig = s.__origChildren ? s.__origChildren.slice() : Array.from(s.childNodes);
        s.innerHTML = '';
        // Pre-apply two-col styles so measurements use correct column width
        try {
          s.classList.add('two-col');
          s.style.setProperty('--mhe-slide-max-h', `${available}px`);
        } catch (_) {}
        const left = document.createElement('div');
        left.className = 'mhe-col mhe-col-left';
        const right = document.createElement('div');
        right.className = 'mhe-col mhe-col-right';
        s.appendChild(left);
        s.appendChild(right);

        let leftH = 0;
        const maxH = Math.max(0, available - 8);

        // Prioritize filling the left column first by sequentially appending
        for (const node of orig) {
          left.appendChild(node);
          leftH = left.scrollHeight;
          if (leftH > maxH) {
            // Move the last node to the right column to prevent overflow
            right.appendChild(left.lastChild);
            leftH = left.scrollHeight;
          }
        }

        const lh = left.scrollHeight;
        const rh = right.scrollHeight;
        const ratio = Math.min(lh, rh) / Math.max(lh, rh || 1);
        const MIN_FILL_RATIO = 0.7; // if one column is <70% of the other, consider "almost empty"
        const MIN_LEFT_ABS = available * 0.55; // absolute minimum fill target for the left column

        const leftChildren = left.childElementCount;
        const rightChildren = right.childElementCount;

        const headerOnlyLeft = (() => {
          const first = left.firstElementChild;
          const isHeading = first && /H[1-6]/.test(first.tagName);
          const hasBodyContent = !!left.querySelector('p,ul,ol,blockquote,pre,table');
          return isHeading && !hasBodyContent;
        })();

        const largeVisualSel = '.mermaid, img, figure, pre, table, video, svg';
        const rightHasLargeVisual = !!right.querySelector(largeVisualSel);

        // If one column is almost empty, or left has only a heading while right holds a large visual,
        // revert to single column layout. Also revert when right has a large visual and left height is small.
        if (
          ratio < MIN_FILL_RATIO ||
          (headerOnlyLeft && rightHasLargeVisual) ||
          (leftChildren <= 1 && rightChildren >= 1) ||
          (lh < MIN_LEFT_ABS && rightChildren >= 1) ||
          (rightHasLargeVisual && lh < available * 0.6)
        ) {
          s.innerHTML = '';
          orig.forEach((n) => s.appendChild(n));
          s.classList.remove('two-col');
          try { s.style.removeProperty('--mhe-slide-max-h'); } catch (_) {}
          s.__twoColApplied = false;
          return false;
        }

        // Keep two-column (already applied above for correct measurements)
        s.classList.add('two-col');
        try { s.style.setProperty('--mhe-slide-max-h', `${available}px`); } catch (_) {}
        s.__twoColApplied = true;
        return true;
      } catch (_) {
        return false;
      }
    };

    if (!wideEnough) {
      restoreSingle();
      return;
    }

    // Measure on original flow to correctly detect non-text objects (mermaid/images)
    ensureOriginalSnapshot();

    // Compare content height against viewport to avoid page scrolling
    const paddingY = 48; // approximate vertical padding and nav-hint space
    const available = Math.max(0, vh - paddingY);
    const contentHeight = s.scrollHeight;

    // Avoid two-col when a large unbreakable block would dominate or clip
    const significantSel = 'pre, table, .mermaid, figure, img, video, svg';
    const blocks = Array.from(s.querySelectorAll(significantSel));
    const hasVeryLarge = blocks.some((el) => {
      try { return el.scrollHeight > available * 0.6; } catch (_) { return false; }
    });
    const firstSig = blocks.length ? blocks[0] : null;
    const firstIsVeryLarge = (() => {
      try { return firstSig && firstSig.scrollHeight > available * 0.5; } catch (_) { return false; }
    })();

    // Enable two-col only when total content can fit into two columns without clipping
    const enableTwo =
      (contentHeight > available + 8) &&
      (contentHeight <= (available * 2 - 16)) &&
      !hasVeryLarge &&
      !firstIsVeryLarge;

    if (enableTwo) {
      applyTwoCol(available);
    } else {
      restoreSingle();
    }
    // Ensure Mermaid diagrams render after layout changes
    try { renderMermaidInSlide(s); } catch (_) {}
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
  // After Mermaid finishes rendering, refresh the original snapshots to preserve rendered diagrams
  window.addEventListener('mhe:diagrams-rendered', () => {
    try {
      slides.forEach((s) => {
        // Rebuild snapshot from the current DOM (flatten columns if present)
        s.__origChildren = flattenSlideChildren(s);
      });
    } catch (_) {}
    evaluateActiveTwoCol();
  });
  // (duplicate listener removed; snapshots and evaluation handled above)

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