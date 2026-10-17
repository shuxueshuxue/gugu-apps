// app/cursor.js = trycua's cursor-motion (vendor/cua-cursor-motion, MIT, unchanged) as one ES module: the same agent
// cursor and motion gugu draws over a session's browser tab (#7191). `--check` rebuilds and compares byte for byte.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const result = await build({
  entryPoints: [here('./cua-cursor-motion/index.ts')],
  bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', write: false, logLevel: 'warning',
  banner: { js: '// @trycua/cursor-motion (MIT, Copyright (c) 2025 Cua AI, Inc.) — see vendor/cua-cursor-motion/LICENSE in gugu-apps.' },
});
const output = result.outputFiles[0].text;
const target = here('../app/cursor.js');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('app/cursor.js is not what vendor/build.mjs builds: run it and commit');
  console.log('app/cursor.js matches');
} else {
  writeFileSync(target, output);
  console.log(`app/cursor.js ${output.length} bytes`);
}
