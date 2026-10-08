# gugu-apps —— 咕咕 App 市场的索引仓

市场的**唯一真相**。每个 App 一个 `apps/<id>.json`;合并到 `main` 后,CI 把它同步到下载站
`https://download.gugu.nextmind.space/market/`,咕咕客户端只读那里(`market/index.json`)。

## 一个 App 的记录

```json
{
  "id": "choukatai",
  "unlisted": false,
  "deprecated": null,
  "versions": [
    {
      "version": "0.1.0",
      "repo": "shuxueshuxue/promo-skills",
      "path": "apps/choukatai",
      "commit": "<完整 40 位>",
      "sha256": "<包的 sha256>",
      "bytes": 48213,
      "yanked": null
    }
  ]
}
```

- **上架一版**:`npm ci && node scripts/add-version.mjs <owner/repo> <commit> <目录,仓根写 .>`,
  它照那个提交取源码、打包、算 sha256 与字节数,把这一行追加进 json。提 PR。
- **撤回一版**:那一行写 `"yanked": { "reason": "…" }`。只能加,不能收回;版本号不复用。
- **停维**:`"deprecated": { "note": "…", "replacedBy": "<id>" | null }`。
- **下架**:`"unlisted": true`,目录里就没有它了(文件留在下载站,已装的人收不到更新)。
- 已经上线的版本行,除了加 `yanked`,一个字段都不许改、不许删。
- json 里不写能从包里推出来的东西(manifest、更新说明、README、图标),CI 从包里取。

**测试用的 App 测完一律 `unlisted`**:`main` 上 listed 的只能是准备给用户看的 App。

## CI

- `verify`(PR):照每个新版本的 `repo@commit` 把 `path` 重新打包,sha256 与字节数逐字节对上;
  `manifest.json` 的 id / 版本对上、写了 `engines.gugu`;`CHANGELOG.md` 有 `## <版本>` 这一节;图标是 PNG(≤ 32 KiB、≤ 512px)。
  源码仓要是公开仓,或者本仓自己;提交必须在源码仓默认分支的历史里(GitHub 按 sha 也给 fork 里的提交,不核就会把 fork 的代码记成「代码在 owner/repo」)。
- `sync`(合并到 `main`,environment `mirror`):写 `market/bundles|meta|media/…`,每个文件只写一次
  (同名同字节跳过,不同字节报红),最后覆盖 `market/index.json`。只写 `market/` 下面,由 `scripts/sync.mjs` 的 `putObject` 硬守。

打包器(`scripts/lib.mjs` 的 `packDir`)是市场字节的唯一来源:文件按路径排序、时间戳固定、不要目录条目、拒绝符号链接,
`jszip` 锁在 `package-lock.json`。改它等于改所有已发布版本的 sha256 —— 别改。

`npm test` 跑本地格:打包可重复、sha 错一位就红、改旧版本就红、只写 `market/`、不覆盖、重跑零写入。

## 公开之前

「只写 `market/`、不覆盖」现在只靠 `scripts/sync.mjs` 守(下载站的钥匙能写整个发布桶),而私有免费仓开不了分支保护,
能推 `main` 的人就能改它。所以**公开的同时打开 `main` 的分支保护(只有 owner 能批)**;以后有协作者能推 `main`,
就换成只给 `market/*` Put、不给 Delete 的 RAM 子账号钥匙。
