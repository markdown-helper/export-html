/**
 * Detect whether a Font Awesome stylesheet is active on the page.
 *
 * Strategy:
 * 1) Prefer document.fonts.check against known FA font-family names (v4, v5, v6).
 * 2) Fallback: create a fully hidden element with common FA classes (fa/fas/far/fab)
 *    and inspect computed font-family for FA signatures.
 *
 * Notes:
 * - Does not rely on specific link IDs; detection works even if FA was loaded elsewhere.
 * - The fallback element is positioned off-screen, zero-sized, non-interactive, and aria-hidden
 *   to avoid any visible/layout/a11y impact.
 *
 * @returns {boolean} True if Font Awesome appears to be loaded; false otherwise.
 */
export function isFontAwesomeLoaded() {
  const families = [
    'FontAwesome',           // v4
    'Font Awesome 5 Free',   // v5 Free
    'Font Awesome 5 Brands', // v5 Brands
    'Font Awesome 6 Free',   // v6 Free
    'Font Awesome 6 Brands', // v6 Brands
  ];

  // 1) Prefer modern FontFaceSet when available
  try {
    if (document.fonts && typeof document.fonts.check === 'function') {
      for (const fam of families) {
        if (document.fonts.check(`1em "${fam}"`)) {
          return true;
        }
      }
    }
  } catch (_) {
    // Ignore any errors from fonts.check in older browsers
  }

  // 2) Fallback: test multiple FA classes to improve detection reliability across FA versions
  const classesToTest = ['fa', 'fas', 'far', 'fab']; // v4/v5/v6 variants
  const parent = document.body || document.documentElement;

  for (const cls of classesToTest) {
    const el = document.createElement('i');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.top = '-9999px';
    el.style.left = '-9999px';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.width = '0';
    el.style.height = '0';
    el.style.lineHeight = '0';
    parent.appendChild(el);

    const fontFamily = (window.getComputedStyle(el).fontFamily || '').toLowerCase();
    parent.removeChild(el);

    if (families.some((fam) => fontFamily.includes(fam.toLowerCase()))) {
      return true;
    }
  }

  return false;
}
