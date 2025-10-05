/**
 * Add a CSS <style> tag to document.head exactly once by id.
 *
 * Ensures idempotency: skips insertion if an element with the same id already exists.
 *
 * @param {string} id Unique id for the <style> element.
 * @param {string} css CSS textContent to apply.
 * @returns {void}
 */
export function addStyle(id, css) {
  if (document.getElementById(id)) {
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}