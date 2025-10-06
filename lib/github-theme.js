/**
 * GitHub-like Markdown theme and table compatibility helpers.
 *
 * Exports:
 * - ensureGithubMarkdownStyles({ CDN_NPM_BASE, FORCE_LIGHT, loadCSS, addStyle })
 *   Loads GitHub Markdown CSS (theme-aware) and injects minimal overrides.
 *   When FORCE_LIGHT is true, ensures light theme styles win and adds explicit palette.
 *
 * - enforceLightTables(out)
 *   Applies inline styles to tables inside the provided container to hard-enforce
 *   light appearance even under dark host themes. Highest priority via inline styles.
 */

/**
 * Load GitHub Markdown CSS with theme detection and inject minimal overrides.
 * @param {{ CDN_NPM_BASE: string, FORCE_LIGHT: boolean, loadCSS: (href: string) => void, addStyle: (id: string, css: string) => void }} deps
 * @returns {void}
 */
export function ensureGithubMarkdownStyles({ CDN_NPM_BASE, FORCE_LIGHT, loadCSS, addStyle }) {
  const GITHUB_MD_CSS_LIGHT = `${CDN_NPM_BASE}/github-markdown-css@5/github-markdown.min.css`;
  const GITHUB_MD_CSS_DARK = `${CDN_NPM_BASE}/github-markdown-css@5/github-markdown-dark.min.css`;

  // Load theme-aware GitHub Markdown CSS
  try {
    const absLight = new URL(GITHUB_MD_CSS_LIGHT, document.baseURI).href;
    const absDark = new URL(GITHUB_MD_CSS_DARK, document.baseURI).href;
    const isDarkTheme =
      !FORCE_LIGHT &&
      (document.body.classList.contains('vscode-dark') ||
        document.body.classList.contains('vscode-high-contrast'));
    if (FORCE_LIGHT) {
      // Remove any dark GitHub Markdown CSS to ensure light styles win
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach((l) => {
        if (l.href === absDark || /github-markdown-dark/i.test(l.href)) {
          try {
            l.parentNode.removeChild(l);
          } catch (_) {}
        }
      });
    }
    loadCSS(isDarkTheme ? GITHUB_MD_CSS_DARK : GITHUB_MD_CSS_LIGHT);
  } catch (_) {}

  // Minimal overrides (no citation/footnote styling here; handled by citations module)
  try {
    addStyle(
      'mhe-markdown-overrides',
      `
      .markdown-body { box-sizing: border-box; max-width: 100%; margin: 0; padding: 16px; }
      .markdown-body table { display: block; width: max-content; max-width: 100%; overflow: auto; }
    `
    );
  } catch (_) {}

  // Optional: force light table palette and explicit light theme palette when requested
  try {
    if (FORCE_LIGHT) {
      addStyle(
        'mhe-force-light-tables',
        `
        /* Force light tables even under VSCode dark container */
        .markdown-body { color-scheme: light !important; }
        .markdown-body table { background-color: #ffffff !important; border-color: #d0d7de !important; border-collapse: collapse !important; }
        .markdown-body th, .markdown-body td { background-color: #ffffff !important; border: 1px solid #d0d7de !important; }
        .markdown-body thead th { background-color: #f6f8fa !important; }
        .markdown-body tbody tr { background-color: #ffffff !important; }
        .markdown-body tbody tr:nth-child(2n) { background-color: #f6f8fa !important; }
        .markdown-body table code { background-color: #f6f8fa !important; color: #24292e !important; }
      `
      );
    }
  } catch (_) {}

  try {
    if (FORCE_LIGHT) {
      // Explicit light palette inside markdown container to override VSCode dark UI
      addStyle(
        'mhe-force-light',
        `
        .markdown-body { background-color: #ffffff; color: #24292e; }
        .markdown-body a { color: #0969da; }
        .markdown-body pre, .markdown-body code { background-color: #f6f8fa; color: #24292e; }
      `
      );
    }
  } catch (_) {}
}

/**
 * Enforce light table styles via inline CSS for maximum precedence.
 * @param {HTMLElement} out Container element with rendered markdown (has 'markdown-body' class)
 * @returns {void}
 */
export function enforceLightTables(out) {
  try {
    // Ensure container uses light color scheme regardless of host
    out.style.setProperty('color-scheme', 'light', 'important');

    const set = (el, prop, val) => {
      try {
        el.style.setProperty(prop, val, 'important');
      } catch (_) {}
    };

    // Tables container/background/border behavior
    out.querySelectorAll('table').forEach((t) => {
      set(t, 'background-color', '#ffffff');
      set(t, 'border-collapse', 'collapse');
      set(t, 'border-color', '#d0d7de');
    });

    // Header cells
    out.querySelectorAll('thead th').forEach((th) => {
      set(th, 'background-color', '#f6f8fa');
      set(th, 'border', '1px solid #d0d7de');
      set(th, 'color', '#24292e');
    });

    // Body rows striping
    out.querySelectorAll('tbody tr').forEach((tr, idx) => {
      set(tr, 'background-color', idx % 2 === 1 ? '#f6f8fa' : '#ffffff');
    });

    // All table cells
    out.querySelectorAll('th, td').forEach((cell) => {
      set(cell, 'background-color', '#ffffff');
      set(cell, 'border', '1px solid #d0d7de');
      set(cell, 'color', '#24292e');
    });

    // Code blocks inside tables
    out.querySelectorAll('table code').forEach((code) => {
      set(code, 'background-color', '#f6f8fa');
      set(code, 'color', '#24292e');
    });
  } catch (_) {}
}