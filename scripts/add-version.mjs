// 作者本地:node scripts/add-version.mjs <owner/repo> <40 位 commit> <仓里的目录,仓根写 .>
// 照那个提交取源码、打包、算 sha256 与字节数,把这一版追加进 apps/<id>.json(没有就新建)。然后提 PR。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchSource, inspectAppDir, MARKET_BASE_URL, packDir, sha256, validateApp } from './lib.mjs';

const { values, positionals } = parseArgs({ options: { dir: { type: 'string', default: 'apps' } }, allowPositionals: true });
const [repo, commit, path] = positionals;
if (!repo || !commit || !path) throw new Error('用法: add-version.mjs <owner/repo> <40 位 commit> <目录,仓根写 .>');

const source = fetchSource({ repo, commit, path });
try {
  const bytes = await packDir(source.dir);
  const manifest = JSON.parse(readFileSync(join(source.dir, 'manifest.json'), 'utf8'));
  inspectAppDir(source.dir, manifest.id, manifest.version, MARKET_BASE_URL);
  const file = join(values.dir, `${manifest.id}.json`);
  const app = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { id: manifest.id, unlisted: false, deprecated: null, versions: [] };
  app.versions.push({ version: manifest.version, repo, path, commit, sha256: sha256(bytes), bytes: bytes.byteLength, yanked: null });
  validateApp(app, `${manifest.id}.json`);
  writeFileSync(file, `${JSON.stringify(app, null, 2)}\n`);
  console.log(`${file}: + ${manifest.id}@${manifest.version} sha256=${sha256(bytes)} bytes=${bytes.byteLength}`);
} finally {
  source.cleanup();
}
