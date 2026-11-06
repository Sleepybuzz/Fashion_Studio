import crypto from 'node:crypto';
import { AppError, badRequest, conflict, notFound } from '../../../utils/AppError.js';
import { ImageValidationError, validateImage } from '../../tryon/image.inspect.js';
import { PROVIDER_ERROR as E, ProviderError } from '../providers/errors.js';
import { describeAiError } from '../utils/ai-errors.js';
import {
  apply3dOps, buildImageEditPrompt, cleanText, defaultConfig3d, summarizeInstruction, UNSEEN_VIEW_REPLY,
} from '../chat/instruction.js';
import { computeTryOnMethods } from '../tryon/tryon-methods.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const CONSENT_TEMPLATE_VERSION = 'v1';
export const VIEWS = Object.freeze(['front', 'back', 'side', 'flat_lay', 'unknown']);
const OUTPUT_LIMITS = { minSide: 16, maxSide: 20_000, maxPixels: 120_000_000, maxBytes: 15 * 1024 * 1024 };
/** Smallest side the try-on flow accepts for a garment image (same as admin garment photos in Phase 3). */
export const MIN_TRYON_GARMENT_SIDE = 400;

const errorOf = (err) => (err instanceof ProviderError ? err : new ProviderError(E.INTERNAL));
const iso = (d) => (d ? new Date(d).toISOString() : null);
const parseJson = (v) => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; };

/** Consent text, built from the ACTIVE providers so switching a provider changes the wording automatically. */
export function buildConsent(chat, image, { templateVersion, retention }) {
  const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
  return {
    version: `${templateVersion}-${chat.id}-${image.id}`,
    checkboxLabel: `I agree that my chat messages and garment image may be sent to ${chat.operator} and ${image.operator} to create this customization.`,
    points: [
      `Your chat messages and product details are sent to ${chat.label} (${chat.operator}) to understand your requests.`,
      `The garment image you are editing and your edit instructions are sent to ${image.label} (${image.operator}) to generate each new version.`,
      ...chat.disclosure,
      ...image.disclosure,
      `We store the original, every generated version and the chat privately on our servers. Only you can view them. Sessions you do not save are deleted after ${days(retention.unsavedDays)}; sessions with a saved design after ${days(retention.savedDays)}. You can delete a session at any time.`,
      'Results are AI-generated images. They are design concepts: they can contain visual mistakes and do not guarantee fit, colour, fabric or that a real garment can be made. They are not sewing patterns or 3D models.',
      'Only upload garment photos you have the right to use. Do not upload photos of people, especially children.',
    ],
  };
}

/**
 * Orchestration of AI customization: sessions, conversation, versions, saving and the try-on bridge.
 * All I/O is injected, so the logic is testable without MySQL or any provider.
 * The chat provider only PROPOSES; this service decides what is allowed (see chat/instruction.js).
 *
 * @param {object} deps
 */
export function createCustomizationService({
  repo, storage, chat, providers, productSource, config, sign, createDesign, deleteDesign, arService,
  schedule = (fn) => setImmediate(fn), logger = console, now = Date.now, newId = () => crypto.randomUUID(),
}) {
  const at = (ms = now()) => new Date(ms);
  const retention = { unsavedDays: config.unsavedRetentionDays, savedDays: config.savedRetentionDays };
  const imageLimits = { minSide: config.minSide, maxSide: 8000, maxPixels: 40_000_000, maxBytes: config.maxUploadBytes };

  const consentInfo = () => buildConsent(providers.chat.describe(), providers.image.describe(), { templateVersion: CONSENT_TEMPLATE_VERSION, retention });
  const chatReady = () => providers.isReady('chat');
  const imageReady = () => providers.isReady('image');
  const expiryFor = async (sessionId) => at(now() + ((await repo.countSavedInSession(sessionId)) > 0 ? retention.savedDays : retention.unsavedDays) * DAY_MS);

  async function ownedOrThrow(publicId, userId) {
    const row = await repo.getSessionOwned(publicId, userId);
    if (!row) throw notFound('Customization session not found');
    return row;
  }
  const failStale = (userId) => repo.failStale({ cutoff: at(now() - config.editTimeoutMs), now: at(), userId });

  // ------------------------------------------------------------------ views

  /** Walk from a version up through its parents and return the first one that satisfies `pick`. */
  function nearest(byId, startId, pick) {
    let id = startId;
    for (let i = 0; id && i < 500; i += 1) {
      const v = byId.get(id);
      if (!v) return null;
      if (pick(v)) return v;
      id = v.parent_version_id;
    }
    return null;
  }

  async function productContext(session) {
    if (session.session_type !== 'product' || !session.product_id) return null;
    const p = await productSource.get(session.product_id);
    if (!p) return null;
    const bySize = new Map();
    for (const v of p.variants) if (v.size) bySize.set(v.size, (bySize.get(v.size) || false) || v.inStock);
    return {
      id: p.id, name: p.name, slug: p.slug, description: p.description, price: p.price, status: p.status, has3d: p.has3d,
      sizes: [...bySize.entries()].map(([size, inStock]) => ({ size, inStock })),
      sizesInStock: [...bySize.entries()].filter(([, inStock]) => inStock).map(([size]) => size),
    };
  }

  function versionView(v, { session, byId, savedByVersion, headId }) {
    const failed = v.status === 'failed';
    const err = failed ? describeAiError(v.error_code) : null;
    const changes = parseJson(v.structured_changes);
    return {
      id: v.public_id,
      number: v.version_number,
      parentId: v.parent_version_id ? byId.get(v.parent_version_id)?.public_id ?? null : null,
      status: v.status,
      imageRequested: !!v.image_requested,
      instruction: v.edit_instruction,
      changes,
      hasImage: !!v.output_key,
      imageUrl: v.output_key ? sign('version', v.public_id, session.user_id) : null,
      width: v.output_width, height: v.output_height,
      config3d: parseJson(v.config_3d),
      provider: v.provider ? { id: v.provider, model: v.model } : null,
      error: err ? { code: err.code, message: err.message } : null,
      isCurrent: v.id === headId,
      saved: savedByVersion.has(v.id),
      createdAt: iso(v.created_at),
    };
  }

  function messageView(m, { byId }) {
    const failed = m.status === 'failed';
    const err = failed ? (m.error_code === 'LIMIT' || m.error_code === 'BUSY' ? { code: m.error_code, message: m.message } : describeAiError(m.error_code)) : null;
    return {
      id: m.id,
      role: m.sender_type,
      text: m.message,
      status: m.status,
      error: err ? { code: err.code, message: err.message, retryable: !!err.retryable } : null,
      versionId: m.version_id ? byId.get(m.version_id)?.public_id ?? null : null,
      changes: parseJson(m.structured_instruction),
      createdAt: iso(m.created_at),
    };
  }

  async function sessionView(session) {
    const [versionsRaw, messagesRaw, savedRows, product] = await Promise.all([
      repo.listVersions(session.id), repo.listMessages(session.id), repo.listSavedForSession(session.id), productContext(session),
    ]);
    const byId = new Map(versionsRaw.map((v) => [v.id, v]));
    const savedByVersion = new Map(savedRows.map((s) => [s.version_id, s]));
    const headId = session.current_version_id && byId.has(session.current_version_id) ? session.current_version_id : null;
    const head = headId ? byId.get(headId) : null;
    const imgVersion = head ? nearest(byId, head.id, (v) => v.status === 'completed' && !!v.output_key) : null;
    const cfgVersion = head ? nearest(byId, head.id, (v) => v.status === 'completed' && v.config_3d != null) : null;
    const has3d = !!product?.has3d;
    const ctx = { session, byId, savedByVersion, headId };
    const busy = versionsRaw.some((v) => v.status === 'processing');
    return {
      id: session.public_id,
      type: session.session_type,
      title: session.title,
      visibleView: session.visible_view,
      status: session.status,
      product: product && {
        id: product.id, name: product.name, slug: product.slug, price: product.price, available: product.status === 'active',
        has3d, sizes: product.sizes,
      },
      productName: session.product_name,
      originalUrl: sign('original', session.public_id, session.user_id),
      originalWidth: session.original_width,
      originalHeight: session.original_height,
      currentVersionId: head ? head.public_id : null,
      // The image the next edit will build on and that the preview shows (the original until an edit succeeds).
      previewUrl: imgVersion ? sign('version', imgVersion.public_id, session.user_id) : sign('original', session.public_id, session.user_id),
      previewIsOriginal: !imgVersion,
      config3d: has3d ? (parseJson(cfgVersion?.config_3d) || null) : null,
      busy,
      messages: messagesRaw.map((m) => messageView(m, ctx)),
      versions: versionsRaw.map((v) => versionView(v, ctx)),
      providers: {
        chat: { label: providers.chat.describe().label, available: chatReady() },
        image: { label: providers.image.describe().label, available: imageReady() },
      },
      limits: { maxMessageChars: config.maxMessageChars, maxVersions: config.maxVersionsPerSession },
      saved: savedRows.length > 0,
      expiresAt: iso(session.expires_at),
      createdAt: iso(session.created_at),
      updatedAt: iso(session.updated_at),
    };
  }

  // ------------------------------------------------------------------ public config / status

  const providerStatus = () => ({
    chat: { available: chatReady(), label: providers.chat?.describe().label ?? null },
    image: { available: imageReady(), label: providers.image?.describe().label ?? null },
    tryon: { available: providers.isReady('tryon'), label: providers.tryon?.describe().label ?? null },
    customizationAvailable: chatReady() && imageReady(),
  });

  async function getConfig() {
    return {
      ...providerStatus(),
      consent: chatReady() && imageReady() ? consentInfo() : null,
      views: VIEWS,
      uploads: { acceptedTypes: config.uploadTypes, maxMb: Math.round(config.maxUploadBytes / 1024 / 1024), minSide: config.minSide },
      limits: {
        maxMessageChars: config.maxMessageChars, maxSessions: config.maxSessionsPerUser, maxVersions: config.maxVersionsPerSession,
        editsPerHour: config.editUserHourlyLimit, editsPerDay: config.editUserDailyLimit,
      },
      retention,
    };
  }

  // ------------------------------------------------------------------ sessions

  function checkImage(buffer) {
    try {
      const info = validateImage(buffer, imageLimits);
      if (!config.uploadTypes.includes(info.mime)) throw new ImageValidationError('UNSUPPORTED_TYPE', 'This image format is not accepted.');
      return info;
    } catch (err) {
      if (err instanceof ImageValidationError) throw badRequest(err.message, { image: err.message });
      throw err;
    }
  }

  /**
   * Create a session, or (product sessions) resume the customer's existing one for that product.
   * @param {{user:{id:number}, type:'product'|'upload', productId?:number, title?:string, viewHint?:string, consent:boolean, consentVersion:string, image?:{buffer:Buffer}}} input
   * @returns {Promise<{session:object, resumed:boolean}>}
   */
  async function createSession({ user, type, productId, title, viewHint, consent, consentVersion, image }) {
    if (type === 'product') {
      const existing = await repo.findLatestForProduct(user.id, productId);
      if (existing) return { session: await sessionView(existing), resumed: true };
    }
    if (consent !== true) throw badRequest('Please agree to the processing terms to continue.', { consent: 'Consent is required' });
    if (!chatReady() || !imageReady()) throw new AppError(503, 'AI customization is not available right now. Please try again later.');
    const current = consentInfo();
    if (consentVersion !== current.version) {
      throw badRequest('The consent terms have changed. Please reload the page and review them again.', { consent: 'Outdated consent version' });
    }
    const view = VIEWS.includes(viewHint) ? viewHint : (type === 'product' ? 'front' : 'unknown');

    let source;
    let sessionTitle;
    let product = null;
    if (type === 'product') {
      product = await productSource.get(productId);
      if (!product || product.status !== 'active') throw notFound('Product not found');
      if (!product.primaryImage) throw new AppError(422, 'This product has no image to customize yet.');
      source = await productSource.loadImage(product.primaryImage);
      if (!source) throw new AppError(422, 'The product image could not be loaded for customization.');
      sessionTitle = product.name.slice(0, 120);
    } else {
      source = image?.buffer;
      sessionTitle = cleanText(title, 120);
      if (sessionTitle.length < 3) throw badRequest('Tell us what garment this is (for example "white cotton shirt").', { title: 'Required' });
    }
    const info = checkImage(source);

    const failedCap = await repo.countSessionsForUser(user.id);
    if (failedCap >= config.maxSessionsPerUser) throw new AppError(429, `You can keep up to ${config.maxSessionsPerUser} customization sessions. Delete one to start another.`);

    const key = await storage.save('originals', source, info.ext);
    const nowDate = at();
    let inserted;
    try {
      inserted = await repo.insertSessionLimited({
        publicId: newId(), userId: user.id, type, productId: product?.id ?? null, productName: product?.name ?? null, productSlug: product?.slug ?? null,
        title: sessionTitle, visibleView: view, originalKey: key, originalMime: info.mime, originalSize: info.size, originalWidth: info.width, originalHeight: info.height,
        originalSha256: crypto.createHash('sha256').update(source).digest('hex'),
        consentVersion: current.version, chatProvider: providers.chat.id, imageProvider: providers.image.id,
        now: nowDate, expiresAt: at(now() + retention.unsavedDays * DAY_MS),
      }, config.maxSessionsPerUser);
    } catch (err) {
      await storage.remove('originals', key);
      throw err;
    }
    if (inserted.limit) {
      await storage.remove('originals', key);
      throw new AppError(429, `You can keep up to ${config.maxSessionsPerUser} customization sessions. Delete one to start another.`);
    }
    return { session: await sessionView(await repo.getSessionById(inserted.id)), resumed: false };
  }

  async function listSessions(user, { productId } = {}) {
    const rows = productId
      ? [await repo.findLatestForProduct(user.id, productId)].filter(Boolean).map((r) => ({ ...r, version_count: 0, saved_count: 0 }))
      : await repo.listSessionsForUser(user.id);
    return rows.map((s) => ({
      id: s.public_id, type: s.session_type, title: s.title, productSlug: s.product_slug, productName: s.product_name,
      versionCount: Number(s.version_count || 0), savedCount: Number(s.saved_count || 0),
      thumbnailUrl: sign('original', s.public_id, user.id), expiresAt: iso(s.expires_at), updatedAt: iso(s.updated_at),
    }));
  }

  async function getSession(user, publicId) {
    await failStale(user.id);
    return sessionView(await ownedOrThrow(publicId, user.id));
  }

  async function getMessages(user, publicId) {
    return (await getSession(user, publicId)).messages;
  }

  async function removeSessionFiles(session, keys) {
    await storage.remove('originals', session.original_key);
    for (const k of keys) await storage.remove('versions', k);
  }

  async function deleteSession(user, publicId) {
    const session = await ownedOrThrow(publicId, user.id);
    await failStale(user.id);
    if (await repo.hasProcessingInSession(session.id)) throw conflict('An image is still being generated. Please wait until it finishes.');
    const keys = await repo.collectKeys(session.id);
    await repo.deleteSession(session.id);
    await removeSessionFiles(session, keys);
  }

  /** Delete every session of the customer (account / privacy clean-up). */
  async function deleteAll(user) {
    const rows = await repo.listAllSessionsForUser(user.id);
    let deleted = 0;
    for (const s of rows) {
      if (await repo.hasProcessingInSession(s.id)) continue;
      const keys = await repo.collectKeys(s.id);
      await repo.deleteSession(s.id);
      await removeSessionFiles(s, keys);
      deleted += 1;
    }
    return { deleted };
  }

  // ------------------------------------------------------------------ conversation

  async function enforceEditLimits(userId) {
    const hourAgo = at(now() - HOUR_MS);
    const dayAgo = at(now() - DAY_MS);
    if ((await repo.countImageRequestsSince({ since: hourAgo, userId })) >= config.editUserHourlyLimit) {
      throw new AppError(429, `You have reached the limit of ${config.editUserHourlyLimit} image edits per hour. Please try again later.`);
    }
    if (config.editUserDailyLimit > 0 && (await repo.countImageRequestsSince({ since: dayAgo, userId })) >= config.editUserDailyLimit) {
      throw new AppError(429, `You have reached the limit of ${config.editUserDailyLimit} image edits per day. Please try again tomorrow.`);
    }
    if (config.editStoreDailyCap > 0 && (await repo.countImageRequestsSince({ since: dayAgo })) >= config.editStoreDailyCap) {
      throw new AppError(429, 'AI image editing is very busy today. Please try again tomorrow.');
    }
  }

  /** Compose the assistant's visible reply from the model's reply plus anything the software had to refuse. */
  function composeReply(v, extra = []) {
    const parts = [];
    if (v.unseenView) parts.push(UNSEEN_VIEW_REPLY(v.visibleView));
    else if (v.reply) parts.push(v.reply);
    for (const r of v.rejected) parts.push(`I can't do "${r.request}"${r.reason ? `: ${r.reason}` : '.'}`);
    parts.push(...extra);
    return cleanText(parts.join(' '), 3000) || 'Okay.';
  }

  /**
   * Handle one customer message. Idempotent per `requestId`: a double click or network retry never creates a second
   * message, a second paid generation or a second version.
   * @returns {Promise<{session:object}>}
   */
  async function sendMessage(user, publicId, { message, requestId }) {
    const session = await ownedOrThrow(publicId, user.id);
    if (session.status !== 'active') throw conflict('This session is closed.');
    const text = cleanText(message, config.maxMessageChars);
    if (!text) throw badRequest('Please type a message.', { message: 'Required' });
    if (!chatReady()) throw new AppError(503, 'AI customization is not available right now. Please try again later.');

    await failStale(user.id);
    if (await repo.hasProcessingInSession(session.id)) throw conflict('Please wait for the current image to finish generating.');

    const nowDate = at();
    const inserted = await repo.insertMessage({ sessionId: session.id, sender: 'user', message: text, requestId, now: nowDate });
    if (inserted.duplicate) return { session: await sessionView(session) }; // same request id: nothing new happens

    const product = await productContext(session);
    const has3d = !!product?.has3d;
    const options = has3d ? await productSource.getOptions(product.id) : [];
    const messages = await repo.listMessages(session.id);
    const history = messages
      .filter((m) => m.id !== inserted.id && m.status === 'completed' && (m.sender_type === 'user' || m.sender_type === 'assistant'))
      .slice(-config.historyTurns)
      .map((m) => ({ role: m.sender_type, text: m.message }));

    let result;
    try {
      result = await chat.understand({
        history, message: text,
        context: {
          title: session.title, visibleView: session.visible_view, has3d, options, imageAvailable: imageReady(),
          product: product && { name: product.name, description: product.description, sizesInStock: product.sizesInStock },
        },
      });
    } catch (err) {
      const e = errorOf(err);
      logger.warn?.(`[ai] chat failed for session ${session.public_id}: ${e.code}${e.providerCode ? ` (${e.providerCode})` : ''}`);
      await repo.insertMessage({ sessionId: session.id, sender: 'assistant', message: describeAiError(e.code).message, status: 'failed', errorCode: e.code, now: at() });
      return { session: await sessionView(session) };
    }

    const v = { ...result.instruction, visibleView: session.visible_view };
    const extra = [];
    let wantImage = !!v.imageEdit;
    let ops3d = v.ops3d;

    // ---- cost control and duplicate-generation protection happen BEFORE any paid call
    if (wantImage) {
      try {
        await enforceEditLimits(user.id);
        if (await repo.findProcessingForUser(user.id)) throw new AppError(409, 'You already have an image being generated. Please wait for it to finish.');
        if ((await repo.listVersions(session.id)).length >= config.maxVersionsPerSession) {
          throw new AppError(429, `A session can hold up to ${config.maxVersionsPerSession} versions. Delete an older version or start a new session.`);
        }
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        wantImage = false;
        extra.push(`I didn't start the image edit: ${err.message}`);
      }
    }

    const instruction = summarizeInstruction({ ...v, imageEdit: wantImage ? v.imageEdit : null, ops3d });
    let versionRow = null;

    if (wantImage || ops3d.length) {
      const head = session.current_version_id ? await repo.getVersionById(session.current_version_id) : null;
      let config3d = null;
      if (has3d) {
        const byId = new Map((await repo.listVersions(session.id)).map((x) => [x.id, x]));
        const cfgVersion = head ? nearest(byId, head.id, (x) => x.status === 'completed' && x.config_3d != null) : null;
        config3d = apply3dOps(parseJson(cfgVersion?.config_3d) || defaultConfig3d(options), ops3d, options);
      }
      const ins = await repo.insertVersion({
        publicId: newId(), sessionId: session.id, userId: user.id, parentVersionId: head?.id ?? null,
        status: wantImage ? 'processing' : 'completed', imageRequested: wantImage,
        instruction: wantImage ? v.imageEdit.instruction : null, structuredChanges: instruction, config3d,
        provider: wantImage ? providers.image.id : null, model: wantImage ? providers.image.describe().model : null, now: at(),
      }, { exclusive: wantImage, maxVersions: config.maxVersionsPerSession });

      if (ins.conflict || ins.limit) {
        extra.push(ins.conflict ? "I couldn't start the image edit because another one is already running." : "I couldn't save a new version because this session is full.");
      } else {
        versionRow = await repo.getVersionById(ins.id);
        if (!wantImage) await repo.setCurrentVersion({ sessionId: session.id, versionId: ins.id, expiresAt: await expiryFor(session.id), now: at() });
      }
    }

    await repo.insertMessage({
      sessionId: session.id, sender: 'assistant', message: composeReply(v, extra), structured: instruction,
      versionId: versionRow?.id ?? null, now: at(),
    });
    await repo.touchSession({ sessionId: session.id, expiresAt: await expiryFor(session.id), now: at() });

    if (versionRow && wantImage) {
      const id = versionRow.id;
      schedule(() => runEdit(id).catch((err) => logger.error?.('[ai] unexpected edit error', err?.message)));
    }
    return { session: await sessionView(await repo.getSessionById(session.id)) };
  }

  // ------------------------------------------------------------------ image editing

  /** The image the next edit builds on: the nearest successful version at or above `startId`, else the immutable original. */
  async function resolveInput(session, startId) {
    let id = startId;
    for (let i = 0; id && i < 500; i += 1) {
      const v = await repo.getVersionById(id);
      if (!v) break;
      if (v.status === 'completed' && v.output_key) {
        return { buffer: await storage.read('versions', v.output_key), mimeType: v.output_mime, width: v.output_width, height: v.output_height };
      }
      id = v.parent_version_id;
    }
    return { buffer: await storage.read('originals', session.original_key), mimeType: session.original_mime, width: session.original_width, height: session.original_height };
  }

  /** Send one validated edit to the image provider, exactly once. Never retried: a paid call must not be duplicated. */
  async function runEdit(versionId) {
    const v = await repo.getVersionById(versionId);
    if (!v || v.status !== 'processing') return;
    const session = await repo.getSessionById(v.session_id);
    if (!session) return;
    const fail = async (code, providerCode) => {
      await repo.markVersionFailed({ id: v.id, errorCode: code, providerErrorCode: providerCode, now: at() });
      await repo.failMessagesForVersion(v.id, code);
      logger.warn?.(`[ai] image edit ${v.public_id} failed: ${code}${providerCode ? ` (${providerCode})` : ''}`);
    };
    try {
      const provider = providers.image;
      if (!provider.isConfigured()) throw new ProviderError(E.NOT_CONFIGURED, { providerCode: 'NO_LOCAL_CONFIG' });
      const input = await resolveInput(session, v.parent_version_id);
      const out = await provider.editImage({
        image: { buffer: input.buffer, mimeType: input.mimeType },
        prompt: buildImageEditPrompt(v.edit_instruction),
        size: { width: input.width, height: input.height },
        requestId: v.public_id,
      });
      let info;
      try {
        info = validateImage(out.image.buffer, OUTPUT_LIMITS);
      } catch {
        throw new ProviderError(E.GENERATION_FAILED, { providerCode: 'BAD_RESULT_IMAGE' });
      }
      const key = await storage.save('versions', out.image.buffer, info.ext);
      const ok = await repo.markVersionCompleted({
        id: v.id,
        output: { key, mime: info.mime, size: info.size, width: info.width, height: info.height, sha256: crypto.createHash('sha256').update(out.image.buffer).digest('hex') },
        provider: provider.id, model: out.model || null, metadata: out.meta || null, now: at(),
      });
      if (!ok) { await storage.remove('versions', key); return; } // timed out or deleted meanwhile
      await repo.setCurrentVersion({ sessionId: session.id, versionId: v.id, expiresAt: await expiryFor(session.id), now: at() });
    } catch (err) {
      const e = errorOf(err);
      await fail(e.code, e.providerCode || (err instanceof ProviderError ? null : 'LOCAL_ERROR'));
      if (!(err instanceof ProviderError)) logger.error?.('[ai] local error during edit:', err?.message);
    }
  }

  // ------------------------------------------------------------------ versions

  async function versionOrThrow(session, versionPublicId) {
    const v = await repo.getVersionInSession(session.id, versionPublicId);
    if (!v) throw notFound('Version not found');
    return v;
  }

  async function restoreVersion(user, publicId, versionPublicId) {
    const session = await ownedOrThrow(publicId, user.id);
    await failStale(user.id);
    if (await repo.hasProcessingInSession(session.id)) throw conflict('Please wait for the current image to finish generating.');
    const v = await versionOrThrow(session, versionPublicId);
    if (v.status !== 'completed') throw conflict('Only a successful version can be restored.');
    await repo.setCurrentVersion({ sessionId: session.id, versionId: v.id, expiresAt: await expiryFor(session.id), now: at() });
    return sessionView(await repo.getSessionById(session.id));
  }

  /** Go back to the untouched original (no version selected). */
  async function restoreOriginal(user, publicId) {
    const session = await ownedOrThrow(publicId, user.id);
    await failStale(user.id);
    if (await repo.hasProcessingInSession(session.id)) throw conflict('Please wait for the current image to finish generating.');
    await repo.setCurrentVersion({ sessionId: session.id, versionId: null, expiresAt: await expiryFor(session.id), now: at() });
    return sessionView(await repo.getSessionById(session.id));
  }

  async function deleteVersion(user, publicId, versionPublicId) {
    const session = await ownedOrThrow(publicId, user.id);
    await failStale(user.id);
    const v = await versionOrThrow(session, versionPublicId);
    if (v.status === 'processing') throw conflict('This version is still being generated.');
    if (await repo.hasChildren(v.id)) throw conflict('Later versions build on this one. Delete those first.');
    if (await repo.getSavedByVersion(v.id)) throw conflict('This version is saved. Remove the saved design first.');
    if (session.current_version_id === v.id) {
      await repo.setCurrentVersion({ sessionId: session.id, versionId: v.parent_version_id ?? null, expiresAt: await expiryFor(session.id), now: at() });
    }
    await repo.deleteVersion(v.id);
    if (v.output_key) await storage.remove('versions', v.output_key);
    return sessionView(await repo.getSessionById(session.id));
  }

  // ------------------------------------------------------------------ saved designs

  const savedView = (s, userId) => ({
    id: s.public_id,
    title: s.title,
    sessionId: s.session_public_id,
    versionId: s.version_public_id,
    versionNumber: s.version_number,
    type: s.session_type,
    product: s.product_slug ? { slug: s.product_slug, name: s.product_name } : null,
    hasImage: !!s.has_image,
    imageUrl: s.has_image ? sign('version', s.version_public_id, userId) : null,
    has3dConfig: s.config_3d != null,
    designId: s.design_id,
    createdAt: iso(s.created_at),
  });

  async function saveVersion(user, publicId, { versionId, title }) {
    const session = await ownedOrThrow(publicId, user.id);
    await failStale(user.id);
    if (await repo.hasProcessingInSession(session.id)) throw conflict('Please wait for the current image to finish generating.');
    let v;
    if (versionId) v = await versionOrThrow(session, versionId);
    else if (session.current_version_id) v = await repo.getVersionById(session.current_version_id);
    if (!v) throw conflict('Make at least one change before saving a design.');
    if (v.status !== 'completed') throw conflict('Only a successful version can be saved.');

    const existing = await repo.getSavedByVersion(v.id);
    if (!existing) {
      if ((await repo.countSavedForUser(user.id)) >= config.maxSavedPerUser) {
        throw badRequest(`You can keep up to ${config.maxSavedPerUser} saved designs. Delete one to save another.`);
      }
      // Product sessions with a 3D configuration also appear under the Phase 2 "3D designs" list.
      let designId = null;
      const cfg3d = parseJson(v.config_3d);
      if (session.session_type === 'product' && session.product_id && cfg3d) {
        try {
          designId = (await createDesign(user.id, { productId: session.product_id, name: cleanText(title || session.title, 80) || 'My design', config: cfg3d })).id;
        } catch (err) {
          logger.warn?.(`[ai] could not create the 3D design for session ${session.public_id}: ${err?.message}`);
        }
      }
      try {
        await repo.insertSaved({
          publicId: newId(), userId: user.id, sessionId: session.id, versionId: v.id, designId,
          title: cleanText(title || session.title, 120) || 'My design', now: at(),
        });
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err; // a concurrent identical save already exists
      }
      await repo.touchSession({ sessionId: session.id, expiresAt: at(now() + retention.savedDays * DAY_MS), now: at() });
    }
    const list = await repo.listSavedForUser(user.id);
    return savedView(list.find((s) => s.version_id === v.id), user.id);
  }

  async function listSaved(user) {
    return (await repo.listSavedForUser(user.id)).map((s) => savedView(s, user.id));
  }

  async function deleteSaved(user, savedPublicId) {
    const s = await repo.getSavedOwned(savedPublicId, user.id);
    if (!s) throw notFound('Saved design not found');
    await repo.deleteSaved(s.id);
    if (s.design_id && deleteDesign) { try { await deleteDesign(s.design_id, user.id); } catch { /* already removed */ } }
    // Without any saved design left, the session falls back to the shorter retention window.
    const session = await repo.getSessionById(s.session_id);
    if (session) await repo.touchSession({ sessionId: session.id, expiresAt: await expiryFor(session.id), now: at() });
  }

  // ------------------------------------------------------------------ unified try-on

  /**
   * Which try-on methods are genuinely available for the design in this session (the selected version, or the current one).
   */
  async function getTryOnMethods(user, publicId, versionPublicId) {
    const session = await ownedOrThrow(publicId, user.id);
    const versions = await repo.listVersions(session.id);
    const byId = new Map(versions.map((v) => [v.id, v]));
    const picked = versionPublicId ? versions.find((v) => v.public_id === versionPublicId) : (session.current_version_id ? byId.get(session.current_version_id) : null);
    if (versionPublicId && !picked) throw notFound('Version not found');
    const imgVersion = picked ? nearest(byId, picked.id, (v) => v.status === 'completed' && !!v.output_key) : null;
    const saved = picked ? await repo.getSavedByVersion(picked.id) : null;

    let flags = null;
    if (session.session_type === 'product' && session.product_id) {
      const p = await productSource.get(session.product_id);
      if (p && p.status === 'active') flags = { slug: p.slug, ...(await productSource.flags(p.id, arService)) };
    }
    const methods = computeTryOnMethods({
      sessionType: session.session_type,
      product: flags,
      version: { publicId: imgVersion?.public_id ?? null, hasImage: !!imgVersion, width: imgVersion?.output_width ?? null, height: imgVersion?.output_height ?? null, savedDesignId: saved?.design_id ?? null },
      tryonProviderReady: providers.isReady('tryon'),
      minGarmentSide: MIN_TRYON_GARMENT_SIDE,
    });
    return { versionId: imgVersion?.public_id ?? null, methods };
  }

  // ------------------------------------------------------------------ files / maintenance / admin

  /** Resolve a stored file for a signed request. The route has already verified the signature. */
  async function resolveFile(which, id, userId) {
    const f = which === 'original' ? await repo.getOriginalFile(id, userId) : await repo.getVersionFile(id, userId);
    if (!f) throw notFound('Image not found');
    return { kind: which === 'original' ? 'originals' : 'versions', key: f.key, mime: f.mime };
  }

  /** Retention: delete sessions past expires_at with their files. Safe to run repeatedly. */
  async function purgeExpired() {
    const failedStale = await repo.failStale({ cutoff: at(now() - config.editTimeoutMs), now: at() });
    let deleted = 0;
    for (;;) {
      const batch = await repo.listExpiredSessions(at(), 50);
      if (!batch.length) break;
      for (const s of batch) {
        const keys = await repo.collectKeys(s.id);
        await repo.deleteSession(s.id);
        try { await removeSessionFiles(s, keys); } catch (err) { logger.warn?.(`[ai] could not remove files of session ${s.public_id}: ${err.message}`); }
        deleted += 1;
      }
      if (batch.length < 50) break;
    }
    return { failedStale, deleted };
  }

  async function adminOverview() {
    return {
      providers: providers.summary(),
      supported: providers.supported(),
      limits: {
        editsPerUserPerHour: config.editUserHourlyLimit, editsPerUserPerDay: config.editUserDailyLimit, editsPerStorePerDay: config.editStoreDailyCap,
        maxSessionsPerUser: config.maxSessionsPerUser, maxVersionsPerSession: config.maxVersionsPerSession,
      },
      last30Days: await repo.overview({ since: at(now() - 30 * DAY_MS) }),
    };
  }

  return {
    providerStatus, getConfig, createSession, listSessions, getSession, getMessages, deleteSession, deleteAll, sendMessage,
    restoreVersion, restoreOriginal, deleteVersion, saveVersion, listSaved, deleteSaved, getTryOnMethods, resolveFile, purgeExpired,
    adminOverview, runEdit,
  };
}
