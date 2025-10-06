/**
 * Core Markdown renderer module.
 * Responsibilities:
 * - Fetch markdown from a URL and parse via Marked (GFM enabled).
 * - Apply MPE-like citations and footnotes using lib/citations.js.
 * - Inject GitHub-like styles and table compatibility using lib/github-theme.js.
 * - Convert Mermaid fenced blocks and render diagrams (runtime from icon.js).
 * - Honor window.MHE_FORCE_LIGHT_THEME to force light theme rendering.
 */

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
  const { ensureGithubMarkdownStyles, enforceLightTables } = await import(moduleUrl('lib/github-theme.js'));
  const { ensureCitationStyles, extractBibliographyFromFrontMatter, processFootnotesAndCitations, appendFootnotes, appendReferences } = await import(moduleUrl('lib/citations.js'));
  const { detectSlidesEnabled, splitMarkdownSlides, ensureSlideStyles, initSlideDeck } = await import(moduleUrl('lib/slides.js'));
  const { ensureTocStyles, initSidebarToc } = await import(moduleUrl('lib/toc.js'));
  // Force light theme when MHE_FORCE_LIGHT_THEME is truthy on window
  const FORCE_LIGHT = (typeof window !== 'undefined') && !!window.MHE_FORCE_LIGHT_THEME;

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

  // parseBibTexMinimal moved to lib/citations.js

  // Theme: GitHub Markdown CSS (dark/light aware) + minimal overrides
  try {
    ensureGithubMarkdownStyles({ CDN_NPM_BASE, FORCE_LIGHT, loadCSS, addStyle });
  } catch (_) {}
  // Styles: MPE-like citation and footnote CSS
  try {
    ensureCitationStyles();
  } catch (_) {}
  try {
    const res = await fetch(mdUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    mdText = await res.text();
    // Expose original markdown for downstream helpers (e.g., footnote fallbacks)
    try { window.__mheOriginalMarkdown = mdText; } catch (_) {}
  } catch (err) {
    console.error("Failed to fetch markdown", err);
    out.textContent = "Error loading markdown.";
    return;
  }

  // Preprocess footnotes and citations (MPE-like lightweight support)
  let mdProcessed = mdText;
  let citations = [];
  let bibliography = {};
  let footnoteDefs = {};
  let footnoteOrder = [];
 
  // Extract YAML front matter bibliography path (single file)
  try {
    bibliography = await extractBibliographyFromFrontMatter(mdText, mdUrl);
  } catch (_) {}
 
  // Decide rendering mode: slides (Marp-like) or single document
  out.classList.add('markdown-body');
  out.innerHTML = '';
 
  let slidesEnabled = false;
  try {
    slidesEnabled = detectSlidesEnabled(mdText);
  } catch (_) {}
 
  if (slidesEnabled) {
    // Slides mode
    try { ensureSlideStyles(addStyle); } catch (_) {}
    const deck = document.createElement('div');
    deck.className = 'mhe-slides';
 
    const { slides } = splitMarkdownSlides(mdText);
    // Build a global footnote definitions map so slides can resolve definitions even if they appear in a different slide
    const globalProc = (() => {
      try {
        return processFootnotesAndCitations(mdText);
      } catch (_) {
        return { footnoteDefs: {} };
      }
    })();
    const globalFootnoteDefs = (globalProc && globalProc.footnoteDefs) ? globalProc.footnoteDefs : {};
    // Expose for downstream components and as a fallback for modules
    try { window.__mheFootnoteDefs = globalFootnoteDefs; } catch (_) {}
  
    // Prepare Marked once for all slides
    let marked;
    try {
      ({ marked } = await import(MARKED_URL));
      marked.setOptions({ gfm: true, breaks: true, headerIds: true, mangle: false });
    } catch (err) {
      console.error("Marked parse error (slides mode)", err);
      out.textContent = "Error parsing markdown.";
      return;
    }
 
    // Render each slide independently (numbers reset per slide)
    for (const slideMd of slides) {
      const section = document.createElement('section');
      section.className = 'mhe-slide';
 
      let proc = { mdProcessed: slideMd, citations: [], footnoteOrder: [], footnoteDefs: {} };
      try {
        proc = processFootnotesAndCitations(slideMd);
      } catch (_) {}
 
      let html = "";
      try {
        html = marked.parse(proc.mdProcessed);
      } catch (e) {
        console.error("Marked parse error for slide", e);
      }
 
      section.innerHTML = html;
 
      // Sanitize: remove any script tags embedded in slide HTML
      section.querySelectorAll('script').forEach((s) => s.remove());
 
      // Convert fenced mermaid blocks to div.mermaid within this slide
      section.querySelectorAll('code.language-mermaid').forEach((codeEl) => {
        const pre = codeEl.closest('pre');
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = codeEl.textContent;
        (pre || codeEl).replaceWith(div);
      });
 
      // Append footnotes and references within this slide
      try { appendFootnotes(section, proc.footnoteOrder, Object.assign({}, globalFootnoteDefs, proc.footnoteDefs)); } catch (_) {}
      try { appendReferences(section, proc.citations, bibliography); } catch (_) {}
 
      deck.appendChild(section);
    }
 
    out.appendChild(deck);
 
    // Enforce light tables if requested
    if (FORCE_LIGHT) {
      try { enforceLightTables(out); } catch (_) {}
    }
 
    // Initialize slide navigation
    try { initSlideDeck(deck); } catch (_) {}
    // Initialize sidebar Table of Contents (ToC)
    try { ensureTocStyles({ moduleUrl, loadCSS }); } catch (_) {}
    try { initSidebarToc(out); } catch (_) {}
  } else {
    // Single-document mode (legacy flow)
    // Process citations and footnotes skipping fenced code blocks
    try {
      const processed = processFootnotesAndCitations(mdText);
      mdProcessed = processed.mdProcessed;
      citations = processed.citations;
      footnoteOrder = processed.footnoteOrder;
      footnoteDefs = processed.footnoteDefs;
      // Expose for downstream renderers and as a fallback for modules
      try { window.__mheFootnoteDefs = footnoteDefs; } catch (_) {}
    } catch (_) {}
 
    // Parse Markdown to HTML
    let html = "";
    try {
      const { marked } = await import(MARKED_URL);
      marked.setOptions({ gfm: true, breaks: true, headerIds: true, mangle: false });
      html = marked.parse(mdProcessed);
    } catch (err) {
      console.error("Marked parse error", err);
      out.textContent = "Error parsing markdown.";
      return;
    }
 
    const container = document.createElement('div');
    container.innerHTML = html;
 
    // Sanitize: remove any script tags embedded in markdown HTML
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
    out.append(...container.childNodes);
 
    // When forcing light theme, hard-enforce light table styling with inline styles (highest priority)
    if (FORCE_LIGHT) {
      try {
        enforceLightTables(out);
      } catch (_) {}
    }
 
    // Append footnotes section if any [^id] refs are present
    try {
      appendFootnotes(out, footnoteOrder, footnoteDefs);
    } catch (_) {}
 
    // Append references section if citations are present
    try {
      appendReferences(out, citations, bibliography);
    } catch (_) {}

    // Initialize sidebar Table of Contents (ToC) for single-document mode
    try { ensureTocStyles({ moduleUrl, loadCSS }); } catch (_) {}
    try { initSidebarToc(out); } catch (_) {}
  }

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

  // Helper to render diagrams with current Mermaid setup
  const renderDiagrams = async () => {
    try {
      const isDark = !FORCE_LIGHT && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
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
