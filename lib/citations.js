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
  let footnoteOrder = [];
  let citations = [];

  try {
    // Shield HTML comments and fenced code blocks with placeholders (to avoid counting tokens inside them)
    const comments = [];
    mdProcessed = mdProcessed.replace(/<!--[\s\S]*?-->/g, (m) => {
      comments.push(m);
      return `%%MHE_COMMENT_${comments.length - 1}%%`;
    });

    mdProcessed = mdProcessed.replace(/```[\s\S]*?```/g, (m) => {
      blocks.push(m);
      return `%%MHE_BLOCK_${blocks.length - 1}%%`;
    });
 
    // Strip YAML front matter block if present to avoid counting tokens within metadata
    try {
      const fmMatch = mdProcessed.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
      if (fmMatch) {
        mdProcessed = mdProcessed.slice(fmMatch[0].length);
      }
    } catch (_) {}
 
    // Parse and strip footnote definitions: [^id]: text (+ indented continuations)
    try {
      const lines = mdProcessed.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const def = lines[i] && lines[i].match(/^\s*(?:[-*]\s+|>\s*)?\[\^([^\]]+)\]:\s*(.*)$/);
        if (def) {
          const key = def[1];
          const first = def[2] || '';
          const parts = [first];
          let j = i + 1;
          // Continuations: lines indented with spaces or tabs (tolerant to nested contexts)
          while (j < lines.length && lines[j] && (/^[ \t]+\S/.test(lines[j]))) {
            parts.push(lines[j].trim());
            lines[j] = null; // mark continuation for removal
            j++;
          }
          footnoteDefs[key] = parts.join(' ').trim();
          lines[i] = null; // remove def line
          i = j - 1;
        }
      }
      mdProcessed = lines.filter((l) => l !== null).join('\n');
      // Final safety: remove any residual footnote definition lines with their indented continuations
      mdProcessed = mdProcessed.replace(/^\s*(?:[-*]\s+|>\s*)?\[\^[^\]]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/gm, '');
    } catch (_) {
      // ignore footnote parsing errors
    }

    // Number footnote refs regardless of whether a matching definition exists.
    // Missing definitions will be resolved later via appendFootnotes() fallbacks (global defs or original markdown scan).

    // Single left-to-right pass collecting citations and footnote refs (outside code fences)
    const rx = /(\[@([A-Za-z0-9_:-]+)\]|\[\^([^\]]+)\])/g;

    // Assign independent sequence numbers: citations and footnotes use separate counters
    const citeMap = new Map();   // key -> n (1..)
    const footMap = new Map();   // key -> n (1..)
    const citeOrder = [];
    const fnOrder = [];
    let citeNext = 1;
    let footNext = 1;

    // Replace in-place using a functional replacer to avoid index drift bugs
    mdProcessed = mdProcessed.replace(rx, (full, _whole, citeKey, footKey) => {
      if (citeKey) {
        if (!citeMap.has(citeKey)) {
          citeMap.set(citeKey, citeNext++);
          if (!citeOrder.includes(citeKey)) citeOrder.push(citeKey);
        }
        const n = citeMap.get(citeKey);
        // Citations: keep bracketed [n]
        return `<sup class="citation"><a href="#ref-${citeKey}" id="cite-${citeKey}">[${n}]</a></sup>`;
      }
      if (footKey) {
        if (!footMap.has(footKey)) {
          footMap.set(footKey, footNext++);
          if (!fnOrder.includes(footKey)) fnOrder.push(footKey);
        }
        const n = footMap.get(footKey);
        // Footnotes: plain numeric superscript for visual distinction
        return `<sup class="footnote"><a href="#fn-${footKey}" id="fnref-${footKey}">${n}</a></sup>`;
      }
      return full;
    });

    citations = citeOrder;
    footnoteOrder = fnOrder;

    // Restore fenced blocks and HTML comments
    mdProcessed = mdProcessed.replace(/%%MHE_BLOCK_(\d+)%%/g, (_, i) => blocks[Number(i)]);
    mdProcessed = mdProcessed.replace(/%%MHE_COMMENT_(\d+)%%/g, (_, i) => comments[Number(i)]);
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
 * Read the globally assigned sequence number for a citation or footnote anchor within a container.
 * @param {HTMLElement} out
 * @param {'footnote'|'citation'} type
 * @param {string} key
 * @returns {number|null}
 */
function docNumberFor(out, type, key) {
  try {
    const selKey = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(key)) : String(key);
    const id = type === 'footnote' ? `#fnref-${selKey}` : `#cite-${selKey}`;
    const a = out.querySelector(id);
    if (!a) return null;
    const t = String(a.textContent || '');
    // Accept either "[n]" or plain "n" (or any text containing a number)
    const m = t.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  } catch (_) {
    return null;
  }
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
    if (!Array.isArray(footnoteOrder) || !footnoteOrder.length) return;

    // Prefer injecting into an existing "Sumber" (Sources) section, else fallback to a Footnotes section.
    const normalizeHeading = (t) => (t || '').trim().toLowerCase().replace(/[:\s]+$/, '');
    const findSumberHeading = () => {
      const hs = out.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const h of hs) {
        const norm = normalizeHeading(h.textContent);
        if (norm === 'sumber' || norm === 'sources') return h;
      }
      return null;
    };
    const insertAfter = (newNode, referenceNode) => {
      if (referenceNode && referenceNode.parentNode) {
        if (referenceNode.nextSibling) referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
        else referenceNode.parentNode.appendChild(newNode);
      } else {
        out.appendChild(newNode);
      }
    };

    const sumberHeading = findSumberHeading();
    let ol;

    if (sumberHeading) {
      const next = sumberHeading.nextElementSibling;
      if (next && next.tagName === 'OL') {
        ol = next;
        next.classList.add('footnote-list');
      } else {
        ol = document.createElement('ol');
        ol.className = 'footnote-list';
        insertAfter(ol, sumberHeading);
      }
    } else {
      const section = document.createElement('section');
      section.id = 'footnotes';
      const h2 = document.createElement('h2');
      h2.textContent = 'Footnotes';
      ol = document.createElement('ol');
      ol.className = 'footnote-list';
      section.appendChild(h2);
      section.appendChild(ol);
      out.appendChild(section);
    }

    const isVisible = (el) => {
      try {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const slide = el.closest && el.closest('.mhe-slide');
        if (slide && !slide.classList.contains('active')) return false;
        return true;
      } catch (_) {
        return true;
      }
    };
    const scopeForContext = (refEl) => (refEl && refEl.closest && refEl.closest('.mhe-slide')) || out;

    const labelForRef = (key) => {
      try {
        const selKey = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(key)) : String(key);
        const refEl = out.querySelector(`#fnref-${selKey}`);
        if (!refEl) return '';
        const scope = scopeForContext(refEl);
        const heads = Array.from(scope.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(isVisible);
        if (!heads.length) return '';

        let chosen = '';
        for (const h of heads) {
          const pos = h.compareDocumentPosition(refEl);
          const before = (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          const contains = (pos & Node.DOCUMENT_POSITION_CONTAINS) !== 0;
          if (before || contains) {
            chosen = (h.textContent || '').trim();
          }
        }
        return chosen;
      } catch (_) {
        return '';
      }
    };

    // Shorten context label to the first word, adding ellipsis if truncated.
    const formatCtxLabel = (raw) => {
      try {
        const t = String(raw || '').trim();
        if (!t) return 'Back';
        const i = t.indexOf(' ');
        if (i >= 0 && i < t.length - 1) return t.slice(0, i) + '...';
        return t;
      } catch (_) {
        return 'Back';
      }
    };

    // Read the inline-assigned number for a key using the shared helper (supports [n] or n)
    const numberFor = (type, key) => docNumberFor(out, type, key);

    // Align the ordered list numbering with the first footnote's inline number (global sequence).
    try {
      const firstNum = docNumberFor(out, 'footnote', footnoteOrder[0]);
      if (firstNum != null) {
        ol.start = firstNum;
      }
    } catch (_) {}

    footnoteOrder.forEach((key) => {
      const li = document.createElement('li');
      li.id = `fn-${key}`;

      // Ensure the ordered list numbering matches the globally assigned number for this footnote.
      // HTML allows overriding list item ordinal via li.value.
      const num = numberFor('footnote', key);
      if (num != null) {
        try { li.value = num; } catch (_) {}
      }
  
      // Resolve footnote text from provided defs, global defs, or last-resort from original markdown
      let text =
        (footnoteDefs && footnoteDefs[key])
          ? footnoteDefs[key]
          : ((typeof window !== 'undefined' && window.__mheFootnoteDefs && window.__mheFootnoteDefs[key])
              ? window.__mheFootnoteDefs[key]
              : null);
  
      if (!text && typeof window !== 'undefined' && window.__mheOriginalMarkdown) {
        try {
          const safeKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const rx = new RegExp('^\\s*(?:[-*]\\s+|>\\s*)?\\[\\^' + safeKey + '\\]:\\s*(.*)$', 'm');
          const m = String(window.__mheOriginalMarkdown).match(rx);
          if (m) text = (m[1] || '').trim();
        } catch (_) {}
      }
      if (!text) text = key;
  
      // Build context label from the nearest preceding visible heading where the reference [^key] appears.
      const rawLabel = labelForRef(key);
      const ctxLabel = formatCtxLabel(rawLabel || 'Back');
      const ctxLink = `<a href="#fnref-${key}" class="footnote-context">[${ctxLabel}]</a>`;
  
      // If the footnote text contains a literal [Back] placeholder, replace it with the contextual link.
      // Otherwise, keep the original text and append the contextual link at the end.
      const replaced = text.replace(/\[Back\]/gi, ctxLink);
      if (replaced !== text) {
        li.innerHTML = replaced;
      } else {
        li.innerHTML = `${text} ${ctxLink}`;
      }
      ol.appendChild(li);
    });
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
    // Build citation keys; fall back to scanning DOM anchors if array is empty
    let keys = Array.isArray(citations) ? citations.slice() : [];
    if (!keys.length) {
      try {
        const anchors = Array.from(out.querySelectorAll('sup.citation a[id^="cite-"]'));
        const seen = new Set();
        keys = anchors
          .map((a) => String(a.id || '').replace(/^cite-/, ''))
          .filter((k) => {
            if (!k) return false;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
      } catch (_) {}
    }
    if (!keys.length) return;

    const section = document.createElement('section');
    section.id = 'references';
    const h2 = document.createElement('h2');
    h2.textContent = 'References';
    const ol = document.createElement('ol');
    ol.className = 'citation-list';

    // Align list start with the first citation's inline number
    try {
      const firstCitationNum = docNumberFor(out, 'citation', keys[0]);
      if (firstCitationNum != null) {
        ol.start = firstCitationNum;
      }
    } catch (_) {}

    keys.forEach((key) => {
      const li = document.createElement('li');
      li.id = `ref-${key}`;

      // Ensure the ordered list item value matches the inline number
      const num = docNumberFor(out, 'citation', key);
      if (num != null) {
        try { li.value = num; } catch (_) {}
      }

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
      .markdown-body .footnote-backref, .markdown-body .footnote-context { margin-left: 6px; text-decoration: none; }
    `;
    document.head.appendChild(style);
  } catch (_) {
    // ignore DOM errors
  }
}