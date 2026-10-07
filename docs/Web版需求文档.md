# ArmorHelper Web 版需求文档

| 项目 | 内容 |
|---|---|
| 文档名称 | ArmorHelper Web 版需求规格说明书 |
| 版本 | v1.0 |
| 状态 | 已实现（对应代码版本 2.0.0 / `armorhelper.web`） |
| 基准游戏版本 | 泰拉瑞亚 1.4.5（贴图格式自 1.4.4 起生效） |
| 兄弟文档 | [`需求文档.md`](需求文档.md)（桌面版 / 核心库规格） |
| 目标读者 | 模组作者、贴图美术、工具维护者 |

---

## 1. 背景与定位

桌面版（wxPython）已经能完成全部贴图生成与反向还原。Web 版要解决的问题是：

| 痛点 | Web 版的对策 |
|---|---|
| 换机器、换系统要装 wxPython，编译麻烦 | 只用标准库 + Pillow，`pip install pillow` 就能跑 |
| 想在平板 / 另一台电脑 / 远程开发机上用 | 浏览器访问，界面自适应 |
| 想把结果直接发给别人看 | 生成结果带 20 帧预览图、GIF 与一键 zip 下载 |
| 想在浏览器里对比多套盔甲 | 表格化结果卡片，图片内联预览 |

**核心原则：Web 版不重新实现任何图像逻辑**，所有生成、还原、预览都调用桌面版共用的
`armorhelper` 包，保证两个端的输出**逐像素一致**。

---

## 2. 目标与范围

### 2.1 目标

| 编号 | 目标 |
|---|---|
| WG-1 | 浏览器内完成模板图 → 泰拉盔甲贴图的全部导出 |
| WG-2 | 浏览器内完成原版盔甲 → 绘制模板的反向还原（含「还原全部套装」） |
| WG-3 | 复用桌面版的核心库与中文文案，输出与桌面版完全一致 |
| WG-4 | 零额外依赖（不引入 Flask/FastAPI/Node 构建链），一条命令启动 |
| WG-5 | 结果可预览、可单独下载、可打包下载 |
| WG-6 | 设置持久化，与桌面版可共存互不干扰 |

### 2.2 范围内

* 本地 HTTP 服务 + 单页应用
* 导出（含发光遮罩、原版 ID 命名、预览叠加玩家）
* 反向还原（单套 / 全部套装）
* 服务端目录浏览（用于选择「泰拉贴图目录」「输出目录」）
* 设置持久化
* 中英文界面

### 2.3 范围外

* 多用户 / 账号 / 权限
* 公网部署（默认只监听 `127.0.0.1`）
* 浏览器端图像处理（不做 WebAssembly / Canvas 重算）
* 在线素材库、云端存储

---

## 3. 总体设计

### 3.1 架构

```
┌──────────────────── 浏览器 ────────────────────┐
│  index.html + style.css + app.js（无框架/无构建）│
│   ├─ 拖放上传（FileReader → base64）            │
│   ├─ fetch JSON API                             │
│   └─ 内联 <img> 预览生成的 PNG / GIF            │
└───────────────────────┬────────────────────────┘
                        │ HTTP (127.0.0.1)
┌───────────────────────┴────────────────────────┐
│  armorhelper.web.server   （http.server 标准库）│
│   ├─ 路由 / 静态资源 / JSON 编解码 / 错误→400   │
│   └─ armorhelper.web.api  （纯逻辑，可单测）    │
│        └── armorhelper.*  （与桌面版同一套核心）│
└────────────────────────────────────────────────┘
```

### 3.2 为什么是「本地服务 + 浏览器」

* 图像逻辑已经在 Python 里，重写一遍到 JS 会带来两套实现和两份 bug。
* 浏览器可以直接读取本地文件（上传给本机服务），也能展示 PNG/GIF，无需 Electron。
* 服务端能访问真实文件系统，因此「输出目录直接写进游戏 Content/Images」「批量还原全部套装」
  这两种桌面版的核心用法得以保留。

### 3.3 目录结构

```
armorhelper/web/
    __init__.py
    api.py          # 全部业务逻辑，不依赖 socket
    server.py       # HTTP 路由与静态资源
    store.py        # web-config.json 读写（首次从 config.json 播种）
    static/
        index.html
        style.css
        app.js
        favicon.png
```

---

## 4. 运行方式

```bash
# 依赖只有 Pillow
pip install pillow

# 启动（默认 http://127.0.0.1:8765/）
python3 -m armorhelper web --open          # --open 自动打开浏览器

python3 -m armorhelper web --port 9000 --host 127.0.0.1
python3 -m armorhelper web --config /path/to/web-config.json
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--host` | `127.0.0.1` | 绑定地址；默认仅本机可访问 |
| `--port` | `8765` | 端口；`0` 表示随机（日志里会打印实际地址） |
| `--open` / `-o` | 关 | 启动后自动打开系统默认浏览器 |
| `--config` | `web-config.json` | 设置文件路径 |

---

## 5. 接口规格

所有接口返回 JSON（`Content-Type: application/json; charset=utf-8`），
二进制接口除外。任何业务错误返回 HTTP 400 + `{"error": "..."}`；
服务端内部异常返回 500，且不会中断服务。

### 5.1 元信息与设置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 单页应用 |
| GET | `/static/<file>` | 静态资源（`app.js` / `style.css` / `favicon.png`） |
| GET | `/api/state` | 读取设置 + 版本 + 默认勾选项 |
| POST | `/api/state` | 局部更新设置（未出现的字段保持不变），返回新状态 |
| GET | `/api/i18n` | `{messages: {zh_CN: {...}, en: {...}}, targets: [...]}` |
| GET | `/api/targets` | 导出目标清单与默认勾选 |
| GET | `/api/template` | 内置 128×80 绘制模板 PNG |
| POST | `/api/detect-images` | 自动探测泰拉 `Content/Images` 并写入设置 |

`POST /api/state` 可接受的字段：

```jsonc
{
  "exportFolder": "/path/to/output",     // 输出目录
  "imagesFolder": "/path/to/Content/Images", // 泰拉贴图目录
  "glow": false,                          // 发光遮罩 360x448
  "skin": 0,                              // 预览用玩家肤色 0~9
  "language": "zh_CN",                    // 界面语言
  "targets": { "head": true, ... },       // 12 个导出目标
  "ids": { "id_head": "", "id_body": "", "id_legs": "" }
}
```

### 5.2 原版数据

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sets?q=<关键词>` | 套装列表；`q` 支持中文名 / 英文名 / 任一 ID；为空返回全部 |
| GET | `/api/browse?path=<目录>` | 列目录（仅子目录 + 上级 + 快捷入口），用于目录选择器 |

`/api/sets` 单项结构：

```json
{
  "body": 190, "head": 189, "legs": 130,
  "name": "StardustPlate", "zh": "星尘板甲",
  "label": "星尘板甲  StardustPlate  (190)",
  "confidence": "name", "complete": true
}
```

### 5.3 生成与还原

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| POST | `/api/generate` | `{files:[{name,data(base64)}], targets:[], female:bool, player:bool}` | 逐张模板导出 |
| POST | `/api/reverse` | `{images, body, head?, legs?}` | 还原单套 |
| POST | `/api/reverse-all` | `{images}` | 还原全部贴图齐全的套装 |

返回的任务对象：

```jsonc
{
  "id": "4292c2bf895e",
  "kind": "export",                 // export | reverse | reverse-all
  "name": "MyArmor",
  "files": [{
    "name": "Armor_190.png",
    "relative": "Armor/Armor_190.png",
    "size": 4368, "width": 360, "height": 224,
    "url": "/api/job/<id>/Armor/Armor_190.png",
    "preview": true
  }],
  "written": ["/path/to/output/Armor_190.png"],  // 同时写入输出目录的结果
  "warnings": [],
  "preview": "/api/job/<id>/_preview_sheet.png", // 20 帧拼版
  "gif": "/api/job/<id>/_preview.gif"
}
```

`/api/reverse-all` 额外返回 `{total, failed, directory}`。

### 5.4 结果下载

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/job/<id>/<相对路径>` | 下载单个产物（支持 `Armor/` 子目录，文件名做 URL 编码） |
| GET | `/api/job/<id>/all.zip` | 打包下载（保留 `Armor/` 子目录，不含预览文件） |

---

## 6. 功能需求

| 编号 | 需求 | 优先级 | 验收 |
|---|---|---|---|
| WFR-01 | 页面首屏加载后自动读取设置、套装表与文案，状态栏显示「已连接」 | 必须 | WC-01 |
| WFR-02 | 支持拖放与点选多张 128×80 模板图，列表可单个移除 / 清空 | 必须 | WC-02 |
| WFR-03 | 提供 12 项导出目标复选，勾选变化立即写配置 | 必须 | WC-03 |
| WFR-04 | 导出时可选择「女性版本」「叠加玩家」用于生成预览 | 应该 | WC-04 |
| WFR-05 | 生成结果展示 20 帧拼版预览与 GIF，并列全部产物（尺寸/大小/下载链接） | 必须 | WC-05 |
| WFR-06 | 生成结果支持打包 zip 下载，且保留原版 `Armor/` 目录结构 | 必须 | WC-05 |
| WFR-07 | 指定输出目录时，产物同时写入该目录（可直接落到游戏资源目录） | 必须 | WC-06 |
| WFR-08 | 设置三个盔甲 ID 后，产物使用原版文件名（`Armor_Head_<id>.png` 等） | 必须 | WC-06 |
| WFR-09 | 支持发光遮罩（360×448）与玩家肤色（0~9） | 应该 | WC-07 |
| WFR-10 | 反向还原面板提供可搜索的套装列表，条目格式 `中文名  英文名  (身体ID)` | 必须 | WC-08 |
| WFR-11 | 选中套装自动填入头/身/腿 ID，允许手动覆盖 | 必须 | WC-08 |
| WFR-12 | 还原结果展示模板预览（该模板生成出的 20 帧）并可下载 | 必须 | WC-09 |
| WFR-13 | 支持「还原全部套装」，输出到 `<输出目录>/ArmorTemplate/`，返回统计 | 必须 | WC-10 |
| WFR-14 | 提供目录选择器（列表 + 上级 + 快捷入口），可回填输出目录 / 贴图目录 | 必须 | WC-11 |
| WFR-15 | 提供「自动探测」按钮定位泰拉 `Content/Images` | 应该 | WC-11 |
| WFR-16 | 设置持久化到 `web-config.json`，首次从桌面版 `config.json` 播种 | 必须 | WC-12 |
| WFR-17 | 界面支持中文 / English 切换，切换后不刷新页面即时生效 | 应该 | WC-13 |
| WFR-18 | 所有业务错误以状态栏文字 + HTTP 400 呈现，不弹原生 alert | 必须 | WC-14 |
| WFR-19 | 服务端永不因单个请求异常而退出 | 必须 | WC-15 |
| WFR-20 | 生成结果按时间淘汰，最多保留 24 个任务目录 | 应该 | WC-16 |

---

## 7. 界面需求

### 7.1 布局

```
┌─ ArmorHelper 2.0.0 · 泰拉盔甲贴图工具 · 网页版 ─────────  [导出贴图][反向还原][设置]  [中文▾] ┐
│                                                                                            │
│  ┌─ 导出贴图 ─────────────────────────────┐  ┌─ 导出选项 ────────────────┐                │
│  │  ┌───────────────────────────────────┐ │  │ ☑ 头部贴图 (Armor_Head)   │                │
│  │  │   把 128×80 的绘制模板拖到这里     │ │  │ ☑ 腿部贴图 (Armor_Legs)   │                │
│  │  │   或点击选择（可多选）             │ │  │ ☑ 身体贴图（1.4.4+）      │                │
│  │  └───────────────────────────────────┘ │  │ ☐ 身体/手臂（1.3 旧格式） │                │
│  │  MyArmor.png            3 KB      ✕    │  │ …（共 12 项）             │                │
│  │  [清空]  [下载绘制模板]                │  │                           │                │
│  └────────────────────────────────────────┘  │ 预览选项                  │                │
│                                              │ ☐ 女性版本 ☐ 叠加玩家     │                │
│  ┌─ 导出结果 ─────────────────────────────┐  │                           │                │
│  │ MyArmor · 4292c2bf895e                 │  │ [      开始导出      ]    │                │
│  │ [20 帧拼版预览图]                       │  └───────────────────────────┘                │
│  │ [GIF 预览]                              │                                              │
│  │ MyArmor_Head.png   40×1120 · 1 KB       │                                              │
│  │ [打包下载 (zip)]                        │                                              │
│  └────────────────────────────────────────┘                                              │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 控件与行为

| 编号 | 控件 | 需求 |
|---|---|---|
| WUI-01 | 顶部标签页 | 导出贴图 / 反向还原 / 设置，纯前端切换，不重新加载 |
| WUI-02 | 语言下拉 | 立即切换全部文案与 `<html lang>`，写入配置 |
| WUI-03 | 拖放区 | `dragenter/dragover` 高亮，`drop` 后加入列表；点击等同选择文件 |
| WUI-04 | 文件列表 | 显示文件名与体积，可单独移除 |
| WUI-05 | 目标复选 | 文案来自同一份 i18n 表（`target.*`），勾选即存 |
| WUI-06 | 结果卡片 | 预览图使用 `image-rendering: pixelated` 与棋盘格底，避免糊化 |
| WUI-07 | 状态栏 | 分 `ok / warn / bad / busy` 四种颜色；所有反馈走这里 |
| WUI-08 | 目录选择器 | 模态框，仅列子目录（隐藏 `.` 开头），提供上级与快捷入口 |
| WUI-09 | 反向还原列表 | `<select size=8>`，输入框 160ms 防抖后请求 `/api/sets` |
| WUI-10 | 处理中状态 | 按钮禁用 + 状态栏 `busy` 文案，避免重复提交 |

### 7.3 视觉与可用性

* 深色主题，配色变量集中在 `style.css` 的 `:root`。
* 所有尺寸使用 `rem/px`，主栏 `flex` 自适应，窄屏自动换行。
* 图片预览可横向滚动，不撑破布局。
* 不依赖任何外部 CDN，离线可用。

---

## 8. 非功能需求

| 编号 | 类别 | 需求 |
|---|---|---|
| WNFR-01 | 依赖 | 运行时仅需 Pillow + Python 标准库；前端零依赖、零构建 |
| WNFR-02 | 一致性 | 同一输入下 Web 版与桌面版产物逐字节相同（复用同一核心库） |
| WNFR-03 | 性能 | 单张模板全量导出（含预览与 GIF）< 2 秒；`/api/sets` 全量 < 100ms |
| WNFR-04 | 安全 | 默认只监听 `127.0.0.1`；静态资源与任务文件做路径穿越校验；请求体上限 32MB |
| WNFR-05 | 健壮性 | 任意请求异常只影响该请求；生成任务互不干扰 |
| WNFR-06 | 可测试性 | `Api` 类不依赖 socket，可单测；另提供真实 HTTP 端到端测试 |
| WNFR-07 | 可移植性 | 无平台特定代码；Windows / macOS / Linux 均可 |
| WNFR-08 | 存储 | 任务产物写入系统临时目录，按 LRU 淘汰，最多 24 个任务 |
| WNFR-09 | 国际化 | 界面文案与桌面版共用 `armorhelper/i18n.py`，不重复维护 |
| WNFR-10 | 可观测性 | 日志走 `logging`，访问日志在 DEBUG 级别 |

---

## 9. 配置

`web-config.json`（与桌面版 `config.json` 同结构，便于复用读写代码）：

```json
{
    "exportFolder": "/Volumes/970/Games/tr/steam/output",
    "imagesFolder": "/Volumes/970/Games/tr/1457/贴图-1457/Content/Images",
    "glow": false,
    "skin": 0,
    "language": "zh_CN",
    "exportCheckbox": { "head": true, "legs": true, "body": true, "...": false },
    "ids": { "id_head": "", "id_body": "", "id_legs": "" },
    "inputs": [], "lastExport": {}, "lastDir": "",
    "window": {}, "columns": [250, 210]
}
```

* 首次启动时若 `web-config.json` 不存在，则从桌面版 `config.json` **播种**，
  这样「输出目录」「贴图目录」等路径无需重填；此后两者各写各的文件，互不干扰。
* 文件损坏或字段类型异常时按默认值启动。

---

## 10. 与桌面版的对照

| 能力 | 桌面版（wxPython） | Web 版 |
|---|---|---|
| 运行环境 | 需 wxPython | 只需 Pillow |
| 输入方式 | 文件对话框 / 拖放 | 点选 / 拖放（浏览器） |
| 批量输入 | 列表常驻 + 上次导出时间 | 本次会话内列表 |
| 导出目标 | 12 项复选 | 同样 12 项 |
| 预览 | 导出 PNG / GIF 文件 | 页面内联预览 + 可下载 |
| 结果下载 | 直接落在输出目录 | 落在输出目录 **并且** 可单独/打包下载 |
| 反向还原 | 对话框 + 目录选择 | 可搜索下拉 + 目录选择器 |
| 还原全部 | 按钮 | 按钮 |
| 设置 | `config.json` | `web-config.json`（首次播种自 `config.json`） |
| 语言切换 | 菜单「视图 → 界面语言」 | 顶部下拉，即时生效 |
| 后台执行 | 工作线程避免卡界面 | HTTP 请求天然异步 |
| 输出一致性 | 同一核心库，一致 | 同一核心库，一致 |

---

## 11. 验收标准

| 编号 | 验收内容 | 对应测试 |
|---|---|---|
| WC-01 | 首页可访问，`/api/state`、`/api/i18n` 正常 | `test_index_is_served`、`test_i18n_and_targets` |
| WC-02 | 上传多张模板可一次导出 | `test_generate_endpoint` |
| WC-03 | 目标勾选写入配置 | `test_state_round_trip` |
| WC-04 | 预览可请求女性/玩家版本（不报错） | 手工 |
| WC-05 | 预览尺寸正确；zip 内容正确且保留子目录 | `test_generate_preview_and_zip`、`test_generate_zip_keeps_the_armor_subfolder` |
| WC-06 | 写入输出目录；指定 ID 时使用原版文件名 | `test_generate_writes_into_the_output_folder`、`test_generate_uses_vanilla_names_when_ids_are_set` |
| WC-07 | 发光与肤色可设置并持久化 | `test_state_round_trip` |
| WC-08 | 套装可搜索，条目含中文名/英文名/ID | `test_sets_endpoint_search` |
| WC-09 | 还原结果可下载且为 128×80，可再次导出 | `test_reverse_endpoint`、`test_reverse_output_can_be_exported_again` |
| WC-10 | 还原全部写入 `<输出>/ArmorTemplate/` | `test_reverse_all` |
| WC-11 | 目录浏览与上级导航 | `test_browse_endpoint`、`test_browse_falls_back_to_the_parent` |
| WC-12 | 设置落盘并可再次读取 | `test_settings_are_persisted_on_disk` |
| WC-13 | 语言切换返回对应文案 | `test_i18n_and_targets` |
| WC-14 | 非法输入返回 400 且带可读原因 | `test_generate_rejects_bad_input`、`test_generate_rejects_a_wrongly_sized_template` |
| WC-15 | 路径穿越被拒、未知路由 404 | `test_path_traversal_is_refused`、`test_unknown_route_is_404` |
| WC-16 | 任务目录按上限淘汰 | `test_api_evicts_old_jobs` |

---

## 12. 已知限制与后续可做

| 编号 | 内容 |
|---|---|
| WL-01 | 目录浏览会列出服务器上任意目录（本机工具，默认仅监听 127.0.0.1；若要给局域网用请自行加鉴权） |
| WL-02 | 不支持直接上传「一整套原版贴图文件」做还原，仍是让服务端按 ID 去读 `Content/Images` |
| WL-03 | 没有导出历史记录，任务目录随进程结束而清理 |
| WL-04 | 未做 WebSocket/SSE 进度推送；「还原全部套装」是一次请求，页面显示等待中 |
| WL-05 | 不支持 `.xnb`，需要已解包的 PNG 资源目录 |

后续可做：SSE 进度、还原时允许直接上传三张贴图、任务历史与重放、PWA 离线缓存。
