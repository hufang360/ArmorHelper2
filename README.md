# ArmorHelper 2

[原版 ArmorHelper](https://forums.terraria.org/index.php?threads/armorhelper-sprite-armor-sets-30x-times-faster.68744/)
（Mirsario 作）的重写版，**纯静态网页**，已适配 **泰拉瑞亚 1.4.4 及之后的版本**。

这个工具把一张 128×80 的小模板（`ArmorTemplate_v1.png`）展开成整套盔甲所需的全部贴图，
不用再把同一件盔甲按每一层画 20 遍。

原版工具（2018 年，.NET Framework / WinForms）产出的是 1.3 时代的格式：`Armor_Head`、
`Armor_Body`、`Armor_Arm`、`Armor_Legs`，各 40×1120、20 帧竖排。泰拉瑞亚 1.4.4 把玩家渲染
重写成 *composite* 体系，身体与双臂合并为一张 **9 × 4 网格**，旧输出不再可用。本重写版
**保持模板格式与绘制流程完全不变**，只是产出新格式。

> **只有一个实现：`web/`。** 2.0 时代还有一个 Python 包（命令行 + wxPython 桌面界面）作为
> 参考实现，2026-11 起已移除；它当时的输出被冻结成
> [`web/tests/golden/`](web/tests/golden/) 里的图片，网页版的像素仍被钉在那些数字上。
> 历史版本在 git 里，`v1/` 目录保留原版工具的压缩包与模板。

---

## 快速开始

浏览器不允许 `file://` 下加载 ES 模块，用一个静态服务器打开即可：

```bash
npm start        # 仓库自带的 node tools/serve.mjs
# 然后打开 http://127.0.0.1:8000/
```

部署到 **GitHub Pages**：Settings → Pages → Source 选 **GitHub Actions**，推一次 `main`；
`.github/workflows/pages.yml` 会跑测试并发布 `web/`。

**放在哪个目录都能跑**：所有资源、Service Worker 的注册与缓存都是相对路径，所以
`https://example.com/任何/子目录/`、`https://user.github.io/<仓库名>/` 都可以直接访问，
不需要改配置（`tests/node/subpath.test.mjs` 会把它挂到 `/some/deep/directory/` 下跑一遍）。

---

## 功能

| 标签页 | 做什么 |
|---|---|
| **导出贴图** | 拖入 128×80 模板（可多选），勾选 12 项产物，得到预览 + 下载 + 打包 zip + 写入输出目录。左侧是「输入文件（含导出选项）+ 最近导出」，右侧是占一半页宽的导出结果；鼠标停在「下载绘制模板」上会弹出这 128×80 模板的 4× 预览 |
| **预览贴图** | 头部 / 身体 / 腿部**各一个槽位**，直接拖入成品贴图 → 男 / 女 20 帧 PNG 与 GIF。GIF 速率（100 / 500 / 1000ms）与尺寸（1× / 2× / 4×）可调；「生成材质包」打成游戏可直接读的 `<名称>-pack-pc.zip` |
| **反向还原** | 由原版盔甲贴图反推出 128×80 模板：可搜索套装列表（中文名 / 英文名 / ID），或一次还原全部套装（带 `i/n` 进度与取消） |
| **设置** | 输出目录与 `Content/Images` 目录（Chromium 的 File System Access）、三个盔甲 ID、玩家肤色 0~9、发光遮罩、生成后自检、界面语言 |

* **内置 748 张原版盔甲贴图**（WebP 图集，约 290 KB）与 3 张玩家贴图：手机上不用准备任何文件
  就能还原任意一套盔甲、叠加玩家预览。
* **离线可用**：Service Worker 预缓存启动文件，内置贴图按需缓存；还带 Manifest，可「安装」成独立窗口。
* **零依赖**：无框架、无 npm 包、无 CDN、无构建步骤；PNG / GIF / ZIP 都是自己编码的。
* 中英文界面；设置与导出历史存在 localStorage。

详见 [`docs/Web版需求文档.md`](docs/Web版需求文档.md) 与 [`web/README.md`](web/README.md)。

---

## 产物一览

导出页的 12 个勾选项（早期版本叫 `--targets`）：

| 名称 | 文件 | 尺寸 | 说明 |
|---|---|---|---|
| `head` | `<名称>_Head.png` / `Armor_Head_<id>.png` | 40×1120 | 20 帧，与 1.3 相同 |
| `legs` | `<名称>_Legs.png` / `Armor_Legs_<id>.png` | 40×1120 | 20 帧，与 1.3 相同 |
| `body` | `<名称>_Body.png` / `Armor/Armor_<id>.png` | 360×224 | 1.4.4+ 复合身体 + 双臂 |
| `legacy` | `*_BodyLegacy.png`、`*_ArmsLegacy.png` 等 | 40×1120 | 旧版 1.3 格式，兼容老模组 |
| `full` | `<名称>_FullArmor.png` | 40×1120 | 20 帧叠合 |
| `full-female` | `<名称>_FullArmorFemale.png` | 40×1120 | |
| `full-player` | `<名称>_FullArmorPlayer.png` | 40×1120 | 勾了「叠加玩家」 |
| `full-player-female` | `<名称>_FullArmorPlayerFemale.png` | 40×1120 | |
| `gif-full` | `<名称>_FullArmor.gif` | 40×56 帧 | 动画 |
| `gif-full-female` | `<名称>_FullArmorFemale.gif` | 40×56 帧 | |
| `gif-full-player` | `<名称>_FullArmorPlayer.gif` | 40×56 帧 | 勾了「叠加玩家」 |
| `gif-full-player-female` | `<名称>_FullArmorPlayerFemale.gif` | 40×56 帧 | |

默认勾选 `head,legs,body`。设置里勾「发光遮罩」会把身体贴图写成 360×448（第 4~7 行为发光层）。
指定盔甲 ID 时按原版命名输出（`Armor_Head_<id>` / `Armor_Legs_<id>` / `Armor/Armor_<id>`），
否则用输入文件名。

---

## 模板

[`web/data/ArmorTemplate_v1.png`](web/data/ArmorTemplate_v1.png) 与原版 ArmorHelper v1 附带的
模板逐字节相同，尺寸 128×80，区域划分：

```
      x:  1        23        44        66      83  100 110
 y  1     +---------+---------+---------+-------+---+---+
          | 5 个前臂姿态      | 行走臂 | 后臂          |
 y 19     +---------+---------+---------+-------+---+---+
          |  头部   |  身体   |  女性   |  腿   | 脚    |
          |         |         |         |       |       |
 y 48     +         + 跳跃    + 跳跃    +       +       +
```

* **头部** `(1,19,20,28)` —— 复制到全部 20 帧。
* **身体** `(23,19,20,28)`，**跳跃身体** `(23,48,20,28)`。
* **女性身体** `(44,19,20,28)`，**女性跳跃身体** `(44,48,20,28)`。
* **手臂** —— 5 个前臂姿态对应身体帧 0~4，1 个「行走臂」配合逐帧偏移用于帧 6~19，另有 1 个后臂。
* **腿** —— 10 块腿部素材 + 2 块脚部素材，由帧表映射到 20 帧。

全部逐帧偏移表（`frontArmOffsets`、`backArmOffsets`、`bodyHeadOffsets`、`legMapping`）都原样
照搬原版工具，存在 [`web/data/layout.json`](web/data/layout.json)，由 `web/js/` 读取 ——
网页版不再重新实现常量，只有这一份数据。

---

## 泰拉瑞亚 1.4.4+ 的贴图格式（变了什么）

```
Content/Images/Armor_Head_<id>.png    40 x 1120   20 帧，未变
Content/Images/Armor_Legs_<id>.png    40 x 1120   20 帧，未变
Content/Images/Armor/Armor_<id>.png   360 x 224   9 x 4 网格，每格 40x56   <-- 新
Content/Images/Armor/Armor_<id>.png   360 x 448   ……外加第 4~7 行的发光遮罩
```

不再有独立的手臂贴图：躯干、双肩、男女版本与全部手臂姿态都放在同一张贴图里，引擎按格子采样：

| 格子 | 内容 |
|---|---|
| `(0,0)` `(1,0)` | 男性躯干、男性躯干（跳跃帧 5） |
| `(0,2)` `(1,2)` | 女性躯干、女性躯干（跳跃帧 5） |
| `(0,1)` `(1,1)` | 男性前肩 / 后肩 |
| `(0,3)` `(1,3)` | 女性前肩 / 后肩 |
| `(2..6, 0)` | 前臂，对应身体帧 0~4 |
| `(2..6, 1)` | 前臂，对应身体帧 5~19（分组复用） |
| `(2..6, 2)` | 后臂，对应身体帧 0~4 |
| `(2..6, 3)` | 后臂，对应身体帧 5~19（分组复用） |
| `(7, 0..3)` | 挥动道具时的前臂，4 行 = 4 档伸缩 |
| `(8, 0..3)` | 挥动道具时的后臂 |

第 4~7 行只存在于发光盔甲上，是发光遮罩，引擎以 `+224 px` 偏移采样。

「身体帧 → 格子」的映射取自泰拉 1.4.5 源码的 `PlayerDrawSet.CreateCompositeData`，
存在 `web/data/layout.json` 的 `cells.frontArm` / `cells.backArm`。

### 模板是怎么映射到新网格的

* 躯干格直接放模板的身体素材，不做拆分。模板的身体素材本身已含肩与上臂，所以前/后肩格
  **故意留空** —— 引擎本来就在前臂之前画躯干，这样得到的观感与旧版完全一致。
* 行走手臂格沿用同一批手臂素材，位置与 ArmorHelper v1 在旧 20×28 帧里的位置完全相同。
  引擎让手臂的 position 与 origin 同步偏移，净位移为 0，因此渲染结果与 1.3 贴图一致。
  共用同一格的帧（`7~10`、`11~13`、`18~19` 等）在原版工具里偏移本来就相同，没有损失。
* 身体帧 6~19 的手臂使用固定纵向偏移 `12`：原版是 `12 + BODY_HEAD_OFFSETS[帧]`，用来抵消
  身体上下起伏；泰拉现在自己施加这个起伏（`Main.OffsetsPlayerHeadgear`），所以只剩常量部分。
* 第 7、8 列用第 0 帧的手臂填充，保证挥武器时手臂不消失。想要完美效果就自己画这 4 档姿态
  （引擎会绕身体中心旋转这张图）。
* 勾「发光遮罩」把第 0~3 行复制到第 4~7 行，得到「整件都发光」的底稿，再擦掉不该发光的部分即可。

### 参考资料

* [`docs/贴图裁切说明.md`](docs/贴图裁切说明.md) —— `Armor_1.png`（9×4 共 36 格逐格标注）、
  `Armor_Head_1.png`、`Armor_Legs_1.png` 的裁切方法，含可直接使用的
  `crop(left, upper, right, lower)` 坐标与「帧号 → 格子」对照表。
* [`docs/Web版需求文档.md`](docs/Web版需求文档.md) —— 网页版的规格与验收标准。
* [`docs/需求文档.md`](docs/需求文档.md) —— 核心行为与算法的完整规格（含已移除的 Python
  命令行 / 桌面界面章节，作历史参照）。
* [`docs/Web版UI线框图.md`](docs/Web版UI线框图.md) —— 各标签页的 ASCII 线框图、两栏比例与
  响应式断点。
* [`web/README.md`](web/README.md) —— 网页版自身说明（会发布到 GitHub Pages）。
* [`PROJECT_STATUS.md`](PROJECT_STATUS.md) —— 项目交接文档：技术决策、已知问题、下一步顺序。
* [`v1/`](v1/) —— 原版工具的压缩包、模板与论坛链接，作为溯源参考。

---

## 目录结构与工具

```
web/                  纯静态站点（发布的就是这个目录）
  index.html app.js style.css sw.js manifest.webmanifest
  js/                 核心：bitmap data generate compose reverse sheets atlas png gif zip fs idb
  data/               layout.json armor_sets.json i18n.json 模板 / 参考线 / 图标
                      vanilla/（748 张贴图的 WebP 图集）player/（玩家贴图）
  tests/              run.mjs（Node 自检）smoke.html（浏览器自检）golden/（冻结的参考图）
tools/                打包 / 开发脚本（.mjs，与站点同一套 Node 工具链）
tests/node/          npm test：core（金标准）· harness · browser · bundle · docs · site
```

| 工具 | 用途 |
|---|---|
| `npm run pack` → `tools/pack_vanilla_textures.mjs` | 把已解包的 `Content/Images` 打包成 `web/data/vanilla` 的 WebP 图集（1× 存储、按部位分页、每页 ≤ 2048px） |
| `npm run sets` → `tools/build_armor_sets.mjs` | 由游戏源码（`ArmorSetBonuses.cs` 等）生成 `web/data/armor_sets.json` |
| `npm run players` → `tools/import_player_textures.mjs` | 把 `Player_0_3 / 0_7 / 0_10.png` 复制进 `web/data/player/` |
| `npm run inspect` → `tools/inspect_armor.mjs` | 按引擎算法渲染任意 1.4.4+ 身体贴图，方便与原版对照 |
| `npm start` → `tools/serve.mjs` | 静态服务器（`http://127.0.0.1:8000/`） |

```bash
npm ci                                              # 只装图集打包要用的 wasm 编解码器
npm run pack -- "/path/to/Content/Images" --version 1.4.5.8
npm run sets -- "/path/to/tr-code-1458"
npm run players -- "/path/to/Content/Images" --version 1.4.5.8
npm run inspect -- "Terraria/Content/Images/Armor/Armor_1.png" --frames 0,5
```

> **整个仓库没有 Python 了。** 图集打包需要**无损** WebP 编码，Node 自带不了，所以用
> `@jsquash/webp`（libwebp 的 wasm 版）——它只是 **devDependency**，发布出去的站点仍然零依赖、
> 由浏览器原生解码 WebP。为什么不用 PNG 图集：实测首屏会从 297 KB 涨到 2.3 MB（8.6×）。

---

## 旧格式输出的保真度

`legacy` 目标（`*_BodyLegacy.png` / `*_ArmsLegacy.png` 等）是 ArmorHelper v1 的逐行移植，
连历史怪癖都保留了（被裁剪的后臂、两个被忽略的模板像素、不跟随 bob 的 1 像素补点）。
这些输出与 2018 年那版工具**逐像素一致**，并且现在由
[`web/tests/golden/`](web/tests/golden/) 里冻结的参考图守着（见下）。

## 开发与测试

```bash
npm ci                      # devDependency：wasm WebP 编解码器（只有打包工具与图集用例要用）
npm test                    # 全部 164 项，约 16 秒
npm start                   # 静态服务器：http://127.0.0.1:8000/
```

| 文件 | 覆盖 |
|---|---|
| `tests/node/core.test.mjs` | 114 项：`web/js/` 核心 vs `web/tests/golden/` 的冻结参考图，逐像素 |
| `tests/node/harness.test.mjs` | 5 项：贴图查找、部位识别、图集读取、zip 结构、拼版 PNG |
| `tests/node/browser.test.mjs` | 3 项：真 Chrome 里跑完整交互（拖放、导出、预览贴图、材质包、取消、还原全部、切语言） |
| `tests/node/bundle.test.mjs` | 19 项：WebP 图集自洽、内容 checksum、以及「从源目录重打一遍」的可复现性 |
| `tests/node/docs.test.mjs` | 10 项：裁切表 ↔ `layout.json`、文档链接、用词、README 语言、文案无死条目 |
| `tests/node/site.test.mjs` | 12 项：数据、HTML↔JS 接线、SW 的 `CORE` 清单、Manifest、图标、图集包、Pages 工作流、无绝对路径 |
| `tests/node/subpath.test.mjs` | 1 项：把站点挂到 `/some/deep/directory/` 下，真 Chrome 跑启动 + 图集 + 反推 + SW 作用域 |

`ARMORHELPER_VANILLA_SOURCE="<Content/Images>" npm test` 会额外校验「图集能从源目录原样重建」，
并把 748 张贴图逐像素还原比对（约 30 秒）。

## 致谢

* 原版工具、模板美术与工作流：**Mirsario**。
* 新复合贴图布局的考证：泰拉瑞亚 1.4.5 源码与原版贴图集。

## 许可

MIT。随包分发的 `ArmorTemplate_v1.png` 来自 Mirsario 的 ArmorHelper v1。
