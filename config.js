/**
* Configuration module.
* Responsibilities:
* - Define centralized CDN base and external library URLs (Mermaid, Marked, Font Awesome).
* - Provide iconifyPackUrl() to resolve Iconify JSON collections with optional version.
* - Resolve a base URL for local ESM modules via MHE_MODULE_BASE, honoring window override.
* - Provide moduleUrl() helper to produce absolute URLs and optionally use minified variants.
*
* Notes:
* - Set window.MHE_MODULE_BASE before loading modules to override local module base.
* - Set window.MHE_MODULE_USE_MINIFIED to truthy to prefer *.min.js for local module paths.
*/
export const CDN_NPM_BASE = 'https://cdn.jsdelivr.net/npm';

// Library URLs built from the base
export const MERMAID_URL = `${CDN_NPM_BASE}/mermaid@11/dist/mermaid.min.js`;
export const MARKED_URL = `${CDN_NPM_BASE}/marked/lib/marked.esm.js`;
export const FONT_AWESOME4_CSS = `${CDN_NPM_BASE}/font-awesome@4/css/font-awesome.min.css`;

// Iconify pack resolver
export function iconifyPackUrl(pkg, version) {
  // pkg: '@iconify-json/logos'
  // version: '1' | '2' | '' (latest)
  if (version) {
    return `${CDN_NPM_BASE}/${pkg}@${version}/icons.json`;
  }
  return `${CDN_NPM_BASE}/${pkg}/icons.json`;
}

// Base URL for hosting local ESM modules (icon.js, mermaid-parser.js, etc.)
// Can be overridden by setting window.MHE_MODULE_BASE before importing modules.
export const MHE_MODULE_BASE = (() => {
  try {
    if (typeof window !== 'undefined' && window.MHE_MODULE_BASE) {
      return new URL(window.MHE_MODULE_BASE, document.baseURI).href;
    }
  } catch (_) {}
  try {
    // Fallback: base is the directory where this config.js resides
    return new URL('.', import.meta.url).href;
  } catch (_) {}
  // Final fallback: document base
  return document.baseURI;
})();

// Toggle to load local modules (*.js) as minified (*.min.js) when available.
// Can be overridden by setting window.MHE_MODULE_USE_MINIFIED before importing modules.
export const MHE_MODULE_USE_MINIFIED = (() => {
  const parseTruthy = (v) => {
    if (v === undefined || v === null) return false;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  };
  try {
    if (typeof window !== 'undefined' && 'MHE_MODULE_USE_MINIFIED' in window) {
      return parseTruthy(window.MHE_MODULE_USE_MINIFIED);
    }
  } catch (_) {}
  return false;
})();

function addMinSuffix(path) {
  try {
    // Only apply to .js files and avoid double '.min'
    if (/\.min\.js$/i.test(path)) return path;
    if (/\.js$/i.test(path)) return path.replace(/\.js$/i, '.min.js');
  } catch (_) {}
  return path;
}

// Helper to build absolute URLs for local modules based on BASE and minified toggle
export function moduleUrl(path, BASE = MHE_MODULE_BASE, USE_MIN = MHE_MODULE_USE_MINIFIED) {
  const resolvedPath = USE_MIN ? addMinSuffix(path) : path;
  return new URL(resolvedPath, BASE).href;
}