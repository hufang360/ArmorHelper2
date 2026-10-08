# ArmorHelper · Web 版

纯前端实现，**没有任何服务端**：所有贴图生成、反向还原、预览与编码都在浏览器里完成。
可以直接部署到 GitHub Pages，也能离线使用（用任意静态服务器打开即可）。

功能与桌面版（Python + wxPython）一致，输出**逐像素相同**。

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

* 用 `tools/export_web.py` 从 Python 包重新导出 `web/data/`，并检查提交进去的数据没有过期；
* 跑 `tests/test_web_port.py`，确认 JS 核心与 Python 实现逐像素一致；
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

* **绘制模板预览**（128×80 放大 4 倍，棋盘格底）
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

### 反向还原

1. 「反向还原」标签页里搜索盔甲套（支持**中文名 / 英文名 / 任意 ID**），条目形如
   `星尘板甲  StardustPlate  (190)`。
2. 选中会自动填入头/身/腿 ID，也可以手改。
3. 「还原这一套」得到 128×80 模板，右侧并排显示
   **绘制模板 (128×80)**、**生成效果 (20 帧)** 与 **GIF 动画** 三个预览。
4. 「还原全部套装」会把贴图齐全的套装全部还原到 `<输出目录>/ArmorTemplate/`；
   没有输出目录时给一个 zip。

---

## 与 Python 版的关系

**两个版本在运行时不共享任何代码**，但保证结果一致：

```
armorhelper/          Python 版（命令行 + wxPython 桌面界面）
web/                  Web 版（纯静态，本目录）
tools/export_web.py   把 Python 侧的常量导出成 web/data/*.json
```

`tools/export_web.py` 生成：

| 文件 | 内容 |
|---|---|
| `data/layout.json` | 模板区域、帧偏移表、格子映射表（由 `armorhelper/layout.py` 导出） |
| `data/armor_sets.json` | 204 条原版套装表 |
| `data/i18n.json` | 中英文案（与桌面版共用同一份） |
| `data/ArmorTemplate_v1.png` | 绘制模板 |

改了 Python 侧之后重新导出：

```bash
python3 tools/export_web.py
```

---

## 目录结构

```
web/
  index.html            单页应用
  style.css             深色主题，无外部资源
  app.js                UI 逻辑（导入 / 导出 / 还原 / 设置）
  js/
    bitmap.js           RGBA 位图操作（等价于 armorhelper/imaging.py）
    data.js             布局 / 套装表 / 文案的加载与查询
    generate.js         头部 / 腿部 / 旧格式 / 复合身体贴图生成
    compose.js          20 帧合成、拼版预览、GIF 帧序列
    reverse.js          原版贴图 → 128×80 模板
    png.js              PNG 编码（CompressionStream，带 stored 回退）
    gif.js              GIF89a 编码（精确调色板 + LZW）
    zip.js              ZIP 打包（stored）
    fs.js               文件解码、下载、File System Access
    idb.js              IndexedDB（保存目录句柄）
  data/                 由 tools/export_web.py 生成
  tests/
    run.mjs             Node 下的核心自检（供 Python 测试对比）
    smoke.html          浏览器内的端到端自检
```

无框架、无构建、无 CDN，全部是原生 ES 模块。

---

## 测试

```bash
# Python 侧：跑 Node 核心并与 Python 输出逐像素对比（含浏览器自检）
python3 -m pytest tests/test_web_port.py -q

# 只跑 Node 核心（需要先准备一个工作目录，见测试代码）
node web/tests/run.mjs /tmp/workdir

# 浏览器自检：起个静态服务器后打开 web/tests/smoke.html
python3 -m http.server 8000 --directory web
```

`tests/test_web_port.py` 会：

* 用 Node 跑一遍 JS 核心，把头部 / 腿部 / 手臂 / 旧版身体 / 复合身体 / 发光版本 /
  20 帧组合 / 反推模板全部与 Python 结果**逐像素**比较；
* 用 PIL 解码 JS 生成的 PNG 与 GIF，逐帧比对；
* 用 `zipfile` 校验 JS 生成的 ZIP（含 CRC 与子目录结构）；
* 检查 `web/data/` 与 `tools/export_web.py` 的输出一致（防止数据过期）；
* 检查前端引用的元素与文案键都存在、页面不请求任何外部地址；
* 如果本机有 Chrome / Chromium，再用无头浏览器跑一次 `smoke.html` 与首页渲染。

---

## 已知限制

| 项目 | 说明 |
|---|---|
| 文件夹读写 | 仅 Chromium 内核支持；其它浏览器用下载 / zip |
| 无法自动定位游戏目录 | 浏览器拿不到本机路径，需要你自己选一次目录 |
| 没有 `.xnb` 解码 | 需要已解包的 PNG 资源目录 |
| 还原时只读三张贴图 | 也可以手动上传 `Armor_Head_N.png` / `Armor_N.png` / `Armor_Legs_N.png` |
| 大文件内存 | 全部在内存里处理；一次导出几十套盔甲没问题，几百套建议分批 |
