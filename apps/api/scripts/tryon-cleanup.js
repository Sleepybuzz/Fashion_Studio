import { pool } from '../src/config/db.js';
import { maintenance } from '../src/modules/tryon/tryon.index.js';

/** One-off retention cleanup: `npm run tryon:cleanup`. Also usable from Windows Task Scheduler. */
try {
  const r = await maintenance.run();
  console.log(`[tryon-cleanup] expired sessions deleted: ${r.deleted}; stale sessions marked failed: ${r.failedStale}`);
} catch (err) {
  console.error('[tryon-cleanup] failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
