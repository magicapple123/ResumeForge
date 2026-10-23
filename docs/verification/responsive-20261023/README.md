# 多分辨率适配 · 验证 harness

三个脚本，一条链路：**采证据 → 判指标 → 出对照页**。

| 脚本 | 作用 | 产物 |
|---|---|---|
| `capture.mjs` | 10 视口 × 13 场景截图，同时采集 R1–R8 所需指标 | `<out>/<视口>/<场景>.png` + `<out>/metrics.json` |
| `rubric.mjs` | 把 `metrics.json` 判成 R1–R8 的 PASS / FAIL / SKIP | 终端表格 + 退出码（有 FAIL 即 1） |
| `report.mjs` | 生成逐格对照页（可带改造前截图并排） | `report.html` |

## 前置

- 应用在**同一端口**可访问（默认 `http://127.0.0.1:8123`）：`start.cmd` 起的打包态、
  或 `cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8123` 都行。
- `frontend/` 下已 `npm ci`——脚本用那里的 playwright，按脚本位置向上找
  `frontend/package.json` 解析，不含任何机器绝对路径。

## ⚠️ 数据警告（先读这段）

脚本截的是**当前实例里的真实数据**：简历姓名、目标岗位、公司、邮箱都可能出现在 PNG 里。

- 对外演示或要把截图发给别人时，**先用示例数据集**（设置页「载入示例数据」，或
  `POST /api/settings/datasets/sample/load`），或者用一份全新的数据目录跑；
- 默认落点 `deliverables/software-company/responsive-20261023/screenshots/after/`
  已被 `.gitignore` 排除，**截图不进仓库**；
- 只有 `metrics.json` 是可以入库的——它只记选择器名、尺寸与判定值，不含任何个人数据。

## 跑

```bash
# 1) 采证据（默认 10 视口 × 13 场景，写入 deliverables/…/screenshots/after）
node docs/verification/responsive-20261023/capture.mjs --base http://127.0.0.1:8123

# 只跑几个视口 / 换输出目录
node docs/verification/responsive-20261023/capture.mjs \
  --base http://127.0.0.1:8123 --viewports 1366,1092 --out /tmp/rf-shots

# 2) 判定（默认读 deliverables/…/metrics.json；也可 --metrics 指定）
node docs/verification/responsive-20261023/rubric.mjs

# 3) 对照页（--before 指向改造前的截图根目录则左右并排）
node docs/verification/responsive-20261023/report.mjs --before deliverables/software-company/responsive-20261023/screenshots
```

## 判据（R1–R8）

| 项 | 判据 | 数据来源 |
|---|---|---|
| R1 | 文档与 `main` 都不横向溢出（>1px 即 FAIL） | `docOverflow` / `mainOverflow` |
| R2 | 没有被 `overflow: hidden` 裁掉且滚不到的内容 | `clipped` |
| R3 | 控件不重叠、不出视口 | `outOfViewport` |
| R4 | 正文单行 ≥ 8 个汉字宽（`width / fontSize ≥ 8` 且 ≥280px） | `prose` |
| R5 | **动作组**不换行（≥1092 才判） | `toolbars[].lines` |
| R6 | 同一网格内相邻列距极差 ≤ 4px | `gridGaps[].delta` |
| R7 | A4 纸面 ≥ 437px 且 `scale ≥ 0.55` | `a4` |
| R8 | ≥1920 时正文单行 ≤900px，或内容没有全挤在左边 | `prose` / `emptyRight` |

口径细节（改脚本前先读）：

- **R5 只统计动作组**（`.resume-wb-actionbar` / `.assistant-header-actions` /
  `.resume-preview-zoom-row`）。筛选条与页头是"内容 + 动作"的混合行，按设计允许换行。
  行数用"相邻 top 差 >8px 聚簇"判定——用 `round(top/4)` 分桶会把 11.3 与 12.1 判成两行。
- **R2 排除两类合法形态**：`text-overflow: ellipsis + nowrap`（列表/卡片标题的刻意省略）
  与 `input/textarea/select`（文本在框内滚动是输入框的固有行为）。
- **SKIP ≠ PASS**：没有对应数据的项（例如没有正文容器时的 R4）会显示 SKIP，需要人工看
  `report.html`。

## 已知限制

- **E 档（960 / 768）只出证据、不进 CI 门槛**：CI 只跑 `frontend/tests/responsive/` 的
  8 视口 × 18 路由（R1/R2/R3）。
- **场景依赖数据**：`P05-workbench` / `P11-templates` / `P13-assistant-card` 需要库里有简历。
  库里没有时这三个场景会记 `error`（脚本继续跑，不中断），那一格无图。
- 截图与 `report.html` **不入库**；要留存请放在 `deliverables/` 或自行归档。
