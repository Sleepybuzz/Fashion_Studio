import { FAILED_RETENTION_HOURS } from './tryon.constants.js';

/**
 * MySQL access for tryon_sessions. Every query is parameterized.
 * All timestamps are supplied by the application (JS Date) so the whole feature uses a single clock.
 * @param {{pool: any, withTransaction: Function}} db
 */
export function createTryOnRepo({ pool, withTransaction }) {
  const ACTIVE_SQL = "('validating','processing')";
  const one = async (sql, params) => (await pool.query(sql, params))[0][0] || null;

  return {
    getById: (id) => one('SELECT * FROM tryon_sessions WHERE id = ?', [id]),

    /** Ownership is part of the query: another customer's id behaves exactly like a missing row. */
    getOwned: (publicId, userId) => one('SELECT * FROM tryon_sessions WHERE public_id = ? AND user_id = ?', [publicId, userId]),

    findActiveForUser: (userId) =>
      one(`SELECT * FROM tryon_sessions WHERE user_id = ? AND status IN ${ACTIVE_SQL} ORDER BY id DESC LIMIT 1`, [userId]),

    async listForUser(userId, { limit, offset }) {
      const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM tryon_sessions WHERE user_id = ?', [userId]);
      const [rows] = await pool.query(
        'SELECT * FROM tryon_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
        [userId, limit, offset],
      );
      return { rows, total: Number(total) };
    },

    async listAllForUser(userId) {
      return (await pool.query('SELECT * FROM tryon_sessions WHERE user_id = ?', [userId]))[0];
    },

    /**
     * Insert a new session unless the customer already has an active one. The user row is locked inside the
     * transaction, so two simultaneous requests cannot both pass the check (duplicate paid request protection).
     * @returns {Promise<{conflict:true}|{id:number}>}
     */
    insertExclusive: (r) => withTransaction(async (conn) => {
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [r.userId]);
      const [active] = await conn.query(`SELECT id FROM tryon_sessions WHERE user_id = ? AND status IN ${ACTIVE_SQL} LIMIT 1`, [r.userId]);
      if (active.length) return { conflict: true };
      const [res] = await conn.query(
        `INSERT INTO tryon_sessions
           (public_id, user_id, product_id, customization_version_id, product_name, product_slug, status, provider, attempts,
            photo_key, photo_mime, photo_size, photo_width, photo_height,
            consent_version, consent_provider, consented_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'validating', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.publicId, r.userId, r.productId, r.customizationVersionId ?? null, r.productName, r.productSlug, r.provider,
          r.photoKey, r.photoMime, r.photoSize, r.photoWidth, r.photoHeight,
          r.consentVersion, r.consentProvider, r.consentedAt, r.now, r.now],
      );
      return { id: res.insertId };
    }),

    /** failed -> validating for a manual retry, again exclusive per customer. */
    resetForRetryExclusive: ({ id, userId, now }) => withTransaction(async (conn) => {
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      const [active] = await conn.query(`SELECT id FROM tryon_sessions WHERE user_id = ? AND status IN ${ACTIVE_SQL} LIMIT 1`, [userId]);
      if (active.length) return { conflict: true };
      const [res] = await conn.query(
        `UPDATE tryon_sessions SET status = 'validating', attempts = attempts + 1, error_code = NULL, provider_error_code = NULL,
           provider_job_id = NULL, is_test = 0, submitted_at = NULL, last_polled_at = NULL, expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'failed'`,
        [now, id],
      );
      return res.affectedRows ? { ok: true } : { conflict: true };
    }),

    async markProcessing({ id, jobId, isTest, now }) {
      const [res] = await pool.query(
        `UPDATE tryon_sessions SET status = 'processing', provider_job_id = ?, is_test = ?, submitted_at = ?, updated_at = ?
         WHERE id = ? AND status = 'validating'`,
        [jobId, isTest ? 1 : 0, now, now, id],
      );
      return res.affectedRows > 0;
    },

    async markFailed({ id, errorCode, providerErrorCode, expiresAt, now }) {
      const [res] = await pool.query(
        `UPDATE tryon_sessions SET status = 'failed', error_code = ?, provider_error_code = ?, expires_at = ?, updated_at = ?
         WHERE id = ? AND status IN ${ACTIVE_SQL}`,
        [errorCode, providerErrorCode, expiresAt, now, id],
      );
      return res.affectedRows > 0;
    },

    async markCompleted({ id, resultKey, resultMime, resultSize, expiresAt, now }) {
      const [res] = await pool.query(
        `UPDATE tryon_sessions SET status = 'completed', result_key = ?, result_mime = ?, result_size = ?,
           error_code = NULL, provider_error_code = NULL, expires_at = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'processing'`,
        [resultKey, resultMime, resultSize, expiresAt, now, now, id],
      );
      return res.affectedRows > 0;
    },

    touchPolled: (id, now) => pool.query('UPDATE tryon_sessions SET last_polled_at = ? WHERE id = ?', [now, id]),

    async setSaved({ id, savedAt, expiresAt, now }) {
      await pool.query(
        "UPDATE tryon_sessions SET saved_at = ?, expires_at = ?, updated_at = ? WHERE id = ? AND status = 'completed'",
        [savedAt, expiresAt, now, id],
      );
    },

    async deleteById(id) {
      await pool.query('DELETE FROM tryon_sessions WHERE id = ?', [id]);
    },

    /** Count sessions created since a moment (optionally for one customer): the basis of the daily limits. */
    async countCreatedSince({ since, userId }) {
      const [[row]] = userId
        ? await pool.query('SELECT COUNT(*) AS n FROM tryon_sessions WHERE created_at >= ? AND user_id = ?', [since, userId])
        : await pool.query('SELECT COUNT(*) AS n FROM tryon_sessions WHERE created_at >= ?', [since]);
      return Number(row.n);
    },

    /** Mark sessions that never finished as failed so they cannot block the customer forever. */
    async failStale({ cutoff, now, userId }) {
      const expiresAt = new Date(now.getTime() + FAILED_RETENTION_HOURS * 3600 * 1000);
      const base = `UPDATE tryon_sessions SET status = 'failed', error_code = 'TIMEOUT', provider_error_code = 'LOCAL_TIMEOUT',
        expires_at = ?, updated_at = ? WHERE status IN ${ACTIVE_SQL} AND COALESCE(submitted_at, created_at) < ?`;
      const [res] = userId
        ? await pool.query(`${base} AND user_id = ?`, [expiresAt, now, cutoff, userId])
        : await pool.query(base, [expiresAt, now, cutoff]);
      return res.affectedRows;
    },

    async listExpired(now, limit = 100) {
      return (await pool.query(
        'SELECT * FROM tryon_sessions WHERE expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at ASC LIMIT ?',
        [now, limit],
      ))[0];
    },

    /** Aggregates only: no photos, names or emails. */
    async overview({ since }) {
      const [byStatus] = await pool.query('SELECT status, COUNT(*) AS n FROM tryon_sessions WHERE created_at >= ? GROUP BY status', [since]);
      const [failures] = await pool.query(
        `SELECT error_code, provider_error_code, COUNT(*) AS n FROM tryon_sessions
         WHERE status = 'failed' AND created_at >= ? GROUP BY error_code, provider_error_code ORDER BY n DESC LIMIT 8`,
        [since],
      );
      const [[test]] = await pool.query('SELECT COUNT(*) AS n FROM tryon_sessions WHERE is_test = 1 AND created_at >= ?', [since]);
      const counts = { validating: 0, processing: 0, completed: 0, failed: 0 };
      for (const r of byStatus) counts[r.status] = Number(r.n);
      return {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        byStatus: counts,
        testSessions: Number(test.n),
        topFailures: failures.map((f) => ({ errorCode: f.error_code, providerErrorCode: f.provider_error_code, count: Number(f.n) })),
      };
    },
  };
}
