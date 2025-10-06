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

  const onKey = (e) => {
    if (e.defaultPrevented) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
      setActive(idx + 1, true);
      e.preventDefault();
    } else if (k === 'ArrowLeft' || k === 'PageUp' || (k === 'Backspace' && !/input|textarea/i.test(e.target.tagName))) {
      setActive(idx - 1, true);
      e.preventDefault();
    } else if (k === 'Home') {
      setActive(0, true);
      e.preventDefault();
    } else if (k === 'End') {
      setActive(slides.length - 1, true);
      e.preventDefault();
    }
  };

  const onClick = (e) => {
    // Advance on click if the click target isn't an interactive element
    const t = e.target;
    if (t && (t.closest('a,button,input,textarea,select,details,summary'))) return;
    setActive(idx + 1, true);
  };

  const onHashChange = () => {
    setActive(getIndexFromHash(), false);
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