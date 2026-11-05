/**
 * Retention enforcement. Safe to run repeatedly (from the server timer, the CLI script or a scheduler).
 * - sessions that never finished are marked failed (so they cannot block a customer),
 * - sessions past `expires_at` (unsaved results, saved results, failed attempts) are deleted with their files.
 * @param {{repo:any, storage:any, config:any, logger?:Console, now?:()=>number}} deps
 */
export function createTryOnMaintenance({ repo, storage, config, logger = console, now = Date.now }) {
  return {
    async run() {
      const failedStale = await repo.failStale({ cutoff: new Date(now() - config.limits.processingTimeoutMs), now: new Date(now()) });
      let deleted = 0;
      for (;;) {
        const batch = await repo.listExpired(new Date(now()), 100);
        if (!batch.length) break;
        for (const row of batch) {
          await repo.deleteById(row.id);
          try {
            await storage.remove('photos', row.photo_key);
            if (row.result_key) await storage.remove('results', row.result_key);
          } catch (err) {
            logger.warn?.(`[tryon] could not remove files of session ${row.public_id}: ${err.message}`);
          }
          deleted += 1;
        }
        if (batch.length < 100) break;
      }
      return { failedStale, deleted };
    },
  };
}
