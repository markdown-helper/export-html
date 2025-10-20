/**
 * Minimal HTML bootstrap for export-html.
 *
 * Usage (single tag):
 *   <script type="module" src="boot.min.js"
 *           data-md-url="./example.md"
 *           data-output-id="content"
 *           data-force-light="true"></script>
 *
 * Attributes:
 * - data-md-url    : URL to the markdown file (optional). If omitted, boot derives it from the current page URL:
 *                    - index.html/.htm -> index.md
 *                    - /path/ -> /path/index.md
 *                    - otherwise -> append ".md"
 *                    Alternatively set window.MHE_MD_URL.
 * - data-output-id : ID of the container element to render into (required). Alternatively set window.MHE_OUTPUT_ID.
 * - data-base      : Base URL for local modules (optional; defaults to directory of boot.js). Typically omit when boot.js and modules share the same base.
 * - data-use-min   : Prefer minified local modules (1|true|yes|on). Optional; defaults to window.MHE_MODULE_USE_MINIFIED or inferred from this script filename (boot.min.js => true; boot.js => false).
 * - data-force-light : Force light theme (1|true|yes|on). Optional; defaults to window.MHE_FORCE_LIGHT_THEME or false.
 * - data-two-col-min-width : Minimum viewport width in px to enable auto two-column slides (optional; defaults to 1000 unless overridden by window.MHE_TWO_COL_MIN_WIDTH or this attribute).
 *
 * Global configuration (optional):
 * - window.MHE_MD_URL, window.MHE_OUTPUT_ID, window.MHE_MODULE_BASE, window.MHE_MODULE_USE_MINIFIED,
 *   window.MHE_FORCE_LIGHT_THEME, window.MHE_TWO_COL_MIN_WIDTH can be used instead of data-*.
 *
 * Notes:
 * - Derives module base from import.meta.url directory when data-base is omitted, and assigns window.MHE_MODULE_BASE.
 * - Sets window.MHE_MODULE_USE_MINIFIED from data-use-min if provided, otherwise infers from this script filename (boot.min.js => true; boot.js => false).
 * - Sets window.MHE_FORCE_LIGHT_THEME from data-force-light if provided; renderer checks it to enforce light styles and tables.
 * - Sets window.MHE_TWO_COL_MIN_WIDTH from data-two-col-min-width when provided (or uses the global if already set). The deck reads this to gate auto two-column layout.
 * - Sets window.MHE_CONFIG_URL to config.js or config.min.js based on the minified toggle.
 * - Imports icon.js and markdown.js via config.moduleUrl(), then calls renderMarkdown().
 */

(function () {
  const parseTruthy = (v) => {
    if (v === undefined || v === null) return false;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  };

  // Find the script element corresponding to this module (import.meta.url).
  let thisUrl = '';
  try { thisUrl = import.meta.url; } catch (_) {}
  const scriptEl = Array.from(document.querySelectorAll('script[type="module"]'))
    .find((s) => {
      try {
        return new URL(s.src, document.baseURI).href === thisUrl;
      } catch (_) {
        return false;
      }
    }) || null;

  const ds = (scriptEl && scriptEl.dataset) || {};

  let mdUrl = ds.mdUrl || (typeof window !== 'undefined' ? window.MHE_MD_URL : '');
  const outputId = ds.outputId || (typeof window !== 'undefined' ? window.MHE_OUTPUT_ID : '');
  const base =
    ds.base ||
    (typeof window !== 'undefined' && window.MHE_MODULE_BASE) ||
    (function () {
      try { return new URL('.', thisUrl).href; } catch (_) { return document.baseURI; }
    })();

  // Infer min preference from script filename when not provided
  const inferredMin = /\.min\.js(\?|#|$)/i.test(thisUrl);
  const useMin = (ds.useMin !== undefined)
    ? parseTruthy(ds.useMin)
    : (typeof window !== 'undefined' && 'MHE_MODULE_USE_MINIFIED' in window)
      ? parseTruthy(window.MHE_MODULE_USE_MINIFIED)
      : inferredMin;
  const forceLight = (ds.forceLight !== undefined)
    ? parseTruthy(ds.forceLight)
    : (typeof window !== 'undefined' ? parseTruthy(window.MHE_FORCE_LIGHT_THEME) : false);
  // Optional: two-column width threshold (in px) via data-two-col-min-width or global MHE_TWO_COL_MIN_WIDTH
  const twoColMinWidth = (() => {
    const v = ds.twoColMinWidth;
    if (v !== undefined && v !== null) {
      const n = parseInt(String(v), 10);
      return isFinite(n) && n > 0 ? n : undefined;
    }
    if (typeof window !== 'undefined' && 'MHE_TWO_COL_MIN_WIDTH' in window) {
      const n = parseInt(String(window.MHE_TWO_COL_MIN_WIDTH), 10);
      return isFinite(n) && n > 0 ? n : undefined;
    }
    return undefined;
  })();

  // Derive mdUrl from the current page when not provided
  if (!mdUrl) {
    try {
      const pageUrl = new URL(document.location.href);
      pageUrl.search = '';
      pageUrl.hash = '';
      const path = pageUrl.pathname || '';
      let mdPath = '';
      if (/\.(html?|HTML?)$/.test(path)) {
        mdPath = path.replace(/\.(html?|HTML?)$/, '.md');
      } else if (path.endsWith('/')) {
        mdPath = path + 'index.md';
      } else {
        mdPath = path + '.md';
      }
      mdUrl = new URL(mdPath, pageUrl).href;
    } catch (_) {}
  }

  if (!outputId) {
    console.error('boot.js: data-output-id is required.');
    return;
  }
  if (!mdUrl) {
    console.error('boot.js: Unable to determine markdown URL. Provide data-md-url or ensure the page URL ends with .html/.htm or a directory.');
    return;
  }

  // Expose globals for downstream modules
  try { window.MHE_MODULE_BASE = base; } catch (_) {}
  try { window.MHE_MODULE_USE_MINIFIED = useMin; } catch (_) {}
  try { window.MHE_FORCE_LIGHT_THEME = forceLight; } catch (_) {}
  try { if (twoColMinWidth !== undefined) window.MHE_TWO_COL_MIN_WIDTH = twoColMinWidth; } catch (_) {}

  // Resolve config URL based on base + min toggle and expose it for markdown.js
  let configUrl = '';
  try {
    configUrl = new URL(useMin ? 'config.min.js' : 'config.js', base).href;
    window.MHE_CONFIG_URL = configUrl;
  } catch (e) {
    console.error('boot.js: Failed to resolve config URL', e);
    return;
  }

  // Async boot
  (async () => {
    try {
      // If the HTML has no <title>, derive it from the first Markdown heading (ignoring YAML front matter)
      const hasTitleEl = !!document.querySelector('head > title');
      if (!hasTitleEl) {
        try {
          const resp = await fetch(mdUrl);
          if (resp.ok) {
            const mdText = await resp.text();

            const extractFirstHeading = (text) => {
              // Strip leading YAML front matter delimited by --- ... ---
              let body = text;
              const lines = body.split(/\r?\n/);
              if (lines.length > 0 && /^\s*---\s*$/.test(lines[0])) {
                let end = -1;
                for (let i = 1; i < lines.length; i++) {
                  if (/^\s*---\s*$/.test(lines[i])) { end = i; break; }
                }
                if (end !== -1) {
                  body = lines.slice(end + 1).join('\n');
                }
              }

              // ATX heading: #, ##, ..., ######
              const atx = body.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
              if (atx && atx[1]) return atx[1].trim();

              // Setext heading: text followed by === or ---
              const setext = body.match(/^\s*([^\n]+?)\s*\r?\n\s*(?:=+|-+)\s*$/m);
              if (setext && setext[1]) return setext[1].trim();

              return null;
            };

            const titleText = extractFirstHeading(mdText);
            if (titleText) {
              document.title = titleText;
            }
          }
        } catch (_) {}
      }

      const { moduleUrl } = await import(configUrl);
      // Load icon runtime first (provides Mermaid global and Font Awesome CSS)
      await import(moduleUrl('icon.js'));
      const { renderMarkdown } = await import(moduleUrl('markdown.js'));
      await renderMarkdown({ mdUrl, outputId });
    } catch (err) {
      console.error('boot.js: Activation failed', err);
      try {
        const out = document.getElementById(outputId);
        if (out) out.textContent = 'Error initializing markdown renderer.';
      } catch (_) {}
    }
  })();
})();