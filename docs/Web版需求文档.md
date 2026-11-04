# ArmorHelper Web 版需求文档

| 项目 | 内容 |
|---|---|
| 文档名称 | ArmorHelper Web 版需求规格说明书 |
| 版本 | v2.0（纯静态，可部署 GitHub Pages） |
| 状态 | 已实现（`web/` 是**唯一实现**；2.0 的 Python 版已移除，其输出冻结在 `web/tests/golden/`） |
| 基准游戏版本 | 泰拉瑞亚 1.4.5（贴图格式自 1.4.4 起生效） |
| 兄弟文档 | [`需求文档.md`](需求文档.md)（核心行为与算法规格；命令行 / 桌面界面章节为历史） |
| 目标读者 | 模组作者、贴图美术、工具维护者 |

> **v1 到 v2 的变化**：v1 是「本地 Python HTTP 服务 + 浏览器前端」，无法部署到
> GitHub Pages。v2 把全部图像逻辑移植成原生 ES 模块，**没有任何服务端**，是一个纯静态站点。
>
> **2.1：只剩一个实现**。2.0 时代还并行维护一个 Python 包（命令行 + wxPython 桌面界面），
> 作为参考实现；它已被移除。移除之前，它的输出被冻结成 `web/tests/golden/` 里的图片
> （含 sha256 清单），``tests/node/core.test.mjs`` 让网页版的像素继续钉在那些数字上 ——
> 「逐像素一致」这条要求因此从「跨实现比对」变成「对金标准比对」。

---

## 1. 背景与定位

| 痛点 | Web 版的对策 |
|---|---|
| 装 wxPython 麻烦、跨平台编译 | 浏览器打开即用，零安装 |
| 想分享给别人看 | 部署到 GitHub Pages，发个链接就行 |
| 想在平板 / 另一台机器上用 | 只要有浏览器 |
| 想让别人快速预览效果 | 结果卡片内联 GIF；材质包卡片直接给出两个版本的贴图 |

**核心约束**：GitHub Pages 只能托管静态文件。因此 Web 版必须**在浏览器里完成全部
图像处理**，不能依赖任何服务端接口。

---

## 2. 目标与范围

### 2.1 目标

| 编号 | 目标 |
|---|---|
| WG-1 | 纯静态：任意静态托管（含 GitHub Pages）都能跑，无服务端、无构建步骤 |
| WG-2 | 功能对齐桌面版：导出、反向还原、还原全部、预览、GIF、原版命名、预览贴图（成品贴图 → 全身帧与 GIF）、生成材质包 |
| WG-3 | 输出**逐像素**等于冻结的参考图（`web/tests/golden/`），并有自动化测试证明 |
| WG-4 | 零构建：无打包器、无 CDN、无服务端。唯一的第三方代码是随站点发布的 Bootstrap 5.3 CSS，离线可用 |
| WG-5 | 中英文界面，与桌面版共用同一份文案 |
| WG-6 | 在 Chromium 上可直接读写用户指定的文件夹（写入游戏资源目录） |

### 2.2 范围内

* 单页应用（HTML + CSS + 原生 ES 模块）
* 贴图生成（头部 / 腿部 / 身体复合 / 旧格式 / 发光遮罩）
* 20 帧合成、拼版预览、GIF 动画
* 反向还原（单套 / 全部套装）
* 成品贴图 → 全身 20 帧 / GIF（不经模板），三个部位各一个上传格子
* GIF 速率（快 / 中 / 慢）与尺寸（1× / 2× / 4×）可调
* PNG / GIF / ZIP 编码
* 设置持久化（localStorage）、目录句柄持久化（IndexedDB）与导出历史
* 长任务进度与取消
* File System Access API 集成（可选增强）
* Service Worker 离线缓存 + Web App Manifest（可安装为 PWA）
* Node 下的核心自检 + 浏览器内自检

### 2.3 范围外

* 服务端渲染 / 后端接口（v1 的能力已移除）
* 账号、云端存储、多用户
* `.xnb` 解码
* 浏览器扩展；应用商店上架

---

## 3. 总体设计

### 3.1 架构

```text
┌──────────────────────── 浏览器（唯一运行环境）────────────────────────┐
│  index.html + style.css + app.js                                      │
│    ├─ 文件拖放 / 选择（FileReader、createImageBitmap）                 │
│    ├─ 设置（localStorage）＋ 目录句柄（IndexedDB）                     │
│    └─ 结果预览（data URL / object URL）                                │
│                                                                        │
│  js/  ← 纯计算核心，不碰 DOM                                           │
│    bitmap.js   位图操作                                                 │
│    data.js     布局 / 套装表 / 文案                                    │
│    generate.js 贴图生成                                                 │
│    compose.js  帧合成                                                   │
│    reverse.js  反向还原                                                 │
│    sheets.js   三张成品贴图 → 帧 / GIF                                  │
│    atlas.js    读取打包好的内置贴图图集（裁切 + 1×→2× 还原）           │
│    png.js / gif.js / zip.js   编码器                                   │
│    fs.js / idb.js            浏览器胶水                                │
│                                                                        │
│  data/  ← 数据本身（layout / 套装表 / 文案 / 模板 / 参考线）           │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键设计决定

| 决定 | 理由 |
|---|---|
| 用原生 ES 模块，不打包 | 无构建链，改完刷新即生效；Pages 直接发布源码 |
| 样式用 Bootstrap 5.3，CSS 放在 `web/vendor/` | 组件与栅格直接可用，省掉手写控件样式；文件随站点发布、进 Service Worker 预缓存，所以不加构建步骤、不请求外部地址 |
| 核心模块不碰 DOM | 同一份代码能在 Node 里跑，从而与冻结的金标准做逐像素对比 |
| 常量集中在 `data/layout.json` | 单一份数据源；JS 不再重新实现常量 |
| 自己做 PNG/GIF/ZIP 编码 | 不引入依赖；PNG 绕开 canvas 的 alpha 预乘问题，保证像素精确 |
| 目录句柄存 IndexedDB | 句柄不能进 localStorage，但可以被结构化克隆 |
| 浏览器不支持文件夹时降级 | 用下载 / zip / 手动上传贴图，功能不缺失 |
| 文案只留 `data/i18n.json` 一份 | 没有生成器，也没有第二份覆盖文件；``docs.test.mjs`` 守着「不能有死条目」 |
| 离线用 Service Worker 预缓存 | 启动所需文件全部进缓存；内置贴图（17 页 WebP 图集，约 290 KB）改为按需缓存，安装不吃流量 |
| 内置贴图按「部位 + id」打包成图集 | 748 张散图 → 17 页 WebP + `index.json`（1.68 MB → 约 290 KB，请求数 453 → ≤17）。按套装打包覆盖不全（204 套只引用了 530 张，另 218 张不属于任何套装），且拼页会破坏压缩，实测 2× PNG 反而涨到 2.07 MB |
| 图集里存 1× 像素 + 例外表 | 原版贴图都是 1× 的精确 2× 放大，存 1× 再运行时放大，像素少 4 倍；120 个不符合 2×2 的像素记在 `index.json` 里补回，重建结果逐字节一致 |
| 单页不超过 2048×2048 | 浏览器解码上限（iOS Safari 还限总面积），超了直接画不出来；由打包脚本拒绝、`index.json` 与 `version.txt` 记录、`atlas.js` 加载时再校验，测试守住 |
| 预览贴图用三个槽位而不是自动识别 | 用户直接指定部位，识别只作为「一次拖入多个文件」时的便利，错了随时可换 |
| GIF 速率/尺寸只改播放参数 | 帧像素不变，金标准断言不受影响 |
| 结果卡片存 i18n key，渲染时才翻译 | 卡片不能在生成那一刻把译文冻死，否则切语言后已经画出来的卡片停在旧语言（这个 bug 真出现过）；`state.results` 统一重绘 |
| 长任务逐项检查 + `nextFrame()`，不用 AbortController | 中途硬断 fetch 会留下不一致的结果；逐项检查更简单，也更好测；取消后已完成的结果仍可用 |
| 参考线是独立叠加层，生成器只读原始模板 | 但随包模板本身已含参考线（overlay 的 4395 个像素与模板逐像素相同），所以现在叠加是**空操作**；用「只有美术的模板」验证过整条路径 |
| 材质包照游戏的 `ResourcePacks` 结构打包 | 结构与自带的 `01-pack-pc.zip` 一致；zip 名用 ASCII 的 `Armor_<id>-pack-pc.zip`（游戏按 `*-pack-pc.zip` 扫描），`pack.json` 的 `Name` 用中文名（资源包列表里显示的就是它） |
| 玩家贴图内置（`data/player/`） | 手机没有目录 API，不内置就永远勾不出「叠加玩家」；用户选了 `Content/Images` 时优先用用户的 |
| 图集打包用 wasm 版 libwebp（devDependency） | 图集必须无损，Node 没有内置 WebP 编码；站点本身没有 npm 依赖（体积对照见附录 A） |

### 3.3 目录结构与工具

```text
web/                  纯静态站点（发布的就是这个目录）
  index.html  style.css  app.js  sw.js  manifest.webmanifest
  vendor/  bootstrap.min.css（随站点发布，不请求 CDN）  bootstrap.LICENSE
  package.json  .nojekyll  README.md
  js/     bitmap data generate compose reverse sheets atlas png gif zip fs idb
  data/   layout.json  armor_sets.json  armor_names.json  i18n.json
          ArmorTemplate_v1.png  ArmorTemplate_overlay.png  icon.png
          vanilla/（748 张内置原版贴图 → head/legs/body 的 WebP 图集
                   + index.json + version.txt，见 3.4）
          player/（内置玩家贴图 Player_0_0 / 0_1 / 0_3 / 0_7 / 0_10 + version.txt）
  tests/  run.mjs（Node 自检）  smoke.html（浏览器自检）
          golden/（冻结的参考输出 + manifest.json）
tools/                打包 / 开发脚本，全是 .mjs，与站点同一套 Node 工具链
tests/node/           npm test：core · harness · browser · bundle · docs · site · subpath
```

| 工具 | 用途 |
|---|---|
| `npm run pack` → `tools/pack_vanilla_textures.mjs` | 把已解包的 `Content/Images` 打包成 `web/data/vanilla` 的 WebP 图集（1× 存储、按部位分页、每页 ≤ 2048px） |
| `npm run sets` → `tools/build_armor_sets.mjs` | 由游戏源码（`ArmorSetBonuses.cs` 等）生成 `web/data/armor_sets.json` 与 `web/data/armor_names.json`（各部位的 ID → 名称） |
| `npm run check` → `tools/check.mjs` | 语法、重复声明、调用了但未声明的名字、i18n 键，约 1 秒；不替代 `npm test` |
| `npm run players` → `tools/import_player_textures.mjs` | 把 `Player_0_0 / 0_1 / 0_3 / 0_7 / 0_10.png` 复制进 `web/data/player/` |
| `npm run inspect` → `tools/inspect_armor.mjs` | 按引擎规则渲染任意 1.4.4+ 身体贴图，方便与原版对照 |
| `npm start` → `tools/serve.mjs` | 静态服务器（`http://127.0.0.1:8000/`） |

```bash
npm ci                                              # 只装图集打包要用的 wasm 编解码器
npm run pack -- "/path/to/Content/Images" --version 1.4.5.8
npm run sets -- "/path/to/tr-code-1458"
npm run players -- "/path/to/Content/Images" --version 1.4.5.8
npm run inspect -- "Terraria/Content/Images/Armor/Armor_1.png" --frames 0,5
```

`@jsquash/webp`（libwebp 的 wasm 版）只是 **devDependency**：图集必须无损编码，Node 自带不了。
发布出去的站点没有 npm 依赖，由浏览器原生解码 WebP。体积对照见附录 A.1。

### 3.4 内置贴图的打包格式

`web/data/vanilla/` 只放打包后的产物，源文件（748 张 PNG）不进仓库：

```text
web/data/vanilla/
  version.txt      元数据：版本 / 张数 / 分类张数 / 页数 / 单页上限 / 总字节 / checksum
  index.json       pages（每页文件名与尺寸）+ sheets（每张图在页里的矩形）+ strays（例外像素）
  head-0.webp ...  legs-0.webp ...  body-0.webp ...
```

三条约定：

1. **按部位（head / legs / body）而不是按套装打包。** 同部位的贴图尺寸一致、拼页没有空隙；
   而且套装表只引用了 530 / 748 张图，按套装打包会漏掉 218 张（头 128 / 腿 90），
   还得再补一个「零散」图集——等于两套机制。读取时用游戏路径即可定位：
   `Armor_Head_1.png` → `Armor_Head_1`，`Armor/Armor_1.png` → `Armor/Armor_1`。
2. **页里存 1× 像素。** 原版贴图是 1× 像素画的精确 2× 最近邻放大，故只存 1×，
   `atlas.js` 读取时按 `index.scale` 放大回 2×；120 个破例像素写在 `index.strays` 里补回。
   重建结果与原图逐字节一致（`test_the_pages_reproduce_the_recorded_content_checksum`）。
3. **任何一页都不得超过 2048×2048。** 这是个硬约束：浏览器解不了更大的图（iOS Safari
   还限制 canvas 总面积）。打包脚本的 `MAX_PAGE` 常量拒绝超限的 `--page-size`、
   `version.txt` 的 `max_page` 与 `index.json` 的 `maxPage` 都会记下来，`atlas.js` 的
   `validateIndex` 在加载时再校验一遍，测试同时盯住这三处。默认页边 1024（≈4 MB/页），
   这样单套还原最多解 4 页就能拿到头 / 腿 / 身体。

重新打包（游戏更新后）：

```bash
npm run pack -- "/path/to/Content/Images" --version 1.4.5.8
```

脚本会自己校验「页面里重建出来的像素 = 源 PNG 的像素」（内容 checksum），不一致直接报错。

---

## 4. 运行与部署

### 4.1 本地

```bash
npm start        # 仓库自带的 node tools/serve.mjs（或任意静态服务器）
```

浏览器不允许 `file://` 下加载 ES 模块，因此必须经静态服务器打开。

### 4.2 GitHub Pages

`.github/workflows/pages.yml`：

1. checkout；
2. `npm ci`（只为图集打包的 wasm 编解码器）；`web/data/` 本身就是数据，
   确认提交的数据没有过期；
3. 跑 `npm test`（核心逐像素 + 浏览器端到端 + 图集 + 站点 + 文档）；
4. `actions/upload-pages-artifact` 上传 `web/`，`actions/deploy-pages` 发布。

仓库设置里把 Pages 的 Source 选为 **GitHub Actions** 即可。

`web/.nojekyll` 防止 Jekyll 忽略下划线开头的路径。

`web/sw.js` 与 `web/manifest.webmanifest` 让站点可以离线打开、并被浏览器「安装」成
独立窗口。`sw.js` 里的 `CORE` 清单必须覆盖启动所需的每个文件，``site.test.mjs``
会逐一检查；改文件名后记得同时升级 `CORE` 与 `VERSION`。

---

## 5. 功能需求

| 编号 | 需求 | 优先级 | 验收 |
|---|---|---|---|
| WFR-01 | 拖放或点选一张 128×80 模板，只接受 PNG 与 WebP；拖放区右上角的垃圾桶图标清空当前选择，也可再选一张替换；载入新模板即重新出结果 | 必须 | WC-02 |
| WFR-01a | 「来个 Demo」按钮载入内置绘制模板 `data/ArmorTemplate_v1.png` 作为示例，走与拖放相同的校验与重画流程；该图已带参考线，载入后隐藏参考线图标，预览与下载都按原图处理 | 应该 | WC-02 |
| WFR-01b | 输入区右上角有四个图标按钮：参考线、下载、清空、最近导出。参考线图标切换「模板预览叠加参考线」并把叠加后的画面显示在拖放区，tooltip 为「叠加标注画面」；下载图标下载当前画面，叠加开着就给合并后的图，关着就是原图。清空图标在没有模板时禁用。图标按钮用样式化 tooltip，不用 `title` | 必须 | WC-02 |
| WFR-02 | 非 128×80 的图片、非 PNG / WebP 的文件要给出提示并拒绝载入，不产出贴图 | 必须 | WC-13 |
| WFR-03 | 没有导出目标可勾选：载入模板后三个页签的内容总是齐全。材质包卡片始终存在 | 必须 | WC-03 |
| WFR-04 | 生成头部 / 腿部 / 复合身体 / 发光遮罩 / 1.3 旧格式贴图 | 必须 | WC-05 |
| WFR-04a | 载入模板后「材质包」卡片始终存在：第一行标题，第二行按当前页签给出操作按钮（1.4.4+ 为「生成材质包」，1.3 为「打包下载」，全身盔甲页签没有按钮），第三行为 `1.4` / `1.3` / `全身盔甲` 三个页签，页签下是该版本的 `文件名 / 尺寸 / 说明` 三列表与贴图预览列，1.4.4+ 页签在「尺寸」与「说明」之间多一列「盔甲 ID」：数字输入 + 原版中文名（`data/armor_names.json`，查不到就只显示数字）。表格每行都有横向格线，尺寸不带 `px` 单位 | 必须 | WC-05 |
| WFR-04b | 两个页签的 zip 不同：1.4.4+ 写 `pack.json` 与 `Content/Images/` 下三张，1.3 只写 `Content/Images/` 下五张（1.3 没有资源包机制） | 必须 | WC-05 |
| WFR-04c | 1.4.4+ 页签的「生成材质包」右侧有 `pack.json` 输入组（名称 / 作者 / 描述），留空取默认值，值写入设置并在下次打开时回填 | 应该 | WC-05 |
| WFR-04d | 「全身盔甲」页签始终列出四张全身盔甲 PNG 与四个 GIF（`FullArmor.png` 等），同样以表格 + 预览列呈现 | 应该 | WC-05 |
| WFR-05 | 导出结果区只有「材质包」卡片；20 帧动画放在拖放区右侧的等高矩形框里，预览选项也在该框内。模板预览在「反向还原」页 | 必须 | WC-05 |
| WFR-06 | 指定盔甲 ID 时使用原版文件名与 `Armor/` 子目录 | 必须 | WC-06 |
| WFR-07 | 单文件下载与打包 zip 下载，zip 保留目录结构 | 必须 | WC-05 |
| WFR-08 | 可选「女性版本」「叠加玩家」用于预览；玩家贴图**内置**（`data/player/`），无 `Content/Images` 时也能用 | 应该 | WC-07 |
| WFR-09 | 反向还原：可搜索套装列表（中文名 / 英文名 / ID），条目形如 `中文名  英文名  (ID)` | 必须 | WC-08 |
| WFR-10 | 选中套装自动填入头/身/腿 ID，可手改 | 必须 | WC-08 |
| WFR-11 | 还原结果展示 128×80 模板（放大 4 倍）与其 20 帧预览，可下载 | 必须 | WC-09 |
| WFR-12 | 「还原全部套装」批量还原贴图齐全的套装 | 必须 | WC-10 |
| WFR-13 | 支持读取用户指定的 `Content/Images` 目录（Chromium） | 应该 | WC-11 |
| WFR-14 | 支持手动上传需要的那几张贴图（其它浏览器） | 必须 | WC-11 |
| WFR-15 | 支持写入用户指定的输出目录（Chromium）并记住授权；导出页的结果卡只提供 zip，写入由「预览贴图」与「反向还原」提供 | 应该 | WC-12 |
| WFR-16 | 设置持久化（语言、勾选、ID、发光、肤色、预览开关） | 必须 | WC-14 |
| WFR-17 | 界面中英文切换即时生效 | 应该 | WC-15 |
| WFR-18 | 可选「生成后自检」：反向还原再生成，应与原贴图一致 | 可以 | WC-16 |
| WFR-19 | 所有错误以状态栏文字呈现，不弹原生 alert | 必须 | WC-13 |
| WFR-20 | 页面不请求任何外部地址（离线可用） | 必须 | WC-17 |
| WFR-21 | 可选的参考线图层（`data/ArmorTemplate_overlay.png`，128×80）叠加在拖放区预览、拖放区下载与「反向还原」页的模板预览上；**生成贴图时不得参与** | 应该 | WC-21 |
| WFR-22 | 「预览贴图」标签页：头部 / 身体 / 腿部**三个独立的上传格子**（各有点击、拖放、移除），生成男女 20 帧 PNG 与 GIF；可选叠加玩家；结果可下载、打包或写入输出目录 | 必须 | WC-24 |
| WFR-23 | 槽位状态实时显示（✓ / 缺少），缺部位时禁用生成按钮；一次拖入多个文件时按文件名自动分配到**空**槽位，重复与无法识别给出提示 | 应该 | WC-24 |
| WFR-24 | 拖进槽位的文件尺寸不合法（列数、宽高比、高度）时**拒绝放入**并在状态栏给出该槽位能接受的尺寸，不做静默缩放 | 必须 | WC-25 |
| WFR-25 | GIF 速率可选快（每帧 100ms）/ 中（500ms）/ 慢（1000ms），尺寸可选 1× / 2× / 4×（最近邻），选择写入 localStorage 并作用于所有 GIF | 必须 | WC-26 |
| WFR-26 | 批量任务（还原全部套装等）显示 `i/n` 进度与进度条，并可中途取消；取消后保留已完成的结果、按钮恢复可用 | 必须 | WC-27 |
| WFR-27 | 导出历史：记下时间、名称、文件数与缩略图，最多 20 条，可清空；写满配额时静默跳过，不影响导出 | 应该 | WC-28 |
| WFR-28 | Service Worker 预缓存启动所需的全部文件（内置贴图按需缓存），Web App Manifest 提供名称/图标/独立窗口，注册失败时静默降级 | 应该 | WC-29 |
| WFR-30 | 「预览贴图」页提供「生成材质包」：把三个槽位的贴图按游戏的资源包结构打成 `<名称>-pack-pc.zip`（`pack.json` + `Content/Images/Armor_Head_<id>.png` + `Armor_Legs_<id>.png` + `Armor/Armor_<id>.png`），可直接放进 `ResourcePacks/`；缺槽位时按钮禁用 | 必须 | WC-32 |
| WFR-31 | 内置贴图按「部位 + id」打包成 WebP 图集（`index.json` + 若干页），读取时按 `index.scale` 放大回 2×、并按 `index.strays` 补回例外像素；仓库里只放打包产物（748 张 PNG 不进仓库） | 必须 | WC-33 |
| WFR-32 | 任何图集页不得超过 2048×2048：打包脚本拒绝超限页，`index.json` / `version.txt` 记录上限，读取端校验后拒绝加载 | 必须 | WC-33 |

---

## 6. 界面需求

### 6.1 布局

```text
┌ ArmorHelper v2.2.0 · 泰拉盔甲贴图工具 · 网页版 ─ [导出贴图][预览贴图][反向还原][设置] [中文▾][🌳][🐙] ┐
│ ┌──────────────────────────────────┐  ┌─ 导出结果（一半页宽）──────────────────┐  │
│ │ ┌──────────────────────────────┐ │  │ ┌─ 材质包 ───────────────────────┐ │  │
│ │ │ 128:80 拖放区（靠左）[🗑][◫][◷][⤓]│ │  │ │ [生成材质包] [名称|作者|描述]   │ │  │
│ │ │ 拖入/上传 绘制模板             │ │  │ │ (1.4) (1.3) (全身盔甲)          │ │  │
│ │ │ 支持 .png 和 .webp 格式        │ │  │ │ 文件名/尺寸/ID/说明 四列         │ │  │
│ │ └──────────────────────────────┘ │  │ │ 头 / 身 / 腿 贴图列（共用一个滚动区）│ │  │
│ │ ┌──────────────┐                 │  │ └──────────────────────────────┘ │  │
│ │ │ [20帧动画][▶][❙◀][▶❙]│  ← 与拖放区等高 │                                  │  │
│ │ │          5/52  │                 │  │                                  │  │
│ │ │ ☐女 ☐玩家      │                 │  │                                  │  │
│ │ │ [速率 ▾]       │                 │  │                                  │  │
│ │ │ [尺寸 ▾]       │                 │  │                                  │  │
│ │ └──────────────┘                 │  │                                  │  │
│ │ [上传] [来个 Demo]                │  │                                  │  │
│ │ 导出结果：材质包卡片在这里         │  │                                  │  │
│ └──────────────────────────────────┘  └──────────────────────────────────┘  │
└──────── 状态栏：就绪 · 纯前端，全部在本机处理 ────────────── [进度条][取消] ────────┘
```

「预览贴图」页只有一张卡，自上而下依次是：拖拽区、选项、按钮、结果：

```text
┌─ 三张成品贴图 → 全身预览 ────────────────────────────────────────────────────┐
│ 头 [180×224] │ 身体 [360×224] │ 腿 [180×224]                                │
│ GIF 速率 ▾   GIF 尺寸 ▾   ☐ 叠加玩家 ⓘ                                      │
│ [上传] [来个 Demo] [下载材质包]                                              │
│ 导出结果：全身盔甲（男）/（女）GIF、20 帧拼版、文件列表                      │
│ [打包下载 (zip)] [写入…]                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 控件与行为

| 编号 | 控件 | 需求 |
|---|---|---|
| WUI-01 | 顶部标签页 | 四个面板纯前端切换，不重新加载；选中项是**加粗文字 + 下划线**，不用填充按钮的观感 |
| WUI-02 | 语言下拉 | 立即切换全部文案与 `<html lang>`，写入 localStorage |
| WUI-02a | 页头链接 | 语言下拉右侧两个图标按钮，都新窗口打开：树图标是泰拉瑞亚 wiki 的盔甲 ID 页（`https://terraria.wiki.gg/zh/wiki/Armor_IDs`，英文界面换 `https://terraria.wiki.gg/wiki/Armor_IDs`），tooltip 写 `wiki:盔甲ID`；GitHub 图标是本项目仓库（`https://github.com/hufang360/ArmorHelper2`），tooltip 写「开源仓库（GitHub）」。图标用 `svg`，不引外部图片；页面本身仍不发出任何外部请求 |
| WUI-03 | 拖放区 | `dragenter/dragover` 高亮；支持点击与键盘 Enter |
| WUI-04 | 结果卡片 | 预览图 `image-rendering: pixelated` + 棋盘格底；每张预览下方有 `figcaption` 说明 |
| WUI-05 | 状态栏 | 四色反馈；所有错误走这里。站点是纯静态的，**没有后端可连**，所以启动成功后只写「就绪 · 纯前端，全部在本机处理」，不出现「已连接」这类连接字样 |
| WUI-06 | 文件夹按钮 | 不支持 File System Access 时按钮降级并在状态栏说明 |
| WUI-07 | 套装列表 | `<select size=8>`，搜索框 140ms 防抖 |
| WUI-08 | 处理中 | 按钮禁用 + `busy` 文案，避免重复提交 |
| WUI-09 | 全局错误兜底 | `error` / `unhandledrejection` 都写进状态栏，不静默失败 |
| WUI-10 | 参考线开关 | 同一个设置（`state.config.guide`）有两个入口：导出页拖放区右上角的图标（`aria-pressed` 表示状态），「反向还原」页的复选框。默认开启 |
| WUI-11 | 站点图标 | `data/icon.png` 同时用作 `<link rel="icon">`、`apple-touch-icon` 与页头标志；页头标志按平滑渲染（不加 `image-rendering: pixelated`） |
| WUI-11a | 版本号 | 页头标题右侧显示 `v<版本>`，来源是 `data/version.json`（启动时读取，取不到就不显示，不阻塞页面）。该文件、根 `package.json`、`web/package.json` 三处版本必须一致，由 `site.test.mjs` 断言 |
| WUI-11b | 帮助卡片 | 导出贴图与预览贴图两页在操作卡片下方各有一张「操作说明」卡，四行编号说明，文案走 i18n（`web.helpExport` / `web.helpSheets`），不折行由 `white-space: pre-line` 负责 |
| WUI-12 | 启动自检 | 若套装表为空或页面缺少脚本引用的元素，状态栏给出明确原因（含强制刷新提示），不得静默留下空列表 |
| WUI-13 | 「预览贴图」标签页 | 单卡自上而下：拖拽区、选项行、按钮行、结果；先放贴图，再调参数，最后才是动作按钮。三个拖拽区可点击 / 键盘 / 拖放，宽度固定 `180px 360px 180px`、高 `224px`，身体那格正好是贴图的 `360×224`；标题写「头」「身体」「腿」，拖拽区文字两行：`拖入 / 上传 png图片` 与原版文件名示例加尺寸（`Armor_Head_0.png · 40×1120`、`Armor_0.png · 360×224(整数倍也行)`、`Armor_Legs_0.png · 40×1120`）。放入后整张显示贴图，文件名与尺寸分两行写在格子下方，格子左上角显示 ✓；状态行只写警告，不再逐个说明还缺哪个部位；GIF 速率与尺寸在标签页内直接可选 |
| WUI-13b | 拖拽区的图标按钮 | 每个拖拽区右上角有 × 图标按钮，清空该格。头部与腿部形状相同，× 下方再加左右箭头图标：只有两格都有贴图时出现，点一下互换两格。这类按钮不触发文件选择（`stopPropagation`），tooltip 由 CSS 显示 |
| WUI-13c | 批量上传 | 按钮行有「上传」：选择 1~3 张图片，按文件名分板（`Armor_Head_*` / `Armor_*` / `Armor_Legs_*`）。名字说不清时先看形状：宽图是身体，竖图是头或腿；头与腿形状相同，文件更大的那张当腿部。只剩一张竖图无法区分时，状态行按 `web.sheetWarnUnknown` 提示用户手动拖到对应区域。`web.sheets` 匹配不上任何部位也走同一条提示 |
| WUI-13d | 按钮行（预览贴图页） | 从左到右固定为「上传」「来个 Demo」「下载材质包」。「来个 Demo」从内置原版图集按需取出金冠 26 / 金链甲 4 / 金护胫 4 三张贴图填格，不额外放任何图片。「下载材质包」默认隐藏，三张齐备才出现并可用；「上传」在三张齐备前是 `btn-primary`，齐备后降为 `btn-secondary`。原先的「清空」按钮已移除，清空走每格的 × |
| WUI-13a | 预览贴图实时出结果 | 没有「生成预览」按钮：三张贴图加两个下拉就是全部输入。三个槽位都填上就出结果，之后改速率 / 尺寸 / 叠加玩家、换槽位、点 × 都立即重画；槽位不全时结果清空。历史只在贴图组合变化时追加一条，改下拉不追加。`[生成材质包]` 仍是手动动作，三张齐了才解禁 |
| WUI-14 | 导出页布局 | 一张卡装全部：输入行（拖放区 + 等高预览框）、动作行（上传 / 来个 Demo）、结果区（材质包卡片）。卡片没有标题；结果区与输入在同一张卡里，空着时不写占位文字 |
| WUI-15 | 结果卡片高度 | 「反向还原」页的结果卡空着时与左侧输入卡**等高**（内联 `min-height`，随输入卡变化实时重算）；一旦出现结果就丢掉这个下限，改由内容决定高度。导出页与预览贴图页的结果在同一张卡里，不适用 |
| WUI-16 | 预览框 | 拖放区右侧一个与之等高的矩形框，宽度固定 `12.5rem`，不随窗口变宽，且默认隐藏：有模板才出现，清空拖放区后再次隐藏。上方是动画与右侧的帧控制，下方是「女性版本 / 叠加玩家」两个开关与提问图标，再往下是 `GIF 速率` 与 `GIF 尺寸` 两个下拉，竖排、宽度都固定 `11.2rem`、字号小于 `form-select-sm` |
| WUI-16a | 帧控制 | 动画画在 `canvas` 上，不播放 GIF：`<img>` 里的 GIF 无法暂停到某一帧。动画右侧竖排三个图标按钮，自上而下为播放 / 暂停、上一帧、下一帧；按钮下方是「当前帧/总帧数」。帧号按导出 GIF 的帧序列计，长度是 `gifFrameOrder()` 的长度，停顿与重复帧各占一格。默认播放，切到上一帧或下一帧时自动暂停 |
| WUI-27 | 材质包卡片的滚动区 | 页签以下的内容（文件表 + 贴图列）共用一个滚动容器；贴图列自身不再单独滚动 |
| WUI-27a | 滚动条外观 | 细条、无轨道背景；静止时滑块透明，鼠标移入或正在滚动时才显示（滚动结束后约 0.7 秒淡出） |
| WUI-17 | 进度与取消 | 状态栏左侧是文字进度，右侧是进度条与「取消」按钮，仅在多步任务中出现 |
| WUI-18 | 输入区不留文件行 | 不再有文件摘要与文件列表：只处理一张模板，载入后由拖放区显示模板本身，文件名与尺寸不进版面 |
| WUI-19 | 内容区宽度 | 页头、主栏与状态栏共用同一个容器，最大宽度 1320px 并水平居中；更宽的窗口只留背景 |
| WUI-20 | 尺寸密度 | 按钮一律 `btn-sm`；控件间距与卡片内边距取紧凑值，一屏放得下导出页的选项与按钮 |
| WUI-20a | 按钮层级 | 主动作（上传、生成材质包、保存设置、还原）用 `btn-primary`；其余次要按钮（来个 Demo、打包下载、清空）用 `btn-secondary`，不用描边样式。最近导出是拖放区里的纯图标按钮（WUI-23） |
| WUI-21 | 输入区 | 拖放区按模板自身的 128:80 比例并靠左；未载入时显示提示文字，载入后直接显示模板图片本身；只处理一张，载入新模板即重画结果 |
| WUI-28 | 输入区图标 | 图标放在拖放区右上角，自上而下为清空、参考线、历史、下载，四个同尺寸同线宽，整组只在鼠标移入时淡入。点击不触发文件选择（`stopPropagation`）；参考线图标用 `aria-pressed` 与高亮表示状态，和「反向还原」页的同名复选框共用同一个设置；tooltip 是 `data-tooltip` 上的文案，由 CSS 显示，切语言时一起翻译 |
| WUI-26 | 材质包卡片 | 始终显示，放在导出结果区最上面。标题 → 操作行 → 页签 → 内容。页签用下划线样式，切换只重建卡片，不重新生成贴图；页签选择记在设置里。文件名是下载链接，悬停或聚焦时浮出该图；切语言时整张卡片重画 |
| WUI-26a | 操作行 | 操作按钮按当前页签变化（生成材质包 / 打包下载）。1.4.4+ 页签的按钮右侧接一个 `input-group`，放 `pack.json` 的名称 / 作者 / 描述输入框；宽度不够时 `input-group` 整体换到下一行 |
| WUI-24 | 实时导出 | 没有导出按钮：载入模板后立即出结果，改预览开关、改 ID、改 `GIF 速率` 或 `GIF 尺寸`、切页签都直接重画；历史只在新模板时追加一条 |
| WUI-24a | 实时预览贴图 | 「预览贴图」页同样没有生成按钮（见 WUI-13a），重画延迟 120ms，旧的一次重画不得覆盖新的一次 |
| WUI-25 | 结果文件行 | 只显示名称与 `宽×高px`，不显示体积；鼠标悬停或聚焦链接时浮出该图预览 |
| WUI-22 | 两组 GIF 选项 | 导出页的 `GIF 速率` / `GIF 尺寸` 只作用于导出结果，「预览贴图」页的同名下拉只作用于该页；两组设置各自记在本地，互不影响 |
| WUI-23 | 导出历史入口 | 历史收进拖放区右上角的时钟图标按钮；点开后浮层显示记录与「清空记录」，点浮层外部或按 Esc 关闭 |
| WUI-29 | 拖放区图标 | 右上角四个图标：参考线、下载、垃圾桶、时钟（历史）。参考线在 Demo 模板下隐藏；垃圾桶在没有模板时禁用；前三个都阻止冒泡，点图标不打开文件选择 |

### 6.3 视觉

* 深色主题：Bootstrap 5.3 的 `data-bs-theme="dark"` 加上 `style.css` 里的配色变量。
* 组件与栅格用 Bootstrap；`style.css` 只写 Bootstrap 没有的部分：拖放区、槽位、像素预览、历史、状态栏。
* 内容区最大宽度 1320px 并居中；按钮统一 `btn-sm`；间距紧凑。
* 主栏栅格自适应，窄屏单列。
* 不依赖任何外部字体、图标或 CDN。

---

## 7. 非功能需求

| 编号 | 类别 | 需求 |
|---|---|---|
| WNFR-01 | 依赖 | 运行时唯一的第三方代码是 `web/vendor/bootstrap.min.css`（Bootstrap 5.3.3，随站点发布、进预缓存）；不引 CDN，不加构建步骤；唯一的 devDependency 是图集打包用的 wasm WebP 编解码器 |
| WNFR-02 | 一致性 | 输出逐像素等于 `web/tests/golden/` 的参考图，由 ``tests/node/core.test.mjs`` 断言 |
| WNFR-03 | 静态性 | `web/` 目录内不得出现 `.py`；发布产物就是源码 |
| WNFR-04 | 性能 | 单张模板全量导出（含预览与 GIF）< 2 秒（桌面 Chrome） |
| WNFR-05 | 离线 | 页面不发起任何外部请求；首次打开后由 Service Worker 缓存，断网可继续使用 |
| WNFR-06 | 可测试性 | 核心模块不碰 DOM，可在 Node 下运行并对比 |
| WNFR-07 | 兼容性 | Chrome / Edge / Firefox / Safari 最新版；文件夹功能仅 Chromium |
| WNFR-08 | 健壮性 | IndexedDB 不可用时不得卡死（2 秒超时降级） |
| WNFR-09 | 像素精确 | PNG 自行编码，绕开 canvas alpha 预乘；缩放一律最近邻 |
| WNFR-10 | 国际化 | 文案在 `web/data/i18n.json`（中英各一份，键必须一一对应） |

---

## 8. 数据契约

这些文件就是数据本身（以前由 Python 包导出），Web 版只读：

| 文件 | 内容 |
|---|---|
| `data/layout.json` | 模板区域、帧偏移表、格子映射、逐帧图层、导出目标清单 |
| `data/armor_sets.json` | 204 条原版套装（body/head/legs/name/zh/confidence） |
| `data/armor_names.json` | 各部位的 ID → 名称（`ItemID.cs`），材质包卡片的 ID 列用它显示中文名；读不到时不报错，只是没有名字 |
| `data/i18n.json` | 中英文案（唯一来源；只允许「在用」的键，``docs.test.mjs`` 守着） |
| `tests/golden/` | 冻结的参考输出 + `manifest.json`（sha256），`tests/node/core.test.mjs` 的比对目标 |
| `data/ArmorTemplate_v1.png` | 128×80 绘制模板 |

CI 会重新生成并比对，**数据过期会导致构建失败**。

---

## 9. 与已移除的 Python 版（2.0）对照

| 能力 | 2.0 的 Python 版 | 现在的 Web 版 |
|---|---|---|
| 运行方式 | 命令行 / wxPython 桌面窗口 | 浏览器（静态站点） |
| 依赖 | Pillow；桌面界面需 wxPython | 无 |
| 图像逻辑 | `armorhelper/*.py` | `web/js/*.js`（唯一实现） |
| 一致性保证 | 自身即参考实现 | 与 `web/tests/golden/` 逐像素比对 |
| 输入 | 文件对话框 / 拖放 | 拖放 / 点选（浏览器） |
| 输出目录 | 直接写文件系统 | File System Access（Chromium）或下载 / zip |
| 读取游戏贴图 | 直接读目录 | 内置图集 / 目录句柄（Chromium）/ 手动上传 |
| 设置 | `config.json` | `localStorage` |
| 部署 | 本机 | GitHub Pages / 任意静态托管 |
| 现状 | **已移除**（git 历史 + `web/tests/golden/` 保留其行为） | 唯一实现 |

2.0 的命令行与桌面界面规格（界面线框、UI-01~21、`config.json`、非功能需求、
Python 时代的验收表）在 [`历史-2.0.md`](历史-2.0.md)。

功能上 Web 版已经覆盖它：8 个导出目标（含 `gif-full*`）、带 1.4 / 1.3 页签的材质包卡片、模板生成、反向还原（单套 /
全部）、成品贴图 → 全身帧与 GIF、玩家肤色 0~9、发光遮罩、生成后自检、中英文；
另外多了材质包导出、导出历史、离线缓存、进度与取消。

---

## 10. 验收标准

| 编号 | 验收内容 | 对应测试 |
|---|---|---|
| WC-01 | 页面可加载，模块可解析 | ``browser.test.mjs`` |
| WC-02 | 单张模板载入、替换与清空 | 浏览器自检 `smoke.html` |
| WC-03 | 三个页签的内容总是齐全，不依赖勾选 | ``browser.test.mjs`` |
| WC-04 | 生成结果逐像素等于冻结的参考图 | ``tests/node/core.test.mjs``：``core.test.mjs`` 等 |
| WC-05 | 预览、GIF、zip 正确 | ``core.test.mjs``、``core.test.mjs``、``harness.test.mjs``、``browser.test.mjs``（材质包卡片两个页签的表格、输入组、预览列与两个 zip 的条目名） |
| WC-06 | 原版 ID 命名与子目录 | 浏览器自检 + ``browser.test.mjs``（材质包条目名） |
| WC-07 | 女性 / 玩家预览可生成（玩家贴图内置，无需目录） | 浏览器自检 `20 composed frames`、``browser.test.mjs``（勾选叠加玩家后产出 8 个文件 / 5 个预览）、``site.test.mjs`` |
| WC-08 | 套装搜索含中文名与 ID | 浏览器自检 `set search finds stardust` |
| WC-09 | 还原结果可下载且为 128×80，卡片里并排出现三个带标题的预览 | ``core.test.mjs``、``browser.test.mjs``（在浏览器里模拟上传贴图并点「还原这一套」） |
| WC-10 | 还原全部可批量产出（并带进度） | ``browser.test.mjs``（完整跑一次，断言 > 100 个文件） |
| WC-11 | 目录读取与手动上传 | 手工（需真实浏览器授权） |
| WC-12 | 目录写入 | 手工（需真实浏览器授权） |
| WC-13 | 非法输入有提示不崩溃 | 浏览器自检的错误分支 + 手工 |
| WC-14 | 设置持久化 | 手工 / localStorage 检查 |
| WC-15 | 中英文切换 | `test_frontend_files_exist_and_are_wired` 文案键校验 |
| WC-16 | 生成后自检 | 浏览器自检 `reverse round trip is lossless` |
| WC-17 | 页面无外部请求 | `test_frontend_files_exist_and_are_wired` |
| WC-18 | 数据与金标准没有漂移 | ``core.test.mjs``（sha256 清单）+ ``docs.test.mjs`` |
| WC-19 | `web/` 里没有 Python（也没有任何 `.py`） | `site.test.mjs`（`the web app holds no Python`） |
| WC-20 | Pages 工作流正确发布 | `test_pages_workflow_publishes_the_web_folder` |
| WC-21 | 参考线只画在预览与模板上，不影响生成结果 | ``browser.test.mjs``、``browser.test.mjs`` |
| WC-22 | 内置贴图可用（含手机场景） | `test_bundle_has_a_version_file` 等 18 项 + ``browser.test.mjs``（仅靠内置贴图还原一次） |
| WC-23 | 站点图标被引用，且不会被导出脚本覆盖 | `test_site_icon_is_used`、`test_export_does_not_touch_the_icon` |
| WC-24 | 三张成品贴图 → 男女 20 帧 / GIF，且与参考图逐像素一致 | ``core.test.mjs``、``core.test.mjs``、``core.test.mjs``、``harness.test.mjs``、``browser.test.mjs`` |
| WC-25 | 槽位拒绝不合尺寸的贴图并给出可读原因 | ``browser.test.mjs``（把身体贴图拖进头部槽位）、``harness.test.mjs`` |
| WC-26 | GIF 速率与尺寸生效且被记住 | ``browser.test.mjs``（选「慢 + 2×」后 GIF 宽度翻倍、localStorage 里是 slow/2） |
| WC-27 | 批量任务有进度且能取消 | ``browser.test.mjs``（取消一次 + 完整跑完一次） |
| WC-28 | 导出历史写入 localStorage 且有缩略图 | ``browser.test.mjs``（`armorhelper.history`） |
| WC-29 | 预缓存清单完整、Manifest 合法、SW 已注册 | ``site.test.mjs``、``site.test.mjs``、``site.test.mjs`` |
| WC-31 | 文案只有一份，且没有死条目 | ``docs.test.mjs``（`web/data/i18n.json`） |
| WC-32 | 资源包 zip 的条目名、`pack.json` 与三张 PNG 与游戏一致 | ``browser.test.mjs``（浏览器点「生成材质包」→ 用 `zipfile` 解开，逐项比对文件名、`pack.json` 字段，并把三张 PNG 与冻结的参考图逐像素比较） |
| WC-33 | 打包图集：页内矩形与张数自洽、重建像素与记录的 checksum 一致、单页 ≤ 2048×2048（脚本拒绝超限、`maxPage` 记录、`validateIndex` 校验） | `bundle.test.mjs` 19 项（含 `every page fits the 2048 cap`、`the pages reproduce the recorded content checksum`、`the JavaScript reader knows the same cap`）、`harness.test.mjs`（图集读取） |

---

## 11. 已知限制

| 编号 | 内容 |
|---|---|
| WL-01 | 文件夹读写仅 Chromium 支持，其它浏览器用下载 / zip / 手动上传贴图；**还原**仍可用内置贴图 |
| WL-02 | 浏览器拿不到本机路径，无法自动定位游戏目录，需要用户自己选一次（不选也能用内置贴图还原） |
| WL-03 | 不支持 `.xnb`，需要已解包的 PNG 资源目录 |
| WL-04 | 全部在内存处理，一次几百套盔甲可能吃紧 |
| WL-05 | `file://` 不能直接用：ES 模块受 CORS 限制，必须经静态服务器打开 |
| WL-06 | Service Worker 需要 HTTPS / localhost；`file://` 下没有离线缓存（功能本身可用） |
| WL-07 | 改了 `web/` 的文件却不升 `sw.js` 的 `VERSION`，已安装的旧缓存会继续命中 |
| WL-08 | 文件夹授权刷新后被浏览器收回，每次操作要再要一次（句柄本身存在 IndexedDB） |
| WL-09 | 内置玩家贴图只有原版默认肤色；用材质包或自改皮肤时请在设置里选 `Content/Images` |
| WL-10 | `event.waitUntil()` 只能在事件派发期间调用：放进 `respondWith` 的 `.then()` 会抛 `InvalidStateError` 并让这次 fetch 直接失败，后台缓存必须用普通浮动 promise |

### 11.1 未验证

* **非 Chromium 浏览器**（Firefox / Safari）的降级路径与 Service Worker 注册未实测。
* **离线只有静态断言**（`CORE` 清单 + Manifest + 注册代码），没有真的断网重载过。
* 套装表的中文名来自游戏源码的 `zh-Hans` 本地化，游戏版本升级后需要重新生成。

### 11.2 后续可做

| 优先级 | 内容 | 说明 |
|---|---|---|
| P1 | 非 Chromium 实测、离线自动化 | 用 Chrome 的 `Network.emulateNetworkConditions` 断网后重载，断言页面仍能启动 |
| P2 | 套装表补全 | 204 条里 53 条缺头或缺腿（13 条置信度 `none`）；值得加一张人工覆盖表，免得每次重新生成又被覆盖 |
| P2 | 「预览贴图」一键用内置原版贴图 | 现在只能自己上传三张图 |
| P2 | 导出历史可点击回填 | 现在只记时间 / 名称 / 文件数 / 缩略图，不能重新下载 |
| P3 | 导出页也放 GIF 速率/尺寸 | 目前只有「预览贴图」页有控件（设置全局生效） |
| P3 | 模板扩展（行走手臂 / 肩部各占区域） | 能明显提升反向还原保真度，但模板没有空闲像素、必须重画，金标准也要整批重做 —— 见 [`需求文档.md`](需求文档.md) §5.1 |
| P3 | `.xnb` 解码、发光层图形化编辑 | 工作量都在解析器 / 编辑器上 |

---

## 附录 A：取舍与实测

### A.1 内置图集的几种做法

| 做法 | 实测 | 结论 |
|---|---|---|
| 只裁掉空白（2× PNG） | 1.680 MB → 1.061 MB（−37%） | 有用但不是大头；WebP 下只有 −3%，空白本来就几乎免费 |
| 换 WebP lossless（2× 散图） | 1.680 MB → 0.329 MB | 单这一项就是 −80%，**采用** |
| 存 1× 再运行时放大 | 0.329 MB → 0.270 MB；像素 41.7M → 10.4M | **采用**，前提是 3.4 的「确实是精确 2× 放大」 |
| 按套装打包（1× WebP） | 106 页 0.279 MB，且覆盖不全（204 套只引用 530 张，218 张不属于任何套装） | **否决**；按部位打包 17 页 267 KB + 索引 30 KB |

首屏体积（同一页面、同一批图）：无损 WebP 图集 **297 KB**、PNG 图集 2 298 KB（**8.6×**）、
748 张散图 1 150 KB（748 个请求）。这就是 `@jsquash/webp` 只作 devDependency 的唯一理由。

### A.2 被否决的方案

| 方案 | 为什么否决 |
|---|---|
| 服务端式 Web 版（Python `http.server` + 一组 JSON 接口） | GitHub Pages 只能托管静态文件，部署不了；代码留在 git 历史里 |
| 2× 模板（256×160） | 不需要：原版贴图都是 1× 的精确 2× 放大，1× 模板已能无损往返 |
| 无头浏览器测试用 `--virtual-time-budget` + `--dump-dom` | 虚拟时间跑在真实异步之前，约一半概率在页面完成前 dump，且不随预算增大而改善；改为页面 `POST /__done` 回报结果 |
| 无头测试服务器沿用默认的 HTTP/1.0 | 每次请求都关连接，Chrome 同时拉十几个模块时约 1/4 概率卡满 40 秒；改 HTTP/1.1 长连接后稳定 |
| 把 `web/` 放进 Python 包（`armorhelper/web/`） | 静态站点不该和 Python 包混在一起；现在还有测试禁止 `web/` 里出现 `.py` |

### A.3 测试栈

`node --test` 内置、零依赖。浏览器用例用 `node:http` 起静态服务器 + `child_process` 拉
Chrome，靠页面 `POST /__done` 回报结果，而不是 sleep 等。为此自带两个解码器：
`tools/lib/png.mjs`（`node:zlib` + 五种滤波）与 `tests/node/lib/gif.mjs`（GIF89a + LZW）——
「与冻结参考图逐像素比对」因此不再需要 Pillow，`tools/inspect_armor.mjs` 也能直接读 PNG。

### A.4 已修但容易回归的坑

每条都修过一次以上，或只在一个选项下才触发。改代码前读一遍。

| 坑 | 现象与现状 |
|---|---|
| 浏览器缓存让 `index.html` 与 `app.js` 版本错配 | 盔甲套列表为空，状态栏没有提示。现在 `wire()` 用 `on()` 容错；启动结束检查套装表，为空就提示强制刷新 |
| `ImageBitmap.close()` 清零宽高 | 关闭后再读 `width`/`height` 得 0，`getImageData` 报「source width is 0」。先取尺寸，再关闭 |
| `withTimeout` 泄漏定时器 | `web/js/idb.js` 的守卫定时器不在 promise 结束后 `clearTimeout`，IndexedDB 不可用时启动卡住 |
| GIF 调色板遍历错对象 | `web/js/gif.js` 要遍历 `frame.data`，不是 `frame` |
| 还原时「文件名 → 槽位」映射 | 曾把原版文件名当字典键，结果只还原出躯干。映射在 `web/js/reverse.js` 的 `loadTextures()` |
| 静态服务器用 HTTP/1.0 | 每个请求都关连接。Chrome 同时拉十几个模块时会卡几十秒。必须 HTTP/1.1 长连接 |
| `renderFolders()` 里残留 `!!images` | 引用了从未声明的变量。`!needsPlayer` 会短路，只有勾上「叠加玩家」才抛 `images is not defined` |
| 结果卡片的 zip / 写入按钮 | `const zip` / `const save` 曾遮蔽 `result.zip` / `result.save`。`zipBlob()` 收 `{name, data}`；Blob 条目走 `zipBlobAsync()` |
| 结果卡片文案在生成时就译好 | 切语言后卡片停在旧语言。结果对象只存 `titleKey` / `captionKey`，`applyI18n()` 用 `state.results` 重绘 |
| 浏览器测试写进 `~/Downloads` | 用例会真的点「下载」。harness 吞掉带 `download` 属性的 `<a>` 点击，并把 `download.default_directory` 指到临时目录 |

无头用例收集页面里所有 `error` / `unhandledrejection`，断言列表为空。只在某个选项下才触发的
`ReferenceError` 也会让它变红。不要以「平时看不见」为由跳过。

### A.5 测试清单

```bash
npm ci          # devDependency：wasm WebP 编解码器（只有打包工具与图集用例要用）
npm test        # 全部用例，约 16 秒
npm start       # 静态服务器：http://127.0.0.1:8000/
```

| 文件 | 覆盖 |
|---|---|
| `tests/node/core.test.mjs` | `web/js/` 核心 vs `web/tests/golden/` 的冻结参考图，逐像素 |
| `tests/node/harness.test.mjs` | 贴图查找、部位识别、图集读取、zip 结构、拼版 PNG |
| `tests/node/browser.test.mjs` | 真 Chrome 里跑完整交互（拖放、导出、预览贴图、材质包、取消、还原全部、切语言） |
| `tests/node/bundle.test.mjs` | WebP 图集自洽、内容 checksum、从源目录重打的可复现性 |
| `tests/node/docs.test.mjs` | 裁切表 ↔ `layout.json`、文档链接、用词、README 章节与格式、文案无死条目 |
| `tests/node/site.test.mjs` | 数据、HTML↔JS 接线、SW 的 `CORE` 清单、Manifest、图标、图集包、Pages 工作流、无绝对路径 |
| `tests/node/subpath.test.mjs` | 把站点挂到 `/some/deep/directory/` 下，真 Chrome 跑启动 + 图集 + 反推 + SW 作用域 |

用例数会随开发变化，以 `npm test` 的输出为准，本文不再拄一份。

设置 `ARMORHELPER_VANILLA_SOURCE="<Content/Images>"` 时，`bundle.test.mjs` 会把整包从源目录
重打一遍，并把 748 张贴图逐像素还原比对（约 30 秒）。
