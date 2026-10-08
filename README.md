# ArmorHelper 2

[原版 ArmorHelper](https://forums.terraria.org/index.php?threads/armorhelper-sprite-armor-sets-30x-times-faster.68744/)
（Mirsario 作）的 Python 重写版，已适配 **泰拉瑞亚 1.4.4 及之后的版本**。

这个工具把一张 128×80 的小模板（`ArmorTemplate_v1.png`）展开成整套盔甲所需的全部贴图，
不用再把同一件盔甲按每一层画 20 遍。

原版工具（2018 年，.NET Framework / WinForms）产出的是 1.3 时代的格式：`Armor_Head`、
`Armor_Body`、`Armor_Arm`、`Armor_Legs`，各 40×1120、20 帧竖排。泰拉瑞亚 1.4.4 把玩家渲染
重写成 *composite* 体系，身体与双臂合并为一张 **9 × 4 网格**，旧输出不再可用。本重写版
**保持模板格式与绘制流程完全不变**，只是产出新格式。

---

## 安装

```bash
pip install pillow            # 生成贴图只需要它
pip install wxPython          # 只有桌面界面需要
pip install -e .              # 可选，安装 armorhelper / armorhelper-gui 命令
```

不安装也能直接用：

```bash
python3 -m armorhelper --help
```

## 快速开始

```bash
# 1. 导出一张绘制模板，用 Aseprite / Piskel 等随便改
python3 -m armorhelper template -o MyArmor.png

# 2. 生成贴图（文件名：MyArmor_Head.png / MyArmor_Legs.png / MyArmor_Body.png）
python3 -m armorhelper -i MyArmor.png -o out/

# 3. 或者直接按原版文件名输出，丢进游戏资源目录
python3 -m armorhelper -i MyArmor.png -o "Terraria/Content/Images" \
    --id-head 189 --id-body 190 --id-legs 130
#   -> Content/Images/Armor_Head_189.png
#      Content/Images/Armor_Legs_130.png
#      Content/Images/Armor/Armor_190.png

# 4. 预览图与 GIF
python3 -m armorhelper -i MyArmor.png -o out/ --targets all \
    --images "Terraria/Content/Images"
```

## 反向还原：由原版盔甲反推出模板

有时候需要的方向相反 —— 拿原版盔甲当底稿来改。因为生成过程是「纯像素拷贝 + 末尾 2 倍最近邻
放大」，每一步都可逆：

```bash
# 身体 ID 190 对应哪套？头/腿的 ID 是多少？
python3 -m armorhelper sets --search stardust
#   星尘板甲  StardustPlate (body 190, head 189, legs 130)  [name]
python3 -m armorhelper sets --search 星尘        # 中文也能搜

# 还原出绘制模板（头/腿 ID 自动查表）
python3 -m armorhelper reverse --images "Terraria/Content/Images" --body 190 -o Stardust.png

# 也可以手动指定三个 ID
python3 -m armorhelper reverse --images "..." --body 190 --head 189 --legs 130 -o out.png

# 一次还原全部套装，输出到 <输出目录>/ArmorTemplate/
python3 -m armorhelper reverse --images "..." --all -o templates/
#   templates/ArmorTemplate/星尘板甲_190.png ……（151 套约 0.4 秒）
```

桌面界面的「反向还原」分组里有两个按钮：

* **从原版 ID 还原模板...** —— 可搜索的套装列表，还原结果写入**输出目录**（和贴图同一个目录）。
* **还原全部套装...** —— 把贴图齐全的套装全部还原到 **`<输出目录>/ArmorTemplate/`**，
  带进度显示，结束后询问是否打开目录。

输出目录为空时会先弹出目录选择框，选完立即回填并记住。列表条目形如
`星尘板甲  StardustPlate  (190)`，搜索框支持中文名、英文名与任意 ID。

还原精度：

| 部位 | 往返一致率 | 说明 |
|---|---|---|
| 头部 | 100% | 无损 |
| 腿部 | 90~100% | 前后脚贴图在同一帧里互相遮挡，后脚的少数像素不可观测 |
| 身体（按引擎渲染后的画面比较） | 90~97% | 模板只有 1 个行走手臂姿态，原版 4 个不同姿态格会被合并 |

依据：**748 个原版盔甲贴图全部是 1× 像素画的精确 2 倍最近邻放大**（实测 2×2 同色块比例
100%），所以 128×80 的模板足以描述它们。

套装表在 `armorhelper/data/armor_sets.json`。泰拉并没有把「套装」存成数据，因此
`tools/build_armor_sets.py` 从游戏源码推导：

* 有套装加成的盔甲直接取自 `ArmorSetBonuses.cs`（权威，标记 `set-bonus`）；
* 其余按原版命名规则匹配（标记 `name` / `prefix`）；
* 中文名取自胸甲那一件：解析 `Item.cs` 里的 `bodySlot = n;` 拿到物品 ID，再查
  `Terraria.Localization.Content.zh-Hans.Items.json`（204 条中 202 条有中文名）。

重新生成：

```bash
python3 tools/build_armor_sets.py /path/to/decompiled/Terraria
```

## 桌面界面

```bash
python3 -m armorhelper gui        # 或：armorhelper-gui
```

用 **wxPython** 实现，四个分组与原版一致（输入文件、输出目录、导出、选项），另加「详情」
面板放新格式需要的东西（发光遮罩、玩家肤色、三个盔甲 ID、泰拉贴图目录）。

* 文件可以直接拖进窗口，也可以点「选择...」。
* 输入列表显示 `从未导出` / `上次导出于 N 秒前`，绿黄红三色，和原版一样。
* 「选项」里覆盖上表全部 12 种产物，含 GIF。
* 所有设置记在 `config.json`：勾选项、ID、发光、肤色、**输入文件列表、窗口位置尺寸、
  列宽、界面语言、对话框起始目录、每个文件上次导出时间** —— 下次打开就是关掉时的样子。
  原版 v1 的 `config.json` 也能读。
* 首次启动会自动探测游戏的 `Content/Images` 目录。
* 「视图 → 界面语言」可切换中文 / English，切换后会被记住。
* 导出在后台线程执行，界面不卡。
* 「反向还原」分组可由盔甲 ID 反推模板。

## 网页版

[`web/`](web/README.md) 是一个**完全独立的纯静态站点** —— 不需要 Python、不需要服务端、
没有构建步骤，可以直接发布到 **GitHub Pages**。

```bash
python3 -m http.server 8000 --directory web
# 然后打开 http://127.0.0.1:8000/
```

全部处理都在浏览器里完成：生成贴图、合成 20 帧预览、编码 PNG / GIF / ZIP。JS 核心是本包的
移植版，并有**逐像素等价性测试**（`tests/test_web_port.py` 用 Node 跑 JS 核心，与 Python
输出逐像素比对：各类贴图、20 帧组合、反推模板、PNG、GIF 全部 52 帧、ZIP）。

* 拖放 128×80 模板，勾选要导出的内容，得到预览 + 下载 + 打包 zip。
* 可搜索的套装列表（中文名 / 英文名 / ID）与「还原全部套装」。
* **内置 748 张原版盔甲贴图（Terraria 1.4.5.7，约 1.6 MB）**，手机上不用准备任何文件
  就能还原任意一套盔甲。
* Chrome / Edge 上可以直接读取你的 `Content/Images` 文件夹，并把贴图写回游戏资源目录
  （File System Access API）；其它浏览器降级为下载 / zip / 手动上传贴图。
* 默认中文，右上角可切英文。
* 可选的**参考线叠加层**（`data/ArmorTemplate_overlay.png`，128×80）会叠在模板*预览*与
  下载的绘制模板上，**不会**进入生成的贴图。

部署：推到 GitHub 后，**Settings → Pages → Source** 选 **GitHub Actions**。
`.github/workflows/pages.yml` 会重新导出 `web/data/`、检查提交的数据没过期、跑等价性测试，
然后发布 `web/`。

两个版本刻意分开：运行时不共享代码，只共享 `tools/export_web.py` 导出的数据。

规格见 [`docs/Web版需求文档.md`](docs/Web版需求文档.md)，网页版自身说明见
[`web/README.md`](web/README.md)。

## 产物一览

| `--targets` 名称 | 文件 | 尺寸 | 说明 |
|---|---|---|---|
| `head` | `<名称>_Head.png` / `Armor_Head_<id>.png` | 40×1120 | 20 帧，与 1.3 相同 |
| `legs` | `<名称>_Legs.png` / `Armor_Legs_<id>.png` | 40×1120 | 20 帧，与 1.3 相同 |
| `body` | `<名称>_Body.png` / `Armor/Armor_<id>.png` | 360×224 | 1.4.4+ 复合身体 + 双臂 |
| `legacy` | `*_BodyLegacy.png`、`*_ArmsLegacy.png` 等 | 40×1120 | 旧版 1.3 格式，兼容老模组 |
| `full` | `<名称>_FullArmor.png` | 40×1120 | 20 帧叠合 |
| `full-female` | `<名称>_FullArmorFemale.png` | 40×1120 | |
| `full-player` | `<名称>_FullArmorPlayer.png` | 40×1120 | 需要 `--images` |
| `full-player-female` | `<名称>_FullArmorPlayerFemale.png` | 40×1120 | 需要 `--images` |
| `gif-full` | `<名称>_FullArmor.gif` | 40×56 | 动画预览 |
| `gif-full-female` | `<名称>_FullArmorFemale.gif` | 40×56 | |
| `gif-full-player` | `<名称>_FullArmorPlayer.gif` | 40×56 | 需要 `--images` |
| `gif-full-player-female` | `<名称>_FullArmorPlayerFemale.gif` | 40×56 | 需要 `--images` |

`--targets` 默认是 `head,legs,body`；用 `all` 全出，`none` 跳过。加 `--glow` 会把身体贴图
写成 360×448（第 4~7 行为发光遮罩）。

`--images` 必须指向**已解包**（PNG，不是 `.xnb`）的 `Terraria/Content/Images` 目录，
只用于给 `*player*` 预览画上玩家本体。

---

## 模板

`armorhelper/data/ArmorTemplate_v1.png` 与原版 ArmorHelper v1 附带的模板逐字节相同，
尺寸 128×80，区域划分：

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

全部逐帧偏移表（`FRONT_ARM_OFFSETS`、`BACK_ARM_OFFSETS`、`BODY_HEAD_OFFSETS`、`LEG_MAPPING`）
都原样照搬原版工具 —— 见 `armorhelper/layout.py` 与 `docs/armorhelper-v1.decompiled.cs`。

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
存放在 `armorhelper/layout.py` 的 `FRONT_ARM_CELL` / `BACK_ARM_CELL`。

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
* `--glow` 把第 0~3 行复制到第 4~7 行，得到「整件都发光」的底稿，再擦掉不该发光的部分即可。

### 参考资料

* [`docs/贴图裁切说明.md`](docs/贴图裁切说明.md) —— `Armor_1.png`（9×4 共 36 格逐格标注）、
  `Armor_Head_1.png`、`Armor_Legs_1.png` 的裁切方法，含可直接使用的
  `crop(left, upper, right, lower)` 坐标与「帧号 → 格子」对照表。
* [`docs/需求文档.md`](docs/需求文档.md) —— Python 版的完整规格。
* [`docs/Web版需求文档.md`](docs/Web版需求文档.md) —— 网页版的规格。
* [`web/README.md`](web/README.md) —— 网页版自身说明（会发布到 GitHub Pages）。
* [`PROJECT_STATUS.md`](PROJECT_STATUS.md) —— 项目交接文档：技术决策、已知问题、下一步顺序。
* [`v1/`](v1/) —— 原版工具的压缩包、模板与论坛链接，作为溯源参考。

`tools/inspect_armor.py` 会按引擎算法渲染任意 1.4.4+ 身体贴图，方便和原版对照：

```bash
python3 tools/inspect_armor.py "Terraria/Content/Images/Armor/Armor_1.png" --frames 0,5
```

---

## 旧格式输出的保真度

`generate_head`、`generate_legs`、`generate_arms`、`generate_body_legacy` 是 ArmorHelper v1 的
逐行移植，连历史怪癖都保留了（被裁剪的后臂、两个被忽略的模板像素、不跟随 bob 的 1 像素补点）。
`tests/reference.py` 是原版 C# `GenerateSheets` 的独立直译，`tests/test_generate.py` 断言移植版
产出**逐像素一致**的贴图 —— 也就是说 `--targets legacy` 的输出与 2018 年那版工具完全一样。

## 开发

```bash
python3 -m pytest tests -q                      # 全部测试（约 4 秒）
python3 -m pyflakes armorhelper tests tools      # 静态检查
python3 tools/export_web.py                      # 改了 Python 侧常量后，重新导出 Web 数据
```

改了 `armorhelper/` 下的常量或文案，务必跑一次 `tools/export_web.py`，否则
`tests/test_web_port.py::test_exported_data_is_up_to_date` 会失败。

## 致谢

* 原版工具、模板美术与工作流：**Mirsario**。
* 新复合贴图布局的考证：泰拉瑞亚 1.4.5 源码与原版贴图集。
* 本重写版：同一套工具的 Python / 网页双实现。

## 许可

MIT。随包分发的 `ArmorTemplate_v1.png` 来自 Mirsario 的 ArmorHelper v1。
