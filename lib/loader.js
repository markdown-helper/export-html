const loadedScripts = {};

/**
 * Load an external script exactly once with optional readiness check.
 *
 * Behavior and guarantees:
 * - Normalizes to an absolute URL to avoid duplicate loads caused by relative vs absolute href/src.
 * - Deduplicates by both generated id and exact normalized src match across the DOM.
 * - Queues multiple callbacks while the same script is loading and flushes them on 'load'.
 * - If checkVariable is provided and already present on window, no element is inserted;
 *   the callback (if provided) is invoked asynchronously.
 *
 * Note: checkVariable supports only top-level globals (e.g., 'mermaid').
 *
 * @param {string} src Script URL to load.
 * @param {Function} [callback] Invoked after the script is ready (onload or short-circuit).
 * @param {string} [checkVariable] Optional window global to short-circuit loading.
 * @returns {void}
 */
export function loadScript(src, callback, checkVariable) {
  const absSrc = new URL(src, document.baseURI).href;
  const scriptId = `script-loader-${absSrc.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const key = absSrc;

  // Ensure state bucket for this src
  if (!loadedScripts[key]) {
    loadedScripts[key] = { element: null, callbacks: [] };
  }

  // 1) If the global variable already exists, fire callback asynchronously and exit
  if (checkVariable && window[checkVariable]) {
    if (typeof callback === 'function') setTimeout(callback, 0);
    return;
  }

  // 2) If we're already loading this src, just queue the callback
  if (loadedScripts[key].element) {
    if (typeof callback === 'function') {
      loadedScripts[key].callbacks.push(callback);
    }
    return;
  }

  // 3) Check for an existing script element in the DOM (by id or identical normalized src)
  const existingById = document.getElementById(scriptId);
  const existingExact = document.querySelector(`script[src="${absSrc}"]`);
  const existingByIter = existingExact || Array.from(document.scripts).find((s) => s.src === absSrc) || null;
  const existing = existingById || existingByIter;

  if (existing) {
    loadedScripts[key].element = existing;

    if (typeof callback === 'function') {
      // If a readiness probe is provided and already satisfied, run immediately.
      if (checkVariable && window[checkVariable]) {
        setTimeout(callback, 0);
      } else if (checkVariable) {
        // With a probe but not yet ready: queue until the existing script reports 'load',
        // and also schedule a microtask to flush if the global appears without 'load' firing.
        loadedScripts[key].callbacks.push(callback);
        existing.addEventListener('load', () => {
          const q = loadedScripts[key].callbacks.splice(0);
          q.forEach((cb) => cb());
        }, { once: true });
        existing.addEventListener('error', () => {
          console.error(`Failed loading script: ${absSrc}`);
          loadedScripts[key].callbacks = [];
        }, { once: true });
        setTimeout(() => {
          if (window[checkVariable] && loadedScripts[key].callbacks.length) {
            const q = loadedScripts[key].callbacks.splice(0);
            q.forEach((cb) => cb());
          }
        }, 0);
      } else {
        // No readiness probe: assume the existing script is already ready and invoke asynchronously.
        setTimeout(callback, 0);
      }
    }

    // Existing script detected; callbacks and readiness handled in the block above.

    return;
  }

  // 4) Create and load the script
  const script = document.createElement('script');
  script.id = scriptId;
  script.src = absSrc;
  script.defer = true;

  const onLoad = () => {
    if (typeof callback === 'function') callback();
    const q = loadedScripts[key].callbacks.splice(0);
    q.forEach((cb) => cb());
  };

  const onError = (e) => {
    console.error(`Error loading script ${absSrc}`, e);
    loadedScripts[key].callbacks = [];
  };

  script.addEventListener('load', onLoad, { once: true });
  script.addEventListener('error', onError, { once: true });

  document.head.appendChild(script);
  loadedScripts[key].element = script;
}


// --- Your main functions ---

/**
 * Build an Iconify pack descriptor for Mermaid.
 * - name: The short pack name used in diagrams, e.g., 'logos', 'fa', 'fa7-solid'
 * - pkg: The npm package under @iconify-json containing icons.json
 *
 * @param {string} name
 * @param {string} pkg
 * @returns {{name: string, loader: () => Promise<object>}}
 */
/**
 * Resolve and fetch icons.json for an Iconify pack, with version negotiation.
 *
 * Not all @iconify-json packs publish the same major version. Many are at @1,
 * but some may publish at @2 (or newer) depending on the collection. This helper:
 * - Tries specific majors (e.g., @1, @2) and finally falls back to the unpinned latest (no @major),
 * - Caches per package+version-candidate list to avoid repeated network fetches.
 *
 * This avoids hardcoding '@1' so packs that publish at '@2' or newer still work.
 */
const iconsJsonCache = new Map();

/**
 * Resolve and fetch icons.json for an Iconify pack, with version negotiation.
 * @param {string} pkg NPM package under @iconify-json (e.g., '@iconify-json/logos').
 * @param {string[]} [versionCandidates=['1','2','']] Major versions to try; '' means latest.
 *   Order reflects preference for stability first (@1), then newer (@2), then latest (no pin).
 * @returns {Promise<object>} icons.json payload or {} on failure.
 * @private
 */
function fetchIconsJson(pkg, versionCandidates = ['1', '2', '']) {
  const cacheKey = `${pkg}|${versionCandidates.join(',')}`;
  if (iconsJsonCache.has(cacheKey)) return iconsJsonCache.get(cacheKey);

  const urls = versionCandidates.map((v) =>
    v
      ? `https://cdn.jsdelivr.net/npm/${pkg}@${v}/icons.json`
      : `https://cdn.jsdelivr.net/npm/${pkg}/icons.json`
  );

  const promise = (async () => {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        return await res.json();
      } catch (_) {
        // Try next candidate
      }
    }
    throw new Error(`Unable to fetch icons.json for ${pkg} from: ${urls.join(' | ')}`);
  })().catch((err) => {
    console.error(`Failed to fetch icon pack '${pkg}'`, err);
    // Return empty object to keep registration robust if a single pack fails
    return {};
  });

  iconsJsonCache.set(cacheKey, promise);
  return promise;
}

/**
 * Build an Iconify pack descriptor for Mermaid.
 * Accepts optional versions override to pin preferred majors.
 *
 * Not all packs are '@1': some may publish '@2' or later. By default we try
 * ['1','2',''] to prefer stability first, then newer majors, then latest.
 * Override per pack if you want to prefer a different order, e.g. ['2','1',''].
 *
 * @param {string} name - Short pack name ('logos', 'fa', etc.)
 * @param {string} pkg - '@iconify-json/<pack>'
 * @param {{versions?: string[]}} [options] - e.g., { versions: ['2', '1', ''] }
 * @returns {{name: string, loader: () => Promise<object>}}
 */
export function buildIconPack(name, pkg, options = {}) {
  const versions = options.versions || ['1', '2', '']; // stability-first default
  return {
    name,
    loader: () => fetchIconsJson(pkg, versions),
  };
}

// --- Loading indicator utilities ---

/**
 * Show a prominent loading overlay using Font Awesome icons.
 * Covers most of the target container to indicate ongoing network activity.
 * @param {string} [targetId] Element id to host the overlay; defaults to document.body.
 * @param {string} [text='Loading...'] Optional label text.
 * @returns {void}
 */
export function showLoadingIndicator(targetId, text = 'Loading...') {
  try {
    const container = (targetId && document.getElementById(targetId)) || document.body || document.documentElement;
    const id = `xhr-loader-${targetId || 'global'}`;
    if (document.getElementById(id)) return;

    // Inject fallback CSS spinner once (visible even if FA not yet ready)
    if (!document.getElementById('xhr-spinner-style')) {
      const style = document.createElement('style');
      style.id = 'xhr-spinner-style';
      style.textContent = `
        @keyframes xhrSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .xhr-fallback-spinner {
          width: 72px;
          height: 72px;
          border: 10px solid rgba(128,128,128,0.3);
          border-top-color: rgba(128,128,128,0.9);
          border-radius: 50%;
          animation: xhrSpin 0.9s linear infinite;
        }
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = id;

    // Theme-aware colors
    const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
    const bg = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
    const fg = isDark ? '#ffffff' : '#222222';

    // Fixed overlay to cover viewport regardless of container readiness
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.background = bg;
    overlay.style.zIndex = '2147483647'; // Max overlay priority
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.gap = '24px';
    overlay.style.textAlign = 'center';
    overlay.style.color = fg;
    overlay.style.padding = '24px';
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('role', 'status');

    // Icons: spinner + hourglass (FA v4 compatible: hourglass-o)
    const spinner = document.createElement('i');
    spinner.className = 'fa fa-spinner fa-spin';
    spinner.style.fontSize = '84px';

    const hourglass = document.createElement('i');
    hourglass.className = 'fa fa-hourglass-o';
    hourglass.style.fontSize = '64px';

    // Fallback CSS spinner (used if FA not present yet)
    const cssSpinner = document.createElement('div');
    cssSpinner.className = 'xhr-fallback-spinner';

    const label = document.createElement('div');
    label.textContent = text;
    label.style.fontSize = '32px';
    label.style.fontWeight = '700';

    // Always include both FA icons and CSS fallback; whichever is styled will be visible
    overlay.appendChild(spinner);
    overlay.appendChild(hourglass);
    overlay.appendChild(cssSpinner);
    overlay.appendChild(label);

    container.appendChild(overlay);
  } catch (_) {
    // ignore errors
  }
}

/**
 * Hide the loading spinner previously created by showLoadingIndicator.
 * @param {string} [targetId] The same target id used when showing the spinner.
 * @returns {void}
 */
export function hideLoadingIndicator(targetId) {
  try {
    // Do not hide overlay if global network activity is still ongoing
    if (typeof enableGlobalNetworkSpinner !== 'undefined' && enableGlobalNetworkSpinner._activeCount > 0) {
      return;
    }
    const id = `xhr-loader-${targetId || 'global'}`;
    const el = document.getElementById(id);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  } catch (_) {
    // ignore errors
  }
}


// --- Global network activity spinner ---

/**
 * Enable a global network activity spinner for all fetch() and XMLHttpRequest calls.
 * Idempotent: safe to call multiple times.
 * Requires Font Awesome CSS (loaded by icon.js).
 * @param {string} [targetId] Element id to host the spinner (defaults to document.body when omitted).
 * @param {string} [label='Loading...'] Optional label text.
 * @returns {void}
 */
export function enableGlobalNetworkSpinner(targetId, label = 'Loading...', onIdle) {
  if (enableGlobalNetworkSpinner._installed) {
    // allow updating target and callback if called again
    enableGlobalNetworkSpinner._targetId = targetId;
    enableGlobalNetworkSpinner._label = label;
    enableGlobalNetworkSpinner._onIdle = onIdle;
    return;
  }
  enableGlobalNetworkSpinner._installed = true;
  enableGlobalNetworkSpinner._targetId = targetId;
  enableGlobalNetworkSpinner._label = label;
  enableGlobalNetworkSpinner._onIdle = onIdle;

  let active = 0;
  let hideTimer = null;
  const updateActive = () => {
    enableGlobalNetworkSpinner._activeCount = active;
  };
  const inc = () => {
    active++;
    updateActive();
    if (active === 1) {
      showLoadingIndicator(enableGlobalNetworkSpinner._targetId, enableGlobalNetworkSpinner._label);
    }
  };
  const scheduleHide = () => {
    if (hideTimer) {
      try { clearTimeout(hideTimer); } catch (_) {}
    }
    hideTimer = setTimeout(() => {
      if (active === 0) {
        hideLoadingIndicator(enableGlobalNetworkSpinner._targetId);
        try {
          if (typeof enableGlobalNetworkSpinner._onIdle === 'function') {
            enableGlobalNetworkSpinner._onIdle();
          }
        } catch (_) {}
      }
      hideTimer = null;
    }, 150);
  };
  const dec = () => {
    active = Math.max(0, active - 1);
    updateActive();
    if (active === 0) {
      scheduleHide();
    }
  };

  // Patch window.fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = (...args) => {
      inc();
      const p = origFetch(...args);
      if (p && typeof p.finally === 'function') {
        return p.finally(() => dec());
      }
      return p.then(
        (res) => {
          dec();
          return res;
        },
        (err) => {
          dec();
          throw err;
        }
      );
    };
  }

  // Patch Response body methods to keep spinner active until content is fully consumed
  const RespProto = window.Response && window.Response.prototype;
  if (RespProto && !RespProto.__spinner_patched) {
    RespProto.__spinner_patched = true;
    ['json','text','arrayBuffer','blob','formData'].forEach((method) => {
      const orig = RespProto[method];
      if (typeof orig === 'function') {
        RespProto[method] = function(...args) {
          inc();
          try {
            const p = orig.apply(this, args);
            if (p && typeof p.finally === 'function') {
              return p.finally(() => dec());
            }
            return p.then(
              (v) => { dec(); return v; },
              (e) => { dec(); throw e; }
            );
          } catch (e) {
            dec();
            throw e;
          }
        };
      }
    });
  }

  // Patch XMLHttpRequest
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const proto = window.XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;

    proto.open = function(...args) {
      try {
        this.__xhrSpinnerAttached = false;
      } catch (_) {}
      return origOpen.apply(this, args);
    };

    proto.send = function(...args) {
      try {
        if (!this.__xhrSpinnerAttached) {
          this.__xhrSpinnerAttached = true;
          inc();
          const done = () => {
            try {
              this.removeEventListener('loadend', done);
              this.removeEventListener('error', done);
              this.removeEventListener('abort', done);
            } catch (_) {}
            dec();
          };
          this.addEventListener('loadend', done, { once: true });
          this.addEventListener('error', done, { once: true });
          this.addEventListener('abort', done, { once: true });
        }
      } catch (_) {}
      return origSend.apply(this, args);
    };
  }
}
