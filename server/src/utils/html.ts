/**
 * HTML escaping for values interpolated into email templates.
 *
 * Content is stored as the user typed it and escaped at the point of output,
 * so the same value stays correct in JSON responses, in the UI and in email.
 */

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
