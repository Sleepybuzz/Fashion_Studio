/**
 * MySQL access for the AI customization tables. Every query is parameterized. All timestamps are supplied by the
 * application (JS Date) so the whole feature uses one clock. Ownership is part of the query wherever a customer
 * reaches a record: another customer's id behaves exactly like a missing row.
 * @param {{pool:any, withTransaction:Function}} db
 */
export function createAiRepo({ pool, withTransaction }) {
  const one = async (sql, params) => (await pool.query(sql, params))[0][0] || null;
  const json = (v) => (v == null ? null : JSON.stringify(v));

  return {
    // ------------------------------------------------------------ sessions
    getSessionById: (id) => one('SELECT * FROM ai_customization_sessions WHERE id = ?', [id]),
    getSessionOwned: (publicId, userId) => one('SELECT * FROM ai_customization_sessions WHERE public_id = ? AND user_id = ?', [publicId, userId]),

    findLatestForProduct: (userId, productId) => one(
      "SELECT * FROM ai_customization_sessions WHERE user_id = ? AND session_type = 'product' AND product_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC LIMIT 1",
      [userId, productId],
    ),

    async listSessionsForUser(userId, { limit = 50 } = {}) {
      return (await pool.query(
        `SELECT s.*,
           (SELECT COUNT(*) FROM ai_customization_versions v WHERE v.session_id = s.id AND v.status = 'completed') AS version_count,
           (SELECT COUNT(*) FROM ai_saved_customizations c WHERE c.session_id = s.id) AS saved_count
         FROM ai_customization_sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC, s.id DESC LIMIT ?`,
        [userId, limit],
      ))[0];
    },

    /**
     * Insert a session unless the customer is at the session cap. The user row is locked so two simultaneous
     * requests cannot both pass the check.
     * @returns {Promise<{limit:true}|{id:number}>}
     */
    insertSessionLimited: (r, maxSessions) => withTransaction(async (conn) => {
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [r.userId]);
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM ai_customization_sessions WHERE user_id = ?', [r.userId]);
      if (Number(n) >= maxSessions) return { limit: true };
      const [res] = await conn.query(
        `INSERT INTO ai_customization_sessions
           (public_id, user_id, session_type, product_id, product_name, product_slug, title, visible_view, status,
            original_key, original_mime, original_size, original_width, original_height, original_sha256,
            consent_version, consent_chat_provider, consent_image_provider, consented_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.publicId, r.userId, r.type, r.productId, r.productName, r.productSlug, r.title, r.visibleView,
          r.originalKey, r.originalMime, r.originalSize, r.originalWidth, r.originalHeight, r.originalSha256,
          r.consentVersion, r.chatProvider, r.imageProvider, r.now, r.expiresAt, r.now, r.now],
      );
      return { id: res.insertId };
    }),

    async setCurrentVersion({ sessionId, versionId, expiresAt, now }) {
      await pool.query('UPDATE ai_customization_sessions SET current_version_id = ?, expires_at = ?, updated_at = ? WHERE id = ?', [versionId, expiresAt, now, sessionId]);
    },
    async touchSession({ sessionId, expiresAt, now }) {
      await pool.query('UPDATE ai_customization_sessions SET expires_at = ?, updated_at = ? WHERE id = ?', [expiresAt, now, sessionId]);
    },
    async deleteSession(id) { await pool.query('DELETE FROM ai_customization_sessions WHERE id = ?', [id]); },

    /** Sessions past expires_at that have no saved design (saved ones are kept until their own expiry). */
    async listExpiredSessions(now, limit = 50) {
      return (await pool.query(
        'SELECT * FROM ai_customization_sessions WHERE expires_at < ? ORDER BY expires_at ASC LIMIT ?',
        [now, limit],
      ))[0];
    },
    async countSessionsForUser(userId) {
      return Number((await one('SELECT COUNT(*) AS n FROM ai_customization_sessions WHERE user_id = ?', [userId])).n);
    },
    async listAllSessionsForUser(userId) {
      return (await pool.query('SELECT * FROM ai_customization_sessions WHERE user_id = ?', [userId]))[0];
    },

    // ------------------------------------------------------------ messages
    async listMessages(sessionId, limit = 200) {
      return (await pool.query('SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT ?', [sessionId, limit]))[0];
    },
    findMessageByRequest: (sessionId, requestId) => one('SELECT * FROM ai_chat_messages WHERE session_id = ? AND client_request_id = ?', [sessionId, requestId]),
    getMessage: (id) => one('SELECT * FROM ai_chat_messages WHERE id = ?', [id]),

    /** @returns {Promise<{id:number}|{duplicate:true}>} a repeated client_request_id is reported, not inserted twice */
    async insertMessage({ sessionId, sender, message, structured = null, status = 'completed', errorCode = null, versionId = null, requestId = null, now }) {
      try {
        const [res] = await pool.query(
          `INSERT INTO ai_chat_messages (session_id, sender_type, message, structured_instruction, status, error_code, version_id, client_request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [sessionId, sender, message, json(structured), status, errorCode, versionId, requestId, now],
        );
        return { id: res.insertId };
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return { duplicate: true };
        throw err;
      }
    },
    /** A failed generation marks the assistant message that announced it as failed (so the chat shows the error). */
    async failMessagesForVersion(versionId, errorCode) {
      await pool.query("UPDATE ai_chat_messages SET status = 'failed', error_code = ? WHERE version_id = ? AND sender_type = 'assistant'", [errorCode, versionId]);
    },
    async updateMessage(id, { message, structured, status, errorCode, versionId }) {
      const sets = [];
      const params = [];
      if (message !== undefined) { sets.push('message = ?'); params.push(message); }
      if (structured !== undefined) { sets.push('structured_instruction = ?'); params.push(json(structured)); }
      if (status !== undefined) { sets.push('status = ?'); params.push(status); }
      if (errorCode !== undefined) { sets.push('error_code = ?'); params.push(errorCode); }
      if (versionId !== undefined) { sets.push('version_id = ?'); params.push(versionId); }
      if (!sets.length) return;
      await pool.query(`UPDATE ai_chat_messages SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    },

    // ------------------------------------------------------------ versions
    getVersionById: (id) => one('SELECT * FROM ai_customization_versions WHERE id = ?', [id]),
    getVersionInSession: (sessionId, publicId) => one('SELECT * FROM ai_customization_versions WHERE session_id = ? AND public_id = ?', [sessionId, publicId]),
    async listVersions(sessionId) {
      return (await pool.query('SELECT * FROM ai_customization_versions WHERE session_id = ? ORDER BY version_number ASC', [sessionId]))[0];
    },
    async hasChildren(versionId) {
      return !!(await one('SELECT id FROM ai_customization_versions WHERE parent_version_id = ? LIMIT 1', [versionId]));
    },
    async hasProcessingInSession(sessionId) {
      return !!(await one("SELECT id FROM ai_customization_versions WHERE session_id = ? AND status = 'processing' LIMIT 1", [sessionId]));
    },
    async findProcessingForUser(userId) {
      return one(
        `SELECT v.* FROM ai_customization_versions v JOIN ai_customization_sessions s ON s.id = v.session_id
         WHERE s.user_id = ? AND v.status = 'processing' AND v.image_requested = 1 ORDER BY v.id DESC LIMIT 1`,
        [userId],
      );
    },

    /**
     * Insert a new version. For an image generation (`exclusive`) the user row is locked and the insert is refused while
     * the customer already has a generation running: the basis of duplicate / repeated paid request protection.
     * @returns {Promise<{conflict:true}|{limit:true}|{id:number, versionNumber:number}>}
     */
    insertVersion: (r, { exclusive, maxVersions }) => withTransaction(async (conn) => {
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [r.userId]);
      if (exclusive) {
        const [busy] = await conn.query(
          `SELECT v.id FROM ai_customization_versions v JOIN ai_customization_sessions s ON s.id = v.session_id
           WHERE s.user_id = ? AND v.status = 'processing' AND v.image_requested = 1 LIMIT 1`,
          [r.userId],
        );
        if (busy.length) return { conflict: true };
      }
      const [[{ n, maxNo }]] = await conn.query('SELECT COUNT(*) AS n, COALESCE(MAX(version_number), 0) AS maxNo FROM ai_customization_versions WHERE session_id = ?', [r.sessionId]);
      if (Number(n) >= maxVersions) return { limit: true };
      const versionNumber = Number(maxNo) + 1;
      const [res] = await conn.query(
        `INSERT INTO ai_customization_versions
           (public_id, session_id, parent_version_id, version_number, status, image_requested, edit_instruction, structured_changes, config_3d, provider, model, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.publicId, r.sessionId, r.parentVersionId, versionNumber, r.status, r.imageRequested ? 1 : 0, r.instruction, json(r.structuredChanges), json(r.config3d),
          r.provider, r.model, r.now, r.status === 'completed' ? r.now : null],
      );
      return { id: res.insertId, versionNumber };
    }),

    /** processing -> completed. Returns false when another request already finished or failed it. */
    async markVersionCompleted({ id, output, provider, model, metadata, now }) {
      const [res] = await pool.query(
        `UPDATE ai_customization_versions SET status = 'completed', output_key = ?, output_mime = ?, output_size = ?, output_width = ?, output_height = ?,
           output_sha256 = ?, provider = ?, model = ?, provider_metadata = ?, error_code = NULL, provider_error_code = NULL, completed_at = ?
         WHERE id = ? AND status = 'processing'`,
        [output.key, output.mime, output.size, output.width, output.height, output.sha256, provider, model, json(metadata), now, id],
      );
      return res.affectedRows > 0;
    },
    async markVersionFailed({ id, errorCode, providerErrorCode, now }) {
      const [res] = await pool.query(
        "UPDATE ai_customization_versions SET status = 'failed', error_code = ?, provider_error_code = ?, completed_at = ? WHERE id = ? AND status = 'processing'",
        [errorCode, providerErrorCode || null, now, id],
      );
      return res.affectedRows > 0;
    },
    async deleteVersion(id) { await pool.query('DELETE FROM ai_customization_versions WHERE id = ?', [id]); },

    /** Mark generations that never finished as failed so they cannot block the customer forever. Returns affected rows. */
    async failStale({ cutoff, now, userId }) {
      const base = `UPDATE ai_customization_versions v JOIN ai_customization_sessions s ON s.id = v.session_id
        SET v.status = 'failed', v.error_code = 'TIMEOUT', v.provider_error_code = 'LOCAL_TIMEOUT', v.completed_at = ?
        WHERE v.status = 'processing' AND v.created_at < ?`;
      const [res] = userId ? await pool.query(`${base} AND s.user_id = ?`, [now, cutoff, userId]) : await pool.query(base, [now, cutoff]);
      return res.affectedRows;
    },

    /** Generation attempts since a moment (optionally one customer): the basis of the hourly / daily cost limits. */
    async countImageRequestsSince({ since, userId }) {
      const [[row]] = userId
        ? await pool.query(
          `SELECT COUNT(*) AS n FROM ai_customization_versions v JOIN ai_customization_sessions s ON s.id = v.session_id
           WHERE v.image_requested = 1 AND v.created_at >= ? AND s.user_id = ?`, [since, userId])
        : await pool.query('SELECT COUNT(*) AS n FROM ai_customization_versions WHERE image_requested = 1 AND created_at >= ?', [since]);
      return Number(row.n);
    },

    /** Storage keys of every image of a session (call BEFORE deleting it; rows cascade away). */
    async collectKeys(sessionId) {
      const [rows] = await pool.query('SELECT output_key FROM ai_customization_versions WHERE session_id = ? AND output_key IS NOT NULL', [sessionId]);
      return rows.map((r) => r.output_key);
    },

    // ------------------------------------------------------------ saved designs
    async insertSaved({ publicId, userId, sessionId, versionId, designId, title, now }) {
      const [res] = await pool.query(
        'INSERT INTO ai_saved_customizations (public_id, user_id, session_id, version_id, design_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [publicId, userId, sessionId, versionId, designId, title, now],
      );
      return res.insertId;
    },
    async countSavedForUser(userId) {
      return Number((await one('SELECT COUNT(*) AS n FROM ai_saved_customizations WHERE user_id = ?', [userId])).n);
    },
    getSavedByVersion: (versionId) => one('SELECT * FROM ai_saved_customizations WHERE version_id = ?', [versionId]),
    getSavedOwned: (publicId, userId) => one('SELECT * FROM ai_saved_customizations WHERE public_id = ? AND user_id = ?', [publicId, userId]),
    async countSavedInSession(sessionId) {
      return Number((await one('SELECT COUNT(*) AS n FROM ai_saved_customizations WHERE session_id = ?', [sessionId])).n);
    },
    async listSavedForSession(sessionId) {
      return (await pool.query('SELECT * FROM ai_saved_customizations WHERE session_id = ?', [sessionId]))[0];
    },
    async listSavedForUser(userId) {
      return (await pool.query(
        `SELECT c.*, s.public_id AS session_public_id, s.session_type, s.product_slug, s.product_name,
           v.public_id AS version_public_id, v.version_number, v.output_key IS NOT NULL AS has_image, v.config_3d
         FROM ai_saved_customizations c
         JOIN ai_customization_sessions s ON s.id = c.session_id
         JOIN ai_customization_versions v ON v.id = c.version_id
         WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 100`,
        [userId],
      ))[0];
    },
    async deleteSaved(id) { await pool.query('DELETE FROM ai_saved_customizations WHERE id = ?', [id]); },

    // ------------------------------------------------------------ try-on bridge
    /** A completed version that has an image, only if it belongs to the customer. */
    getVersionForTryOn: (versionPublicId, userId) => one(
      `SELECT v.*, s.title AS session_title, s.user_id AS owner_id, s.public_id AS session_public_id
       FROM ai_customization_versions v JOIN ai_customization_sessions s ON s.id = v.session_id
       WHERE v.public_id = ? AND s.user_id = ?`,
      [versionPublicId, userId],
    ),
    getVersionForTryOnById: (id) => one(
      `SELECT v.*, s.title AS session_title, s.user_id AS owner_id, s.public_id AS session_public_id
       FROM ai_customization_versions v JOIN ai_customization_sessions s ON s.id = v.session_id WHERE v.id = ?`,
      [id],
    ),

    /** Signed-file lookup: version output or session original, only for the owner. */
    getVersionFile: (publicId, userId) => one(
      `SELECT v.output_key AS \`key\`, v.output_mime AS mime FROM ai_customization_versions v
       JOIN ai_customization_sessions s ON s.id = v.session_id WHERE v.public_id = ? AND s.user_id = ? AND v.output_key IS NOT NULL`,
      [publicId, userId],
    ),
    getOriginalFile: (publicId, userId) => one(
      'SELECT original_key AS `key`, original_mime AS mime FROM ai_customization_sessions WHERE public_id = ? AND user_id = ?',
      [publicId, userId],
    ),

    /** Aggregates only: no images, messages, names or emails. */
    async overview({ since }) {
      const [byStatus] = await pool.query('SELECT status, COUNT(*) AS n FROM ai_customization_versions WHERE image_requested = 1 AND created_at >= ? GROUP BY status', [since]);
      const [failures] = await pool.query(
        `SELECT error_code, provider_error_code, COUNT(*) AS n FROM ai_customization_versions
         WHERE status = 'failed' AND created_at >= ? GROUP BY error_code, provider_error_code ORDER BY n DESC LIMIT 8`, [since]);
      const [[s]] = await pool.query('SELECT COUNT(*) AS n FROM ai_customization_sessions WHERE created_at >= ?', [since]);
      const counts = { processing: 0, completed: 0, failed: 0 };
      for (const r of byStatus) counts[r.status] = Number(r.n);
      return {
        sessions: Number(s.n),
        imageEdits: { total: counts.processing + counts.completed + counts.failed, ...counts },
        topFailures: failures.map((f) => ({ errorCode: f.error_code, providerErrorCode: f.provider_error_code, count: Number(f.n) })),
      };
    },
  };
}
