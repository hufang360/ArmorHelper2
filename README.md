# ArmorHelper 2

在线使用：[hufang360.github.io/ArmorHelper2](https://hufang360.github.io/ArmorHelper2/)

ArmorHelper 2 是 ArmorHelper 的重写版，纯静态网页，支持泰拉瑞亚 1.4.4 及之后的版本。

这个工具把一张 128×80 的小模板（`ArmorTemplate_v1.png`）展开成整套盔甲所需的全部贴图，不用再把同一件盔甲按每一层画 20 遍，可大幅度节约盔甲材质包的制作时间。

## ArmorHelper 原版

原版产出的是 1.3 时代的格式：`Armor_Head`、`Armor_Body`、`Armor_Arm`、`Armor_Legs`，各 40×1120、20 帧竖排。

泰拉瑞亚 1.4.4 把玩家渲染重写成 *composite* 体系，身体与双臂合并为一张 9 × 4 网格，旧输出不再可用。本重写版保持模板格式与绘制流程完全不变，只是产出新格式。

「原版作者是 Mirsario，工具开发于 2018 年」，技术栈是 .NET Framework / WinForms。最早发布在泰拉瑞亚论坛（TCF），见[原帖](https://forums.terraria.org/index.php?threads/armorhelper-sprite-armor-sets-30x-times-faster.68744/)。

`v1/` 目录保留原版工具的压缩包与模板。

## 开发和部署

网页本身在 `web/` 目录，没有构建步骤，交给任意静态服务器即可。浏览器不允许在 `file://` 下加载 ES 模块，所以要经 HTTP 打开：

```bash
npm start        # 仓库自带的 node tools/serve.mjs，需要 Node 20+
# 打开 http://127.0.0.1:8000/
```

放在哪个目录都能跑：所有资源、Service Worker 的注册与缓存都用相对路径，所以 `https://example.com/任何/子目录/`、`https://user.github.io/<仓库名>/` 都能直接访问，不需要改配置（`tests/node/subpath.test.mjs` 会把它挂到 `/some/deep/directory/` 下跑一遍）。

推一次 `main` 分支即可。在仓库设置里把 Pages 的 Source 选为 **GitHub Actions**，`.github/workflows/pages.yml` 会跑全部测试，然后把 `web/` 发布出去。

## 致谢

* 原版工具、模板美术与工作流：**Mirsario**。
* 新复合贴图布局的考证：泰拉瑞亚 1.4.5 源码与原版贴图集。

## 许可

MIT。随包分发的 `ArmorTemplate_v1.png` 来自 Mirsario 的 ArmorHelper v1。
