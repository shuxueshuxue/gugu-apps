// 合并后:把索引同步到下载站 market/。node scripts/sync.mjs [--dry-run]
//
// 只追加:除 market/index.json 之外,每个文件只写一次(x-oss-forbid-overwrite)。已经在的、字节相同 → 跳过;
// 字节不同 → 报红,❌ 覆盖。这把钥匙能写整个发布桶(桌面安装包、server 包也在里面),
// 所以「只写 market/ 下面」在 put 这一处硬守,不靠调用方自觉。
//
// 每一版的顺序:包 → 图标 / README / 图 → meta。meta 最后写:它在,就说明这一版的文件都齐了,下次直接跳过。
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import OSS from 'ali-oss';
import { bundleKey, fail, MARKET_BASE_URL, metaKey, readApps, rebuildVersion } from './lib.mjs';

export const MARKET_PREFIX = 'market/';
export const INDEX_KEY = `${MARKET_PREFIX}index.json`;

/**
 * 写一个对象。唯一的写口。
 * - key 不在 market/ 下 → 拒绝;
 * - 除 index.json 外一律 forbid-overwrite;已存在时比 MD5(OSS 简单上传的 ETag 就是内容 MD5),同字节算写过,不同字节报红。
 * 回 'written' | 'same'。
 */
export async function putObject(client, key, bytes, contentType, dryRun = false) {
  if (!key.startsWith(MARKET_PREFIX) || key.includes('..')) fail(`拒绝写 market/ 以外的路径: ${key}`);
  const mutable = key === INDEX_KEY;
  if (dryRun) return 'written';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': mutable ? 'public, max-age=60' : 'public, max-age=2592000, immutable',
    ...(mutable ? {} : { 'x-oss-forbid-overwrite': 'true' }),
  };
  try {
    await client.put(key, bytes, { headers });
    return 'written';
  } catch (error) {
    if (mutable || error.code !== 'FileAlreadyExists') throw error;
    const head = await client.head(key);
    const etag = String(head.res.headers.etag ?? '').replace(/"/g, '').toLowerCase();
    const md5 = createHash('md5').update(bytes).digest('hex');
    if (etag !== md5) fail(`${key} 已经在下载站上,而且字节不同(ETag ${etag} ≠ ${md5})。已发布的文件不可变,❌ 覆盖`);
    return 'same';
  }
}

async function readJson(client, key) {
  try {
    return JSON.parse((await client.get(key)).content.toString('utf8'));
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.status === 404) return null;
    throw error;
  }
}

export function ossClient() {
  const need = ['ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET', 'ALIYUN_OSS_BUCKET', 'ALIYUN_OSS_REGION'];
  for (const name of need) if (!process.env[name]) fail(`缺环境变量 ${name}`);
  return new OSS({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET,
    region: process.env.ALIYUN_OSS_REGION,
    secure: true,
  });
}

/** 一版:没有 meta 就重打、核 sha、写文件、最后写 meta;回 meta。 */
async function syncVersion(client, app, version, dryRun, log) {
  const key = MARKET_PREFIX + metaKey(app.id, version);
  const existing = await readJson(client, key);
  if (existing) return existing;
  const { bytes, inspected } = await rebuildVersion(app, version, MARKET_BASE_URL);
  const counts = { written: 0, same: 0 };
  const put = async (relativeKey, body, type) => {
    counts[await putObject(client, MARKET_PREFIX + relativeKey, body, type, dryRun)] += 1;
  };
  await put(bundleKey(app.id, version), bytes, 'application/zip');
  if (inspected.icon) await put(inspected.icon.key, inspected.icon.bytes, 'image/png');
  if (inspected.readme) {
    for (const media of inspected.readme.media) await put(media.key, media.bytes, media.contentType);
    await put(inspected.readme.key, Buffer.from(inspected.readme.text), 'text/markdown; charset=utf-8');
  }
  const meta = {
    publishedAt: new Date().toISOString(),
    manifest: inspected.manifest,
    apiVersion: inspected.apiVersion,
    minAppVersion: inspected.minAppVersion,
    releaseNotes: inspected.releaseNotes,
    icon: inspected.icon?.key ?? null,
    readme: inspected.readme?.key ?? null,
  };
  await put(metaKey(app.id, version), Buffer.from(JSON.stringify(meta)), 'application/json; charset=utf-8');
  log(`synced ${app.id}@${version.version}: ${counts.written} written, ${counts.same} already there`);
  return meta;
}

/** 下载站上的目录:下架的不在里面;每一版 = 索引仓那一行(仓、提交、sha、撤回)+ 它的 meta。 */
export function buildIndex(apps, metas) {
  return {
    apps: apps
      .filter((app) => !app.unlisted)
      .map((app) => ({
        id: app.id,
        deprecated: app.deprecated,
        versions: app.versions.map((version) => {
          const meta = metas.get(`${app.id}@${version.version}`);
          return {
            version: version.version,
            manifest: meta.manifest,
            apiVersion: meta.apiVersion,
            minAppVersion: meta.minAppVersion,
            releaseNotes: meta.releaseNotes,
            publishedAt: meta.publishedAt,
            sha256: version.sha256,
            bytes: version.bytes,
            bundle: bundleKey(app.id, version),
            icon: meta.icon,
            readme: meta.readme,
            source: { repo: version.repo, path: version.path, commit: version.commit },
            yanked: version.yanked,
          };
        }),
      })),
  };
}

export async function sync({ client, dir = 'apps', dryRun = false, log = console.log }) {
  const apps = readApps(dir);
  const metas = new Map();
  for (const app of apps) {
    for (const version of app.versions) {
      metas.set(`${app.id}@${version.version}`, await syncVersion(client, app, version, dryRun, log));
    }
  }
  const index = buildIndex(apps, metas);
  await putObject(client, INDEX_KEY, Buffer.from(JSON.stringify(index)), 'application/json; charset=utf-8', dryRun);
  log(`index.json: ${index.apps.length} 个 App(下架的 ${apps.length - index.apps.length} 个不在里面)`);
  return index;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false }, dir: { type: 'string', default: 'apps' } } });
  await sync({ client: ossClient(), dir: values.dir, dryRun: values['dry-run'] });
}
