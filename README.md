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
- **官方精选**:`"featured": true`(可不写),市场页顶上那一张;同时标了几个,客户端取排在最前的那个。
- **首启默认**:`"firstRun": true`(可不写),新用户第一次启动咕咕时,在后台静默装上的那一组 —— 不问人,和预装时一样。
  名单就写在这里,客户端代码里不点名;已经有 App 的老用户不受影响,装过、卸了的也不会再装回来。
  **只能标在本仓自己的 App 上**(代码在 `sources/` 里,每一版的 `repo` 都是本仓):不问人就装的只能是 gugu 自己的。verify 拦,咕咕客户端也照这一条判。
- 已经上线的版本行,除了加 `yanked`,一个字段都不许改、不许删。
- json 里不写能从包里推出来的东西(manifest、更新说明、README、图标),CI 从包里取。

**测试用的 App 测完一律 `unlisted`**:`main` 上 listed 的只能是准备给用户看的 App。

## 本仓自己的 App(`sources/`)

- 工具类 App 可以没有业务 HTML（App API 5）：`browser-use` 使用咕咕宿主的会话浏览器桥；`computer-use` 是咕咕电脑控制的开关（装着、启用着这台电脑才有电脑控制，agent 用咕咕自带的那套动作），它带一个每个任务一份的「电脑」页签（`perSession`），显示 agent 正在操作的窗口与每一步。点击 App 打开宿主的配置与状态页（`computer-use` 的系统授权也在那里办）。两者都标 `firstRun`（`computer-use` 随 0.2.0 上架时标），新用户首启默认安装，可停用和卸载。老 profile 不追装，卸载后不自动装回。

- 一个目录就是整个 App 的(`radar`、`day-calendar`):`path` 写 `sources/<id>`。
- 带打包脚本、带测试的(`office`、`omnisearch`):`sources/<id>/` 是这个 App 的工程，市场打的包只是其中的 `app/`
  (`path` 写 `sources/<id>/app`)。测试、打包脚本、它们的 `package.json` 都在 `app/` 外面，不进用户装的包。
  - `sources/<id>/package.json` 写了 `scripts.test`,CI 就在那个目录里 `npm ci && npm test`(`node scripts/app-tests.mjs [<id>…]`,本地同样能跑)。
  - devDependencies 里有 `playwright` 的(有真浏览器用例),先装 Chromium。
  - 咕咕办公打包进去的库(`app/skills/office/vendor/`)由 `vendor/build.mjs` 照钉住的 lockfile 打出来,它的 `npm test` 先跑
    `node vendor/build.mjs --check`:重打一遍，逐字节和仓里的比。
  - 全能搜索的 `app/server/server.mjs` 由 `server-build/build.mjs` 从上游打出来(要 git、pnpm、网络，手动跑)。

## CI

- `verify`(PR):先跑 `npm test` 和每个自带测试的 App 的测试(见上一节);再照每个新版本的 `repo@commit` 把 `path` 重新打包,sha256 与字节数逐字节对上;
  `manifest.json` 的 id / 版本对上、写了 `engines.gugu`;`CHANGELOG.md` 有 `## <版本>` 这一节;图标是 PNG(≤ 32 KiB、≤ 512px);
  `description` 的第一句在 agent 读到的 `<gugu_apps>` 里那一行(`- 名字 (id): 第一句`)不超过 120 字 —— 超过就被截成半句。
  源码仓要是公开仓,或者本仓自己;提交必须在源码仓默认分支的历史里(GitHub 按 sha 也给 fork 里的提交,不核就会把 fork 的代码记成「代码在 owner/repo」)。
- `sync`(合并到 `main`,environment `mirror`):写 `market/bundles|meta|media/…`,每个文件只写一次
  (同名同字节跳过,不同字节报红),最后覆盖 `market/index.json`。只写 `market/` 下面,由 `scripts/sync.mjs` 的 `putObject` 硬守。

打包器(`scripts/lib.mjs` 的 `packDir`)是市场字节的唯一来源:文件按路径排序、时间戳固定、不要目录条目、拒绝符号链接,
`jszip` 锁在 `package-lock.json`。改它等于改所有已发布版本的 sha256 —— 别改。

`npm test` 跑本地格:打包可重复、sha 错一位就红、改旧版本就红、只写 `market/`、不覆盖、重跑零写入。

## 公开与权限

本仓 2026-10-08 起公开。owner 定的：先不开 `main` 的分支保护，眼下能推 `main` 的只有 owner 一个人。

「只写 `market/`、不覆盖」目前只靠 `scripts/sync.mjs` 守（下载站那把钥匙能写整个发布桶）。加协作者、让别人也能推 `main` 之前，先做两件事：
1. 打开 `main` 的分支保护，合并只能由 owner 批；
2. 把钥匙换成只能对 `market/*` Put、不能 Delete 的 RAM 子账号钥匙。

fork 来的 PR 只跑 `verify`，拿不到 secrets；只有 `main` 能用 `mirror` 环境。
