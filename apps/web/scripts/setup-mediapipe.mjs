/**
 * Prepares the self-hosted MediaPipe files for the AR try-on:
 *   apps/web/public/mediapipe/wasm/*                      copied from the installed @mediapipe/tasks-vision package
 *   apps/web/public/mediapipe/models/pose_landmarker_lite.task   downloaded once from Google's public model host
 * Run automatically before `npm run dev` / `build`, or manually: `npm run setup:ar`.
 * It never fails the command: if something is missing the app falls back to the official public hosts at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(WEB_ROOT, 'public', 'mediapipe');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const EXPECTED_VERSION = '1.2.2'; // must match WASM_VERSION in src/features/ar-tryon/poseTracker.js

function findPackage() {
  // apps/web/node_modules first: other packages (e.g. drei) may pull an older copy into the repo root.
  for (let dir = WEB_ROOT, i = 0; i < 4; i += 1, dir = path.dirname(dir)) {
    const p = path.join(dir, 'node_modules', '@mediapipe', 'tasks-vision');
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
  }
  return null;
}

async function main() {
  const pkg = findPackage();
  if (!pkg) { console.warn('[ar-setup] @mediapipe/tasks-vision is not installed. Run: npm install'); return; }
  const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  if (version !== EXPECTED_VERSION) console.warn(`[ar-setup] installed @mediapipe/tasks-vision is ${version}, the app expects ${EXPECTED_VERSION}. Keep poseTracker.js and this script in sync.`);

  const wasmOut = path.join(OUT, 'wasm');
  fs.mkdirSync(wasmOut, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(path.join(pkg, 'wasm'))) {
    const dst = path.join(wasmOut, f);
    const src = path.join(pkg, 'wasm', f);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) { fs.copyFileSync(src, dst); copied += 1; }
  }
  console.log(`[ar-setup] wasm files ready (${copied} copied).`);

  const modelOut = path.join(OUT, 'models', 'pose_landmarker_lite.task');
  if (fs.existsSync(modelOut) && fs.statSync(modelOut).size > 1_000_000) { console.log('[ar-setup] pose model already present.'); return; }
  fs.mkdirSync(path.dirname(modelOut), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) throw new Error('unexpectedly small file');
    fs.writeFileSync(modelOut, buf);
    console.log(`[ar-setup] downloaded pose model (${(buf.length / 1024 / 1024).toFixed(1)} MB).`);
  } catch (err) {
    console.warn(`[ar-setup] could not download the pose model (${err.message}). The app will download it from Google's host when AR is opened. To self-host, save it from\n  ${MODEL_URL}\n  to ${modelOut}`);
  }
}

main().catch((err) => console.warn('[ar-setup] skipped:', err.message));
