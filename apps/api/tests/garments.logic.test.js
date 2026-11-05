import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { inspectModelFile, sanitizeNodeName } = await import('../src/modules/garments/glb.js');
const { findConfigProblems, normalizeConfig } = await import('../src/modules/garments/garments.config.js');
const { createDesignSchema, updateDesignSchema, optionsBodySchema, modelMetaSchema } = await import('../src/modules/garments/garments.schemas.js');
const { COLOR_PRESETS, MATERIAL_PRESETS } = await import('../src/modules/garments/garments.presets.js');
const { buildSampleGarmentGlb } = await import('../scripts/lib/sampleGarment.js');

async function tmpFile(name, data) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'afs-glb-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, data);
  return file;
}

/** Build a GLB (header + JSON chunk only) around an arbitrary JSON document. */
function glbFromJson(json) {
  let body = Buffer.from(JSON.stringify(json));
  if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4), 0x20)]);
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + body.length, 8);
  h.writeUInt32LE(body.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([h, body]);
}

const baseJson = () => ({ asset: { version: '2.0' }, nodes: [{ name: 'A', mesh: 0 }], meshes: [{ primitives: [{ attributes: {} }] }] });

test('sample GLB is inspected: nodes, materials and triangles are extracted', async () => {
  const info = await inspectModelFile(await tmpFile('s.glb', buildSampleGarmentGlb()), 'glb');
  assert.equal(info.format, 'glb');
  assert.ok(info.nodeNames.includes('Sleeve_Long_L') && info.nodeNames.includes('Collar_Crew'));
  assert.deepEqual(info.materialNames.sort(), ['Fabric', 'Trim']);
  assert.equal(info.triangleCount, 8 * 12);
});

test('inspector rejects non-GLB content, truncated files and bad versions', async () => {
  await assert.rejects(inspectModelFile(await tmpFile('x.glb', Buffer.from('this is not a model file at all')), 'glb'), /bad header|valid GLB/);
  const good = buildSampleGarmentGlb();
  await assert.rejects(inspectModelFile(await tmpFile('t.glb', good.subarray(0, 60)), 'glb'), /truncated|corrupted/);
  const v1 = Buffer.from(good); v1.writeUInt32LE(1, 4);
  await assert.rejects(inspectModelFile(await tmpFile('v.glb', v1), 'glb'), /version 2/);
});

test('inspector rejects Draco, KTX2 and unknown required extensions with a helpful message', async () => {
  const draco = { ...baseJson(), extensionsRequired: ['KHR_draco_mesh_compression'] };
  await assert.rejects(inspectModelFile(await tmpFile('d.glb', glbFromJson(draco)), 'glb'), /Draco/);
  const ktx = { ...baseJson(), extensionsRequired: ['KHR_texture_basisu'] };
  await assert.rejects(inspectModelFile(await tmpFile('k.glb', glbFromJson(ktx)), 'glb'), /KTX2/);
  const odd = { ...baseJson(), extensionsRequired: ['VENDOR_weird'] };
  await assert.rejects(inspectModelFile(await tmpFile('o.glb', glbFromJson(odd)), 'glb'), /unsupported glTF extension/);
});

test('inspector rejects external resource references', async () => {
  const ext = { ...baseJson(), buffers: [{ uri: 'https://evil.example/x.bin', byteLength: 4 }] };
  await assert.rejects(inspectModelFile(await tmpFile('e.glb', glbFromJson(ext)), 'glb'), /external files/);
  const gltfExt = { ...baseJson(), buffers: [{ uri: 'model.bin', byteLength: 4 }] };
  await assert.rejects(inspectModelFile(await tmpFile('e.gltf', JSON.stringify(gltfExt)), 'gltf'), /external/);
  const img = { ...baseJson(), images: [{ uri: 'tex.png' }] };
  await assert.rejects(inspectModelFile(await tmpFile('i.glb', glbFromJson(img)), 'glb'), /external texture/);
});

test('inspector accepts a self-contained .gltf and rejects invalid JSON', async () => {
  const ok = { ...baseJson(), buffers: [{ uri: 'data:application/octet-stream;base64,AAAAAA==', byteLength: 4 }] };
  const info = await inspectModelFile(await tmpFile('ok.gltf', JSON.stringify(ok)), 'gltf');
  assert.equal(info.format, 'gltf');
  await assert.rejects(inspectModelFile(await tmpFile('bad.gltf', '{nope'), 'gltf'), /valid glTF JSON/);
});

test('node names are sanitised the way three.js does', () => {
  assert.equal(sanitizeNodeName('Sleeve Long.L'), 'Sleeve_LongL');
  assert.equal(sanitizeNodeName('a[b]:c/d'), 'abcd');
});

const options = [
  { key: 'sleeves', values: [{ key: 'short' }, { key: 'long' }] },
  { key: 'length', values: [{ key: 'regular' }, { key: 'cropped' }] },
];

test('config validation accepts valid values and fills option defaults', () => {
  const out = normalizeConfig({ colorKey: 'navy', materialKey: 'satin', options: { sleeves: 'long' } }, options);
  assert.deepEqual(out, { colorKey: 'navy', materialKey: 'satin', options: { sleeves: 'long', length: 'regular' } });
  assert.deepEqual(normalizeConfig({ colorKey: null, materialKey: null, options: {} }, []), { colorKey: null, materialKey: null, options: {} });
});

test('config validation rejects unknown colours, materials, options and values', () => {
  const p = findConfigProblems({ colorKey: 'neon', materialKey: 'gold', options: { sleeves: 'huge', hood: 'up' } }, options);
  assert.ok(p.colorKey && p.materialKey && p['options.sleeves'] && p['options.hood']);
  assert.throws(() => normalizeConfig({ colorKey: 'neon', materialKey: null, options: {} }, options), /Invalid customization/);
});

test('presets are internally consistent', () => {
  for (const c of COLOR_PRESETS) assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/);
  for (const m of MATERIAL_PRESETS) assert.ok(m.roughness >= 0 && m.roughness <= 1 && m.metalness >= 0 && m.metalness <= 1);
  assert.equal(new Set(COLOR_PRESETS.map((c) => c.key)).size, COLOR_PRESETS.length);
});

test('design schemas validate and apply defaults', () => {
  const ok = createDesignSchema.safeParse({ productId: '3', name: ' Summer ', config: { colorKey: 'navy' } });
  assert.equal(ok.success, true);
  assert.equal(ok.data.productId, 3);
  assert.equal(ok.data.name, 'Summer');
  assert.deepEqual(ok.data.config, { colorKey: 'navy', materialKey: null, options: {} });
  assert.equal(createDesignSchema.safeParse({ productId: 1, name: 'x'.repeat(81), config: {} }).success, false);
  assert.equal(createDesignSchema.safeParse({ productId: 1 }).success, false);
  assert.equal(updateDesignSchema.safeParse({}).success, false);
  assert.equal(updateDesignSchema.safeParse({ name: 'New' }).success, true);
});

test('options schema enforces structure', () => {
  const val = (key) => ({ key, label: key, show: ['A'], hide: [] });
  const good = { options: [{ key: 'sleeves', label: 'Sleeves', values: [val('short'), { key: 'long', label: 'Long', show: [], hide: ['A'] }] }] };
  assert.equal(optionsBodySchema.safeParse(good).success, true);
  assert.equal(optionsBodySchema.safeParse({ options: [{ key: 'Bad Key', label: 'x', values: [val('a'), val('b')] }] }).success, false);
  assert.equal(optionsBodySchema.safeParse({ options: [{ key: 'one', label: 'x', values: [val('a')] }] }).success, false);
  assert.equal(optionsBodySchema.safeParse({ options: [{ key: 'k', label: 'x', values: [val('a'), val('a')] }] }).success, false);
  assert.equal(optionsBodySchema.safeParse({ options: [{ key: 'k', label: 'x', values: [{ key: 'a', label: 'a', show: [], hide: [] }, val('b')] }] }).success, false);
  assert.equal(optionsBodySchema.safeParse({ options: [{ key: 'k', label: 'x', values: [{ key: 'a', label: 'a', show: ['N'], hide: ['N'] }, val('b')] }] }).success, false);
  assert.equal(modelMetaSchema.safeParse({ customizableMaterials: ['Fabric'] }).success, true);
});
