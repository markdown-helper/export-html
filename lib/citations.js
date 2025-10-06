/**
 * Citations and footnotes processing helpers (MPE-like lightweight support)
 * Provides:
 * - parseBibTexMinimal(text)
 * - extractBibliographyFromFrontMatter(mdText, mdUrl)
 * - processFootnotesAndCitations(mdText)
 * - appendFootnotes(out, footnoteOrder, footnoteDefs)
 * - appendReferences(out, citations, bibliography)
 */

/**
 * Minimal BibTeX parser (title, author, year, url, doi)
 * @param {string} text
 * @returns {Record<string, Record<string, string>>}
 */
export function parseBibTexMinimal(text) {
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

/**
 * Extract bibliography from YAML front matter `bibliography: path` and fetch BibTeX.
 * @param {string} mdText
 * @param {string} mdUrl
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
export async function extractBibliographyFromFrontMatter(mdText, mdUrl) {
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
              return parseBibTexMinimal(bibText);
            }
          } catch (_) {
            // ignore network errors and fall through to empty bibliography
          }
        }
      }
    }
  } catch (_) {
    // ignore parsing errors
  }
  return {};
}

/**
 * Process footnotes and citations in Markdown while skipping fenced code blocks.
 * Supports:
 * - Strip footnote definitions: [^id]: text (+ indented continuations)
 * - Replace footnote references [^id] with numbered superscripts
 * - Replace citations [@key] with numbered superscripts
 * @param {string} mdText
 * @returns {{
 *   mdProcessed: string,
 *   citations: string[],
 *   footnoteOrder: string[],
 *   footnoteDefs: Record<string, string>
 * }}
 */
export function processFootnotesAndCitations(mdText) {
  let mdProcessed = mdText;
  const blocks = [];
  const footnoteDefs = {};
  const footnoteOrder = [];
  let citations = [];

  try {
    // Replace fenced blocks with placeholders
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
    } catch (_) {
      // ignore footnote parsing errors
    }

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
  } catch (_) {
    // ignore processing errors
  }

  return {
    mdProcessed,
    citations,
    footnoteOrder,
    footnoteDefs,
  };
}

/**
 * Append footnotes section to output if any references are present.
 * Uses same structure as inline implementation for compatibility.
 * @param {HTMLElement} out
 * @param {string[]} footnoteOrder
 * @param {Record<string, string>} footnoteDefs
 * @returns {void}
 */
export function appendFootnotes(out, footnoteOrder, footnoteDefs) {
  try {
    if (Array.isArray(footnoteOrder) && footnoteOrder.length) {
      const section = document.createElement('section');
      section.id = 'footnotes';
      const h2 = document.createElement('h2');
      // Footnotes section heading
      h2.textContent = 'Footnotes';
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
  } catch (_) {
    // ignore DOM errors
  }
}

/**
 * Append references section to output if citations are present.
 * @param {HTMLElement} out
 * @param {string[]} citations
 * @param {Record<string, Record<string, string>>} bibliography
 * @returns {void}
 */
export function appendReferences(out, citations, bibliography) {
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
  } catch (_) {
    // ignore DOM errors
  }
}
/**
 * Ensure citation and footnote styles are present in document.
 * Idempotent: injects a single &lt;style&gt; tag by id.
 */
export function ensureCitationStyles() {
  try {
    const id = 'mhe-citation-footnote-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
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
    `;
    document.head.appendChild(style);
  } catch (_) {
    // ignore DOM errors
  }
}