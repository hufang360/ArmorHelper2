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
| 想让别人快速预览效果 | 结果卡片内联 20 帧拼版与 GIF |

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
| WG-4 | 零依赖：无框架、无 npm 包、无 CDN，离线可用 |
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

```
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

### 3.3 目录结构

```
web/
  index.html  style.css  app.js  sw.js  manifest.webmanifest
  package.json  .nojekyll  README.md
  js/     bitmap data generate compose reverse sheets atlas png gif zip fs idb
  data/   layout.json  armor_sets.json  i18n.json
          ArmorTemplate_v1.png  ArmorTemplate_overlay.png  icon.png
          vanilla/（748 张内置原版贴图 → head/legs/body 的 WebP 图集
                   + index.json + version.txt，见 3.4）
          player/（内置玩家贴图 Player_0_3 / 0_7 / 0_10 + version.txt）
  tests/  run.mjs（Node 自检）  smoke.html（浏览器自检）
          golden/（冻结的参考输出 + manifest.json）
```

### 3.4 内置贴图的打包格式

`web/data/vanilla/` 只放打包后的产物，源文件（748 张 PNG）不进仓库：

```
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
python3 tools/pack_vanilla_textures.py "/path/to/Content/Images" --version 1.4.5.8
```

脚本会自己校验「页面里重建出来的像素 = 源 PNG 的像素」（内容 checksum），不一致直接报错。

---

## 4. 运行与部署

### 4.1 本地

```bash
python3 -m http.server 8000 --directory web    # 或 npx serve web
```

浏览器不允许 `file://` 下加载 ES 模块，因此必须经静态服务器打开。

### 4.2 GitHub Pages

`.github/workflows/pages.yml`：

1. checkout；
2. 装 Pillow 与 pytest（`pip install -r requirements-dev.txt`）；`web/data/` 本身就是数据，
   确认提交的数据没有过期；
3. 跑 `npm test`（核心逐像素 + 浏览器端到端 + 站点 + 文档）与 `pytest tests`（图集打包器）；
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
| WFR-01 | 拖放或点选多张 128×80 模板，可单个移除 / 清空 | 必须 | WC-02 |
| WFR-02 | 非 128×80 的图片要给出提示并跳过 | 必须 | WC-13 |
| WFR-03 | 12 项导出目标复选，默认勾选与桌面版一致 | 必须 | WC-03 |
| WFR-04 | 生成头部 / 腿部 / 复合身体 / 发光遮罩 / 旧格式贴图 | 必须 | WC-05 |
| WFR-05 | 结果卡片并排显示「绘制模板 (128×80)」「生成效果 (20 帧)」「GIF 动画」三个带标题的预览 | 必须 | WC-05 |
| WFR-06 | 指定盔甲 ID 时使用原版文件名与 `Armor/` 子目录 | 必须 | WC-06 |
| WFR-07 | 单文件下载与打包 zip 下载，zip 保留目录结构 | 必须 | WC-05 |
| WFR-08 | 可选「女性版本」「叠加玩家」用于预览；玩家贴图**内置**（`data/player/`），无 `Content/Images` 时也能用 | 应该 | WC-07 |
| WFR-09 | 反向还原：可搜索套装列表（中文名 / 英文名 / ID），条目形如 `中文名  英文名  (ID)` | 必须 | WC-08 |
| WFR-10 | 选中套装自动填入头/身/腿 ID，可手改 | 必须 | WC-08 |
| WFR-11 | 还原结果展示 128×80 模板（放大 4 倍）与其 20 帧预览，可下载 | 必须 | WC-09 |
| WFR-12 | 「还原全部套装」批量还原贴图齐全的套装 | 必须 | WC-10 |
| WFR-13 | 支持读取用户指定的 `Content/Images` 目录（Chromium） | 应该 | WC-11 |
| WFR-14 | 支持手动上传需要的那几张贴图（其它浏览器） | 必须 | WC-11 |
| WFR-15 | 支持写入用户指定的输出目录（Chromium），并记住授权 | 应该 | WC-12 |
| WFR-16 | 设置持久化（语言、勾选、ID、发光、肤色、预览开关） | 必须 | WC-14 |
| WFR-17 | 界面中英文切换即时生效 | 应该 | WC-15 |
| WFR-18 | 可选「生成后自检」：反向还原再生成，应与原贴图一致 | 可以 | WC-16 |
| WFR-19 | 所有错误以状态栏文字呈现，不弹原生 alert | 必须 | WC-13 |
| WFR-20 | 页面不请求任何外部地址（离线可用） | 必须 | WC-17 |
| WFR-21 | 可选的参考线图层（`data/ArmorTemplate_overlay.png`，128×80）叠加在模板预览与下载的绘制模板上；**生成贴图时不得参与** | 应该 | WC-21 |
| WFR-22 | 「预览贴图」标签页：头部 / 身体 / 腿部**三个独立的上传格子**（各有点击、拖放、移除），生成男女 20 帧 PNG 与 GIF；可选叠加玩家；结果可下载、打包或写入输出目录 | 必须 | WC-24 |
| WFR-23 | 槽位状态实时显示（✓ / 缺少），缺部位时禁用生成按钮；一次拖入多个文件时按文件名自动分配到**空**槽位，重复与无法识别给出提示 | 应该 | WC-24 |
| WFR-24 | 拖进槽位的文件尺寸不合法（列数、宽高比、高度）时**拒绝放入**并在状态栏给出该槽位能接受的尺寸，不做静默缩放 | 必须 | WC-25 |
| WFR-25 | GIF 速率可选快（每帧 100ms）/ 中（500ms）/ 慢（1000ms），尺寸可选 1× / 2× / 4×（最近邻），选择写入 localStorage 并作用于所有 GIF | 必须 | WC-26 |
| WFR-26 | 批量任务（导出、还原全部套装）显示 `i/n` 进度与进度条，并可中途取消；取消后保留已完成的结果、按钮恢复可用 | 必须 | WC-27 |
| WFR-27 | 导出历史：记下时间、名称、文件数与缩略图，最多 20 条，可清空；写满配额时静默跳过，不影响导出 | 应该 | WC-28 |
| WFR-28 | Service Worker 预缓存启动所需的全部文件（内置贴图按需缓存），Web App Manifest 提供名称/图标/独立窗口，注册失败时静默降级 | 应该 | WC-29 |
| WFR-29 | 「下载绘制模板」按钮 hover / 聚焦时弹出 popover，显示**即将下载的那张图**（含参考线，随参考线开关变化） | 应该 | WC-30 |
| WFR-30 | 「预览贴图」页提供「生成材质包」：把三个槽位的贴图按游戏的资源包结构打成 `<名称>-pack-pc.zip`（`pack.json` + `Content/Images/Armor_Head_<id>.png` + `Armor_Legs_<id>.png` + `Armor/Armor_<id>.png`），可直接放进 `ResourcePacks/`；缺槽位时按钮禁用 | 必须 | WC-32 |
| WFR-31 | 内置贴图按「部位 + id」打包成 WebP 图集（`index.json` + 若干页），读取时按 `index.scale` 放大回 2×、并按 `index.strays` 补回例外像素；仓库里只放打包产物（748 张 PNG 不进仓库） | 必须 | WC-33 |
| WFR-32 | 任何图集页不得超过 2048×2048：打包脚本拒绝超限页，`index.json` / `version.txt` 记录上限，读取端校验后拒绝加载 | 必须 | WC-33 |

---

## 6. 界面需求

### 6.1 布局

```
┌ ArmorHelper · 泰拉盔甲贴图工具 · 网页版 ─── [导出贴图][预览贴图][反向还原][设置] [中文▾] ┐
│ ┌─ 输入文件 ───────────────────────┐  ┌─ 导出结果（一半页宽）──────────────────┐  │
│ │ ┌──────────────────────────────┐ │  │ 铜盔甲                                │  │
│ │ │ 把 128×80 的绘制模板拖到这里   │ │  │ [绘制模板 128×80][生成效果 20 帧][GIF]│  │
│ │ │ 或点击选择（可多选）           │ │  │ 铜盔甲_Head.png  40×1120 · 1 KB       │  │
│ │ └──────────────────────────────┘ │  │ 铜盔甲_Legs.png  40×1120 · 1 KB       │  │
│ │ 铜盔甲.png  128×80   ✕            │  │ 铜盔甲_Body.png  360×224 · 2 KB       │  │
│ │ [清空] [下载绘制模板]  ⤴ popover  │  │ [打包下载 (zip)] [写入输出目录]        │  │
│ │                                  │  └──────────────────────────────────────┘  │
│ │ 导出选项                         │                                             │
│ │ ☑ 头部贴图 ☑ 腿部贴图 ☑ 身体贴图  │   （空着时本卡片与左侧输入卡等高）            │
│ │ …（共 12 项）                    │                                             │
│ │ 预览选项                         │  ┌─ 最近导出 ────────────────────────────┐  │
│ │ ☐ 女性版本 ☐ 叠加玩家            │  │ 🖼 2026-11-03 01:46  铜盔甲  3 个文件  │  │
│ │ [          开始导出           ]  │  └──────────────────────────────────────┘  │
│ └──────────────────────────────────┘                                             │
└──────── 状态栏：就绪 · 纯前端，全部在本机处理 ────────────── [进度条][取消] ────────┘
```

「预览贴图」页把左侧换成三个槽位（头部 / 身体 / 腿部），右侧仍是结果区：

```
┌─ 三张成品贴图 → 全身预览 ───────────────────┐ ┌─ 导出结果 ──────────────────┐
│ 头部（Armor_Head_ · 40×1120px）   [移除]     │ │ 全身盔甲（男）/（女）GIF     │
│ ┌──── 缩略图 + 文件名 尺寸 ────┐             │ │ 20 帧拼版                   │
│ 身体（Armor_ · 360×224）         [移除]       │ │ Armor_190_FullArmor.png  …  │
│ 腿部（Armor_Legs_ · 40×1120px）  [移除]       │ │ [打包下载 (zip)] [写入…]     │
│ GIF 速率 ▾   GIF 尺寸 ▾   ☐ 叠加玩家          │ └─────────────────────────────┘
│ [生成预览] [生成材质包] [清空]                │
└───────────────────────────────────────────────┘
```

### 6.2 控件与行为

| 编号 | 控件 | 需求 |
|---|---|---|
| WUI-01 | 顶部标签页 | 四个面板纯前端切换，不重新加载 |
| WUI-02 | 语言下拉 | 立即切换全部文案与 `<html lang>`，写入 localStorage |
| WUI-03 | 拖放区 | `dragenter/dragover` 高亮；支持点击与键盘 Enter |
| WUI-04 | 结果卡片 | 预览图 `image-rendering: pixelated` + 棋盘格底；每张预览下方有 `figcaption` 说明 |
| WUI-05 | 状态栏 | 四色反馈；所有错误走这里。站点是纯静态的，**没有后端可连**，所以启动成功后只写「就绪 · 纯前端，全部在本机处理」，不出现「已连接」这类连接字样 |
| WUI-06 | 文件夹按钮 | 不支持 File System Access 时按钮降级并在状态栏说明 |
| WUI-07 | 套装列表 | `<select size=8>`，搜索框 140ms 防抖 |
| WUI-08 | 处理中 | 按钮禁用 + `busy` 文案，避免重复提交 |
| WUI-09 | 全局错误兜底 | `error` / `unhandledrejection` 都写进状态栏，不静默失败 |
| WUI-10 | 参考线开关 | 「预览选项」里的复选框，默认开启；关闭后模板预览不叠加参考线 |
| WUI-11 | 站点图标 | `data/icon.png` 同时用作 `<link rel="icon">`、`apple-touch-icon` 与页头标志；页头标志按平滑渲染（不加 `image-rendering: pixelated`） |
| WUI-12 | 启动自检 | 若套装表为空或页面缺少脚本引用的元素，状态栏给出明确原因（含强制刷新提示），不得静默留下空列表 |
| WUI-13 | 「预览贴图」标签页 | 三个槽位各自可点击 / 键盘 / 拖放 / 移除，标题写明原版文件名前缀与尺寸（`头部（Armor_Head_ · 40×1120px）`）；放入后显示该贴图的缩略图（40×1120 这类长图显示首帧 2×，身体 9×4 显示整张）与「文件名 + 尺寸」；状态行显示 ✓ 与缺失项；GIF 速率与尺寸在标签页内直接可选 |
| WUI-14 | 导出页布局 | 两列：左列一张卡片装「输入文件 + 导出选项 + 预览选项 + 开始导出」，下面接「最近导出」；右列是**占一半页宽的导出结果**；≤900px 单列堆叠 |
| WUI-15 | 结果卡片高度 | 空着时与左侧输入卡**等高**（内联 `min-height`，随输入卡变化实时重算）；一旦出现结果就丢掉这个下限，改由内容决定高度（两个标签页一致） |
| WUI-16 | 模板 popover | 悬停或聚焦「下载绘制模板」时显示 4× 放大、带棋盘格底的模板图，移开即隐藏；参考线开关变化后重新取图 |
| WUI-17 | 进度与取消 | 状态栏左侧是文字进度，右侧是进度条与「取消」按钮，仅在多步任务中出现 |
| WUI-18 | 文件行 | 文件名、尺寸、操作按钮相邻排列，尺寸不被推到卡片另一侧 |

### 6.3 视觉

* 深色主题，配色集中在 `:root` 变量。
* 主栏 flex 自适应，窄屏自动换行。
* 不依赖任何外部字体、图标或 CDN。

---

## 7. 非功能需求

| 编号 | 类别 | 需求 |
|---|---|---|
| WNFR-01 | 零依赖 | 运行时不需要任何第三方库；Python 只用于测试与 `tools/` 里的打包脚本 |
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

功能上 Web 版已经覆盖它：12 个导出目标（含 `gif-full*`）、模板生成、反向还原（单套 /
全部）、成品贴图 → 全身帧与 GIF、玩家肤色 0~9、发光遮罩、生成后自检、中英文；
另外多了材质包导出、导出历史、离线缓存、进度与取消。

---

## 10. 验收标准

| 编号 | 验收内容 | 对应测试 |
|---|---|---|
| WC-01 | 页面可加载，模块可解析 | ``browser.test.mjs`` |
| WC-02 | 多张模板一次导出 | 浏览器自检 `smoke.html` |
| WC-03 | 目标勾选与默认值与数据一致 | ``site.test.mjs`` |
| WC-04 | 生成结果逐像素等于冻结的参考图 | ``tests/node/core.test.mjs``：``core.test.mjs`` 等 |
| WC-05 | 预览、GIF、zip 正确 | ``core.test.mjs``、``core.test.mjs``、``harness.test.mjs``、``browser.test.mjs`` |
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
| WC-19 | `web/` 里没有 Python | `test_no_python_left_in_the_web_app` |
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
| WC-30 | 模板 popover 显示 4× 模板 | ``browser.test.mjs`` |
| WC-31 | 文案只有一份，且没有死条目 | ``docs.test.mjs``（`web/data/i18n.json`） |
| WC-32 | 资源包 zip 的条目名、`pack.json` 与三张 PNG 与游戏一致 | ``browser.test.mjs``（浏览器点「生成材质包」→ 用 `zipfile` 解开，逐项比对文件名、`pack.json` 字段，并把三张 PNG 与冻结的参考图逐像素比较） |
| WC-33 | 打包图集：页内矩形与张数自洽、重建像素与记录的 checksum 一致、单页 ≤ 2048×2048（脚本拒绝超限、`maxPage` 记录、`validateIndex` 校验） | `test_vanilla_bundle.py` 18 项（含 `test_every_page_fits_the_2048_cap`、`test_the_pages_reproduce_the_recorded_content_checksum`、`test_the_javascript_reader_knows_the_same_cap`）、`harness.test.mjs`（图集读取） |

---

## 11. 已知限制与后续可做

| 编号 | 内容 |
|---|---|
| WL-01 | 文件夹读写仅 Chromium 支持，其它浏览器用下载 / zip |
| WL-02 | 浏览器拿不到本机路径，无法自动定位游戏目录，需要用户选一次 |
| WL-03 | 不支持 `.xnb`，需要已解包的 PNG 资源目录 |
| WL-04 | 全部在内存处理，一次几百套盔甲可能吃紧 |
| WL-05 | 没有 Service Worker，刷新后需要重新联网加载（可加 PWA） |

后续可做：Service Worker 离线缓存、还原时允许直接上传整套贴图、
导出历史记录、把 GIF 帧率/尺寸做成可调。
