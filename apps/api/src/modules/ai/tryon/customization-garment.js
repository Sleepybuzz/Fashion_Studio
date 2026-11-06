import crypto from 'node:crypto';

/** Customer-facing explanations for a customized design that cannot be tried on. */
export const CUSTOM_ELIGIBILITY_MESSAGES = Object.freeze({
  not_found: 'This design was not found.',
  no_image: 'This version has no generated garment image yet. Make an image edit first.',
  too_small: 'The generated image is too small for AI Photo Try-On.',
});

/**
 * Bridge between the AI customization tables and the Phase 3 try-on service: it turns a completed customization
 * version (a generated garment image) into the provider-neutral garment the try-on service already understands.
 * @param {{repo:any, storage:any, minSide:number}} deps
 */
export function createCustomizationGarment({ repo, storage, minSide, sign }) {
  const evaluate = (row) => {
    if (!row) return { eligible: false, reason: 'not_found' };
    if (row.status !== 'completed' || !row.output_key) return { eligible: false, reason: 'no_image' };
    if (Math.min(row.output_width || 0, row.output_height || 0) < minSide) return { eligible: false, reason: 'too_small' };
    return { eligible: true, reason: null };
  };
  const describeRow = (row) => ({
    versionId: row.id,
    publicId: row.public_id,
    title: String(row.session_title).slice(0, 200),
    description: `Customer-designed garment: ${String(row.session_title)}${row.edit_instruction ? `. Edit: ${row.edit_instruction}` : ''}`.slice(0, 500),
    storageKey: row.output_key,
    mimeType: row.output_mime,
    sha256: row.output_sha256 || '',
    userId: row.owner_id,
  });

  return {
    buildSpec: buildCustomGarmentSpec,
    /** Signed preview URL of the generated image (for the try-on page). */
    imageUrl: (versionPublicId, userId) => sign('version', versionPublicId, userId),
    /** Eligibility for the customer who owns the version (another customer's id behaves like a missing one). */
    async evaluateOwned(versionPublicId, userId) {
      const row = await repo.getVersionForTryOn(versionPublicId, userId);
      const { eligible, reason } = evaluate(row);
      return { eligible, reason, message: reason ? CUSTOM_ELIGIBILITY_MESSAGES[reason] : null, garment: eligible ? describeRow(row) : null };
    },
    /** Used at submit time (and on retry): the row is looked up by id and must still belong to the same customer. */
    async loadForSubmit(versionId, userId) {
      const row = await repo.getVersionForTryOnById(versionId);
      if (!row || row.owner_id !== userId || !evaluate(row).eligible) return null;
      const g = describeRow(row);
      return { ...g, buffer: await storage.read('versions', row.output_key) };
    },
  };
}

/** Provider-neutral garment description for a customized design. The id embeds a fingerprint of the image. */
export function buildCustomGarmentSpec(g) {
  const fp = crypto.createHash('sha256').update([g.title, g.description, g.sha256].join('|')).digest('hex').slice(0, 12);
  return { externalId: `afs-c${g.versionId}-${fp}`, title: g.title, description: g.description };
}
