# PROJECT_STATUS — ArmorHelper 2

> 交接文档。记录当前目标、已完成内容、关键决策、核心文件、验证结果、已知问题、走过的弯路与下一步顺序。
> 所有结论均来自当前代码与实测；未验证的事项在「未验证 / 待确认」里单独标出。

| 项 | 值 |
|---|---|
| 仓库路径 | `/Volumes/970/Games/tr/dev/ArmorHelper2` |
| 版本号 | `armorhelper 2.1.0`（`package.json`）——**只剩一个实现：`web/`** |
| 实测环境 | macOS · Node v26.13.0 · Google Chrome（headless）——**不需要 Python** |
| 规模 | 约 810 个受跟踪文件（内置贴图是 17 页 WebP 图集 + index.json，不是散图）；JS 4087 行 / 工具与测试 约 2400 行 / Markdown 约 2700 行 |
| 测试 | `npm test` → **162 passed**（核心逐像素 + 浏览器端到端 + 图集 + 站点 + 文档，约 16 秒） |

---

## 1. 当前目标

把 2018 年的 .NET 工具 ArmorHelper v1 重写成**纯静态网页**，并适配泰拉瑞亚 1.4.4+ 的新贴图
格式。可部署到 GitHub Pages，手机 / 任意静态托管都能跑。

**只有一个实现：`web/`。** 2.0 时代并行维护过一个 Python 包（命令行 + wxPython 桌面界面），
2026-11 已连同它的代码一起移除；移除前把它的输出冻结成 `web/tests/golden/`
（16 张参考图 + sha256 清单），`tests/node/core.test.mjs` 让网页版继续钉在同一批像素上。
**现在整个仓库没有 Python**：工具与测试都是 `.mjs`，只有图集打包需要 libwebp，走 dev-only 的
wasm（`@jsquash/webp`），发布出去的站点仍然零依赖。

交付形态：

| 形态 | 位置 | 状态 |
|---|---|---|
| 网页应用 | `web/` | 唯一实现：纯静态，无服务端、无构建、无依赖 |
| 打包 / 开发工具 | `tools/` | 全是 Node（`.mjs`）：图集打包（wasm WebP）、套装表、玩家贴图导入、贴图检查、静态服务器 |
| 2.0 的命令行与桌面界面 | 已删除 | 行为留在 `web/tests/golden/` 与 git 历史里 |

核心约束：**模板格式（128×80）与绘制流程必须与 v1 一致**，用户已有的模板继续可用 ——
这条约束现在由冻结的参考图守着。

---

## 2. 已完成内容

### 2.1 2.0 的 Python 实现（已移除）

一度并行的参考实现：`layout` / `imaging` / `generate` / `compose` / `preview` / `reverse` /
`sheets` / `export` / `config` / `i18n` / `vanilla` / `cli` / `gui` 共 4.4k 行，外加 1.5k 行
Python 测试。它的输出在移除前被冻结成 `web/tests/golden/`（16 张参考图 + sha256 清单），
算法与历史细节记在 `docs/需求文档.md`（含已退役的命令行与桌面界面章节）。

删掉的东西：`armorhelper/` 整包、它的 7 个 Python 测试文件、`tools/export_web.py`（数据已是唯一来源）、
`web/i18n.web.json`（合并进 `web/data/i18n.json`）。随后三组 Web 用例（浏览器、核心逐像素、文档）
迁到了 `tests/node/`；最后连图集打包器也迁到 `tools/pack_vanilla_textures.mjs`（wasm WebP 编码），
`tests/test_vanilla_bundle.py` 变成 `tests/node/bundle.test.mjs` —— 仓库里不再有 `.py`。

### 2.2 Web 版（纯静态）

- `web/js/` — 核心移植：`bitmap` / `data` / `generate` / `compose` / `reverse` /
  `sheets` / `png` / `gif` / `zip` / `fs` / `idb`，全部原生 ES 模块，无框架、无构建、无 CDN。
- `web/app.js` — 单页应用：导出贴图、预览贴图、反向还原、设置四个标签页；结果卡片并排显示
  「绘制模板 (128×80)」「生成效果 (20 帧)」「GIF 动画」。
  导出页左列一张卡片装「输入文件 + 导出选项 + 预览选项 + 开始导出」、下面接「最近导出」，
  右列是占一半页宽的导出结果（空着时与左侧输入卡等高，出结果后按内容增长）；
  「下载绘制模板」悬停/聚焦会弹出 4× 模板 popover。
  「预览贴图」页是**三个部位槽位**（头部 / 身体 / 腿部各一个拖放区，放错尺寸会被拒绝），
  GIF 速率（100 / 500 / 1000ms）与尺寸（1× / 2× / 4×）可选；批量任务带 `i/n` 进度与取消。
- `web/sw.js` + `web/manifest.webmanifest` — 离线缓存与可安装 PWA（`CORE` 清单由测试守卫，
  内置贴图（17 页 / 约 290 KB）改为首次使用时缓存）。
- 「预览贴图 → 生成材质包」把三张贴图打成游戏可直接读的 `<名称>-pack-pc.zip`
  （`pack.json` + `Content/Images/Armor_Head_<id>.png` / `Armor_Legs_<id>.png` /
  `Armor/Armor_<id>.png`），zip 名用 ASCII 的 `Armor_<id>-pack-pc.zip`，`Name` 用套装中文名。
- `web/data/i18n.json` — **唯一**的中英文案（138 个键，中英一一对应）；
  `tests/node/docs.test.mjs` 不允许出现没有出口的死条目。
- `web/data/` — 数据本身（layout / armor_sets / i18n / 模板 / 参考线 / 图标），没有生成器。
- `web/data/vanilla/` — 内置原版盔甲贴图的**打包图集**（`index.json` + 若干 WebP 页 +
  `version.txt`），由 `tools/pack_vanilla_textures.py` 从一个已解包的 `Content/Images` 生成；
  读取走 `web/js/atlas.js`（查索引 → 页内裁切 → 1× 放大回 2× → 补例外像素）。
- `.github/workflows/pages.yml` — 跑全部测试（金标准 + 浏览器 + 图集包）→ 发布 `web/` 到 Pages。

### 2.3 工具与文档

| 文件 | 用途 |
|---|---|
| `tools/build_armor_sets.mjs` | 由游戏源码生成套装表（`ArmorSetBonuses.cs` + `ArmorIDs.cs` + `Item.cs` + 简中本地化） |
| `tools/import_player_textures.mjs` | 把 `Player_0_3 / 0_7 / 0_10.png` 复制进 `web/data/player/`（含 `version.txt`），让「叠加玩家」在手机 / Firefox / Safari 上也能用 |
| `tools/pack_vanilla_textures.py` | 把已解包的 `Content/Images` 里的盔甲贴图**打包**进 `web/data/vanilla/`：按部位（head / legs / body）shelf 装箱成若干 WebP 页（1× 像素 + 例外像素表），写 `index.json` 与 `version.txt`（版本 / 张数 / 页数 / `max_page=2048` / 总字节 / 内容 checksum），并用内容 checksum 自校验 |
| `tools/inspect_armor.py` | 按引擎算法渲染任意 1.4.4+ 身体贴图，用于与原版对照 |
| `docs/需求文档.md` | 核心规格（9×4 格子、帧偏移表、命名、反向还原限制）；命令行/桌面界面章节为历史 |
| `docs/Web版需求文档.md` | Web 版规格（架构、功能/界面/非功能需求、验收标准） |
| `docs/贴图裁切说明.md` | 铜盔甲三张贴图的逐格裁切说明（36 格全部标注 + 实测包围盒） |
| `docs/Web版UI线框图.md` | Web 版四个标签页的 ASCII 线框图（两栏比例、响应式断点、线框 ↔ DOM 对照） |
| `docs/armorhelper-v1.decompiled.cs` | v1 的反编译源码（移植与回归的参考基准） |
| `v1/` | 原版工具的压缩包、模板与论坛链接，作为溯源参考 |

---

## 3. 关键技术决策

### D-1 模板保持 128×80（1×），输出统一放大 2×

**依据（已实测）**：抽查全部 748 个原版盔甲贴图，**每一个 2×2 像素块都是同色**，
即原版贴图是 1× 像素画的精确 2 倍最近邻放大（748 个里只有 22 个文件存在
0.005%~0.18% 的例外块）。因此 1× 模板足以无损描述原版贴图，不需要引入 2× 模板。

生成流程统一为「在 1× 上做纯像素拷贝，最后整体 2× 最近邻放大」，
所以反向还原可以精确求逆。

### D-2 新格式（1.4.4+）的身体贴图布局

`Content/Images/Armor/Armor_<id>.png` 是 **9 列 × 4 行** 的 40×56 格子（发光盔甲 9×8，
第 4~7 行是发光遮罩，引擎以 `sourceRect.Y += 224` 采样）。格子含义与
「身体帧 → 手臂格」映射取自 `PlayerDrawSet.CreateCompositeData`，全部集中在
`web/data/layout.json`（早先由 Python 版的 `layout.py` 导出）。

引擎侧要点（已从 1.4.5 源码核实）：
- 手臂的 `position` 与 `origin` 同步偏移（前臂 −5、后臂 +6/+2），**净位移为 0**，
  所以模板里的手臂放在 v1 的老位置即可，无需补偿。
- 身体 bob 由引擎的 `Main.OffsetsPlayerHeadgear` 统一施加，**新格式不再烘进贴图**；
  头部不使用该偏移，所以头贴图仍保留 bob（原版确实如此）。
- 发光层采样偏移固定为 224px。

### D-3 肩部格留空

模板的躯干区域已经包含肩与上臂；引擎绘制顺序是「后肩 → 后臂 → 躯干 → 前肩 → 前臂」，
所以把肩部留空、躯干直接放模板素材，观感与旧版一致。反向还原时按同一顺序把两个肩部
格合并回躯干区域。

### D-4 反向还原走「生成表的逆运算」

生成过程是纯像素拷贝 + 末尾放大，每一步可逆。反向按正向的表逐区域倒推：
躯干取格子 (0,0)/(1,0)/(0,2)/(1,2)，前臂取各帧所属格子的 owner 帧偏移，
行走手臂取 offset 为 0 的格子，后臂取 (2,2)，脚部用「第 0 帧 + 第 19 帧」互补恢复
（生成器在第 19 帧交换了两只脚的左右位置）。

### D-5 常量只有一份（2.0 时期：由 Python 导出）

现状：所有常量都在 `web/data/*.json` 里，JS 直接读，没有第二份实现。
2.0 时期是 `tools/export_web.py` 从 Python 包导出，CI 重新导出后 `git diff --exit-code`
比对；Python 包移除后这条链也一起退场，只剩「`web/` 里不许出现 `.py`」这条仍然有效
（有测试守着）。

### D-6 Web 版核心不碰 DOM

`web/js/` 里的模块不依赖 DOM，因此可以在 Node 下运行，与 Python 输出做**逐像素对比**。
这是两个版本一致性的主要保障手段。

### D-7 PNG / GIF / ZIP 自己编码

- PNG 用 `CompressionStream("deflate")`，不可用时退回 stored 块。自己编码是为了绕开
  canvas 的 alpha 预乘——`canvas.toBlob` 对半透明像素可能产生舍入差异。
- GIF 自己做调色板 + LZW：像素画颜色少，用**精确调色板**比量化更好看。
- ZIP 用 stored（PNG 已压缩，再压无收益）。

### D-8 参考线是独立的叠加层，不参与生成

`ArmorTemplate_overlay.png` 与模板同尺寸（128×80），由 `layout.compose_overlay()` /
`compose.composeOverlay()` 叠加在**模板预览**与**下载的绘制模板**上，用
「替换、不混合」的语义（与生成器一致，两种语言可精确复现）。
生成器与反向还原**只读原始模板**，有测试守着（`test_overlay_never_reaches_the_generated_sheets`）。

**实测现状**：随包分发的 `ArmorTemplate_v1.png` 本身已经含参考线，overlay 的 4395 个像素
与模板逐像素相同（模板另 1251 个像素是美术），因此当前叠加在视觉上是**空操作**
（下载得到的模板与原始文件都是 5646 个不透明像素）。

已用「只有美术的模板」（1251 像素）验证过整条路径：下载结果变成 5646 像素，
即参考线确实被叠加了；`test_browser_download_applies_the_guide_overlay` 固化了这条断言。
三处交出的模板现在都会叠加：Web 的下载按钮、`armorhelper template`、桌面 GUI 的「保存模板」
与启动时还原到工作目录的那一份（GUI 原来直接写原始文件，已修正）。

### D-9 原版贴图内置到 Web 版

手机浏览器没有 File System Access API，也不可能手动挑 748 个文件，所以把
**748 张原版盔甲贴图（Terraria 1.4.5.8）** 打包进 `web/data/vanilla/`。

- 目录结构与读取：游戏路径仍然能直接定位——`Armor_Head_N.png` → 索引键 `Armor_Head_N`，
  `Armor/Armor_N.png` → `Armor/Armor_N`（去扩展名、保留子目录），不需要额外的映射表。
- 打包方式见 **D-18**（按部位图集 + 1× 存储 + WebP）；`version.txt` 记录游戏版本、总张数、
  分类张数、页数、单页上限与**内容 checksum**，`tests/test_vanilla_bundle.py` 会核对；
  设置了 `ARMORHELPER_VANILLA_SOURCE` 时还会验证打包脚本能从源目录**逐字节重建**所有贴图。
- 读取优先级：用户选的文件夹 → 手动上传 → **内置**。界面会显示当前用的是哪一个。
- 内置只含 `Armor_*`，不含玩家皮肤，所以「叠加玩家」预览在手机上仍需自备
  `Player_0_3/0_7/0_10.png`。

### D-10 站点图标与启动自检

- `data/icon.png` 同时作为 favicon、apple-touch-icon 与页头标志。页头标志按**平滑**渲染
  （不带 `image-rendering: pixelated`），因为它是矢量风格的美术而不是像素画。
- `web/app.js` 的事件绑定改为 `on(选择器, 事件, 处理)`，**元素缺失只记录不抛异常**；
  启动结束时如果套装表为空、或缺少脚本引用的元素，状态栏会给出明确原因
  （后者提示强制刷新）。目的是让「浏览器缓存了旧 index.html + 新 app.js」这类
  版本错配表现为可见的告警，而不是静默的空列表。
- （历史）`tools/export_web.py` 改为**先写临时文件再 rename**，避免浏览器在导出过程中读到
  写了一半的 JSON。

### D-11 全身预览直接从成品贴图采样，不经过模板

需求是「上传三张贴图，生成全身盔甲 GIF」。最省事的做法是 `reverse` 出模板再走既有
生成流程，但反推对身体只有 90~97%、对腿 90~100%（前后脚互相遮挡、4 个行走手臂姿态
被合并），做出来的预览不是游戏实际画面。因此新增 `sheets.py` / `web/js/sheets.js`，
按引擎的绘制顺序（腿 → 后肩 → 后臂 → 躯干 → 前肩 → 前臂 → 头）直接采样成品贴图：

* 肩部格参与合成（原版贴图里它们不是空的），所以任何材质包都能还原引擎效果；
* 结果只取决于贴图本身，和 128×80 模板无关；
* 1× 素材统一放大到 2×，保证 GIF 可读（模板流程也是输出 2×）；
* 身体贴图共用的行走手臂格（帧 7~10 等）按同一格采样 —— 引擎本来就是这样画的。

2.0 时期 Python 与 JS 各一份实现、逐帧比对；现在只剩 JS，比对对象是冻结的参考图。
当时 `tests/test_sheets.py` 用生成器产出的三张贴图做交叉验证，并确认帧 0~6 与
`compose.full_armor_frames` 逐像素一致（这几帧的手臂格是独占的）。

### D-12 输出命名

未指定 ID 时用 `<输入名>_Head.png` 等；指定 ID 时用原版命名
`Armor_Head_<id>.png` / `Armor_Legs_<id>.png` / `Armor/Armor_<id>.png`。
身体贴图带 `Armor/` 子目录，Web 版的 zip 也保留该结构。

### D-13 文案只有一份，且卡片存 key 而不是译好的字符串

现状：`web/data/i18n.json` 是唯一来源（138 个键，中英一一对应）。
2.0 时期为了不改动冻结的 Python，Web 专属文案放在 `web/i18n.web.json`、导出时合并 ——
Python 移除后两份合一，`test_every_translation_is_used` 继续禁止出现没有出口的死条目。

真正有价值的经验留了下来：**结果卡片不能在生成时就把文案嵌死**，而要带
`titleKey` / `captionKey`，切语言时由 `applyI18n()` 用 `state.results` 重绘 ——
否则已经画出来的卡片会停在旧语言（这个 bug 真的存在过）。

### D-14 部位改用三个槽位，而不是相信文件名

最初的实现是「拖三张图，按文件名猜部位」。识别错了用户只能删掉重试（而 40×1120 的头和腿
在尺寸上完全一样，猜错是常事）。改成三个槽位后，**部位由用户放的位置决定**，
`classifySheets()` 只在「一次拖入多个文件」时用来自动分配；每个槽位入口都会跑
`validateSheet()`（列数 / 宽高比 / 高度），不合格直接拒绝并给出该槽位能接受的尺寸，
绝不静默缩放。核心警告从英文句子改成 `{key, vars}`，由 UI 翻译成中文/英文。

### D-15 长任务：进度条 + 取消，用轮询而不是 AbortController 硬中断

「还原全部套装」要读约 450 张内置贴图（151 套 × 3 张），中途没有反馈、也不能停。
现在每个任务有 `state.job = {cancelled, done, total}`：状态栏显示 `正在处理 12/151：星尘板甲`、
右侧是进度条与「取消」按钮；循环在每个 item 前检查 `jobCancelled()`，`nextFrame()`
让浏览器有机会重绘。**没有**用 `AbortController` 去断掉进行中的 fetch —— 中断到一半
反而会留下不一致的结果，逐项检查更简单也更可测。取消后已完成的结果仍然可用。

顺带把「还原全部」开头的目录选择挪到**保存时**才问，避免点一下按钮先弹一个文件选择器。

### D-16 离线用 Service Worker，缓存分两层

`CORE`（启动必需：HTML/CSS/JS/JSON/模板/图标，约 60 KB）在 install 时预缓存；
内置贴图（17 页 WebP 图集 + `index.json`，约 292 KB）走 `data/vanilla/` 前缀，命中后用后台 fetch 刷新（stale-while-revalidate），
没命中就按需缓存。这样手机首次打开不会一次性下载图集。
坑：`event.waitUntil()` 只能在事件派发期间调用，放在 `respondWith` 的 `.then()` 里会抛
`InvalidStateError` 并让这次 fetch 直接失败 —— 后台缓存必须用普通浮动 promise。

### D-17 材质包直接按游戏的 ResourcePacks 结构打包

参照 `/Terraria/ResourcePacks/01`（`01-pack-pc.zip`）实测的结构：根目录 `pack.json`
（`Name` / `Author` / `Description` / `Version{major,minor}`）+ `Content/Images/Armor_Head_<id>.png`
+ `Content/Images/Armor_Legs_<id>.png` + `Content/Images/Armor/Armor_<id>.png`。
浏览器侧用现成的 stored ZIP 写入器拼出来，目录条目（`Content/`、`Content/Images/`、
`Content/Images/Armor/`）也照抄，方便用户直接对比。

两个命名细节：zip 文件名用 ASCII 的 `Armor_<id>-pack-pc.zip`（游戏按
`*-pack-pc.zip` 扫描 `ResourcePacks/`，ASCII 最稳），而 `pack.json` 的 `Name` 用套装中文名
（资源包列表里显示的就是它，参考的 `2440024138` 包就是 `Name: 华文圆体`）。
`<id>` 取自身体贴图文件名，取不到时回落到设置里的身体 ID，再退回 0 并提示。

### D-18 结果卡片记在 state 里，文案一律存 key

一张清理时才发现的老问题：`state.result` 从没被赋值过，`renderResult()` 实际是死代码，
于是**切换语言时已有的结果卡片不会跟着翻译**（WUI-02 要求「立即切换全部文案」）。
现在每个面板记一份 `state.results[panel]`，`showResult()` 统一渲染；卡片的标题、
预览图说明都改存 i18n **key**（`titleKey` / `captionKey`），在渲染时才翻译 ——
否则字符串在生成卡片那一刻就被冻住了，重绘也没用。

同一次清理还删掉了 `frameAt` / `bitmapToCanvas` / `existsInFolder` / `loadJSON` /
`saveJSON` / `PLAYER_SKIN` 这些再没人调用的移植残留，并把三处写死的英文提示
（`self check mismatch`、`self check failed`、`N failed`）改成 i18n。

### D-19 移除 Python 版之前，先把它冻结成金标准

顺序是：先在 Python 侧做一遍「删死代码、删失效文案」的清理（3 处死代码 +
22 条中英各一份的失效文案），确认输出没变；然后把参考输出冻结成
`web/tests/golden/`（`head` / `legs` / `body` / `body-glow` / 旧格式三张 /
男、女 20 帧 / 玩家帧 / 叠加玩家帧 / 反推模板 / 成品贴图合成帧，共 16 张 + sha256 清单）；
最后才删掉 `armorhelper/` 与它的 Python 测试。

`tests/node/core.test.mjs` 现在拿这些图当基准：114 项逐像素断言。这样做的好处是
「只剩一个实现」并没有失去安全网 —— 而且第一次跑就暴露出一个从未被测过的差异：
`multiplyColor()`（玩家肤色着色）JS 用四舍五入、Python 用截断，差 1/255。
现在 JS 也改成 `Math.trunc`，与金标准逐像素一致。

### D-20 图集打包用 wasm 版 libwebp，而不是改回 PNG

图集必须**无损** WebP（有损会改像素，内容 checksum 就失去意义），而 Node 没有内置编解码。
实测过的三条路：

| 方案 | 首屏体积 | 结论 |
|---|---|---|
| 无损 WebP（现状，`@jsquash/webp` = libwebp 的 wasm） | **297 KB** | 采用。用 wasm 二进制直接 `init({ wasmBinary })`（包内默认 `fetch()` 读不了 `file:`） |
| 同样页面换 PNG | 2,298 KB（**8.6×**） | 否决。用 PIL 把现有 17 页重新编码实测；zlib 的 32 KB 窗口吃不到跨贴图的相似性 |
| 不打包，直接发 748 张散图 | 1,150 KB（748 个请求） | 备选。比 PNG 图集小，但比 WebP 图集大 3.9 倍 |

结论：`@jsquash/webp` 只作为 **devDependency**，站点本身仍是零依赖。换成 Node 打包器后
重新打的 17 页与 Pillow 版**逐像素相同**，内容 checksum 不变（`total_bytes` 少 150 字节，
因为 libwebp 这版编码略好）。

### D-21 测试全部搬到 Node

`node --test` 内置、零依赖；浏览器用例用 `node:http` 起静态服务器 + `child_process` 拉 Chrome，
靠页面 `POST /__done` 回报结果。为此写了两个小工具：`tools/lib/png.mjs`（PNG 解码，
`node:zlib` 解压 + 五种滤波）与 `tests/node/lib/gif.mjs`（GIF89a + LZW 解码）。
PNG 解码器让「与冻结参考图逐像素比对」不再需要 Pillow，也让 `tools/inspect_armor.mjs` 能直接
读 PNG。踩过的坑：harness 页本来是 Python 三引号字符串，搬出来时 `/\\d+\\/\\d+/` 里的双反斜杠
会让 `\\/` 提前结束正则字面量，整个模块语法错误、页面永远不上报。

### D-22 玩家贴图内置，而不是只靠 Content/Images

「叠加玩家」原来只从 Chromium 的目录句柄读 `Player_0_3 / 0_7 / 0_10.png`，于是手机上这个
复选框永远拿不到贴图（除非用户手动挑 748 个文件——不可能）。现在把这三张（约 4 KB）
一并放进 `web/data/player/`，启动时就加载；用户选了 `Content/Images` 时优先用用户的
（可能是材质包），失败再回落到内置版。顺带把这一块补上了端到端断言：勾上之后应有
8 个文件 / 5 个预览（4 张 PNG + 4 个 GIF，其中两个是「玩家 + 盔甲」）。

### D-21 内置贴图按「部位 + id」打包成 WebP 图集（不按套装）

748 张散图变成 **17 页 WebP + `index.json`**：1.68 MB → 约 292 KB，全量还原的请求数从 453 降到 ≤ 17。
三条判断都是实测出来的（脚本见 `tools/pack_vanilla_textures.py`）：

| 做法 | 实测 | 结论 |
|---|---|---|
| 只裁掉空白（2× PNG） | 1.680 MB → 1.061 MB（−37%） | 有用但不是大头；WebP 下只有 −3%（空白本来就几乎免费） |
| **换 WebP lossless** | 2× 散图 1.680 → 0.329 MB | 单这一项就 −80% |
| **存 1× 再运行时放大** | 1× 散图 WebP 0.329 → 0.270 MB；像素 41.7M → 10.4M | 原版贴图是 1× 的精确 2× 放大（D-1），22 个文件、120 个像素的例外写进 `index.strays` 补回 |
| **按套装打包** | 2× PNG 下 203 页共 **2.075 MB**（比散图 1.255 MB 还大）；1× WebP 下 106 页 0.279 MB | 不但覆盖不全（204 套只引用 530 张，**218 张不属于任何套装**：头 128 + 腿 90），拼页还把只填了 34% 的 440×1120 格子撑大；且 106 请求 vs 17 |
| **按部位打包** | 1× WebP 17 页 267 KB + 索引 30 KB | 同部位尺寸一致、拼页无空隙；查找键本来就是（部位, id），套装表只是 UI 列表 |

> **单页 ≤ 2048×2048 是硬约束**（浏览器解码上限，iOS Safari 还限 canvas 总面积）：
> 打包脚本的 `MAX_PAGE` 拒绝超限的 `--page-size`，写进 `version.txt` 的 `max_page`
> 与 `index.json` 的 `maxPage`，`web/js/atlas.js` 的 `validateIndex` 加载时再校验，
> `tests/test_vanilla_bundle.py` 同时盯住这三处。默认页边 1024（≈4 MB/页解码开销），
> 单套还原最多解 4 页就能拿到头 / 腿 / 身体；全量还原时页面走 LRU（默认 24 MB）。

其他实现细节：

- 仓库里**只放打包后的产物**，748 张源 PNG 不进仓库；游戏更新后重跑脚本即可。
- checksum 算的是**内容**（把 748 张图重建出来再哈希），所以换 WebP 版本不会让校验漂；
  脚本结束时自己校验一遍，页面里还原不出的像素会让它直接报错退出。
- 读取端只改了 `textureReader()`：核心（`reverse.js` / `sheets.js` / `downscale2`）拿到的
  仍是原尺寸的 2× 贴图，像素等价性测试不用改。
- WebP lossless 与 PNG 走同一条 `createImageBitmap(premultiplyAlpha:"none") → canvas`
  路径解码**逐字节相同**（无头 Chrome 实测 178 880 字节 diff = 0），不引入新误差。

## 4. 修改过的核心文件

按后续开发最可能触碰的顺序：

| 文件 | 作用 | 改动风险 |
|---|---|---|
| `web/data/layout.json` | 全部坐标与映射表常量（模板区域、帧偏移、9×4 格子表） | **高**：改动同时影响生成与还原，还要同步 `docs/贴图裁切说明.md`（测试会对账） |
| `web/js/generate.js` | 各贴图生成 | 高：旧格式输出由金标准逐像素守着 |
| `web/js/compose.js` | 20 帧合成、玩家帧、GIF 帧序、拼版 | 高：同上 |
| `web/js/reverse.js` | 反向还原 | 中：往返无损有测试覆盖 |
| `web/js/sheets.js` | 成品贴图 → 全身帧/GIF | 中：金标准覆盖 20 帧与分类警告 |
| `web/js/atlas.js` | 内置图集读取（裁切 + 1×→2× + 例外像素） | 中：改坏了所有「手机上还原」的路径 |
| `web/js/bitmap.js` | 像素原语（含 `multiplyColor` 的**截断**语义） | 高：语义与 v1 对齐，改动影响全部输出 |
| `web/app.js` | 界面（四个标签页、进度/取消、历史、popover、槽位、材质包） | 中 |
| `web/style.css` | 布局（两列 / 三列断点、粘性侧栏） | 低 |
| `web/data/i18n.json` | 中英文案（唯一来源） | 低：`test_every_translation_is_used` 禁止死条目 |
| `web/sw.js` + `web/manifest.webmanifest` | 离线缓存 / PWA | 中：`CORE` 清单与 `VERSION` 必须同步 |
| `web/data/vanilla/` | 内置贴图图集 | 低：由 `tools/pack_vanilla_textures.mjs` 生成，不要手改 |
| `web/data/player/` | 内置玩家贴图 | 低：由 `tools/import_player_textures.mjs` 生成 |
| `web/tests/golden/` | 冻结的参考输出 + sha256 清单 | **不要改**：`test_golden_manifest_matches_the_files` 会报 |
| `tools/pack_vanilla_textures.py` | 图集打包 | 中：改格式要同步 `web/js/atlas.js` 与 `tests/test_vanilla_bundle.py` |
| `tools/build_armor_sets.mjs` | 生成 `web/data/armor_sets.json` | 低 |
| `tools/inspect_armor.mjs` | 按引擎规则渲染身体贴图（读 `layout.json`） | 低 |

---

## 5. 测试与验证结果

### 5.1 规模

`npm test` → 162 项，约 16 秒（含无头 Chrome）：

```
tests/node/core.test.mjs     114  web/js/ 核心 vs web/tests/golden/ 冻结参考图，逐像素
tests/node/harness.test.mjs    5  贴图查找、部位识别、图集读取、zip 结构、拼版 PNG
tests/node/browser.test.mjs    3  真 Chrome：拖放/导出/预览贴图/材质包/取消/还原全部/切语言
tests/node/bundle.test.mjs    19  WebP 图集自洽、内容 checksum、从源目录重打的可复现性
tests/node/docs.test.mjs      10  裁切表 ↔ layout.json、链接、用词、README 语言、文案无死条目
tests/node/site.test.mjs      11  数据、HTML↔JS 接线、SW 的 CORE 清单、Manifest、图标、图集包、Pages
```

设置 `ARMORHELPER_VANILLA_SOURCE` 时，`bundle.test.mjs` 会额外把整包从源目录重打一遍，并
逐像素还原比对 748 张贴图（约 30 秒）。

### 5.2 关键验证结论（均已实跑）

| 验证项 | 结果 |
|---|---|
| 旧格式（头/腿/手臂/身体/女性身体）与 v1 参考实现 | **逐像素一致**（金标准 `web/tests/golden/`） |
| 新格式各贴图尺寸 | 头 40×1120、腿 40×1120、身体 360×224、发光 360×448 |
| 生成 → 反向还原 → 再生成 | **头 / 腿 / 身体 全部 0 像素差异**（金标准 `template-rebuilt`） |
| JS 核心 vs 冻结的参考图（6 种贴图 + 发光版 + 20 帧 + 玩家/叠加玩家 + 反推模板 + 成品贴图合成） | **逐像素一致** |
| JS 生成的 PNG | PIL 解码后与参考图一致（40×1120 RGBA） |
| JS 生成的 GIF | PIL 解码 **52 帧逐帧一致**，调色板 8 色，约 16.2 KB |
| JS 生成的 ZIP | `zipfile.testzip()` 通过，保留 `Armor/` 子目录与 UTF-8 文件名 |
| 无头 Chrome 跑 `web/tests/smoke.html` | **22 项全 PASS**（模块加载、贴图生成、往返无损、原版文件名取贴图、模板放大、PNG/GIF/ZIP、套装搜索） |
| 无头 Chrome 端到端驱动「还原这一套」 | **两种来源各跑一次**（仅内置 / 上传文件），产物名正确、3 个带标题的预览、模板预览 `naturalWidth = 128×4+4`、无「找不到贴图」告警 |
| 内置贴图包 | 748 张（按部位打包成 17 页 WebP 图集）、张数/分类数与 `version.txt` 一致、内容 checksum 匹配、覆盖 140+ 套可还原套装、单页 ≤ 2048×2048、脚本可原样重建 |
| 参考线叠加 | 只画在模板预览与下载的模板上；**不改变任何生成结果**（浏览器用例断言新增 4395 像素） |
| 金标准清单 | 16 张参考图的 sha256 与 `manifest.json` 一致；改图会立刻失败 |
| 套装表 | 204 条；151 条同时有头与腿；202 条有中文名；23 条来自套装加成（权威） |
| 「预览贴图」三个槽位 | 无头 Chrome 实测：错槽位被拒绝并给出中文原因；三格填满后生成 4 个文件、3 个预览；选「慢 + 2×」后 GIF 宽度 80、设置写进 localStorage |
| 进度与取消 | 取消「还原全部套装」后状态栏显示「已取消」、按钮复位；完整跑完显示 `i/151` 进度并产出 > 100 个模板 |
| 导出历史 | 无头 Chrome 实测：导出后 `armorhelper.history` 有 1 条（含缩略图 data URL），列表显示名称与文件数；还原全部后再增 1 条 |
| 模板 popover | 悬停后 popover 出现且图片 `naturalWidth = 516`（128×4 + 2px 边框），移开后隐藏 |
| 结果卡片高度 | 无头 Chrome 实测：空结果卡与输入卡的差值 ≤ 2px（内联 `min-height`），出结果后内联高度被清空、由内容撑开；两个标签页都断言 |
| 启动提示 | 状态栏不再说「已连接」（那是 v1 本地服务的说法），改为「就绪 · 纯前端，全部在本机处理」；用例同时断言旧词不出现 |
| 切语言重绘结果卡片 | 无头 Chrome 实测：导出后语言切英文，三张卡片的 `figcaption` 变成英文、文件列表不丢；切回中文与切换前逐字一致 |
| 语言切换 | 无头 Chrome 实测：导出后切到 English，卡片标题/说明变成 `Drawing template (128x80)`，切回中文完全复原；表单、槽位、历史同步刷新 |
| Python 侧清理 | `vulture` + 「只被声明一次」扫描后删了 `DEFAULT_WINDOW`（改为 gui 使用）、`BODY_COMPOSITE_SIZE`、`TARGET_LABELS`；中文文案 186 → 164 条，`test_every_translation_is_used` 断言无死条目；生成/还原/合成代码与模板零改动，全部逐像素测试仍通过 |
| 静态残留扫描 | 用脚本扫过：没有只被声明一次的 JS 函数、没有 `app.js` 不引用的 HTML id、没有没用到的 CSS 类；`web/data/i18n.json` 的每个键都有 `test_every_translation_is_used` 守着 |
| 页面不抛异常 | 无头 Chrome 全程收集 `error` / `unhandledrejection`（拖放、导出、预览贴图、材质包、取消、还原全部、勾选叠加玩家），断言列表为空 —— 故意注入 `notDeclaredAnywhere` 验证过这条断言确实会红 |
| 结果卡片的 zip / 写入按钮 | 无头 Chrome 真的点「打包下载 (zip)」：捕获到的 blob 以 `PK` 开头，解开后是 `MyArmor_Head/Legs/Body.png`，头部 PNG 与 `generate_head(template)` 逐像素一致；状态栏没有 `not a function` |
| 生成材质包 | 无头 Chrome 点按钮后把 zip 回传给 Python：`zipfile` 校验 7 个条目、`pack.json`（`Name=星尘板甲`、`Version 1.0`）、三张 PNG 与 Python 生成结果逐像素一致 |
| 叠加玩家（内置贴图） | 无头 Chrome 实测：不选目录、只勾复选框 → 4 张 PNG + 4 个 GIF、5 个预览，玩家提示消失 |
| 离线缓存 | 静态断言：`CORE` 覆盖启动所需的每个文件与模块、内置贴图走按需缓存；Manifest 合法；`app.js` 注册 `sw.js` |

### 5.3 复现命令

```bash
cd /Volumes/970/Games/tr/dev/ArmorHelper2
npm ci                                     # devDependency：wasm WebP 编解码器
npm test                                   # 全部 162 项

# 只跑其中一组
node --test tests/node/core.test.mjs       # 核心 vs 冻结参考图
node --test tests/node/browser.test.mjs    # 无头 Chrome 端到端
node --test tests/node/bundle.test.mjs     # 图集
ARMORHELPER_VANILLA_SOURCE="<Content/Images>" node --test tests/node/bundle.test.mjs

# 本地看网页版
npm start                                  # http://127.0.0.1:8000/

# 数据侧脚本
npm run pack -- "<Content/Images>" --version 1.4.5.8
npm run sets -- "<Terraria source>"
npm run players -- "<Content/Images>" --version 1.4.5.8
npm run inspect -- "Content/Images/Armor/Armor_1.png" --frames 0,5
```

## 6. 已知问题

### 6.1 新格式的固有限制（已验证，非缺陷）

| 编号 | 内容 |
|---|---|
| L-01 | 身体帧 7~10 共用同一后臂格，而 v1 给这 4 帧的后臂横向偏移并不一致（1,1,1,0），帧 10 有 1 逻辑像素偏差——新版格式无法表达 |
| L-02 | 肩部格留空（见 D-3）。若美术想让肩部随手臂单独运动，需自行在 `(0,1)(1,1)(0,3)(1,3)` 补素材 |
| L-03 | `(7,*)`/`(8,*)`（挥动道具的手臂）默认用第 0 帧手臂填充，只是保证手臂不消失；完美效果需手绘 4 档伸缩姿态 |
| L-04 | `--glow` 只是把第 0~3 行复制到第 4~7 行，得到「整体发光」底稿，局部发光需美术擦除 |
| L-05 | 不支持 `.xnb`，需要已解包的 PNG 资源目录 |

### 6.2 反向还原的不可恢复项（已验证）

| 内容 | 原因 |
|---|---|
| 后脚第 21 行的部分像素 | 生成器对该行两个源像素做了屏蔽，且后脚始终被前脚遮挡；**不影响重建结果**（重建时会再次跳过/被覆盖） |
| 原版第 7~10 帧各自的行走手臂 | 模板只有 1 个行走手臂区域，重建后 4 格共用同一姿态；按引擎渲染比较，身体贴图约 3~10% 差异 |
| 挥动道具的手臂格（第 7、8 列） | 模板没有对应区域，重建时由第 0 帧手臂填充 |
| 发光遮罩（第 4~7 行） | 模板没有发光层，还原时丢弃 |

### 6.3 套装表质量

204 条中 **53 条缺头或缺腿**（其中 13 条置信度为 `none`）。原因是原版并没有把「套装」
存成数据，只能靠套装加成表 + 命名规则推导；robe / 时装类套装的三个槽位命名往往不成套。
`--head` / `--legs` 可手动覆盖，UI 也会显示推导结果供核对。

### 6.4 Web 版限制

| 内容 | 说明 |
|---|---|
| 文件夹读写仅 Chromium | `showDirectoryPicker` 是 Chromium 独有；其它浏览器降级为下载 / zip / 手动上传贴图，**还原**则自动用内置贴图 |
| 无法自动定位游戏目录 | 浏览器拿不到本机路径，用户需自己选一次（不选也能用内置贴图还原） |
| 内置玩家贴图是原版皮肤 | `data/player/` 只有默认肤色；用材质包 / 自己改过的皮肤时请在设置里选 `Content/Images` |
| `file://` 不能直接用 | ES 模块受 CORS 限制，必须经静态服务器打开 |
| Service Worker 需要 HTTPS / localhost | `file://` 打开时没有离线缓存（浏览器限制），但功能本身可用 |
| 改文件后要给缓存换版本 | `sw.js` 的 `VERSION` 不变时，已安装的旧缓存会继续命中 |
| 全部在内存处理 | 一次几百套盔甲可能吃紧 |
| 文件夹授权 | 刷新后被浏览器收回，每次操作会再请求一次（句柄本身存在 IndexedDB） |

### 6.5 未验证 / 待确认

- **GitHub Pages 实际部署未跑过**：`.github/workflows/pages.yml` 已改好在等一次推送。
- **非 Chromium 浏览器**（Firefox / Safari）的降级路径与 Service Worker 未实测。
- **离线只做了静态断言**，没有真的断网重载过。
- 套装表的中文名来自游戏源码里的 `zh-Hans` 本地化；游戏版本升级后需要重新生成。

---

## 7. 尝试过但失败的方案

| 方案 | 结果 | 现状 |
|---|---|---|
| **服务端式 Web 版**（Python `http.server` + `/api/*` + 浏览器前端） | 功能可用，但 GitHub Pages 只能托管静态文件，无法部署 | 已移除（提交 `037f4da` 引入，`60be40a` 移除）。如需「网页直接读写本机文件系统」以外的服务端能力，可从 git 历史取回 |
| **用连续 item id 推断套装三元组** | 失败。原版同一套的 item id 并不连续（铜盔甲是 89 / 80 / 76），噪声大 | 改用 `ArmorSetBonuses.cs`（权威）+ 命名规则匹配 |
| **解析 `Item.cs` 的 `bodySlot = N` 再按相邻 id 分组** | 同样受连续性问题影响，且 `case` 块嵌套导致窗口式解析出现误配 | 只保留其中「body slot → item id → 本地化名」这一步用于取中文名，分组仍靠套装加成表 + 命名 |
| **2× 模板（256×160）** | 曾为「无损还原」而考虑 | **不需要**：实测所有原版贴图都是 1× 的精确 2× 放大（见 D-1），1× 模板已可无损往返 |
| **无头浏览器测试用 `--virtual-time-budget` + `--dump-dom`** | 不稳定。虚拟时间会跑在真实异步之前，约 50% 概率在页面完成前 dump，且不随预算增大而单调改善 | 改为让页面 **POST `/__done` 回报结果**，Python 侧等待该信号 |
| **无头测试服务器沿用标准库默认的 HTTP/1.0** | 每次请求都关连接，Chrome 一次拉十几个模块时 4 次里约 1 次卡满 40 秒 | 改 `protocol_version = "HTTP/1.1"` 长连接后 8/8 稳定，整体耗时 3.3s → 3.0s |
| **把 `web/` 放在 Python 包内（`armorhelper/web/`）** | 与「两个版本分开」的目标冲突，且静态站点不该混在 Python 包里 | 已移到仓库根的 `web/`，并加测试禁止 `web/` 内出现 `.py` |
| **只靠文件夹 / 手动上传取原版贴图** | 手机上两者都不可行（没有文件系统 API，也不可能挑 748 个文件） | 改为把贴图内置进站点，读取时作为兜底（见 D-9） |

### 已修但容易回归的坑

| 坑 | 说明 |
|---|---|
| 浏览器缓存导致 index.html 与 app.js 版本错配 | 曾表现为「盔甲套列表是空的」且状态栏无提示。现在 `wire()` 用 `on()` 容错、启动结束会检查套装表是否为空并提示强制刷新 |
| `ImageBitmap.close()` 会把 `width`/`height` 清零 | `web/js/fs.js` 里必须先取出宽高再关闭，否则 `getImageData` 报「source width is 0」 |
| `withTimeout` 泄漏定时器 | `web/js/idb.js` 的守卫定时器必须在 promise 结束后 `clearTimeout`，否则 IndexedDB 不可用时会卡住启动 |
| GIF 调色板把 bitmap 当数组遍历 | `web/js/gif.js` 要遍历 `frame.data`，不是 `frame` |
| 还原时「文件名 → 槽位」映射写错 | `web/app.js` 曾把原版文件名当成字典键，导致只还原出躯干。映射逻辑已移进 `web/js/reverse.js` 的 `loadTextures()` 并由浏览器端到端测试覆盖 |
| 静态服务器用 HTTP/1.0 | 见上表 |
| `renderFolders()` 里残留 `!!images` | 一行 `$("#player-hint").hidden = !needsPlayer || !!images \|\| ...` 遮蔽改名前留下的变量（`images` 从未声明）。因为 `!needsPlayer` 会短路，**只有勾上「叠加玩家」才抛 `images is not defined`**，平时看不出来。现在提示行只跟复选框走，并且浏览器用例会收集页面里所有 `error` / `unhandledrejection` 并断言为空 |
| 结果卡片的两个按钮其实一直没工作 | `resultCard()` 用 `const zip` / `const save` 命名按钮，遮蔽了 `result.zip` / `result.save`，点击抛 `save.save is not a function`；修完还发现 `zipBlob()` 接受的是 `{name, data}`，而 UI 一直传 `{name, blob}`，于是又抛 `unsupported entry type`。现在按钮调 `result.zip.save()`，并新增 `zipBlobAsync()`（接受 Blob 条目），浏览器用例会真的点这两个按钮、把 zip 解开比对 |
| 结果卡片的文案在生成时就译好了 | 切语言时卡片停在旧语言。现在结果对象只带 `titleKey` / `captionKey`，`applyI18n()` 用 `state.results` 重绘三个面板 |
| 浏览器测试把文件下到 `~/Downloads` | 测试是真的点「下载」按钮，Chrome 默认落到用户下载目录（曾堆积 30 个 `ArmorTemplate_v1 (n).png`）。现在 harness 吞掉带 `download` 属性的 `<a>` 点击，并给 Chrome 写 `download.default_directory` 指向临时目录 |

---

## 8. 下一步开发顺序

### P0 — 把站点真正发出去

1. **推送仓库并启用 GitHub Pages**：Settings → Pages → Source 选 GitHub Actions，
   推一次 `main`，确认工作流两步都过（跑全部测试 → 发布 `web/`）。

### P1 — 补齐测试覆盖面

2. Firefox / Safari 的降级路径实测（文件夹 API 不可用时的下载 / zip / 手动上传，
   以及 Service Worker 在这两个浏览器上的注册）。
3. 离线路径的自动化：用 Chrome 断网（`Network.emulateNetworkConditions`）后重载，
   断言页面仍能启动。目前只有静态断言（`CORE` 清单 + Manifest + 注册代码）。

> 已完成（原先列在这里）：还原全部的端到端、预览贴图的端到端、取消与进度、导出历史、
> 模板 popover、SW/Manifest 静态校验、叠加玩家的端到端，以及把 Python 侧的像素金标准
> 迁移成 `web/tests/golden/`。

### P2 — 质量增强

4. 「预览贴图」支持一键换成内置原版贴图（套装列表 → 直接看动画），目前只能自己上传。
5. **套装表补全**（`tools/build_armor_sets.mjs` → `web/data/armor_sets.json`）：
   53 条缺头或缺腿的条目，做一张人工覆盖表（例如 `data/armor_set_overrides.json`），
   避免每次重新生成又被覆盖。
6. 导出历史可点击回填（现在只是记录时间 / 名称 / 文件数 / 缩略图，不能重新下载）。
7. GIF 速率/尺寸目前只有「预览贴图」页有控件（设置全局生效）；若用户反馈，可在导出页也放一份。

### P3 — 可选

8. **模板扩展**：为「4 个行走手臂姿态」和「肩部」各加区域，可显著提升反向还原保真度。
   **注意**：已实测当前 128×80 模板**没有任何完全空闲的像素**（区域外 4395 个不透明像素
   全是参考线），所以扩展必须重画模板，会破坏「与 v1 同一张模板」的兼容目标；
   而且 `web/tests/golden/` 全部要重做。
9. **参考线归属**：现在 `ArmorTemplate_v1.png` 本身含参考线，叠加层是空操作。
   若要「模板只有美术、参考线单独一层」，需重画模板，同上。
10. `.xnb` 解码（可直接吃游戏原始资源，但需要引入 xnb 解析，工作量不小）。
11. 自定义 GL 贴图/发光层的图形化编辑。

---

## 9. 改动前自查清单

命令都在 §5.3，这里只列「改哪里 → 必跑什么」。

1. 改了 `web/js/*.js` → 跑 `node --test tests/node/core.test.mjs`（与 `web/tests/golden/` 逐像素比对）。
   如果**故意**改变了输出（例如修 bug），要显式重设金标准：跑一遍核心、人工看图确认、更新
   `web/tests/golden/manifest.json` 的 sha256，并在提交信息里说明为什么像素变了 ——
   默认情况下金标准不该动。
2. 改了 `web/data/layout.json` 的坐标/格子表 → 同步 `docs/贴图裁切说明.md`，
   `tests/node/docs.test.mjs` 会逐格对账。
3. 改了 `web/` 的文件名或新增模块 → 同步 `web/sw.js` 的 `CORE` 与 `VERSION`，
   `test_service_worker_precaches_the_whole_app` 会逐项检查。
4. 界面新增文案 → 中英文都要加进 `web/data/i18n.json`；
   `test_every_translation_the_app_uses_exists`（缺）与 `test_every_translation_is_used`（多）都会拦。
   注意 `test_browser_renders_the_app` 里断言了复选框数量（18）。
5. 用词统一为「**盔甲**」，文档正文里不得出现另一种写法（`test_the_ui_never_says_hujia` 会拦；
   界面上的替换由 `web/js/data.js` 的 `displayName()` 负责）。
6. 提交前跑 `node --check`（`web/app.js`、`web/js/*.js`、`web/sw.js`、`web/tests/run.mjs`、`tools/*.mjs`、
   `tests/node/**/*.mjs`）；仓库里没有 Python，也就没有 pyflakes 这一步了。
7. 游戏更新后重打内置贴图：
   `npm run pack -- "/path/to/Content/Images" --version <新版本>`，然后跑
   `node --test tests/node/bundle.test.mjs`。**不要**把散图提交进仓库；
   页边不得超过 2048（`MAX_PAGE`，脚本会拒绝），改这个常量要连带改 `web/js/atlas.js` 与测试。
8. 玩家贴图更新：`node tools/import_player_textures.mjs "<Content/Images>"`。
