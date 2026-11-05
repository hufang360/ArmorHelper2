# 冻结的参考输出（金标准）

这里的 PNG 是 **2.0 的 Python 参考实现**在被移除之前生成的，`manifest.json` 记录每张图的
尺寸、字节数与 sha256。`tests/node/core.test.mjs` 在 Node 里跑 `web/js/` 核心，把输出与这些
图片**逐像素**比较 —— 所以「只剩一个 JS 实现」并没有丢掉安全网。

| 文件 | 内容 |
|---|---|
| `head.png` / `legs.png` / `body.png` | 由 128×80 模板生成的 1.4.4+ 头部 / 腿部 / 复合身体 |
| `body-glow.png` | 同上 + 发光遮罩（360×448） |
| `body-legacy.png` / `body-legacy-female.png` / `arms.png` | 1.3 旧格式（与 v1 逐字节一致） |
| `frames-male.png` / `frames-female.png` | 20 帧全身叠合（40×1120，帧高 56） |
| `player-frames-male.png` / `player-frames-female.png` | 玩家本体 20 帧（内置皮肤 0） |
| `frames-player-male.png` / `frames-player-female.png` | 玩家 + 盔甲 |
| `template-rebuilt.png` | 由上面三张贴图反推回来的模板（应与 `web/data/ArmorTemplate_v1.png` 一致） |
| `sheets-frames-male.png` / `sheets-frames-female.png` | 由成品贴图直接合成的 20 帧（预览贴图页） |

**玩家头与眼睛不在参考里。** `player-frames-*` 与 `frames-player-*` 只含躯干、手臂、腿，
这是 Python 参考实现的行为。网页版额外叠上 `Player_0_0`（头）与 `Player_0_1`（眼），
否则开脸头盔会露出空洞。这一层不进金标准，`web/tests/run.mjs` 也不传这两个部位。

**不要手改。** `test_golden_manifest_matches_the_files` 会核对 sha256；确实需要更新
（例如故意改变输出）时，重新生成后同步改 `manifest.json`，并在提交信息里说明原因。
