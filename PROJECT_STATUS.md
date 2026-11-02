# PROJECT_STATUS — ArmorHelper 2

> 交接文档。记录当前目标、已完成内容、关键决策、核心文件、验证结果、已知问题、走过的弯路与下一步顺序。
> 所有结论均来自当前代码与实测；未验证的事项在「未验证 / 待确认」里单独标出。

| 项 | 值 |
|---|---|
| 仓库路径 | `/Volumes/970/Games/tr/dev/ArmorHelper2` |
| 分支 / HEAD | `main` / 本页所述提交（`git log -1`），工作区干净 |
| 版本号 | `armorhelper 2.0.0`（`pyproject.toml`）——**Python 侧已冻结**，Web 版仍在演进 |
| 基准游戏版本 | 泰拉瑞亚 1.4.5（新贴图格式自 1.4.4 起生效） |
| 实测环境 | macOS · Python 3.14.8 · Pillow 12.0.0 · wxPython 4.2.4 · Node v26.10.0 · Google Chrome（headless） |
| 规模 | 818 个文件（含内置贴图 748 张）；Python 8300 行 / JS 3678 行 / Markdown 2500 行 |
| 测试 | `pytest tests -q` → **176 passed, 1 skipped**（共 177 项；未装 wxPython 时为 154 passed / 2 skipped），约 21 秒，含无头 Chrome |

---

## 1. 当前目标

> **Python 工具已冻结（2.0.0）**。命令彉与桌面界面保留为**参考实现**与 Web 版的
> **等价性基准**（`tests/test_web_port.py` 逐像素比对），不再新增功能、不再做平台适配。
> **从现在起，包括正在做的改动，全部只落 Web 版（`web/`）**；新需求只写进
> `docs/Web版需求文档.md`。Python 侧除「修正正确性缺陷」外不动，若必须动，
> 必须同时改 `web/js/` 并让两侧测试一起通过。

把 2018 年的 .NET 工具 ArmorHelper v1 重写为 Python 版，并适配泰拉瑞亚 1.4.4+ 的新贴图格式；
另外提供一个**纯静态**的 Web 版，可部署到 GitHub Pages。**后者是当前唯一的开发目标。**

三个交付形态，彼此独立：

| 形态 | 位置 | 状态 |
|---|---|---|
| 网页界面 | `web/` | **活跃开发**。纯前端静态站点，与 Python 版运行时不共享代码 |
| 命令行 | `armorhelper/`（`python -m armorhelper`） | 已冻结，可作为基准与脚本工具继续使用 |
| 桌面界面 | `armorhelper/gui.py`（wxPython） | 已冻结，不再投入跨平台适配 |

核心约束：**模板格式（128×80）与绘制流程必须与 v1 一致**，用户已有的模板继续可用。
这条约束现在由 Web 版继承（且有用例守着：`test_exported_data_is_up_to_date` 等）。

---

## 2. 已完成内容

### 2.1 核心库（Python）

- `armorhelper/layout.py` — 模板 128×80 的区域定义、v1 的帧偏移表（`FRONT_ARM_OFFSETS` /
  `BACK_ARM_OFFSETS` / `BODY_HEAD_OFFSETS` / `LEG_MAPPING`）、新格式 9×4 格子映射表
  （`FRONT_ARM_CELL` / `BACK_ARM_CELL` / 躯干/肩部格子常量）。
- `armorhelper/imaging.py` — 复刻 v1 的像素语义：`Copy`（跳过 alpha ≤ 1，直接替换不混合）、
  `Fill`（含 alpha 覆盖）、2× 最近邻放大。
- `armorhelper/generate.py` — 头部 / 腿部 / 手臂 / 旧版身体 / **新版复合身体**（360×224，
  `--glow` 时 360×448）/ 20 帧合成。
- `armorhelper/compose.py` — 全身盔甲 20 帧、GIF 帧序列（与 v1 一致）、GIF 导出。
- `armorhelper/preview.py` — 从游戏 `Content/Images` 读取玩家贴图做预览。
- `armorhelper/reverse.py` — **反向还原**：由三张原版贴图重建 128×80 模板。
- `armorhelper/sheets.py` — **成品贴图 → 全身帧/GIF**：直接按引擎顺序采样三张成品贴图
  （腿 → 后肩 → 后臂 → 躯干 → 前肩 → 前臂 → 头），不经过模板；含文件名部位识别、
  1×/2× 归一化、饱和的部位缺失容错，以及 PNG/GIF 落盘（`export_sheet_previews`）。
- `armorhelper/data/ArmorTemplate_overlay.png` — 可选的 **128×80 参考线图层**
  （区域底色 + 分区线 + 边框）。只用于显示与绘制底稿，**生成与还原都不参与**。
- `web/data/vanilla/` — **内置的 748 张原版盔甲贴图**（Terraria 1.4.5.7，约 1.6 MB）
  加 `version.txt`。手机没有文件系统权限，靠它才能用反向还原。
- `web/data/icon.png` — 站点图标（浏览器标签页 / iOS 主屏幕 / 页头标志）。
  手工放置，`tools/export_web.py` 不碰它。
- `armorhelper/vanilla.py` + `data/armor_sets.json` — 204 条原版套装表（body/head/legs）。
- `armorhelper/export.py` — 产物落盘、原版 ID 命名规则。
- `armorhelper/config.py` — 界面状态持久化（`config.json`，兼容 v1 的键）。
- `armorhelper/i18n.py` — 中英文案，桌面版与 Web 版**共用同一份**。
- `armorhelper/cli.py` — 子命令：`export` / `template` / `targets` / `reverse` / `sets` /
  `gif`（别名 `sheets`，由三张成品贴图直接生成全身帧与 GIF）/ `gui`。

### 2.2 桌面界面

中文（可切英文），四组布局对齐原版：输入文件（含拖放、上次导出时间着色）、输出目录、
导出按钮、12 项导出选项，另加「详情」（发光遮罩 / 玩家肤色 / 三个盔甲 ID / 泰拉贴图目录）
与「反向还原」（单套 + 还原全部套装）、「全身预览」（从三张成品贴图生成 GIF）。设置存 `config.json`，含窗口位置尺寸、列宽、
输入列表、上次导出时间、最近目录、界面语言。

### 2.3 Web 版（纯静态）

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
  748 张内置贴图改为首次使用时缓存）。
- 「预览贴图 → 生成材质包」把三张贴图打成游戏可直接读的 `<名称>-pack-pc.zip`
  （`pack.json` + `Content/Images/Armor_Head_<id>.png` / `Armor_Legs_<id>.png` /
  `Armor/Armor_<id>.png`），zip 名用 ASCII 的 `Armor_<id>-pack-pc.zip`，`Name` 用套装中文名。
- `web/i18n.web.json` — **仅 Web** 的文案（标签页改名、GIF 速率、历史、槽位提示…），
  `tools/export_web.py` 把它合并覆盖到 Python 的 `MESSAGES` 上，因此不用解冻 Python 就能改界面文字。
- `web/data/` — 由 `tools/export_web.py` 从 Python 侧导出（layout / armor_sets / i18n / 模板 / 参考线）。
- `web/data/vanilla/` — 内置原版盔甲贴图（748 张 + `version.txt`），由
  `tools/import_vanilla_textures.py` 从一个已解包的 `Content/Images` 导入。
- `.github/workflows/pages.yml` — 重新导出数据并检查未过期 → 跑等价性测试 → 发布 `web/` 到 Pages。

### 2.4 工具与文档

| 文件 | 用途 |
|---|---|
| `tools/build_armor_sets.py` | 由游戏源码生成套装表（`ArmorSetBonuses.cs` + `ArmorIDs.cs` + `Item.cs` + 简中本地化） |
| `tools/export_web.py` | 把 Python 侧的常量导出成 `web/data/*` |
| `tools/import_player_textures.py` | 把 `Player_0_3 / 0_7 / 0_10.png` 复制进 `web/data/player/`（含 `version.txt`），让「叠加玩家」在手机 / Firefox / Safari 上也能用 |
| `tools/import_vanilla_textures.py` | 把已解包的 `Content/Images` 里的盔甲贴图导入 `web/data/vanilla/`（只取 `Armor_*`，身体贴图保留 `Armor/` 子目录），并写 `version.txt`（版本 / 张数 / 分类张数 / 总字节 / checksum） |
| `tools/inspect_armor.py` | 按引擎算法渲染任意 1.4.4+ 身体贴图，用于与原版对照 |
| `docs/需求文档.md` | Python 版 / 核心库规格（含 9×4 格子定义、帧偏移表、验收标准） |
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
`armorhelper/layout.py`，并由 `tools/export_web.py` 导出给 Web 版。

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

### D-5 Python 版与 Web 版运行时完全分开，只共享「导出的数据」

Web 版不重新实现常量，而是由 `tools/export_web.py` 把布局、套装表、文案、模板导出成
`web/data/*`；CI 会重新导出并 `git diff --exit-code`，数据过期即构建失败。
`web/` 目录内不允许出现 `.py`（有测试守着）。

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
**748 张原版盔甲贴图（Terraria 1.4.5.7，约 1.6 MB）** 直接放进 `web/data/vanilla/`。

- 目录结构照抄游戏：`Armor_Head_N.png` / `Armor_Legs_N.png` 在根，
  `Armor/Armor_N.png` 在 `Armor/` 子目录——这样读取逻辑可以直接
  `fetch("data/vanilla/" + <游戏里的相对路径>)`，不需要额外的映射表。
- `version.txt` 记录游戏版本、总张数、分类张数与**全部文件的 checksum**，
  `tests/test_vanilla_bundle.py` 会核对；设置了 `ARMORHELPER_VANILLA_SOURCE`
  时还会验证导入脚本能**原样复现**这个目录。
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
- `tools/export_web.py` 改为**先写临时文件再 rename**，避免浏览器在导出过程中读到
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

Python 与 JS 各一份实现，`tests/test_web_port.py` 逐帧比对两者输出；
`tests/test_sheets.py` 用生成器产出的三张贴图做交叉验证，并确认帧 0~6 与
`compose.full_armor_frames` 逐像素一致（这几帧的手臂格是独占的）。

### D-12 输出命名

未指定 ID 时用 `<输入名>_Head.png` 等；指定 ID 时用原版命名
`Armor_Head_<id>.png` / `Armor_Legs_<id>.png` / `Armor/Armor_<id>.png`。
身体贴图带 `Armor/` 子目录，Web 版的 zip 也保留该结构。

---

### D-13 Web 专属文案单独成文件，不动冻结的 Python

界面改名（「全身 GIF」→「预览贴图」）、速率/尺寸、导出历史、槽位提示这些只有浏览器需要的
文字，写在 `web/i18n.web.json`；`tools/export_web.py` 把它按语言合并覆盖到 Python 的
`MESSAGES` 上再导出 `data/i18n.json`。这样就不必为了改动「一行 UI 文案」去解冻 Python，`test_web_only_strings_are_merged_over_the_frozen_python_ones` 会检查合并结果，
`test_exported_data_is_up_to_date` 仍然守着「数据没过期」。

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
748 张内置贴图（约 1.6 MB）走 `data/vanilla/` 前缀，命中后用后台 fetch 刷新（stale-while-revalidate），
没命中就按需缓存。这样手机首次打开不会一次性下载 1.6 MB。
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

### D-18 玩家贴图内置，而不是只靠 Content/Images

「叠加玩家」原来只从 Chromium 的目录句柄读 `Player_0_3 / 0_7 / 0_10.png`，于是手机上这个
复选框永远拿不到贴图（除非用户手动挑 748 个文件——不可能）。现在把这三张（约 4 KB）
一并放进 `web/data/player/`，启动时就加载；用户选了 `Content/Images` 时优先用用户的
（可能是材质包），失败再回落到内置版。顺带把这一块补上了端到端断言：勾上之后应有
8 个文件 / 5 个预览（4 张 PNG + 4 个 GIF，其中两个是「玩家 + 盔甲」）。

## 4. 修改过的核心文件

按后续开发最可能触碰的顺序：

| 文件 | 作用 | 改动风险 |
|---|---|---|
| `armorhelper/layout.py` | 全部坐标与映射表常量 | **高**：改动会同时影响生成与还原，且必须重新导出 Web 数据 |
| `armorhelper/generate.py` | 各贴图生成 | 高：`tests/reference.py` 会逐像素校验旧格式输出 |
| `armorhelper/reverse.py` | 反向还原 | 中：往返无损有测试覆盖 |
| `armorhelper/sheets.py` | 成品贴图 → 全身帧/GIF | 中：与 `web/js/sheets.js` 必须保持一致 |
| `armorhelper/imaging.py` | 像素原语 | 高：语义与 v1 对齐，改动会影响全部输出 |
| `armorhelper/export.py` | 落盘与命名 | 中 |
| `armorhelper/config.py` | `config.json` | 低：对未知字段容错 |
| `armorhelper/i18n.py` | 中英文案 | 低：但改完要跑 `tools/export_web.py` |
| `armorhelper/data/ArmorTemplate_overlay.png` | 参考线图层 | 低：改了要跑 `tools/export_web.py` |
| `armorhelper/gui.py` | wxPython 界面 | 中：弹窗拆成了可替换的钩子便于测试 |
| `armorhelper/vanilla.py` + `data/armor_sets.json` | 套装表 | 低 |
| `web/js/*.js` | Web 核心（含 `sheets.js`） | 中：改完必须跑等价性测试 |
| `web/app.js` | Web 界面（含进度/取消、历史、popover、槽位） | 中 |
| `web/i18n.web.json` | 仅 Web 的文案（覆盖 Python 的键） | 低：改完必须跑 `tools/export_web.py` |
| `web/sw.js` + `manifest.webmanifest` | 离线缓存 / PWA | 中：`CORE` 清单与 `VERSION` 必须同步 |
| `web/data/player/` | 内置玩家贴图（3 张 + version.txt，约 4 KB） | 低：由 `tools/import_player_textures.py` 生成，不要手改 |
| `web/data/*` | **生成产物，不要手改**（含 `ArmorTemplate_overlay.png`） | 改完会被 CI 判定过期 |
| `tools/export_web.py` | 导出 Web 数据 | 改常量结构时必须同步改这里与 `web/js/data.js` |
| `tools/build_armor_sets.py` | 生成套装表 | 低 |
| `tests/reference.py` | v1 C# `GenerateSheets` 的独立直译 | **不要改**，它是旧格式的回归基准 |

---

## 5. 测试与验证结果

### 5.1 规模

```
tests/test_generate.py   22   旧格式与 v1 逐像素一致、新格式尺寸/格子占用/发光行、导出命名、参考线叠加
tests/test_reverse.py    26   反向还原往返、套装表、中文名、文件名清洗
tests/test_gui.py        22   wxPython 冒烟、设置读写、还原流程（含输出目录回填）、三张贴图 → GIF
tests/test_config.py      9   config.json 往返、v1 兼容、垃圾输入容错
tests/test_cli.py         9   各子命令冒烟与错误码、template 的参考线开关
tests/test_docs.py        9   文档裁切表与 layout 常量一致、用词、markdown 链接、README 为中文
tests/test_sheets.py     35   部位识别/ID 解析、混合尺度归一化、短末帧容错、帧合成、gif 子命令落盘
tests/test_web_port.py   34   JS 核心与 Python 逐像素对比 + 无头 Chrome 端到端（导出/还原/预览贴图/
                          取消/进度/历史/popover）+ 参考线 + 站点图标 + SW/Manifest + 文案合并
tests/test_vanilla_bundle.py 11  内置贴图的张数/checksum/目录结构/可复现性
                        ---
                        177（其中 1 项在未设置 ARMORHELPER_VANILLA_SOURCE 时跳过）
```

### 5.2 关键验证结论（均已实跑）

| 验证项 | 结果 |
|---|---|
| 旧格式（头/腿/手臂/身体/女性身体）与 v1 参考实现 | **逐像素一致** |
| 新格式各贴图尺寸 | 头 40×1120、腿 40×1120、身体 360×224、发光 360×448 |
| 生成 → 反向还原 → 再生成 | **头 / 腿 / 身体 全部 0 像素差异** |
| JS 核心 vs Python（6 种贴图 + 发光版 + 20 帧组合 + 反推模板） | **逐像素一致** |
| JS 生成的 PNG | PIL 解码后与 Python 输出一致（40×1120 RGBA） |
| JS 生成的 GIF | PIL 解码 **52 帧逐帧一致**，调色板 8 色，约 16.2 KB |
| JS 生成的 ZIP | `zipfile.testzip()` 通过，保留 `Armor/` 子目录与 UTF-8 文件名 |
| 无头 Chrome 跑 `web/tests/smoke.html` | **22 项全 PASS**（模块加载、贴图生成、往返无损、原版文件名取贴图、模板放大、PNG/GIF/ZIP、套装搜索） |
| 无头 Chrome 端到端驱动「还原这一套」 | **两种来源各跑一次**（仅内置 / 上传文件），产物名正确、3 个带标题的预览、模板预览 `naturalWidth = 128×4+4`、无「找不到贴图」告警 |
| 内置贴图包 | 748 张、分类张数与 `version.txt` 一致、checksum 匹配、`Armor/` 子目录保留、覆盖 140+ 套可还原套装、脚本可原样复现 |
| 参考线叠加（Python vs JS） | 新增像素数一致；叠加幂等；**不改变任何生成结果** |
| `web/data` 与 `tools/export_web.py` 输出 | 一致（未过期） |
| 套装表 | 204 条；151 条同时有头与腿；202 条有中文名；23 条来自套装加成（权威） |
| 「预览贴图」三个槽位 | 无头 Chrome 实测：错槽位被拒绝并给出中文原因；三格填满后生成 4 个文件、3 个预览；选「慢 + 2×」后 GIF 宽度 80、设置写进 localStorage |
| 进度与取消 | 取消「还原全部套装」后状态栏显示「已取消」、按钮复位；完整跑完显示 `i/151` 进度并产出 > 100 个模板 |
| 导出历史 | 无头 Chrome 实测：导出后 `armorhelper.history` 有 1 条（含缩略图 data URL），列表显示名称与文件数；还原全部后再增 1 条 |
| 模板 popover | 悬停后 popover 出现且图片 `naturalWidth = 516`（128×4 + 2px 边框），移开后隐藏 |
| 结果卡片高度 | 无头 Chrome 实测：空结果卡与输入卡的差值 ≤ 2px（内联 `min-height`），出结果后内联高度被清空、由内容撑开；两个标签页都断言 |
| 生成材质包 | 无头 Chrome 点按钮后把 zip 回传给 Python：`zipfile` 校验 7 个条目、`pack.json`（`Name=星尘板甲`、`Version 1.0`）、三张 PNG 与 Python 生成结果逐像素一致 |
| 叠加玩家（内置贴图） | 无头 Chrome 实测：不选目录、只勾复选框 → 4 张 PNG + 4 个 GIF、5 个预览，玩家提示消失 |
| 离线缓存 | 静态断言：`CORE` 覆盖启动所需的每个文件与模块、内置贴图走按需缓存；Manifest 合法；`app.js` 注册 `sw.js` |

### 5.3 复现命令

```bash
cd /Volumes/970/Games/tr/dev/ArmorHelper2

# 全部测试（含无头浏览器；缺 Node/Chrome 会自动 skip 对应用例）
python3 -m pytest tests -q

# 只跑 JS ↔ Python 等价性 + 浏览器端到端
python3 -m pytest tests/test_web_port.py -q

# 静态检查
python3 -m pyflakes armorhelper tests tools
for f in web/js/*.js web/app.js web/tests/run.mjs; do node --check "$f"; done

# 本地看 Web 版
python3 -m http.server 8000 --directory web      # http://127.0.0.1:8000/

# 桌面界面
python3 -m armorhelper gui

# 改了 Python 侧常量之后，务必重新导出 Web 数据
python3 tools/export_web.py
```

---

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

- **GitHub Pages 实际部署未跑过**：`.github/workflows/pages.yml` 已写好但从未推送运行。
- **桌面 GUI 只在 macOS 实测**（wxPython 4.2.4 / cocoa），Windows / Linux 未验证。
  Python 侧已冻结，因此这一项只在需要修 bug 时才补。
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
| 浏览器测试把文件下到 `~/Downloads` | 测试是真的点「下载」按钮，Chrome 默认落到用户下载目录（曾堆积 30 个 `ArmorTemplate_v1 (n).png`）。现在 harness 吞掉带 `download` 属性的 `<a>` 点击，并给 Chrome 写 `download.default_directory` 指向临时目录 |

---

## 8. 下一步开发顺序

**前提：Python 已冻结。下列事项除标注「仅维护」者外，全部在 `web/` 里做。**

### P0 — 把 Web 版真正发出去

1. **推送仓库并启用 GitHub Pages**：Settings → Pages → Source 选 GitHub Actions，
   推一次 `main`，确认工作流三步都过（重新导出数据 → `git diff --exit-code -- web/data`
   不报差异 → 等价性测试通过 → 发布成功）。

### P1 — 补齐 Web 版测试覆盖面（只改 `tests/test_web_port.py` 与 `web/tests/`）

2. Firefox / Safari 的降级路径实测（文件夹 API 不可用时的下载 / zip / 手动上传，
   以及 Service Worker 在这两个浏览器上的注册）。
3. 离线路径的自动化：用 Chrome 断网（`Network.emulateNetworkConditions`）后重载，
   断言页面仍能启动。目前只有静态断言（`CORE` 清单 + Manifest + 注册代码）。

> 已完成（原先列在这里）：还原全部的端到端、预览贴图的端到端、取消与进度、导出历史、
> 模板 popover、SW/Manifest 静态校验、**叠加玩家的端到端**（顺带把玩家贴图内置）。

### P2 — Web 版质量增强

5. 「预览贴图」支持一键换成内置原版贴图（套装列表 → 直接看动画），目前只能自己上传。
6. **套装表补全**（数据侧，`tools/build_armor_sets.py` → `web/data/armor_sets.json`）：
   53 条缺头或缺腿的条目，做一张人工覆盖表（例如 `data/armor_set_overrides.json`），
   避免每次重新生成又被覆盖。此改动**不影响 Python 运行时行为**，不违反冻结。
7. 导出历史可点击回填（现在只是记录时间 / 名称 / 文件数 / 缩略图，不能重新下载）。
8. GIF 速率/尺寸目前只有「预览贴图」页有控件（设置全局生效）；若用户反馈，可在导出页也放一份。

### P3 — 可选（需先解冻 Python，暂缓）

10. **模板扩展**：为「4 个行走手臂姿态」和「肩部」各加区域，可显著提升反向还原保真度。
    **注意**：已实测当前 128×80 模板**没有任何完全空闲的像素**（区域外 4395 个不透明像素
    全是参考线），所以扩展必须重画模板，会破坏「与 v1 同一张模板」的兼容目标；
    且要同时改 Python 生成器与 `web/js/generate.js` 两侧，**冻结期间不做**。
11. **参考线归属**：现在 `ArmorTemplate_v1.png` 本身含参考线，叠加层是空操作。
    若要「模板只有美术、参考线单独一层」，需重画模板，同样需要解冻，暂缓。
12. `.xnb` 解码（可直接吃游戏原始资源，但需要引入 xnb 解析，工作量不小）。
13. 自定义 GL 贴图/发光层的图形化编辑。
14. **仅维护**：Windows / Linux 上的桌面 GUI 实测（只在需要修 bug 时做）。

---

## 9. 快速上手

```bash
cd /Volumes/970/Games/tr/dev/ArmorHelper2
python3 -m pytest tests -q                     # 177 项，约 21 秒（含无头 Chrome；未装 wxPython 会跳过桌面用例）
python3 -m armorhelper gui                     # 桌面界面（已冻结，仅供对照）
python3 -m http.server 8000 --directory web    # Web 版 → http://127.0.0.1:8000/
python3 -m armorhelper sets --search 星尘       # 查套装
python3 -m armorhelper reverse --images "<Content/Images>" --body 190 -o out.png
```

改动前的自查清单：

0. **默认只改 `web/`**。动 `armorhelper/*.py` 前先确认是「修正确性缺陷」；改完必须
   同时改 `web/js/` 对应实现，否则两边会立刻不一致。
1. 改了 `web/i18n.web.json`、或万一改了 `armorhelper/layout.py` / `generate.py` / `i18n.py`
   → 必须跑 `python3 tools/export_web.py`，否则
   `tests/test_web_port.py::test_exported_data_is_up_to_date` 会失败。
   界面新文案优先写 `web/i18n.web.json`（Python 已冻结）。
1.5 改了 `web/` 的文件名或新增模块 → 同步 `web/sw.js` 的 `CORE` 与 `VERSION`，
   `test_service_worker_precaches_the_whole_app` 会逐项检查。
2. 改了 `web/js/` → 必须跑 `pytest tests/test_web_port.py`（会跑 Node 对比 + 无头 Chrome）。
3. 界面新增文案 → 中英文都要加，`test_frontend_files_exist_and_are_wired` 会检查。
   注意 `#opt-guide` 让复选框总数变为 17，`test_browser_renders_the_app` 里有断言。
4. 用词统一为「**盔甲**」，不要出现「盔甲」（`test_the_ui_never_says_hujia` 会拦）。
5. 提交前跑 `python3 -m pyflakes armorhelper tests tools` 与 `node --check`。
