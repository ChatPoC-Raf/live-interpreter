// Kopiuje assety VAD (model Silero ONNX + worklet) oraz WASM onnxruntime-web
// do src/renderer/public/vad/ — serwowane lokalnie, zero CDN w trakcie sesji.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'src', 'renderer', 'public', 'vad');
mkdirSync(dest, { recursive: true });

const sources = [
  {
    dir: join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist'),
    match: (f) => f.endsWith('.onnx') || f.startsWith('vad.worklet'),
  },
  {
    dir: join(root, 'node_modules', 'onnxruntime-web', 'dist'),
    match: (f) => f.endsWith('.wasm') || f.endsWith('.mjs'),
  },
];

let copied = 0;
for (const { dir, match } of sources) {
  if (!existsSync(dir)) {
    console.error(`[copy-vad-assets] brak katalogu: ${dir} — uruchom npm install`);
    process.exit(1);
  }
  for (const f of readdirSync(dir)) {
    if (match(f)) {
      copyFileSync(join(dir, f), join(dest, f));
      copied += 1;
    }
  }
}
console.log(`[copy-vad-assets] skopiowano ${copied} plikow do ${dest}`);
