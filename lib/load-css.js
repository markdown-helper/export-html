/**
* Load a CSS stylesheet exactly once.
*
* Behavior and guarantees:
* - Normalizes URL to absolute to dedupe relative vs absolute hrefs.
* - Skips insertion if an element with the same generated id already exists.
* - Skips if any link[rel="stylesheet"][href="normalized url"] exists.
* - Also checks existing link.href property (normalized by the browser).
*
* @param {string} url Stylesheet URL to load.
* @returns {void}
*/
export function loadCSS(url) {
  const absHref = new URL(url, document.baseURI).href;
  const linkId = `css-loader-${absHref.replace(/[^a-zA-Z0-9]/g, '-')}`;

  // Skip if our id already exists
  if (document.getElementById(linkId)) return;

  // Skip if an identical normalized href already exists (selector)
  if (document.querySelector(`link[rel="stylesheet"][href="${absHref}"]`)) return;

  // Skip if any existing link resolves to the same absolute href (property)
  if (Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => l.href === absHref)) return;

  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = absHref;
  document.head.appendChild(link);
}
