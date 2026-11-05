/**
 * Builds a tiny, self-contained GLB used ONLY to try the 3D studio without owning a real model.
 * The shape is intentionally blocky (boxes) — it is a test asset, not a real garment model.
 *
 * Named nodes (usable in the admin "style options" editor):
 *   Body_Regular, Body_Cropped, Sleeve_Short_L/R, Sleeve_Long_L/R, Collar_Crew, Collar_Wide
 * Materials: "Fabric" (body + sleeves) and "Trim" (collars).
 */

function cube() {
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const pos = [];
  const nor = [];
  const idx = [];
  faces.forEach((f, i) => {
    for (const v of f.v) { pos.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5); nor.push(...f.n); }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos: Buffer.from(new Float32Array(pos).buffer), nor: Buffer.from(new Float32Array(nor).buffer), idx: Buffer.from(new Uint16Array(idx).buffer) };
}

const pad4 = (buf, fill = 0) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), fill)]));

/** @returns {Buffer} GLB file contents */
export function buildSampleGarmentGlb() {
  const c = cube();
  const bin = pad4(Buffer.concat([c.pos, c.nor, c.idx]));
  const node = (name, mesh, t, s) => ({ name, mesh, translation: t, scale: s });
  const nodes = [
    node('Body_Regular', 0, [0, 0, 0], [1.6, 2.0, 0.7]),
    node('Body_Cropped', 0, [0, 0.25, 0], [1.6, 1.5, 0.7]),
    node('Sleeve_Short_L', 0, [-1.05, 0.72, 0], [0.5, 0.55, 0.62]),
    node('Sleeve_Short_R', 0, [1.05, 0.72, 0], [0.5, 0.55, 0.62]),
    node('Sleeve_Long_L', 0, [-1.1, 0.0, 0], [0.5, 1.9, 0.6]),
    node('Sleeve_Long_R', 0, [1.1, 0.0, 0], [0.5, 1.9, 0.6]),
    node('Collar_Crew', 1, [0, 1.02, 0], [0.55, 0.12, 0.75]),
    node('Collar_Wide', 1, [0, 1.02, 0], [0.9, 0.12, 0.8]),
  ];
  const prim = (material) => [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material }];
  const json = {
    asset: { version: '2.0', generator: 'AI Fashion Studio sample garment (blocky test asset)' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: [{ name: 'FabricBlock', primitives: prim(0) }, { name: 'TrimBlock', primitives: prim(1) }],
    materials: [
      { name: 'Fabric', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.82, 0.78, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      { name: 'Trim', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.22, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: c.pos.length, target: 34962 },
      { buffer: 0, byteOffset: c.pos.length, byteLength: c.nor.length, target: 34962 },
      { buffer: 0, byteOffset: c.pos.length + c.nor.length, byteLength: c.idx.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, bin)]);
}
