/** Convert text to a URL-safe slug. */
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'item';
}

/**
 * Produce a slug unique within a table.
 * @param {{query: Function}} db pool or connection
 * @param {string} table trusted table name (never user input)
 * @param {string} base
 * @param {number|null} excludeId row id to ignore (for updates)
 */
export async function uniqueSlug(db, table, base, excludeId = null) {
  let candidate = slugify(base);
  let n = 1;
  for (;;) {
    const [rows] = await db.query(`SELECT id FROM ${table} WHERE slug = ? AND id <> ? LIMIT 1`, [
      candidate,
      excludeId ?? 0,
    ]);
    if (rows.length === 0) return candidate;
    n += 1;
    candidate = `${slugify(base)}-${n}`;
  }
}
