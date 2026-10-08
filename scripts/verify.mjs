// PR 上的核对:node scripts/verify.mjs [--base <git ref>]
// 1. 每个 apps/*.json 形状对。
// 2. 和 base 比:已经上过线的版本行,除了加 yanked,一个字段都不许动、也不许删。
// 3. 新加的每一版:照 repo@commit 把 path 重新打包,sha256 与字节数逐字节对上;manifest / CHANGELOG / 图标 / README 合规。
// 不碰下载站,不需要任何密钥。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fail, MARKET_BASE_URL, readApps, rebuildVersion, validateApp } from './lib.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, dir: { type: 'string', default: 'apps' } } });

function baseApp(ref, id) {
  try {
    return validateApp(JSON.parse(execFileSync('git', ['show', `${ref}:${values.dir}/${id}.json`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()));
  } catch {
    return null; // base 上还没有这个 App
  }
}

const frozen = ({ yanked, ...rest }) => JSON.stringify(rest);

const apps = readApps(values.dir);
let checked = 0;
const problems = [];
for (const app of apps) {
  const before = values.base ? baseApp(values.base, app.id) : null;
  for (const old of before?.versions ?? []) {
    const now = app.versions.find((version) => version.version === old.version);
    if (!now) problems.push(`${app.id}@${old.version}: 上过线的版本不能删(要下线写 yanked)`);
    else if (frozen(now) !== frozen(old)) problems.push(`${app.id}@${old.version}: 上过线的版本不可变,只能加 yanked`);
    else if (old.yanked && !now.yanked) problems.push(`${app.id}@${old.version}: 撤回不能收回(版本号不复用)`);
  }
  const known = new Set((before?.versions ?? []).map((version) => version.version));
  for (const version of app.versions.filter((entry) => !known.has(entry.version))) {
    try {
      await rebuildVersion(app, version, MARKET_BASE_URL);
      checked += 1;
      console.log(`ok ${app.id}@${version.version} sha256=${version.sha256.slice(0, 12)}… bytes=${version.bytes}`);
    } catch (error) {
      problems.push(error.message);
    }
  }
}
if (values.base) {
  // 文件整个删掉 = 把上过线的版本一起删了。
  const removed = execFileSync('git', ['diff', '--name-only', '--diff-filter=D', values.base, '--', values.dir]).toString().trim();
  if (removed) problems.push(`上过线的 App 不能删文件(要下线写 unlisted): ${removed.split('\n').join(', ')}`);
}
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  fail(`${problems.length} 处不合格`);
}
console.log(`verify ok: ${apps.length} 个 App,重打并核对了 ${checked} 个新版本`);
