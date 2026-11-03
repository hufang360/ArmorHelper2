# ArmorHelper · Web 版

纯前端实现，**没有任何服务端**：所有贴图生成、反向还原、预览与编码都在浏览器里完成。
可以直接部署到 GitHub Pages，也能离线使用（用任意静态服务器打开即可）。

这是**这个工具唯一的实现**。2.0 时代的 Python 版（命令行 + wxPython 桌面界面）已经移除，
它当时的输出被冻结成 `web/tests/golden/` 里的图片，网页版的像素仍被钉在那些数字上
（`tests/node/core.test.mjs`）。

---

## 快速开始

### 本地打开

浏览器不允许 `file://` 下的 ES 模块，用一个静态服务器打开即可（Python 自带就够）：

```bash
python3 -m http.server 8000 --directory web
# 然后访问 http://127.0.0.1:8000/
```

或者用 Node：

```bash
npx serve web
```

### 部署到 GitHub Pages

仓库里已经带了工作流 `.github/workflows/pages.yml`：

1. 把仓库推到 GitHub。
2. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
3. 推一次 `main` 分支（或手动触发 *Deploy the web app to GitHub Pages*）。

工作流会：

* 跑 `npm test`（核心逐像素、浏览器端到端、站点与文档）
  与 `tests/test_vanilla_bundle.py`（内置图集）；
* 把 `web/` 整个目录发布为 Pages 站点。

站点地址：`https://<用户名>.github.io/<仓库名>/`

> `web/.nojekyll` 已经就位，避免 Jekyll 忽略下划线开头的文件。

---

## 用法

### 导出贴图

1. 把 128×80 的绘制模板**拖进**页面，或点一下选择（可多选）。没有模板可以点「下载绘制模板」。
2. 勾选要导出的内容（头部 / 腿部 / 身体 / 旧格式 / 全身盔甲 / GIF，共 12 项）。
3. 点「开始导出」。

结果卡片里会有：

* **绘制模板预览**（128×80 放大 4 倍，棋盘格底；默认叠加参考线，可在「预览选项」里关掉）
* **20 帧拼版预览**（棋盘格底，`image-rendering: pixelated` 不糊）
* **GIF 动画预览**
* 每个产物的大小与下载链接
* **打包下载 (zip)** —— 保留原版 `Armor/` 目录结构，解压即用
* **写入输出目录** —— 需要先在「设置」里选一个文件夹（见下）

### 写入游戏目录

Chromium 内核浏览器（Chrome / Edge）支持 File System Access API，可以让网页直接读写你指定的文件夹：

* 「设置 → 输出目录」选你的 `Terraria/Content/Images`，之后导出就能一键写进去；
* 「反向还原 → 原版贴图来源」选同一个目录，网页就能直接读取 `Armor_Head_*.png`、
  `Armor/Armor_*.png`、`Armor_Legs_*.png`。

文件夹授权会被浏览器在刷新后收回，所以每次操作时会再问一次；句柄本身存在 IndexedDB 里，
不用每次重新挑。

Firefox / Safari 没有这个 API，此时请用**下载 / 打包下载**，或者用「或选择贴图文件...」
手动上传需要的那几张 PNG。

### 参考线叠加层

`data/ArmorTemplate_overlay.png` 是可选的 **128×80 参考线图层**（区域底色 + 分区线 + 边框），
用来在预览里看清模板的分区。

* 它只用于**显示**和**给美术的绘制底稿**，**生成贴图时永远不参与**——生成器只读原始模板。
* 默认开启（「导出贴图 → 预览选项 → 模板预览叠加参考线」）；文件不存在时自动忽略。
* 你自己画的干净模板（没有参考线）也可以借此对照分区是否对齐。

> **注意（实测数据）**：随包分发的 `ArmorTemplate_v1.png` 本身已经含参考线 ——
> 模板 5646 个不透明像素里，overlay 占 4395 个且与模板逐像素相同，另外 1251 个才是美术。
> 所以现在叠加在视觉上是**空操作**：下载得到的模板与原始文件完全一致（都是 5646 像素）。
>
> 想让这一层真正起作用，就把模板里的参考线擦掉（只留 1251 个美术像素）。之后：
> 预览与下载的模板仍会是 5646 像素（1251 + 4395），而生成的贴图不受任何影响。
> 这条路径有测试守着：`test_browser_download_applies_the_guide_overlay`
> 会用「只有美术的模板」跑一遍，断言下载结果确实多出那 4395 个像素。

### 预览贴图：三张贴图 → 全身动画

「预览贴图」标签页：

1. 头部 / 身体 / 腿部**各有一个格子**，把对应贴图拖进去（也可以点击选择）。格子会显示
   文件名与尺寸，认错了就点「移除」换一张；塞进去的图尺寸不对会被拒绝并说明原因。
   一次把三张一起拖进任意一格也可以，会按文件名分配到头 / 身 / 腿。
2. 选 **GIF 速率**（快 100ms / 中 500ms / 慢 1000ms）和 **GIF 尺寸**（1× / 2× / 4×）。
3. 点「生成预览」。右侧会得到：**全身盔甲（男）**、**全身盔甲（女）**两个 GIF，
   以及 20 帧拼版预览和两张 PNG。
4. 勾选「叠加玩家」会再多两个「玩家 + 盔甲」的 GIF。玩家贴图**已内置**（`data/player/`，
   约 4 KB），所以手机上也能用；在设置里选了自己的 `Content/Images` 时优先用你的。
5. 结果可以单独下载、打包 zip，或一键写入输出目录。

这一步**不经过 128×80 模板**，而是像引擎那样直接采样成品贴图（腿 → 后肩 → 后臂 → 躯干 →
前肩 → 前臂 → 头），所以比「反向还原 → 重新生成」更准确，任何材质包都能预览。

### 生成材质包

三张图放好后点「生成材质包」，会得到一个 **`<名称>-pack-pc.zip`**，结构就是游戏读的那套：

```
pack.json                                 Name / Author / Description / Version
Content/Images/Armor_Head_<id>.png
Content/Images/Armor_Legs_<id>.png
Content/Images/Armor/Armor_<id>.png
```

`<id>` 取自身体贴图文件名（`Armor_190.png` → `190`），`pack.json` 的 `Name` 用套装中文名
（例如「星尘板甲」），zip 自身仍用 ASCII 名 `Armor_<id>-pack-pc.zip`。
把压缩包放进 `Terraria/ResourcePacks/`，游戏里勾选就能看到效果。
结果可以单独下载、打包，或者在 Chromium 上直接写入你选的 `ResourcePacks` 目录。

### 离线与安装

`sw.js` 会预缓存启动所需的全部文件（`CORE` 清单），内置贴图（17 页 WebP 图集，约 290 KB）
改成首次使用时再缓存，所以断网也能打开，刷新也不用重新下载。`manifest.webmanifest` 让 Chrome / Edge 可以把它
「安装」成独立窗口。首屏是 `file://` 打开时不会有 Service Worker（浏览器限制），
用静态服务器（本地或 Pages）即可。

### 反向还原

1. 「反向还原」标签页里搜索盔甲套（支持**中文名 / 英文名 / 任意 ID**），条目形如
   `星尘板甲  StardustPlate  (190)`。
2. 选中会自动填入头/身/腿 ID，也可以手改。
3. 「还原这一套」得到 128×80 模板，右侧并排显示
   **绘制模板 (128×80)**、**生成效果 (20 帧)** 与 **GIF 动画** 三个预览。
4. 「还原全部套装」会把贴图齐全的套装全部还原到 `<输出目录>/ArmorTemplate/`；
   没有输出目录时给一个 zip。

---

## 站点图标

`data/icon.png`（120×120 的金色盾徽）同时用于：

* 浏览器标签页图标 `<link rel="icon">`（也就是「网页左上角」那个）
* iOS 添加到主屏幕的图标 `<link rel="apple-touch-icon">`
* 页头左上角的标志

它是手工放置的资源，没有脚本会覆盖它（有测试守着）。

## 内置原版贴图（打包成图集）

`web/data/vanilla/` 里**只放打包后的产物**，748 张源 PNG 不进仓库：

```
web/data/vanilla/
  version.txt      游戏版本、张数、页数、单页上限（max_page=2048）、总字节、内容 checksum
  index.json       每页文件名与尺寸、每张贴图在页里的矩形（1× 尺寸）、例外像素
  head-0.webp …    legs-0.webp …    body-0.webp …
```

生成方式（游戏更新后重跑即可）：

```bash
python3 tools/pack_vanilla_textures.py "/path/to/Content/Images" --version 1.4.5.8
```

脚本做三件事，这也是 1.68 MB → 约 290 KB 的来源：

1. **按部位（head / legs / body）打包**，不按套装。套装表只引用了 530 / 748 张贴图，
   按套装打包必漏 218 张（头 128 / 腿 90）；同部位贴图尺寸一致，拼页也没有空隙。
2. **页里存 1× 像素**（原版贴图是 1× 的精确 2× 放大），`js/atlas.js` 读取时放大回 2×，
   再用 `index.strays` 补回 120 个破例像素，重建结果与原图逐字节一致。
3. **WebP lossless**：散图重编码后 PNG 只剩 1.19 MB，换 WebP 直接到 0.33 MB。

**单页不得超过 2048×2048**：这是浏览器解码上限（iOS Safari 还限制 canvas 总面积），
由打包脚本的 `MAX_PAGE` 拒绝超限值、写进 `version.txt` 的 `max_page` 与
`index.json` 的 `maxPage`，`js/atlas.js` 加载时再校验一次，测试同时盯住这三处。
默认页边 1024，单套还原最多解 4 页。

`tests/test_vanilla_bundle.py` 会核对页与索引是否自洽、页内矩形是否越界、
重建像素是否等于 `version.txt` 里的 checksum，单页是否 ≤ 2048，
并在设置了 `ARMORHELPER_VANILLA_SOURCE` 时验证脚本能从源目录**原样重建**
（逐张贴图与源 PNG 逐字节比对）。

## 数据来源

`web/data/` 就是数据本身，没有生成器了（以前由 Python 包导出）：

| 文件 | 内容 | 谁维护 |
|---|---|---|
| `data/layout.json` | 模板区域、帧偏移表、格子映射表 | 手改；`tests/node/docs.test.mjs` 用裁切文档对账 |
| `data/armor_sets.json` | 204 条原版套装表 | `tools/build_armor_sets.mjs` |
| `data/i18n.json` | 中英文案（唯一来源，`tests/node/docs.test.mjs` 检查没有死条目） | 手改 |
| `data/ArmorTemplate_v1.png` | 绘制模板（与 v1 逐字节相同） | 不要动 |
| `data/ArmorTemplate_overlay.png` | 可选的参考线图层 | 手放 |
| `data/vanilla/` | 748 张原版贴图的 WebP 图集 + `index.json` | `tools/pack_vanilla_textures.py` |
| `data/player/` | 玩家贴图 `Player_0_3/0_7/0_10.png` | `tools/import_player_textures.mjs` |
| `tests/golden/` | 冻结的参考输出 + `manifest.json`（sha256） | **不要手改**，改了就过不了测试 |

---

## 目录结构

```
web/
  index.html            单页应用
  style.css             深色主题，无外部资源
  app.js                UI 逻辑（导入 / 导出 / 还原 / 预览贴图 / 设置）
  sw.js                 Service Worker：离线缓存（CORE 清单 + 内置贴图按需缓存）
  manifest.webmanifest  Web App Manifest（可安装成独立窗口）
  js/
    bitmap.js           RGBA 位图操作
    atlas.js            读取打包好的内置贴图图集（裁切 + 1×→2× + 例外像素）
    data.js             布局 / 套装表 / 文案的加载与查询
    generate.js         头部 / 腿部 / 旧格式 / 复合身体贴图生成
    compose.js          20 帧合成、拼版预览、GIF 帧序列
    sheets.js           成品贴图 → 20 帧全身合成
    reverse.js          原版贴图 → 128×80 模板
    png.js              PNG 编码（CompressionStream，带 stored 回退）
    gif.js              GIF89a 编码（精确调色板 + LZW）
    zip.js              ZIP 打包（stored）
    fs.js               文件解码、下载、File System Access
    idb.js              IndexedDB（保存目录句柄）
  data/                 布局 / 套装表 / 文案 / 模板 / 参考线 / 图标（唯一来源）
  data/icon.png         站点图标（浏览器标签页与页头左上角）
  data/vanilla/         内置原版盔甲贴图的 WebP 图集 + index.json + version.txt
                        （手机离线可用，仓库里不放 748 张散图）→ tools/pack_vanilla_textures.py
  data/player/          内置的玩家贴图（Player_0_3 / 0_7 / 0_10 + version.txt），
                        「叠加玩家」在手机上也能用 → tools/import_player_textures.mjs
  tests/
    run.mjs             Node 下的核心自检（供测试对比）
    smoke.html          浏览器内的端到端自检
    golden/             冻结的参考输出（Python 版移除前生成）+ manifest.json
```

无框架、无构建、无 CDN，全部是原生 ES 模块。

---

## 测试

```bash
npm test                            # 全部：核心逐像素 + 浏览器端到端 + 站点 + 文档（143 项）
python3 -m pytest tests -q          # 只有图集打包器的 19 项（它仍是 Python）

# 浏览器自检：起个静态服务器后打开 web/tests/smoke.html
python3 -m http.server 8000 --directory web
```

`tests/node/core.test.mjs` 会用 Node 跑一遍 JS 核心，把头部 / 腿部 / 手臂 / 旧版身体 /
复合身体 / 发光版本 / 20 帧组合 / 玩家与叠加玩家 / 反推模板 / 成品贴图合成，全部与
`web/tests/golden/` 里的参考图**逐像素**比较 —— 那些图是 Python 参考实现移除前冻结的，
所以「只剩一个实现」并没有丢掉安全网。

`tests/node/site.test.mjs` 另外检查：前端引用的元素与文案键都存在、页面不请求任何外部地址、
Service Worker 的 `CORE` 清单完整、Manifest 合法，并在无头 Chrome 里跑完整交互。

---

## 已知限制

| 项目 | 说明 |
|---|---|
| 文件夹读写 | 仅 Chromium 内核支持；其它浏览器用下载 / zip |
| 无法自动定位游戏目录 | 浏览器拿不到本机路径，需要你自己选一次目录 |
| 没有 `.xnb` 解码 | 需要已解包的 PNG 资源目录 |
| 还原时只读三张贴图 | 也可以手动上传 `Armor_Head_N.png` / `Armor_N.png` / `Armor_Legs_N.png` |
| 内置贴图不含玩家皮肤 | 只打包了 `Armor_*`；「叠加玩家」预览仍需自备 `Player_0_3/0_7/0_10.png` |
| 大文件内存 | 全部在内存里处理；一次导出几十套盔甲没问题，几百套建议分批 |
