# ArmorHelper Web 版需求文档

| 项目 | 内容 |
|---|---|
| 文档名称 | ArmorHelper Web 版需求规格说明书 |
| 版本 | v2.0（纯静态，可部署 GitHub Pages） |
| 状态 | 已实现（对应 `web/` 目录，与 Python 版 2.0.0 输出一致） |
| 基准游戏版本 | 泰拉瑞亚 1.4.5（贴图格式自 1.4.4 起生效） |
| 兄弟文档 | [`需求文档.md`](需求文档.md)（Python 版 / 核心库规格） |
| 目标读者 | 模组作者、贴图美术、工具维护者 |

> **v1 到 v2 的变化**：v1 是「本地 Python HTTP 服务 + 浏览器前端」，无法部署到
> GitHub Pages。v2 把全部图像逻辑移植成原生 ES 模块，**没有任何服务端**，
> 是一个纯静态站点。Python 版与 Web 版从此完全分开，各自独立运行。

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
| WG-2 | 功能对齐桌面版：导出、反向还原、还原全部、预览、GIF、原版命名 |
| WG-3 | 与 Python 版**逐像素一致**，并有自动化测试证明 |
| WG-4 | 零依赖：无框架、无 npm 包、无 CDN，离线可用 |
| WG-5 | 中英文界面，与桌面版共用同一份文案 |
| WG-6 | 在 Chromium 上可直接读写用户指定的文件夹（写入游戏资源目录） |

### 2.2 范围内

* 单页应用（HTML + CSS + 原生 ES 模块）
* 贴图生成（头部 / 腿部 / 身体复合 / 旧格式 / 发光遮罩）
* 20 帧合成、拼版预览、GIF 动画
* 反向还原（单套 / 全部套装）
* PNG / GIF / ZIP 编码
* 设置持久化（localStorage）与目录句柄持久化（IndexedDB）
* File System Access API 集成（可选增强）
* Node 下的核心自检 + 浏览器内自检

### 2.3 范围外

* 服务端渲染 / 后端接口（v1 的能力已移除）
* 账号、云端存储、多用户
* `.xnb` 解码
* 浏览器扩展、PWA 离线缓存（后续可做）

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
│    bitmap.js   位图操作（等价 armorhelper/imaging.py）                 │
│    data.js     布局 / 套装表 / 文案                                    │
│    generate.js 贴图生成（等价 armorhelper/generate.py）                │
│    compose.js  帧合成（等价 armorhelper/compose.py）                   │
│    reverse.js  反向还原（等价 armorhelper/reverse.py）                 │
│    png.js / gif.js / zip.js   编码器                                   │
│    fs.js / idb.js            浏览器胶水                                │
│                                                                        │
│  data/  ← 由 tools/export_web.py 从 Python 包导出                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键设计决定

| 决定 | 理由 |
|---|---|
| 用原生 ES 模块，不打包 | 无构建链，改完刷新即生效；Pages 直接发布源码 |
| 核心模块不碰 DOM | 同一份代码能在 Node 里跑，从而与 Python 输出做逐像素对比 |
| 常量由 Python 导出而不是手抄 | 单一份数据源，杜绝两边漂移 |
| 自己做 PNG/GIF/ZIP 编码 | 不引入依赖；PNG 绕开 canvas 的 alpha 预乘问题，保证像素精确 |
| 目录句柄存 IndexedDB | 句柄不能进 localStorage，但可以被结构化克隆 |
| 浏览器不支持文件夹时降级 | 用下载 / zip / 手动上传贴图，功能不缺失 |

### 3.3 目录结构

```
web/
  index.html  style.css  app.js  package.json  .nojekyll  README.md
  js/     bitmap data generate compose reverse png gif zip fs idb
  data/   layout.json  armor_sets.json  i18n.json  ArmorTemplate_v1.png
  tests/  run.mjs（Node 自检）  smoke.html（浏览器自检）
```

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
2. 装 Pillow，跑 `tools/export_web.py` 重新导出 `web/data/`，并用 `git diff --exit-code`
   确认提交的数据没有过期；
3. 跑 `pytest tests/test_web_port.py`（Node 核心对比 + 浏览器自检）；
4. `actions/upload-pages-artifact` 上传 `web/`，`actions/deploy-pages` 发布。

仓库设置里把 Pages 的 Source 选为 **GitHub Actions** 即可。

`web/.nojekyll` 防止 Jekyll 忽略下划线开头的路径。

---

## 5. 功能需求

| 编号 | 需求 | 优先级 | 验收 |
|---|---|---|---|
| WFR-01 | 拖放或点选多张 128×80 模板，可单个移除 / 清空 | 必须 | WC-02 |
| WFR-02 | 非 128×80 的图片要给出提示并跳过 | 必须 | WC-13 |
| WFR-03 | 12 项导出目标复选，默认勾选与桌面版一致 | 必须 | WC-03 |
| WFR-04 | 生成头部 / 腿部 / 复合身体 / 发光遮罩 / 旧格式贴图 | 必须 | WC-05 |
| WFR-05 | 生成 20 帧拼版预览与 GIF 动画 | 必须 | WC-05 |
| WFR-06 | 指定盔甲 ID 时使用原版文件名与 `Armor/` 子目录 | 必须 | WC-06 |
| WFR-07 | 单文件下载与打包 zip 下载，zip 保留目录结构 | 必须 | WC-05 |
| WFR-08 | 可选「女性版本」「叠加玩家」用于预览 | 应该 | WC-07 |
| WFR-09 | 反向还原：可搜索套装列表（中文名 / 英文名 / ID），条目形如 `中文名  英文名  (ID)` | 必须 | WC-08 |
| WFR-10 | 选中套装自动填入头/身/腿 ID，可手改 | 必须 | WC-08 |
| WFR-11 | 还原结果展示 128×80 模板与其 20 帧预览，可下载 | 必须 | WC-09 |
| WFR-12 | 「还原全部套装」批量还原贴图齐全的套装 | 必须 | WC-10 |
| WFR-13 | 支持读取用户指定的 `Content/Images` 目录（Chromium） | 应该 | WC-11 |
| WFR-14 | 支持手动上传需要的那几张贴图（其它浏览器） | 必须 | WC-11 |
| WFR-15 | 支持写入用户指定的输出目录（Chromium），并记住授权 | 应该 | WC-12 |
| WFR-16 | 设置持久化（语言、勾选、ID、发光、肤色、预览开关） | 必须 | WC-14 |
| WFR-17 | 界面中英文切换即时生效 | 应该 | WC-15 |
| WFR-18 | 可选「生成后自检」：反向还原再生成，应与原贴图一致 | 可以 | WC-16 |
| WFR-19 | 所有错误以状态栏文字呈现，不弹原生 alert | 必须 | WC-13 |
| WFR-20 | 页面不请求任何外部地址（离线可用） | 必须 | WC-17 |

---

## 6. 界面需求

### 6.1 布局

```
┌ ArmorHelper · 泰拉盔甲贴图工具 · 网页版 ──────── [导出贴图][反向还原][设置]  [中文▾] ┐
│ ┌─ 输入文件 ───────────────────────────┐ ┌─ 导出选项 ──────────────────┐            │
│ │ ┌──────────────────────────────────┐ │ │ ☑ 头部贴图 (Armor_Head)     │            │
│ │ │  把 128×80 的绘制模板拖到这里     │ │ │ ☑ 腿部贴图 (Armor_Legs)     │            │
│ │ │  或点击选择（可多选）             │ │ │ ☑ 身体贴图（1.4.4+ 复合格式）│            │
│ │ └──────────────────────────────────┘ │ │ ☐ 身体 / 手臂贴图（1.3 旧格式）│          │
│ │ 铜盔甲.png            128×80     ✕   │ │ …（共 12 项）                │            │
│ │ [清空]  [下载绘制模板]                │ │ 预览选项                     │            │
│ └──────────────────────────────────────┘ │ ☐ 女性版本 ☐ 叠加玩家        │            │
│ ┌─ 导出结果 ───────────────────────────┐ │                              │            │
│ │ 铜盔甲                                │ │ [        开始导出        ]   │            │
│ │ [20 帧拼版预览]   [GIF 预览]          │ └──────────────────────────────┘            │
│ │ 铜盔甲_Head.png   40×1120 · 1 KB      │                                             │
│ │ [打包下载 (zip)]  [写入输出目录]       │                                             │
│ └──────────────────────────────────────┘                                             │
└──────────────────────────── 状态栏（ok / warn / bad / busy 四色）──────────────────────┘
```

### 6.2 控件与行为

| 编号 | 控件 | 需求 |
|---|---|---|
| WUI-01 | 顶部标签页 | 三个面板纯前端切换，不重新加载 |
| WUI-02 | 语言下拉 | 立即切换全部文案与 `<html lang>`，写入 localStorage |
| WUI-03 | 拖放区 | `dragenter/dragover` 高亮；支持点击与键盘 Enter |
| WUI-04 | 结果卡片 | 预览图 `image-rendering: pixelated` + 棋盘格底 |
| WUI-05 | 状态栏 | 四色反馈；所有错误走这里 |
| WUI-06 | 文件夹按钮 | 不支持 File System Access 时按钮降级并在状态栏说明 |
| WUI-07 | 套装列表 | `<select size=8>`，搜索框 140ms 防抖 |
| WUI-08 | 处理中 | 按钮禁用 + `busy` 文案，避免重复提交 |
| WUI-09 | 全局错误兜底 | `error` / `unhandledrejection` 都写进状态栏，不静默失败 |

### 6.3 视觉

* 深色主题，配色集中在 `:root` 变量。
* 主栏 flex 自适应，窄屏自动换行。
* 不依赖任何外部字体、图标或 CDN。

---

## 7. 非功能需求

| 编号 | 类别 | 需求 |
|---|---|---|
| WNFR-01 | 零依赖 | 运行时不需要任何第三方库；Python 只用于生成数据与测试 |
| WNFR-02 | 一致性 | 与 Python 版输出逐像素一致，由 `tests/test_web_port.py` 断言 |
| WNFR-03 | 静态性 | `web/` 目录内不得出现 `.py`；发布产物就是源码 |
| WNFR-04 | 性能 | 单张模板全量导出（含预览与 GIF）< 2 秒（桌面 Chrome） |
| WNFR-05 | 离线 | 页面不发起任何外部请求 |
| WNFR-06 | 可测试性 | 核心模块不碰 DOM，可在 Node 下运行并对比 |
| WNFR-07 | 兼容性 | Chrome / Edge / Firefox / Safari 最新版；文件夹功能仅 Chromium |
| WNFR-08 | 健壮性 | IndexedDB 不可用时不得卡死（2 秒超时降级） |
| WNFR-09 | 像素精确 | PNG 自行编码，绕开 canvas alpha 预乘；缩放一律最近邻 |
| WNFR-10 | 国际化 | 文案与桌面版共用 `armorhelper/i18n.py`，由脚本导出 |

---

## 8. 数据契约

`tools/export_web.py` 从 Python 包生成，Web 版只读：

| 文件 | 内容 |
|---|---|
| `data/layout.json` | 模板区域、帧偏移表、格子映射、逐帧图层、导出目标清单 |
| `data/armor_sets.json` | 204 条原版套装（body/head/legs/name/zh/confidence） |
| `data/i18n.json` | 中英文案 |
| `data/ArmorTemplate_v1.png` | 128×80 绘制模板 |

CI 会重新生成并比对，**数据过期会导致构建失败**。

---

## 9. 与 Python 版的对照

| 能力 | Python 版 | Web 版 |
|---|---|---|
| 运行方式 | 命令行 / wxPython 桌面窗口 | 浏览器（静态站点） |
| 依赖 | Pillow；桌面界面需 wxPython | 无 |
| 图像逻辑 | `armorhelper/*.py` | `web/js/*.js`（等价移植） |
| 一致性保证 | 自身即参考实现 | 逐像素对比测试 |
| 输入 | 文件对话框 / 拖放 | 拖放 / 点选（浏览器） |
| 输出目录 | 直接写文件系统 | File System Access（Chromium）或下载 / zip |
| 读取游戏贴图 | 直接读目录 | 目录句柄（Chromium）或手动上传 |
| 设置 | `config.json` | `localStorage` |
| 部署 | 本机 | GitHub Pages / 任意静态托管 |
| 代码共享 | — | 只共享「由脚本导出的数据」，运行时不共享代码 |

---

## 10. 验收标准

| 编号 | 验收内容 | 对应测试 |
|---|---|---|
| WC-01 | 页面可加载，模块可解析 | `test_browser_renders_the_app` |
| WC-02 | 多张模板一次导出 | 浏览器自检 `smoke.html` |
| WC-03 | 目标勾选默认与桌面版一致 | `test_layout_data_covers_every_frame` |
| WC-04 | 生成结果与 Python 逐像素一致 | `test_generated_sheets_match_python` 等 8 项 |
| WC-05 | 预览、GIF、zip 正确 | `test_gif_matches_the_python_frames`、`test_zip_has_the_expected_structure`、`test_browser_smoke_test` |
| WC-06 | 原版 ID 命名与子目录 | 浏览器自检 + Python `test_export_uses_vanilla_names` |
| WC-07 | 女性 / 玩家预览可生成 | 浏览器自检 `20 composed frames` |
| WC-08 | 套装搜索含中文名与 ID | 浏览器自检 `set search finds stardust` |
| WC-09 | 还原结果可下载且为 128×80 | `test_reverse_matches_python` |
| WC-10 | 还原全部可批量产出 | `test_reverse_result_regenerates_the_sheets` + 手工 |
| WC-11 | 目录读取与手动上传 | 手工（需真实浏览器授权） |
| WC-12 | 目录写入 | 手工（需真实浏览器授权） |
| WC-13 | 非法输入有提示不崩溃 | 浏览器自检的错误分支 + 手工 |
| WC-14 | 设置持久化 | 手工 / localStorage 检查 |
| WC-15 | 中英文切换 | `test_frontend_files_exist_and_are_wired` 文案键校验 |
| WC-16 | 生成后自检 | 浏览器自检 `reverse round trip is lossless` |
| WC-17 | 页面无外部请求 | `test_frontend_files_exist_and_are_wired` |
| WC-18 | 数据不过期 | `test_exported_data_is_up_to_date` |
| WC-19 | 两个版本彻底分开 | `test_no_python_left_in_the_web_app` |
| WC-20 | Pages 工作流正确发布 | `test_pages_workflow_publishes_the_web_folder` |

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
