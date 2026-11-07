/** Plan text becomes text content only. Never a tag, attribute, URL, or script. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Derived element ids (scene + layer + word index) can exceed a layer id; the character set is what keeps them safe.
const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe id: ${id}`);
  return id;
}
