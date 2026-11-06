/**
 * Unified try-on eligibility: which try-on methods are GENUINELY available for a design, and why the others are not.
 * Pure function (no I/O) so the rules are easy to test. An ordinary product photograph is not a 3D asset, and a
 * generated image is not a 3D model, so only a store product with a real 3D asset can offer 3D Studio and AR.
 *
 * @param {object} p
 * @param {'product'|'upload'} p.sessionType
 * @param {{slug:string, has3d:boolean, arEligible:boolean, tryOnEligible:boolean}|null} p.product  live product flags (product sessions)
 * @param {{publicId:string, hasImage:boolean, width:number|null, height:number|null, savedDesignId:number|null}|null} p.version  the design being tried
 * @param {boolean} p.tryonProviderReady
 * @param {number} p.minGarmentSide  smallest side the try-on flow accepts for a garment image
 * @returns {{id:'ai_photo'|'studio_3d'|'ar', label:string, available:boolean, reason:string|null, path:string|null, note?:string}[]}
 */
export function computeTryOnMethods({ sessionType, product, version, tryonProviderReady, minGarmentSide }) {
  const methods = [];
  const hasImage = !!version?.hasImage;

  // ---- AI Photo Try-On (Genlook or whichever try-on provider is configured)
  const ai = { id: 'ai_photo', label: 'AI Photo Try-On', available: false, reason: null, path: null };
  if (!tryonProviderReady) {
    ai.reason = 'AI Photo Try-On is not available right now.';
  } else if (hasImage) {
    const side = Math.min(version.width || 0, version.height || 0);
    if (side < minGarmentSide) ai.reason = `The generated image is too small for AI Photo Try-On (the shorter side must be at least ${minGarmentSide}px).`;
    else {
      ai.available = true;
      ai.path = `/try-on/custom/${version.publicId}`;
      ai.note = 'Uses your generated garment image. The try-on service decides whether it accepts the image; if it does not, you will be told why.';
    }
  } else if (sessionType === 'product' && product?.tryOnEligible) {
    ai.available = true;
    ai.path = `/try-on/${product.slug}`;
    ai.note = 'Uses the store\'s garment photos for this product. Generate an image edit first to try on your customized design instead.';
  } else if (sessionType === 'product') {
    ai.reason = 'Generate an image edit first. The store has not enabled AI Photo Try-On with its own garment photos for this product.';
  } else {
    ai.reason = 'Make at least one successful image edit first. Then AI Photo Try-On can use the edited garment image.';
  }
  methods.push(ai);

  // ---- 3D Studio and Real-Time AR: only a store product with a compatible 3D asset
  const notStore = 'Uploaded and AI-generated garment images are not 3D models, so this is not available.';
  const studio = { id: 'studio_3d', label: '3D Studio', available: false, reason: null, path: null };
  const ar = { id: 'ar', label: 'Real-Time AR Try-On', available: false, reason: null, path: null };
  if (sessionType !== 'product' || !product) {
    studio.reason = notStore;
    ar.reason = notStore;
  } else {
    if (product.has3d) {
      studio.available = true;
      studio.path = `/studio/${product.slug}${version?.savedDesignId ? `?design=${version.savedDesignId}` : ''}`;
    } else {
      studio.reason = 'This product has no compatible 3D model. A product photo is not a 3D asset.';
    }
    if (!product.has3d) ar.reason = 'Real-Time AR here needs a compatible 3D model, and this product has none.';
    else if (!product.arEligible) ar.reason = 'The store has not enabled Real-Time AR for this product.';
    else { ar.available = true; ar.path = `/ar-try-on/${product.slug}`; }
  }
  methods.push(studio, ar);
  return methods;
}
