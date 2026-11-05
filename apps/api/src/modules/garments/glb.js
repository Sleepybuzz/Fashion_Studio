import fs from 'node:fs/promises';
import { badRequest } from '../../utils/AppError.js';

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const MAX_LIST = 500;

/** Required extensions the web viewer can decode without downloading anything extra. */
const SUPPORTED_REQUIRED = new Set([
  'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_specular',
  'KHR_materials_sheen', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_volume',
  'KHR_texture_transform', 'KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_materials_pbrSpecularGlossiness',
]);
const UNSUPPORTED_HINT = {
  KHR_draco_mesh_compression: 'Draco-compressed models are not supported. Re-export without Draco compression.',
  KHR_texture_basisu: 'KTX2/Basis textures are not supported. Re-export with PNG or JPEG textures.',
};

/**
 * Same name clean-up three.js applies to node names when loading a glTF file
 * (whitespace -> "_", and the characters [ ] . : / are removed). Node names stored for the
 * admin option editor must match what the viewer sees at runtime.
 */
export const sanitizeNodeName = (name) => String(name).replace(/\s/g, '_').replace(/[[\].:/]/g, '');

function parseGlbJson(buf) {
  if (buf.length < 20) throw badRequest('File is too small to be a valid GLB model');
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw badRequest('File is not a valid GLB model (bad header)');
  if (buf.readUInt32LE(4) !== 2) throw badRequest('Only glTF 2.0 binary (GLB version 2) is supported');
  const declared = buf.readUInt32LE(8);
  if (declared > buf.length) throw badRequest('GLB file is truncated or corrupted');
  const chunkLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) throw badRequest('GLB file is corrupted (JSON chunk missing)');
  if (20 + chunkLength > buf.length) throw badRequest('GLB file is truncated or corrupted');
  try {
    return JSON.parse(buf.subarray(20, 20 + chunkLength).toString('utf8'));
  } catch {
    throw badRequest('GLB file is corrupted (invalid JSON content)');
  }
}

function assertSelfContained(json, format) {
  const isData = (u) => typeof u === 'string' && u.startsWith('data:');
  for (const [i, b] of (json.buffers || []).entries()) {
    if (b.uri === undefined) {
      if (format === 'gltf') throw badRequest('This .gltf references an external buffer. Upload a .glb, or a .gltf with embedded data.');
      if (i !== 0) throw badRequest('Unsupported GLB structure (extra buffer without data)');
    } else if (!isData(b.uri)) {
      throw badRequest('The model references external files. Upload a single self-contained .glb (recommended).');
    }
  }
  for (const img of json.images || []) {
    if (img.uri !== undefined && !isData(img.uri)) {
      throw badRequest('The model references external texture files. Embed textures in a single .glb file.');
    }
  }
}

/** Triangles in the scene, counting each mesh once per node that instances it. */
function countTriangles(json) {
  const acc = json.accessors || [];
  const perMesh = (json.meshes || []).map((mesh) => {
    let tris = 0;
    for (const prim of mesh.primitives || []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue; // only triangle lists
      const idx = prim.indices !== undefined ? acc[prim.indices] : acc[prim.attributes?.POSITION];
      if (idx && Number.isFinite(idx.count)) tris += Math.floor(idx.count / 3);
    }
    return tris;
  });
  return (json.nodes || []).reduce((sum, n) => sum + (n.mesh !== undefined ? perMesh[n.mesh] || 0 : 0), 0);
}

/**
 * Validate a stored model file and extract the metadata the studio needs.
 * @param {string} filePath absolute path of the uploaded file
 * @param {'glb'|'gltf'} format
 * @returns {Promise<{format:string, generator:string|null, triangleCount:number, nodeNames:string[],
 *   meshNodeNames:string[], materialNames:string[], unnamedMaterials:number, textureCount:number,
 *   animationCount:number}>}
 * @throws {import('../../utils/AppError.js').AppError} 400 with a clear message when the file is not usable
 */
export async function inspectModelFile(filePath, format) {
  const buf = await fs.readFile(filePath);
  let json;
  if (format === 'glb') {
    json = parseGlbJson(buf);
  } else {
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      throw badRequest('File is not valid glTF JSON');
    }
  }
  if (!json || typeof json !== 'object' || !json.asset || !String(json.asset.version).startsWith('2')) {
    throw badRequest('Only glTF 2.0 models are supported');
  }
  for (const ext of json.extensionsRequired || []) {
    if (UNSUPPORTED_HINT[ext]) throw badRequest(UNSUPPORTED_HINT[ext]);
    if (!SUPPORTED_REQUIRED.has(ext)) throw badRequest(`The model requires an unsupported glTF extension: ${ext}`);
  }
  assertSelfContained(json, format);
  if (!Array.isArray(json.meshes) || json.meshes.length === 0) throw badRequest('The model contains no meshes');
  if (!Array.isArray(json.nodes) || json.nodes.length === 0) throw badRequest('The model contains no scene nodes');
  if (json.nodes.length > 5000) throw badRequest('The model has too many nodes (limit 5000)');

  const nodeNames = [];
  const meshNodeNames = [];
  const seen = new Set();
  for (const n of json.nodes) {
    if (typeof n.name !== 'string' || !n.name.trim()) continue;
    const clean = sanitizeNodeName(n.name);
    if (!clean || seen.has(clean)) continue; // duplicate names cannot be targeted reliably
    seen.add(clean);
    nodeNames.push(clean);
    if (n.mesh !== undefined) meshNodeNames.push(clean);
  }

  const mats = json.materials || [];
  const materialNames = [...new Set(mats.map((m) => m.name).filter((n) => typeof n === 'string' && n.trim()))];

  return {
    format,
    generator: typeof json.asset.generator === 'string' ? json.asset.generator.slice(0, 120) : null,
    triangleCount: countTriangles(json),
    nodeNames: nodeNames.slice(0, MAX_LIST),
    meshNodeNames: meshNodeNames.slice(0, MAX_LIST),
    materialNames: materialNames.slice(0, MAX_LIST),
    unnamedMaterials: mats.filter((m) => typeof m.name !== 'string' || !m.name.trim()).length,
    textureCount: (json.textures || []).length,
    animationCount: (json.animations || []).length,
  };
}
