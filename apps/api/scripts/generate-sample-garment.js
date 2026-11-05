import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../src/config/env.js';
import { buildSampleGarmentGlb } from './lib/sampleGarment.js';

// Writes docs/sample-assets/sample-tee-blocky.glb (a simple test model; not a real garment).
const out = path.join(REPO_ROOT, 'docs', 'sample-assets', 'sample-tee-blocky.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buildSampleGarmentGlb());
console.log(`[sample] wrote ${out}`);
