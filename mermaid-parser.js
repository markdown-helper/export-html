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

  // Minimal BibTeX parser (title, author, year, url, doi)
  function parseBibTexMinimal(text) {
    const entries = {};
    const rx = /@\w+\s*{\s*([^,\s]+)\s*,([\s\S]*?)}/g;
    let m;
    while ((m = rx.exec(text))) {
      const key = m[1].trim();
      const body = m[2];
      const fields = {};
      body.replace(/(\w+)\s*=\s*(\{[^}]*\}|"[^"]*"|[^,\n]+)\s*,?/g, (_, name, val) => {
        let v = String(val).trim();
        v = v.replace(/^[{"]|[}"]$/g, '');
        fields[name.toLowerCase()] = v;
        return '';
      });
      entries[key] = fields;
    }
    return entries;
  }

  // Load GitHub Markdown CSS (theme-aware) and minimal overrides to improve table rendering
  try {
    const isDarkTheme = !FORCE_LIGHT && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast'));
    loadCSS(isDarkTheme ? GITHUB_MD_CSS_DARK : GITHUB_MD_CSS_LIGHT);
  } catch (_) {}
  try {
    addStyle('mhe-markdown-overrides', `
      .markdown-body { box-sizing: border-box; max-width: 100%; margin: 0; padding: 16px; }
      .markdown-body table { display: block; width: max-content; max-width: 100%; overflow: auto; }
      /* Citation styling */
      .markdown-body sup.citation { font-size: 0.8em; vertical-align: super; line-height: 0; }
      .markdown-body sup.citation a { text-decoration: none; }
      .markdown-body section#references { margin-top: 24px; }
      .markdown-body section#references > h2 { margin-top: 0; }
      .markdown-body ol.citation-list { padding-left: 1.25em; }
      .markdown-body ol.citation-list li { margin-bottom: 8px; }
      /* Footnote styling (MPE-like) */
      .markdown-body sup.footnote { font-size: 0.8em; vertical-align: super; line-height: 0; }
      .markdown-body sup.footnote a { text-decoration: none; }
      .markdown-body section#footnotes { margin-top: 24px; }
      .markdown-body section#footnotes > h2 { margin-top: 0; }
      .markdown-body ol.footnote-list { padding-left: 1.25em; }
      .markdown-body ol.footnote-list li { margin-bottom: 8px; }
      .markdown-body .footnote-backref { margin-left: 6px; text-decoration: none; }
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

  // Preprocess footnotes and citations (MPE-like lightweight support)
  let mdProcessed = mdText;
  let citations = [];
  let bibliography = {};
  let footnoteDefs = {};
  let footnoteOrder = [];
 
  // Extract YAML front matter bibliography path (single file)
  try {
    const fmMatch = mdText.match(/^---[^\n]*\n[\s\S]*?\n---\s*/);
    if (fmMatch) {
      const fm = fmMatch[0];
      const bibLine = fm.split('\n').find((l) => /^\s*bibliography\s*:/i.test(l));
      if (bibLine) {
        const bibPath = String(bibLine.split(':').slice(1).join(':')).trim().replace(/^['"]|['"]$/g, '');
        if (bibPath) {
          const base = new URL(mdUrl, document.baseURI);
          const bibUrl = new URL(bibPath, base);
          try {
            const bibRes = await fetch(bibUrl.href);
            if (bibRes.ok) {
              const bibText = await bibRes.text();
              bibliography = parseBibTexMinimal(bibText);
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
 
  // Skip fenced code blocks while processing citations and footnotes
  try {
    const blocks = [];
    mdProcessed = mdProcessed.replace(/```[\s\S]*?```/g, (m) => {
      blocks.push(m);
      return `%%MHE_BLOCK_${blocks.length - 1}%%`;
    });
 
    // Parse and strip footnote definitions: [^id]: text (+ indented continuations)
    try {
      const lines = mdProcessed.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const def = lines[i].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
        if (def) {
          const key = def[1];
          const first = def[2] || '';
          const parts = [first];
          let j = i + 1;
          while (j < lines.length && (/^\s{2,}\S/.test(lines[j]) || /^\t+\S/.test(lines[j]))) {
            parts.push(lines[j].trim());
            lines[j] = null; // mark continuation for removal
            j++;
          }
          footnoteDefs[key] = parts.join(' ').trim();
          lines[i] = null; // mark def line for removal
          i = j - 1;
        }
      }
      mdProcessed = lines.filter((l) => l !== null).join('\n');
    } catch (_) {}
 
    // Replace [@key] citations with numbered superscripts
    const order = [];
    mdProcessed = mdProcessed.replace(/\[@([A-Za-z0-9_:-]+)\]/g, (m, key) => {
      const idx = order.indexOf(key);
      const num = idx >= 0 ? (idx + 1) : (order.push(key), order.length);
      return `<sup class="citation"><a href="#ref-${key}" id="cite-${key}">[${num}]</a></sup>`;
    });
    citations = order.slice();
 
    // Replace footnote refs [^id] with numbered superscripts
    mdProcessed = mdProcessed.replace(/\[\^([^\]]+)\]/g, (m, key) => {
      const idx = footnoteOrder.indexOf(key);
      const num = idx >= 0 ? (idx + 1) : (footnoteOrder.push(key), footnoteOrder.length);
      return `<sup class="footnote"><a href="#fn-${key}" id="fnref-${key}">[${num}]</a></sup>`;
    });
 
    // Restore fenced blocks
    mdProcessed = mdProcessed.replace(/%%MHE_BLOCK_(\d+)%%/g, (_, i) => blocks[Number(i)]);
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
 
  // Append footnotes section if any [^id] refs are present
  try {
    if (Array.isArray(footnoteOrder) && footnoteOrder.length) {
      const section = document.createElement('section');
      section.id = 'footnotes';
      const h2 = document.createElement('h2');
      h2.textContent = 'References';
      const ol = document.createElement('ol');
      ol.className = 'footnote-list';
      footnoteOrder.forEach((key) => {
        const li = document.createElement('li');
        li.id = `fn-${key}`;
        const text = (footnoteDefs && footnoteDefs[key]) ? footnoteDefs[key] : key;
        li.innerHTML = `${text} <a href="#fnref-${key}" class="footnote-backref" aria-label="Back to content">↩︎</a>`;
        ol.appendChild(li);
      });
      section.appendChild(h2);
      section.appendChild(ol);
      out.appendChild(section);
    }
  } catch (_) {}

  // Append references section if citations are present
  try {
    if (Array.isArray(citations) && citations.length) {
      const section = document.createElement('section');
      section.id = 'references';
      const h2 = document.createElement('h2');
      h2.textContent = 'References';
      const ol = document.createElement('ol');
      ol.className = 'citation-list';
      citations.forEach((key) => {
        const li = document.createElement('li');
        li.id = `ref-${key}`;
        const entry = bibliography && bibliography[key];
        if (entry) {
          const author = entry.author || '';
          const year = entry.year || entry.date || '';
          const title = entry.title || key;
          const url = entry.url || (entry.doi ? `https://doi.org/${entry.doi}` : '');
          li.innerHTML = `${author ? author + '. ' : ''}${year ? '(' + year + '). ' : ''}<strong>${title}</strong>${url ? `. <a href="${url}" target="_blank" rel="noopener">link</a>` : ''}`;
        } else {
          li.textContent = key;
        }
        ol.appendChild(li);
      });
      section.appendChild(h2);
      section.appendChild(ol);
      out.appendChild(section);
    }
  } catch (_) {}

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
