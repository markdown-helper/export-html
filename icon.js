// Icon and diagram runtime initializer.
// Responsibilities:
// - Resolve config and dynamic module base via config.js.
// - Load Font Awesome CSS if not already present.
// - Enable a global network spinner (idempotent) to indicate resource loading.
// - Load Mermaid once and expose window.__registerIconPacksFor to lazily register needed Iconify packs.
// - Trigger a render of existing diagrams after packs registration.
// Notes:
// - Local helper modules are imported dynamically via config.moduleUrl honoring window.MHE_MODULE_USE_MINIFIED.

// Resolve selected config URL (set by the page) or fall back to local config.js
const CONFIG_URL =
  (typeof window !== 'undefined' && window.MHE_CONFIG_URL)
    ? window.MHE_CONFIG_URL
    : new URL(
        'config.js',
        (typeof window !== 'undefined' && window.MHE_MODULE_BASE ? window.MHE_MODULE_BASE : document.baseURI)
      ).href;
// Dynamically import selected config to get constants and local module URL resolver
const { MERMAID_URL, FONT_AWESOME4_CSS, moduleUrl } = await import(CONFIG_URL);

// Import local helper modules dynamically to honor minified toggle
const { loadScript, buildIconPack, enableGlobalNetworkSpinner } = await import(moduleUrl('lib/loader.js'));
const { isFontAwesomeLoaded } = await import(moduleUrl('lib/detect-fa.js'));
const { loadCSS } = await import(moduleUrl('lib/load-css.js'));

// Enable global network spinner now that helpers are available
enableGlobalNetworkSpinner(undefined, 'Loading resources...');

// Load Font Awesome CSS only if not already applied.
// Default to FA v4 for widest compatibility ('fa' class). If a newer FA is present (v5/v6), detection prevents duplicate loads.
if (!isFontAwesomeLoaded()) {
  loadCSS(FONT_AWESOME4_CSS);
}

/**
 * Register Iconify icon packs with Mermaid.
 *
 * Safe to call multiple times: Mermaid deduplicates packs by name.
 * Uses buildIconPack() which negotiates Iconify '@iconify-json' pack majors (['1','2',''] by default)
 * and caches fetches to avoid redundant network requests.
 *
 * @returns {void}
 */
async function registerMermaidRuntime() {
  if (!window.mermaid) {
    console.error("Mermaid global not found while initializing icon runtime.");
    return;
  }

  // Global network spinner is already enabled at module init; avoid redundant re-enable.
 
  // Expose a lazy registration function that only registers packs actually needed.
  const packMap = {
    logos: '@iconify-json/logos',
    fa: '@iconify-json/fa',
    'fa7-solid': '@iconify-json/fa7-solid',
    mdi: '@iconify-json/mdi',
    'material-symbols': '@iconify-json/material-symbols',
    fluent: '@iconify-json/fluent',
  };

  window.__iconPacksReady = false;

  window.__registerIconPacksFor = async (names = []) => {
    try {

      // Build only the requested packs
      const unique = Array.from(new Set(names)).filter((n) => packMap[n]);
      if (!unique.length) {
        // Nothing to register
        window.__iconPacksReady = true;
        return;
      }
      const packs = unique.map((n) => buildIconPack(n, packMap[n]));

      // Register selected packs lazily
      if (typeof window.mermaid.registerIconPacks === 'function') {
        window.mermaid.registerIconPacks(packs);
      }

      window.__iconPacksReady = true;

      // Attempt to render any existing diagrams now that packs/plugin are ready
      try {
        const nodes = document.querySelectorAll('.mermaid');
        if (nodes.length) {
          const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
          mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose' });
          if (typeof mermaid.run === 'function') {
            mermaid.run({ nodes });
          } else if (typeof mermaid.init === 'function') {
            mermaid.init(undefined, nodes);
          }
        }
      } catch (e) {
        console.warn("Post-register render failed", e);
      }
    } catch (e) {
      console.error("Failed registering requested icon packs", e);
    }
  };
}

// Load Mermaid exactly once; if 'mermaid' global already exists, the callback is invoked asynchronously without reinserting the script.
// After Mermaid is ready, register icon packs.
loadScript(
  MERMAID_URL,
  registerMermaidRuntime,
  'mermaid' // If Mermaid already exists, callback executes asynchronously
);

