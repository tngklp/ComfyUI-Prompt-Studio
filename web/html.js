/**
 * Shared HTML escaping.
 *
 * Extracted so a module that renders markup from data (the character picker, which
 * shows user-searchable names) does not have to reach into `main.js`, and so the
 * escaping rule has exactly one definition.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}
