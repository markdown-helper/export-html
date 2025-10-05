 // Resolve selected config URL (set by the page) or fall back to local config.js
 const CONFIG_URL =
   (typeof window !== 'undefined' && window.MHE_CONFIG_URL)
     ? window.MHE_CONFIG_URL
     : new URL(
         'config.js',
         (typeof window !== 'undefined' && window.MHE_MODULE_BASE ? window.MHE_MODULE_BASE : document.baseURI)
       ).href;

/**
 * Render Markdown URL into a container and process Mermaid diagrams.
 * Relies on global mermaid loaded/initialized elsewhere (icon.js).
 *
 * @param {{ mdUrl: string, outputId: string }} options
 * @returns {Promise<void>}
 */
export async function renderMarkdown({ mdUrl, outputId }) {
  if (!mdUrl || !outputId) {
    throw new Error("renderMarkdown requires mdUrl and outputId");
  }

  const out = document.getElementById(outputId);
  if (!out) {
    throw new Error(`Output element #${outputId} not found`);
  }

  let mdText = "";

  // Import selected config and helper dynamically (minified-aware via moduleUrl)
  const { MARKED_URL, moduleUrl, CDN_NPM_BASE } = await import(CONFIG_URL);
  const { enableGlobalNetworkSpinner } = await import(moduleUrl('lib/loader.js'));
  const { loadCSS } = await import(moduleUrl('lib/load-css.js'));
  const { addStyle } = await import(moduleUrl('lib/add-style.js'));
  const GITHUB_MD_CSS_LIGHT = `${CDN_NPM_BASE}/github-markdown-css@5/github-markdown.min.css`;
  const GITHUB_MD_CSS_DARK = `${CDN_NPM_BASE}/github-markdown-css@5/github-markdown-dark.min.css`;

  // Enable global network spinner and re-render diagrams when network becomes idle
  enableGlobalNetworkSpinner(outputId, "Loading...", async () => {
    try {
      const container = document.getElementById(outputId);
      const nodes = container ? container.querySelectorAll('.mermaid') : [];
      if (nodes.length && window.mermaid && window.__iconPacksReady) {
        await renderDiagrams();
      }
    } catch (_) {}
  });

  // Load GitHub Markdown CSS (theme-aware) and minimal overrides to improve table rendering
  try {
    const isDarkTheme = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    loadCSS(isDarkTheme ? GITHUB_MD_CSS_DARK : GITHUB_MD_CSS_LIGHT);
  } catch (_) {}
  try {
    addStyle('mhe-markdown-overrides', `
      .markdown-body { box-sizing: border-box; max-width: 100%; margin: 0; padding: 16px; }
      .markdown-body table { display: block; width: max-content; max-width: 100%; overflow: auto; }
    `);
  } catch (_) {}
  try {
    const res = await fetch(mdUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    mdText = await res.text();
  } catch (err) {
    console.error("Failed to fetch markdown", err);
    out.textContent = "Error loading markdown.";
    return;
  }

  // Parse Markdown to HTML
  let html = "";
  try {
    const { marked } = await import(MARKED_URL);
    marked.setOptions({ gfm: true, breaks: true, headerIds: true, mangle: false });
    html = marked.parse(mdText);
  } catch (err) {
    console.error("Marked parse error", err);
    out.textContent = "Error parsing markdown.";
    return;
  }

  const container = document.createElement('div');
  container.innerHTML = html;

  // Remove any script tags embedded in markdown
  container.querySelectorAll('script').forEach((s) => s.remove());

  // Convert fenced mermaid blocks to div.mermaid
  container.querySelectorAll('code.language-mermaid').forEach((codeEl) => {
    const pre = codeEl.closest('pre');
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = codeEl.textContent;
    (pre || codeEl).replaceWith(div);
  });

  // Inject into output
  out.classList.add('markdown-body');
  out.innerHTML = '';
  out.append(...container.childNodes);

  // Wait for mermaid global provided by icon.js
  const waitForMermaid = (attempts = 50, interval = 100) => new Promise((resolve, reject) => {
    const tick = () => {
      if (window.mermaid) return resolve();
      if (attempts-- <= 0) return reject(new Error("Mermaid not available"));
      setTimeout(tick, interval);
    };
    tick();
  });

  // Wait for icon packs registration signal set by icon.js
  const waitForIconPacks = (attempts = 100, interval = 100) => new Promise((resolve, reject) => {
    const tick = () => {
      if (window.__iconPacksReady) return resolve();
      if (attempts-- <= 0) return reject(new Error("Icon packs not ready"));
      setTimeout(tick, interval);
    };
    tick();
  });

  // Helper to render diagrams with current Mermaid setup
  const renderDiagrams = async () => {
    try {
      const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
      mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose' });
      const nodes = out.querySelectorAll('.mermaid');
      if (typeof mermaid.run === 'function') {
        await mermaid.run({ nodes });
      } else if (typeof mermaid.init === 'function') {
        mermaid.init(undefined, nodes);
      }
    } catch (e) {
      console.error("Mermaid render error", e);
    }
  };

  try {
    await waitForMermaid();

    // Detect required Iconify packs lazily from markdown content
    const detectRequiredPacks = (md) => {
      const names = [];
      if (/\blogos:/m.test(md)) names.push('logos');
      if (/\bfa:/.test(md)) names.push('fa');
      if (/\bfa7-solid:/.test(md)) names.push('fa7-solid');
      if (/\bmdi:/.test(md)) names.push('mdi');
      if (/\bmaterial-symbols:/.test(md)) names.push('material-symbols');
      if (/\bfluent:/.test(md)) names.push('fluent');
      return Array.from(new Set(names));
    };

    const neededPacks = detectRequiredPacks(mdText);

    // Register packs ONLY if needed; avoid loading external plugins
    if (neededPacks.length) {
      if (typeof window.__registerIconPacksFor === 'function') {
        await window.__registerIconPacksFor(neededPacks);
      } else {
        console.warn('Icon pack registration runtime not found; proceeding without external plugin.');
      }
    }

    // Initial render after packs/plugin are ready (or if no packs needed)
    await renderDiagrams();
  } catch (err) {
    console.error("Mermaid not ready to render yet", err);
  }
}
