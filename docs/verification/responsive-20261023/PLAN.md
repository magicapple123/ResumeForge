# ResumeForge 多分辨率 / 系统缩放适配方案（2026-10-23）

> **文档性质**：可脱离任何历史对话独立执行的作业书。执行者只有一个前提——能读 `D:/ResumeForge` 仓库。
> 读完本文 + 仓库代码，就能把「不同客户端适配」这件事做完，并**自证做完了**（§7 验证协议是本文的一等公民，不是附录）。
>
> **本文档不改任何源码、不提交任何 commit。** 所有行号、数值、选择器均于 2026-10-23 实读**当前工作树**（含未提交改动）得到；
> 与实读不符的地方在正文里标注「⚠️ 与交接信息不一致」，见附录 B。
>
> **术语**：按 `docs/ui-copy-guide.md` v1.4 口径——「版式」= 模板变体下拉；「排版参数」= 字号/行距/页边距；「版面」= 纸面上内容的排布；「画布」= 简历 A4 预览区。全文不用「样式模板」这类禁用词。

---

## 目录

| 节 | 内容 | 谁最该先读 |
|---|---|---|
| [0](#0-tldr) | TL;DR + 一页速览表 | 用户 / 主理人 |
| [1](#1-问题诊断根因逐条带证据) | 问题诊断（根因 + 文件:行号证据 + 换算表） | 执行者必读，决定改不改 |
| [2](#2-目标设备矩阵与五档分级) | 五档分级 + Electron 窗口策略 | 执行者必读 |
| [3](#3-断点与令牌体系单一事实源) | 断点与令牌体系（单一事实源 + 守卫） | 执行者必读，**先落这一节再动任何页面** |
| [4](#4-逐页面--逐组件适配方案) | 逐页面 / 逐组件适配方案（断点值 + 预期效果） | 执行者主力 |
| [5](#5-代码改动清单) | 代码改动清单（含 500 行预算账） | 执行者 |
| [6](#6-实施任务分解t01t16--5-批) | 实施任务分解 T01–T16 / 5 批 | 执行者主力 |
| [7](#7-截图验证协议) | 截图验证协议（视口矩阵 / 指标 / rubric / 返工闭环） | 验收人 / QA |
| [8](#8-风险与回滚) | 风险、回滚、明确不做的事 | 主理人 |
| [9](#9-验收清单) | 可勾选验收清单 | 验收人 |
| [A](#附录-a现状证据摘要) | 现状证据摘要（**已填实测**：A.1 量化表 / A.2 截图索引 / A.3 被推翻的判断） | QA + 执行者 |
| [B](#附录-b与交接信息不一致的四已实测更正) | 与交接信息不一致的四处（已实测更正） | 执行者必读，防踩空 |
| [C](#附录-c复现与自证命令) | 复现与自证命令 | 执行者 |
| [D](#附录-d已拍板的决策2026-10-238-条全部确认) | **已拍板的 8 个决策**（D0–D7，执行依据） | 用户 · 2026-10-23 |

---

## 0. TL;DR

**一句话**：这套界面的排版参数全是**像素常量**，而它被塞进的内容盒宽度会在 2048px（用户的 2560×1600 @125%）到 1280px（别人的 1920×1080 @150%）之间浮动 1.6 倍；中间 992–1366 这一段几乎没有规则，于是「在她机器上好看」不是优点，而是**排版只在 2048 这一个宽度上成立**的证据。

**要做的事**（按顺序）：

1. **建一套断点单一事实源**：6 个数值，TS 常量 / CSS 变量 / 媒体查询三处对齐，用一条守卫测试钉死；同时把现有 14 种散落断点数值机械收敛到这 6 个。
2. **外壳令牌化**：侧栏宽度、内容内边距改成 CSS 变量，消掉 `Sider width={200}` + `margin-left:200px` + `margin-left:64px` 这三处硬编码。
3. **五个页面族逐档适配**：投递看板（5→自适应列）、简历中心（宽表→卡片）、简历工作台（三栏→两栏→单栏+抽屉）、求职助手、页头。
4. **A4 画布加可读下限**：现在只有上限（`Math.min(1, …)`）没有下限。真正会发生的是**三栏强留**把纸压到 0.69（1366 视口纸宽 546、正文约 9.6px，看不清）；而在更窄处（转单栏）反而回到 0.87。所以「下限」必须和「哪一栏让位」一起定，见 §4.5 / §4.6。
5. **Electron 窗口策略**：按屏幕工作区自适应默认尺寸、`minWidth/minHeight` 重定、记忆窗口尺寸、Ctrl+± 缩放持久化。
6. **验证闭环**：8 个真实视口 × 13 个场景的截图 + 量化指标 + 7 条目视 rubric + 返工回路，其中 3 条指标进 CI。

| 维度 | 改什么 | 为什么 | 分几批 | 验收怎么判 |
|---|---|---|---|---|
| 断点体系 | 新建 `theme/breakpoints.ts`（6 值）+ `breakpointGuard.test.ts` + `design-tokens.css` 里 6 个 `--rf-bp-*` | 现在 14 种数值、无体系，992–1366 空窗 | 批 1 | `npx vitest run src/theme/breakpointGuard` 绿 + 全仓 `@media` 数值 ⊆ 6 值 |
| 外壳 | `--rf-sider-width` / `--rf-content-pad`；Sider 宽度走变量；删 2 处 `margin-left` 硬编码 | 三处耦合，改宽度要改三个文件 | 批 1 | 1092 / 1093 两个视口下侧栏宽度与 `.app-main` 左偏移之差 = 0 |
| 页面栅格 | 投递看板 5 列 → `auto-fit`（**防御性**，非修 bug）；简历表 `scroll.x` + <1092 卡片回退；助手/指南/设置断点归一 | 看板 768 实测 **0px 溢出**（≤900 已转 2 列，`tracker-form.css:198`）；真正要修的是两张宽表与页头 | 批 2 / 4 | 8 视口 × 18 路由 `document.documentElement.scrollWidth - innerWidth ≤ 1` |
| 工作台 | **校验既有两档**（`design.md` 的 1280/1000）→ 判据换成容器宽（1232/952，数值等价）+ 中栏内部表单 3→2→1 列；抽屉做成真 Drawer | 1366 三栏表单已被挤坏（邮箱截断）；1000–1280 参数栏被绝对定位盖住；<1000 内容编辑**不可达** | 批 3 | 1366 三栏且中栏字段不截断；1280 两栏；1092 两栏+抽屉；768 单栏+抽屉；参数栏 `scrollWidth−clientWidth ≤ 1` |
| A4 画布 | `fitScale` 加 `MIN_READABLE=0.55` + 高度预算改用容器实测 + 矮屏折条回收 56px | 无下限（实测 1092×614 只有 34% = 正文 4.7px）；高度预算取 `0.62×innerHeight`，系统性低估 60–170px | 批 3 | §4.6.2 主表逐格 ±0.01；1366 纸面 337→467（+39%）、1092 269→437（+62%）；触发底时出现 `55% · 已到最小可读缩放` 胶囊 |
| 桌面壳 | 默认尺寸按 `workArea` 算、`minWidth 1120`、`window-state.json`、`zoomFactor` 持久化 | 1440×900 固定 + `minWidth 1080` 掉进最差档且无法自救 | 批 5 | `node --test desktop/scripts/test-window-state.js` 绿；改窗口大小重启后尺寸不变 |
| 验证 | `harness/capture.mjs`（8×13 截图+指标）+ `frontend/tests/responsive/*.spec.ts`（3 条硬指标进 CI） | 用户明确要求"实际模拟演示 + 截图判断，不好看要返工" | 批 5 | §9 清单逐档逐页打勾；rubric 7 条无 🟡 |

**P0（不做等于没做）**：断点体系、外壳令牌化、投递看板、简历工作台、A4 下限、Electron 窗口、验证 harness。
**P2（锦上添花，可延后）**：大屏加宽侧栏、首页 4 卡断点、模板缩略图改造、窄高屏弹层高度档。

---

## 1. 问题诊断（根因逐条，带证据）

### 1.1 第一性原因：CSS 像素视口随系统缩放变化，而布局参数不会

Web 端拿到的 `window.innerWidth` 不是"分辨率"，是**物理像素 ÷ 系统缩放**：

| 物理分辨率 | 系统缩放 | **等效 CSS 视口** | 常见度 / 备注 |
|---|---|---|---|
| 2560×1600 | 100% | 2560×1600 | 少见（字太小，几乎没人这么用） |
| 2560×1600 | **125%** | **2048×1280** | **用户本人**（`2560/1.25=2048`） |
| 2560×1600 | 150% | 1707×1067 | 常见 |
| 2560×1600 | 175% | 1463×914 | 偶见 |
| 1920×1080 | 100% | 1920×1080 | 外接 24" 显示器 |
| 1920×1080 | **125%** | **1536×864** | **最常见的笔记本默认值** |
| 1920×1080 | **150%** | **1280×720** | 常见（13–14" 小屏本） |
| 1600×900 | 100% | 1600×900 | 老笔记本 |
| 1600×900 | 125% | 1280×720 | 常见 |
| 1440×900 | 100% | 1440×900 | MacBook Air 13"（"看起来像 1440×900"）+ Electron 默认窗口 |
| 1366×768 | **100%** | **1366×768** | **用户定义的最低支持线** |
| 1366×768 | 125% | 1093×614 | 常见（11–13" 老本开 125%） |
| 1366×768 | 150% | 911×512 | 偶见 |
| 1024×768 | 100% | 1024×768 | 老旧设备 / 投影 |
| 3840×2160 | 150% | 2560×1440 | 4K 常见设置 |
| 3840×2160 | 200% | 1920×1080 | 4K 笔记本默认 |

**这条换算把问题说清了**：她在 2048 的内容盒里调出来的间距（比如三栏工作台左栏 340 + 中栏 400 + 画布余量 1100），到 1920×1080@150% 的机器上只剩 1280 CSS 宽可用——**同样的像素常量，被塞进了 62% 的空间**。

**Electron 为什么"看起来还行"**：`BrowserWindow` 的 `width/height` 单位是 **DIP**，与系统缩放无关（`desktop/main.js:197` `width:1440,height:900`）。桌面壳把内容**钉死在 1440 CSS 宽**，系统缩放只放大字形不改变布局宽度。所以桌面形态从没经历过"视口从 2048 滑到 1280"这件事——这正是"网页难做、桌面还行"的原因，也是为什么**两种形态必须分别验证**：桌面要验的是"窗口能被拉到多小"，网页要验的是"CSS 宽能有多小"。

> ⚠️ 这条推论在实现上有一个必须验证的点：Electron 的 `zoomFactor` 会改变 CSS px 基准（`1440 / 1.25 = 1152`）。见 §2.3。

### 1.2 固定像素栅格（会直接溢出或压扁的 6 处）

| 位置 | 现值 | 最小所需宽度 | 在哪个视口开始不够 | 现象 |
|---|---|---|---|---|
| `styles/tracker-board.css:21` `.tracker-summary` | `repeat(5, minmax(130px,1fr))` | 5×130 + 4×12 = **698px** | **实测不成立**（2026-10-23 补测 768） | 这行是**死代码**：`tracker-form.css:198` 的 `@media (max-width:900px)` 已改成 2 列，768 视口实测 **0px 溢出**。**降级 P2 / 防御性**——只做"把隐式规则搬成显式"，不冒充修 bug |
| `styles/resume-workbench.css:79` `.resume-wb-body` | `minmax(300,340) minmax(320,400) minmax(0,1fr)` | 620px + 画布可读下限 437 = **1057px** | 弹窗内容宽 <1057 → 视口 <1105（**但 ≤1280 已转两栏，所以实际不会溢出**） | 真正的后果不是溢出而是**纸被压小**：1366 视口纸只有 546px（scale 0.69、正文 ≈9.6px）；而 1280 转两栏后纸是 794 —— 即**窗口变窄纸反而变大**（非单调，见 §4.5） |
| `styles/assistant-layout.css:5` `.assistant-page` | `280px minmax(0,1fr)` | 280 + 正文可读 400 = 680 | 内容盒 <680 → 视口 <776（但 ≤991 有单栏规则，实际安全） | 安全，仅记录 |
| `styles/base-header.css:86` `.app-model-profile-select` | `width:200px` | — | 与 `.app-dataset-chip{max-width:220px}` 叠加 ≈ 560px 固定 | 页头标题在 992–1100 被压成省略号（约 6–8 字） |
| `styles/jobs.css:13` `.jobs-search-input` | `width:260px` | — | 在 `.rf-filter-bar` 里不参与收缩 | 筛选行在 768–991 挤成两行且右端参差 |
| `styles/resume-workbench.css:139-160` 参数栏里的滑杆行 | 滑杆 `width:132px` + `flex: 0 1 132px`，行内还有读数与「来源」胶囊 | 行最小内容宽 **386px** > 栏内可用 **339px**（340 − 20×2 − 1） | **全部 8 个视口**（2560 也是）——与视口无关 | 参数栏横向溢出 **47px**：右侧被裁或出现一条横滚条。**这一行的性质与其他行不同：它不是分辨率问题，是内在缺陷**（QA `metrics.json` 的 `innerScrollers` 实测 `339 / 386`，8 档全同） |
| `styles/modules-templates.css:255/265` `.template-gallery-preview` / `-frame`（`scale(0.36)` 在 `:273`、`margin-left:-143px` 在 `:271`） | 固定 `height:405px`、`width:794px`、`scale(0.36)`、`margin-left:-143px` | 可见区 **286px** | 卡片最小宽 `minmax(280px,1fr)`（`:231`）→ 278px | 缩略图左右各被裁 4px；`-143px` 只在 286 时居中，其它宽度一律偏左 |

### 1.3 断点缺档：14 种数值，992–1366 是空窗

全仓 `styles/*.css` 共 **24 条尺寸媒体查询 + 4 条 `prefers-reduced-motion` = 28 条**，数值如下（`grep -rn "@media" frontend/src/styles/*.css`）：

| 数值 | 出现次数 | 出处 |
|---|---|---|
| 480 | 1 | `aiPolish.css:150` |
| 575 | 2 | `responsive.css:2`、`modules-templates.css:434` |
| 600 | 1 | `announcement.css:55`（写法还是 `(width <= 600px)`，与其它 23 条语法不同） |
| 640 | 3 | `profile.css:30`、`profile.css:476`、`resume-editor.css:65` |
| 700 | 1 | `base-header.css:252` |
| 720 | 2 | `base-panels.css:134`、`resume-panels.css:134` |
| 760 | 1 | `modules-webform.css:68` |
| 767 | 1 | `mobile.css:3` |
| 768 | 2 | `apply.css:305`、`trash.css:22` |
| 900 | 5 | `modules-templates.css:89/215`、`resume-panels.css:252`、`tracker-form.css:198` |
| 991 | 2 | `responsive.css:52/75` |
| 992 | 1 | `resume-editor.css:82` |
| 1000 | 2 | `modules-layout.css:67`、`resume-workbench.css:419` |
| 1280 | 1 | `resume-workbench.css:403` |

**缺口**：1367–1919 之间**零规则**（大屏只能靠 `auto-fit` 自然长列），1100–1365 只有工作台两条规则，**992–1366 这一段对"整页布局"没有任何决策**。另外 767/768、991/992、700/720/760 三对"差 1–20px"的邻居，说明这些数字不是设计出来的，是每次遇到问题时逐个打的补丁。

### 1.4 侧栏三处硬编码耦合

| # | 位置 | 代码 | 问题 |
|---|---|---|---|
| 1 | `App.tsx:294-300`（`width={200}` 在 `:297`、`breakpoint="lg"` 在 `:298`、`collapsedWidth={64}` 在 `:299`） | 桌面上写 200、折叠 64 | 宽度只有一个来源，但这个来源是 TSX 字面量，CSS 不知道 |
| 2 | `styles/base-shell.css:79` `.app-main{ margin-left:200px }` | 与 #1 重复书写 | 改 #1 不改 #2 → 内容被侧栏盖住 200px |
| 3 | `styles/responsive.css:121`（块首 `:111`）`@media(max-width:991px){ .app-main{margin-left:64px} }` | 与 #1 的 `breakpoint="lg"`（antd `lg=992`，`node_modules/antd/es/theme/util/alias.js:30`）隐式对齐 | 991 vs 992 差 1px，靠"魔法相等"维系 |

附加事实：`styles/responsive.css:162-163` 另有 `.app-content{padding:16px}`，与 `styles/mobile.css:108` 的 `padding:16px` 重复；而 `base-tasks.css:113` 的基准是 `padding:24px`。**同一个内边距在 3 个文件里各有说法。**

### 1.5 A4 画布：等比缩放**已经实现**，缺的是下限与正确的高度预算

**先纠正一个容易犯的错：不要重造缩放。** `components/resume-preview/geometry.ts:75-76` 已经是等比缩放：

```ts
const fitScale = Math.min(1, viewportWidth / A4_WIDTH_PX, viewportHeight / contentUnitHeight);
const scale = Math.min(MAX_ZOOM, fitScale * zoom);
```

`viewportWidth` 来自容器实测宽（`ResumePreview.tsx:151` `container.clientWidth`），且容器上**已经有 `ResizeObserver`**（`:257-269`，`observer.observe(container)`）——所以工作台栏宽变化时会自动重算，这一条**不需要新做**。`MIN_ZOOM=0.5 / MAX_ZOOM=3.5`（`config.ts:21-22`）只夹 `zoom`（用户手动倍数），**不夹 `fitScale`**。

真正的缺口有四个：

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| G1 | `fitScale` **没有最小可读下限** | `:75` 只 `min` 不 `max` | 容器越小，纸越小，**永不报错、永不提示** |
| G2 | **高度预算取错来源**：`viewportHeight = window.innerHeight; budget = 0.62 × viewportHeight`（`ResumePreview.tsx:147-149`） | 工作台里画布可用高 = `dvh − 164`（弹窗体高 `dvh−24`、动作条 56、画布说明条 ~56、滚动区内边距 28） | 1092×614 时取 `0.62×614 = 381`，而实际容器有 450 → **少算 69px**；同时 381/1123 = **0.339，正是实测截图上的「34%」** |
| G3 | `Math.min(1, …)` 永远不放大 | `:75` | 在 2048×1280 的用户机上纸也只占画布 794/1228 = 65% → 「显得空」（P2） |
| G4 | 缩放档位不吸附 | `fitScale` 是任意实数（0.8731）；手动 `zoom` 用 0.1 步长（`:199`） | 纸边落在半像素，1px 边框发虚（P3，用 `Math.round` 消化即可） |

**最关键的认知修正（本方案第一版写错过，必须在此说清）**：在工作台里，**约束 `scale` 的是高度，不是宽度**。

| 视口 | 画布宽 | 画布高 | 宽度允许的 scale | 高度允许的 scale | 实际 |
|---|---|---|---|---|---|
| 2048×1280 | 1228 | ~1116 | 1.55 | 0.99 | **高度决定** |
| 1366×768 | 546 | ~604 | 0.69 | 0.54 | **高度决定** |
| 1092×614 | 672 | ~450 | 0.85 | 0.40 | **高度决定** |

推论有两条，都影响后面的方案：
1. **「哪一栏让位」几乎不改变纸的大小**（±3%），它改变的是**表单会不会被挤坏**（§4.5）。所以三栏阈值的理由必须写成"表单可用性"，不能写成"纸变大"。
2. 想让纸变大，唯一有效的手段是**回收高度**（把画布说明条在矮屏折行/收起，回收 ~56px），见 §4.6。

双页并排：**已经不存在**，`config.ts:13` 与 `geometry.ts:67` 的 `stackedPages` 表明 2026-10-21 已改为竖向堆叠、`separatorCount: 0`，且 `fitScale` 恒按**一页**算（`contentUnitHeight`），所以页数增加不会让纸变小。**不做并排阈值。**

### 1.6 没有密度 / 字号分级

`theme/design-tokens.css` 只有一套间距标尺（`--rf-space-1..4` = 4/8/16/24）和一套字号（`tokens.ts: fontSize` 11/12/13/14/16/17），**没有任何"窄屏更紧凑"的表达**。全站唯一的分级手段是 28 条零散媒体查询。结果是：1366 的内容盒（1108）与 2048 的内容盒（1790）用完全相同的 24px 内边距、16px 卡片间距——在 1108 里显得松散（一屏放不下两行卡），在 1790 里显得正常。

### 1.7 Electron 窗口策略缺失

| 项 | 现状 | 问题 |
|---|---|---|
| 默认尺寸 | `desktop/main.js:197-198` `1440×900` 固定 | 在 1366×768 笔记本上（工作区 ≈1366×728）窗口比屏幕高，标题栏被推出屏幕；在 3840 宽的 4K 屏上又只占 37% |
| 最小尺寸 | `:199-200` `minWidth:1080, minHeight:700` | 1080 落在 **D 档**（内容盒 `1080−64−32−8 = 976`），而用户要求的最低线是 1366；用户把窗口拉到 1080 时界面已经在降级，但**没有任何提示**，且 `minHeight:700` 与 768 高的屏幕只差 68px（含任务栏后几乎贴死） |
| 尺寸记忆 | 无 | 每次启动回到 1440×900；用户特意拉大的窗口下次就没了 |
| 位置记忆 | 无 | 关在副屏、下次只在主屏出现（可接受）或反之（找不到窗口） |
| `setZoomFactor` | 无 | 用户 `Ctrl+±` 后 `zoomFactor` 随窗口关闭丢失，下次启动"界面怎么变小了/变回来了"无法解释 |
| 菜单 | `autoHideMenuBar:true`（`:202`）+ `setMenuBarVisibility(false)`（`:212`） | 用户**没有**缩放菜单项，只能用快捷键；发现不了这个能力 |

### 1.8 为什么「在她机器上好看」恰恰是问题的一部分

她的内容盒是 **1790px**。在这一个宽度上：

- 三栏工作台的左栏取 `minmax(300,340)` 的上界 340、中栏取 400，画布还剩 1044 → A4 以 0.79 显示且两侧留白均衡 → 好看。
- 首页/看板一排能放下 5 张卡，每张 320px，标签一行、数字一行 → 好看。
- 正文列（助手消息、说明文字）宽 900px，中文每行 30+ 字 → 好看。

这些**全部是"在 1790 下成立"的取值**：340 / 400 / 5 列 / 24px 内边距。它们没有一条声明过"当宽度只有 1108 时谁让位"。所以：

> 在 2048 调出来的舒适间距，到 1280 上不是"等比缩小"，而是**被硬塞**——该让位的（参数栏）不让位，该换行的（统计卡）不换行，该缩的（画布）缩到看不清，该收的（侧栏 200px 占了 1280 的 15.6%）照旧占着。

**这就是根因的一句话版本**：界面缺的不是"响应式设计"，而是**一份"在更少的宽度里，谁先让位、让到多少"的书面契约**。本方案第 2、3、4 节就是在写这份契约。

---

### 1.9 与分辨率无关的既有排版缺陷（I 类：**不在本次 KPI 内**）

**为什么必须单列一节**：QA 的 `metrics.json` 里 `squeeze`（单行文字被压到 <4 字/行）这一项，在 8 个视口上是 **21 / 22 / 24 / 24 / 24 / 23 / 23 / 23**——**几乎恒定**。也就是说：如果把它当成本次适配的验收项，执行者会拿着"二十多条挤压问题"去做二十多次返工，而其中绝大多数**在她自己的机器上一样存在**、与缩放毫无关系。**方案的价值在于划清边界，不是把所有丑的都揽进来。**

#### 1.9.1 判定方法（可机械执行）

对 `metrics.json` 的每个 `squeeze.samples[i].selector` 做一次集合运算：

```
同一 selector 在 2048（用户机）与 1366（底线）**都**命中  →  I 类：内在排版缺陷，与宽度无关
只在 ≤1366 命中、2048 不命中                          →  R 类：分辨率缺陷，本次要修
```

#### 1.9.2 实测结论

| 类别 | 数量（去重后） | 随视口变化 | 归属 |
|---|---|---|---|
| **R 类**（`offenders` + `hiddenPx`） | 1092:3 → 1920:0 | **单调改善** | **本次主战场**（§4.3 / §4.4 / §4.7） |
| **I 类**（`squeeze`） | 约 23 条，恒定 | **不变** | **本次不做**，只登记 |
| 真裁切（`clipped`） | **0** | — | ✅ 无 |

**最典型的 I 类样本**（1366 首页「近期提醒」里的公司名）：

```
div.ant-listy-item:nth-of-type(1) > .ant-space > .ant-space-item:nth-of-type(2)
1366：width 52px · 2 行 · 1.5 字/行 · "己悦己"
2560：width 52px · 2 行 · 1.5 字/行 · "己悦己"   ← 完全一样
```

即"公司名被挤成竖排"在 2560 上也存在。根因是 `.ant-space-item` 里那层没有 `min-width:0`/`flex` 设定，与容器宽度无关。

#### 1.9.3 处置：三选一，推荐 (b)，且严格限定

| 方案 | 说明 | 取舍 |
|---|---|---|
| (a) 完全不做，只登记 | 写进 `AUDIT.md` 的 I 类清单，本次不碰 | 最省，但看截图时仍会看到这些丑点，容易被误判为"没修好" |
| **(b) 顺手修（推荐）** | **仅限"本批本来就要动的文件"**：改到哪个文件，就顺手把它里面的 I 类修掉（典型：`modules-home.css` 与 `modules-layout.css` 反正要改 `gap` 令牌，同批改 `.ant-space-item` 的 `min-width:0`） | 成本≈0，且不扩大范围 |
| (c) 单独立项 | 开"全站排版重做"批 | **不做**。这会把本次从"适配"膨胀成"重做"，且与用户诉求（不同机器不乱）无关 |

#### 1.9.4 给执行者的一句话（写进 §6 通用约束）

> **不要把 I 类当验收项。** §7 的 rubric 只判 R1–R8（可量化、且与档位相关），I 类一律登记在 `AUDIT.md` 的 I 类清单里、**不进 rubric、不进 CI**。否则 rubric 永远不可能全绿，返工回路会永远在转。

---

## 2. 目标设备矩阵与五档分级

### 2.1 五档定义（正文一律用 A–E 指代）

内容盒宽度按 §2.2 的公式算，**不是视口宽度**——这是本方案与现状最大的口径差异。

| 档 | 等效 CSS 视口宽 | 内容盒宽 | 典型机器 | 必须保住（功能底线） | 允许降级 | 验收口径 |
|---|---|---|---|---|---|---|
| **A 超大** | ≥1920 | 1630–2302 | 2560×1600@100/125、4K@150、双屏拼接 | 全部 | 允许加宽侧栏(216)、A4 允许放大到 1.35；**不允许**正文单行 >900px | rubric 7 条全过 + A8（大屏不空） |
| **B 宽** | 1536–1919 | 1278–1629 | 1920×1080@100/125、1600×900@100 | 全部 | 侧栏仍 200；卡片最多 5 列 | rubric 7 条全过 |
| **C 基线** | 1366–1535 | 1108–1277（实测 1366→1108） | **1366×768@100（用户底线）**、1440×900（Electron 默认）、1600×900@100 | **全部功能在屏上且可用，工作台三栏常驻** | **无功能降级**；只允许「中栏表单按栏宽自动 3→2→1 列」与「看板按门限降到 4 列」这类**自适应**，不算降级 | rubric 7 条全过，**零返工线** |
| **D 紧凑** | 1092–1365 | 843–1107（实测 1280→1022、1092→834） | 1366×768@125(1093)、1600×900@125(1280)、1920×1080@150(1280) | 全部功能可**到达** | 侧栏 64、工作台两栏+抽屉、看板自适应列、宽表横滚（操作列固定） | 「能用、不重叠」+ 关键动作 ≤2 次点击 + rubric 中 R1/R2/R3/R7 必须过 |
| **E 最小** | <1092 | 662–843 | 1366×768@150(911)、1024×768 | 只保四条主链：**导航 / 查看 / 编辑 / 导出** | 工作台单栏+抽屉、看板 2 列、宽表横滚、图表可横滚 | 「能用、不重叠」+ 48px 触控目标（`mobile.css` 已有）+ 不要求美观 |

**C 与 D 的界线为什么是 1366**：这是用户原话给的（"最低支持线 1366×768@100%"）。D 档之所以存在，是因为 1920×1080@150% 会给出 CSS 1280——**它低于 1366，但它是真实存在的大批量机器**。所以 D 档的定义是"不保证好看，但保证能用"。**已拍板（附录 D 的 D1）：1280 按 D 档执行，返工线仍卡 1366。**

> **「降级」的判据只有一种：功能可达性，不是审美。** 表里的"允许降级"一律指**同一个功能还能在同屏或 ≤1 次点击内到达**，不指"变小/变窄/变灰"。反过来，"必须保住"指功能在屏且可用（表单不被挤到读不全、按钮不被盖、操作列不需要横滚就能点到）。这条口径同时约束 §4 与 §7 的 rubric：rubric 判的是 R1–R8（可量化），C 档额外要求"零返工"，两档都不含任何"好不好看"的主观项。**判定口径（一句话，写进 rubric）**：**本方案的"降级"= 功能不可达；"+1 次点击"不算降级，但必须记录在案**（记录位置：§4.5.6 的三档去向表 + §9.2 的逐档备注）。

**因此 C 档（1366–1535）写"零降级"是成立的：工作台三栏在这里常驻（弹窗体 1318–1488 ≥ 1233）；D 档（1092–1365）才允许"内容栏进抽屉（+1 次点击）"——降的是点击次数、不是功能，而点击次数已在"关键动作 ≤2 次"里被量化。**

> **E 档已知不达标项（2026-10-23 补测 768 后登记）**：768 视口下 `.app-header-actions` 实测宽 **702px**、`right=798`，被 `.app-header{overflow:hidden}` 裁掉 **30px**，「退出」按钮**彻底不可达**（无滚动容器）。
> - 触发条件：浏览器直连 768；**桌面壳 `minWidth:1080` 拦得住 1080 本身，但拦不住"1080 窗口 × 140% 缩放 ≈ 771"** 这种叠加。
> - 修法（一行 CSS，列 P2）：`.app-header-actions{flex-wrap:wrap}` + `.app-exit-button{flex:0 0 auto}`。
> - 为什么不算进 C/D 档验收：E 档本来只要求"能用、不重叠"，而这条恰好违反了"不重叠"——所以它被记为**该档唯一 P0**，随 §6 的 P2 批次一起修，不阻塞 1366 基线交付。

### 2.2 内容盒宽度：公式 + 实测锚点（全方案的度量基准）

**度量口径**：全程用"内容盒宽"= 视口 − 侧栏 − 内容区内边距 − 滚动条占位，**不用视口宽**。这是本方案与现状最大的口径差异（现状所有断点都是视口值）。

```
内容盒 = 视口宽 − Sider宽 − 2×(app-content padding) − gutter
gutter ≈ 10px   （*::-webkit-scrollbar 8px，base-shell.css:22；+ 1px 边框与取整）
```

**实测锚点（主理人 2026-10-23 量的是 `.app-main` 的 clientWidth，含内边距）**：

| 视口 | 侧栏（现状） | `.app-main` clientWidth（实测） | 减内边距后的内容盒 | 档 |
|---|---|---|---|---|
| 2048（用户机） | 200 | **1838** | 1790 | A |
| 1366（底线） | 200 | **1156** | **1108** | C |
| 1280 | 200 | **1070** | **1022** | D |
| 1092 | **200（注意：现状此处不折叠）** | **882** | **834** | D |

> **这张表最重要的一行是最后一行**：`Sider` 用的是 `breakpoint="lg"`，antd 的 `lg = 992`（`node_modules/antd/es/theme/util/alias.js:30`），所以**1092 视口下侧栏仍然是 200px**——它吃掉了 1092 的 18.3%，而 1366 底线真正能用的横向空间只有 **1108**，并且这 1108 里还包含 48px 的主区内边距（`responsive.css` 只在 ≤991 才降到 16px）。这正是"1366 特别紧"的量化原因。

**改造后的口径**（`--rf-sider-width` 令牌，§3.3）：

| 视口 | 侧栏（改造后） | 内边距 | 内容盒 |
|---|---|---|---|
| 2560 | 200 | 24 | 2302 |
| 2048 | 200 | 24 | 1790 |
| 1920 | 216 | 32 | 1630 |
| 1536 | 200 | 24 | 1278 |
| 1440 | 200 | 24 | 1182 |
| 1366 | 200 | 24 | **1108** |
| 1280 | 200 | 20 | 1030 |
| 1093 | 200 | 20 | 843 |
| **1092** | **64** | **16** | **986**（跳变点，+143） |
| 992 | 64 | 16 | 886 |
| 768 | 64 | 16 | 662 |
| 767 | 0 | 16 | 725 |

**1092 处的跳变（+143）是可接受的，但有一条硬规矩**：跨跳变点的变体判断**不许**钉在 1092 附近。今天看板在 1093 时内容盒 843（5 列按 150 最小宽需要 798，放得下 → 实际是「边缘刚好」），1092 时 986（宽出 188）——若把"5 列还是 4 列"钉在这里，用户拖动窗口 1px 就会看到卡片重排。**规则：跨 1092 的布局切换只用 `min-width:1366` 以上的断点，或落到组件自身的容器查询。**

### 2.3 Electron 窗口策略

#### 2.3.1 默认尺寸按屏幕工作区自适应

```js
// desktop/main.js —— 替换 createWindow() 里的 1440/900 字面量
const { screen } = require("electron");

function initialBounds(state) {
  const area = screen.getPrimaryDisplay().workAreaSize;   // DIP，已扣除任务栏
  const width  = clamp(Math.round(area.width  * 0.82), 1120, 1600);
  const height = clamp(Math.round(area.height * 0.86), 720, 1000);
  return { width, height, ...centerIn(area, width, height) };
}
```

| 屏幕工作区 | 算出的默认窗口 | 落在哪档 |
|---|---|---|
| 1366×728（1366×768 本，100%） | 1120×728 → 高 720 | D（内容盒 976） |
| 1920×1040（1080p，100%） | 1574×894 | B |
| 1536×824（1080p，125%） | 1259×708 | D |
| 2560×1400（用户的 2560×1600@125%→工作区 2048×1280 DIP） | 1600×1000（封顶） | A |
| 3840×2120（4K@100%） | 1600×1000（封顶） | A |

#### 2.3.2 `minWidth` / `minHeight` 定多少，与 1366 底线的关系

**定 `minWidth: 1120`，`minHeight: 700`**（现状 1080/700）。**已拍板 D4。**

- 为什么不是 1366：桌面用户可以放大窗口，但**不能被强制**。1366×768 笔记本的工作区只有 1366×728，若 `minWidth:1366` 窗口一开就贴满全屏、连拖动都困难。`minWidth` 是"紧凑下限"，不是"支持下限"。
- 为什么不是 1080：1120 的内容盒 = `1120−64−32−10 = 1014`（按改造后：侧栏 64、内边距 16），仍在 D 档；1080 的内容盒 ≈ 974，与 1120 无实质差别——**真正的理由是整数与文档一致性**：D 档下沿是 1092，窗口宽度 1092 + 28（边框）≈ 1120。把 `minWidth` 定在 D 档下沿之上，保证"窗口再小也不会掉进 E 档"。
- `minHeight: 700` 保留（`1440×900` 的 78%；700 高时 `.app-content` 可用高度 700−64−48 = 588，弹层 `calc(100dvh − 240px)` = 460，仍 ≥ 可用的 400）。
- **不提供"最小窗口下弹提示"**：E 档的 Web 形态本来就存在（1920@200% → 960），弹窗只会多一个打扰。改为在「设置 → 外观」里显示一行"当前窗口宽度 / 内容区宽度 / 所在档位"，P2。

#### 2.3.3 窗口尺寸记忆

新增 `desktop/lib/window-state.js`（约 120 行，含纯函数）：

```js
// 契约（纯函数，可单测）
clampToWorkArea(bounds, displays) -> bounds
//  - width/height 先 clamp 到 [minWidth, workArea.width]
//  - 若 bounds 与任一 display.workArea 的交集面积 < 60%，丢弃位置、只保留尺寸并居中
//  - 任何异常/缺字段 → 返回 null（调用方回退默认尺寸）
readWindowState(file) -> object | null     // 读失败一律 null，绝不抛
writeWindowState(file, payload) -> void    // 写失败静默（磁盘满/只读）
```

- 落盘位置：`path.join(app.getPath("userData"), "window-state.json")`。**不要放 `runtimeDir()`**——`desktop/lib/shell-paths.js` 的注释明确运行期目录只承载日志与 pid；`userData` 才是 Electron 的用户态。
- 写盘时机：`resize` / `move` 用 400ms 防抖 + `close`（真实退出路径，`before-quit` 之后）落地。**不要**在 `close` 的 hide-to-tray 分支写（那时窗口没销毁，值可能是最大化前的）。
- 记录内容：`{ width, height, x, y, maximized, zoomFactor, version: 1 }`。

#### 2.3.4 用户按 Ctrl+± 缩放后界面如何不崩

| 方案 | 结论 |
|---|---|
| 禁用缩放 | ❌ 拒绝。需要放大的用户（视力/大屏远距）会立刻弃用 |
| 归一化（把 zoomFactor 吸收进布局） | ❌ 不可行。`zoomFactor` 改的是 CSS px 基准，等价于用户自己把视口变窄；布局本来就该响应，不需要补偿 |
| **允许 + 持久化 + 可重置** | ✅ 采用 |

具体：
1. `webContents.on("zoom-changed", (e, dir) => {/* 用 webContents.getZoomFactor() 取真值并写 state */})`，节流 500ms。
2. 启动时 `mainWindow.webContents.setZoomFactor(state.zoomFactor ?? 1)`，必须在 `did-finish-load` **之后**（对 `about:blank` 设置会被 `loadURL` 重置）。
3. 缩放上限保护：`setVisualZoomLevelLimits(1, 1)` 只关捏合；`Ctrl+±` 由 Chromium 默认处理，需要把 `zoomFactor` 限制在 `[0.8, 1.5]`——超出这个范围时内容盒会掉进 E 档或超出 A 档上限，界面"崩"不是布局错而是**用户把自己放进了未验收的档位**。
4. 「设置 → 外观」加一行：当前缩放 `125%` + 按钮「重置为 100%」（P2；文案走 `t()`，新增 `zh-CN.responsive.ts`）。
5. **验证**：在 1440×900 窗口下把缩放设到 150%，等效 CSS 宽 960 → 必须落在 E 档且 rubric R1/R2/R3 仍过（§7 矩阵的 **V8b = 960×600** 就是这一档）。

**浏览器形态的 Ctrl+± 不特殊处理。** 浏览器缩放等价于"用户自己换了一个视口宽度"：`1366` 按 `Ctrl+−` 一档 ≈ 1707（等于 1920@112.5%），按 `Ctrl++` 一档 ≈ 1093。它不需要补偿逻辑，**由同一套断点兜住**——这正是本方案把"等效 CSS 宽"而不是"分辨率"当自变量的原因。唯一要做的是把它写进验收矩阵：**V8b = 960×600 就是「1440 窗口 + 系统/浏览器 150%」的等效形态**（1440 ÷ 1.5 = 960），不写进矩阵的话“用户放大后崩了”会被当成布局 bug 排查。

---

## 3. 断点与令牌体系（单一事实源）

### 3.1 六个断点值与理由

| 名 | 值 | 一句话理由 | 主要用途 |
|---|---|---|---|
| `phone` | **767** | 沿用 `mobile.css:3` 现值，不动线上行为；`1024×768` 竖屏与 `1366@175%`(≈780) 的上沿；恰好是 antd `md=768` 的 −1（`alias.js:29`） | 侧栏转抽屉、48px 触控、页头两行网格 |
| `narrow` | **1092** | `1366 ÷ 1.25 = 1092.8` 向下取整——**用户的底线机型一旦开 125% 缩放**；也是 D 档下沿 | 侧栏 200→64、内边距 24→16、助手与指南转单栏 |
| `base` | **1366** | 用户原话的"最低支持线"；内容盒 1108（实测） | 全功能不降级的下沿；看板强制 5 列、工作台容器查询的上界参照 |
| `wide` | **1536** | `1920 ÷ 1.25 = 1536`——**最常见的笔记本默认缩放**后的宽度 | 开始放宽留白、卡片允许 5 列、图表区加高 |
| `huge` | **1920** | `1920×1080@100%`；内容盒 1656 | 侧栏加宽到 216、A4 允许放大、正文列加宽上限 |
| `ultra` | **2048** | `2560 ÷ 1.25 = 2048`——**用户本人的机器** | 只用于"不要显得空"的上限约束（正文单行 ≤900px） |

> **为什么不是 antd 的 6 档（576/768/992/1200/1600）**：那 6 个数是"视口"档，而我们的约束是"内容盒"（视口 − 侧栏 − 内边距）。992 对应的内容盒只有 900，1200 对应 952——都落在 D 档内部，作为整页布局的决策点太靠里。**决定：不改 antd 的 `screen` token**（antd 内部组件与 `Row/Col` 依赖它，改了会让第三方行为与文档不一致），但规定两条：
> 1. 自定义 CSS 的 `@media` **只允许**用上表 6 个数值；
> 2. antd `Row/Col` 的 `xs/sm/md/lg/xl/xxl` 视为"栅格档"，允许继续用；**新增 `xl/xxl` 必须在本表登记一行说明**（因为 1200/1600 不在我们的断点集里）。

### 3.2 三处同源：TS 常量 / CSS 变量 / 媒体查询

媒体查询**不能**用 CSS 变量（`@media (max-width: var(--x))` 无效），所以"同源"必须靠一条守卫测试强制。这是本仓已有的惯例（`colorGuard` / `cjkRatchet` / `antdOverrideGuard` / `spinOutletGuard` 都是这么做的）。

**文件 1（新增）`frontend/src/theme/breakpoints.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
/**
 * 断点单一事实源。三个消费方：
 *   1. TS/TSX —— 直接 import BREAKPOINTS；
 *   2. CSS    —— `:root` 的 `--rf-bp-*`（design-tokens.css），由 breakpointGuard 比对；
 *   3. @media —— 只能用字面量，由 breakpointGuard 检查"数值必须属于本表"。
 *
 * 改这里 = 改规则。改之前先读 docs 里的适配方案 §3.1（每个数都有理由）。
 */
export const BREAKPOINTS = {
  phone: 767,
  narrow: 1092,
  base: 1366,
  wide: 1536,
  huge: 1920,
  ultra: 2048,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;
export const BREAKPOINT_VALUES: readonly number[] = Object.values(BREAKPOINTS);

/** 生成 max-width 媒体查询串，供 TSX 里的 matchMedia 用（与 CSS 的 max-width 同义）。 */
export const mqMax = (name: BreakpointName) => `(max-width: ${BREAKPOINTS[name]}px)`;
export const mqMin = (name: BreakpointName) => `(min-width: ${BREAKPOINTS[name]}px)`;
```

**文件 2（修改）`frontend/src/theme/design-tokens.css`** —— 在 `:root` 里加（紧邻 `--rf-header-height`）：

```css
  /* 断点镜像：与 theme/breakpoints.ts 一一对应，由 breakpointGuard.test.ts 逐值比对。
     媒体查询本身不能引用变量——这里存在的意义是"让 CSS 侧也能读到同一个数"，
     例如 @container 的档位判断与 TS 侧算出的 --rf-sider-width 要对得上。 */
  --rf-bp-phone: 767px;
  --rf-bp-narrow: 1092px;
  --rf-bp-base: 1366px;
  --rf-bp-wide: 1536px;
  --rf-bp-huge: 1920px;
  --rf-bp-ultra: 2048px;
```

**文件 3（新增）`frontend/src/theme/breakpointGuard.test.ts`**（约 110 行）—— 四条断言：

```ts
// 1. CSS 变量 == TS 常量
//    读 design-tokens.css，正则 /--rf-bp-([a-z]+):\s*(\d+)px/g，与 BREAKPOINTS 逐项相等且键集合相同。
// 2. 所有 @media 的数值 ∈ 断点集（或 ∈ LEGACY 白名单）
//    扫描 styles/*.css + theme/*.css，抽 /@media[^{]*?\(\s*(?:max|min)-width\s*[:<]=?\s*(\d+)px/ 与旧语法
//    /\(\s*width\s*<=\s*(\d+)px/，每个数值必须命中 BREAKPOINT_VALUES。
// 3. LEGACY 棘轮：存量非标准数值只降不升
//    LEGACY: Record<`${file}:${value}`, number> 记录每处允许出现的行数基线；
//    实际出现次数 > 基线 → 红（"你新写了一个非标准断点"）；
//    实际 < 基线 → 允许，但打印"可以收紧基线了"。
// 4. 语法统一：禁止 `(width <= Npx)` 这种 range 语法（announcement.css:55 是唯一一处，迁移时顺手改掉）
```

> 为什么用"棘轮"而不是"一次性清零"：14 处非标准数值里有些（`480` aiPolish、`640` profile、`900` templates）是就地微调，值得保留但需要登记。棘轮保证**不会更烂**，同时不阻塞本批交付。

### 3.3 密度分级：断点覆盖，不用 `clamp()`

**结论：间距、内边距、圆角、卡片列数一律用断点覆盖；`clamp()` 只允许用于"上限类"表达式（`max-width`），且必须写成 `min(…, …)` 而不是连续插值。**

理由（三条，按重要性）：

| # | 理由 | 具体后果 |
|---|---|---|
| 1 | 现有间距是 **4/8 网格**（`--rf-space-1..4` = 4/8/16/24，`tokens.ts` 明确"只允许 4/8 体系"）。`clamp()` 给出的是连续值（在 1366 时算出 21.37px），**直接破坏网格**，也让 §7 的 rubric R6（"卡片间距差 ≤4px"）无法作为客观判据 | 用 `clamp()` 后，同一屏上两个 16px 意图的间距会分别渲染成 15.7 和 16.4，肉眼是"没对齐" |
| 2 | 断点覆盖是**离散、可 grep、可测**的。守卫能断言"每个间距取值来自 token 表"，`clamp()` 算出来的值测不了 | — |
| 3 | 断点覆盖的规则数量和"变体数量"是 1:1；`clamp()` 让每个属性都成为一个隐式断点，调一次全站漂移 | 本方案共 3 个密度档（D/C/A），3 组覆盖就够了 |

**令牌（新增到 `design-tokens.css` 的 `:root`，并在 `base-shell.css:79`、`base-tasks.css:113` 处消费）**：

```css
:root {
  /* 外壳几何：唯一来源。Sider 的 width 与 .app-main 的 margin-left 都读它，
     消灭「App.tsx 写 200 / base-shell.css 写 200 / responsive.css 写 64」三处耦合。 */
  --rf-sider-width: 200px;
  /* 内容区内边距：取代 base-tasks.css 的 24px、responsive.css 的 16px、mobile.css 的 16px。 */
  --rf-content-pad: 24px;
  /* 卡片内边距与栅格间距（新增，供 §4 各页复用；值全部落在 4/8 网格上）。 */
  --rf-card-pad: 20px;
  --rf-grid-gap: 16px;
  /* 统计卡的最小可读宽度：标签 12px×8 汉字 96 + 左右内边距 32 + 余量 → 150。 */
  --rf-stat-min: 150px;
  /* 正文列的最小可读宽度与最大舒适宽度（rubric R4/A8 的判据来源）。 */
  --rf-prose-min: 280px;
  --rf-prose-max: 900px;
  /* A4 画布：窄容器可读下限与大屏放大上限（见 §4.5）。 */
  --rf-a4-min-scale: 0.55;
  --rf-a4-max-fit: 1;
}

/* D 档：紧一档。注意用 min-width 覆盖 base 再回退，避免顺序依赖 —— 这里用 max-width
   与 mobile.css 同向，层叠顺序由 index.css 的 @import 次序决定（design-tokens 最先）。 */
@media (max-width: 1092px) {
  :root {
    --rf-sider-width: 64px;
    --rf-content-pad: 16px;
    --rf-card-pad: 14px;
    --rf-grid-gap: 12px;
  }
}

/* E 档：侧栏整个让位（mobile.css 里 .app-sider{display:none} 仍然保留，
   因为它是 position:fixed，需要显式退出布局）。 */
@media (max-width: 767px) {
  :root {
    --rf-sider-width: 0px;
  }
}

/* A 档：只在大屏才放宽，避免 1366 用户看到"大屏样式"。 */
@media (min-width: 1920px) {
  :root {
    --rf-sider-width: 216px;
    --rf-content-pad: 32px;
    --rf-card-pad: 24px;
    --rf-grid-gap: 20px;
    --rf-a4-max-fit: 1.35;
  }
}
```

**消费点（三行改动，消灭 §1.4 的三处耦合）**：

```diff
- // App.tsx:294-300
- <Sider className="app-sider" theme="light" width={200} breakpoint="lg" collapsedWidth={64}>
+ // collapsed 由 useResponsiveShell() 给（见下），宽度完全交给 CSS 变量。
+ // antd 6 的 SiderProps.width 类型是 number | string（node_modules/antd/es/layout/Sider.d.ts:30），
+ // 传 "var(--rf-sider-width)" 会原样写进 inline style（Sider.js:123-125,142-155）。
+ <Sider
+   className="app-sider"
+   theme="light"
+   width="var(--rf-sider-width)"
+   collapsedWidth="var(--rf-sider-width)"
+   collapsed={shell.collapsed}
+ >
```

```diff
- /* styles/base-shell.css:79 */
- .app-main { margin-left: 200px; }
+ .app-main { margin-left: var(--rf-sider-width); }
```

```diff
- /* styles/responsive.css:105-110 */
- @media (max-width: 991px) { .app-main { margin-left: 64px; } }
+ /* 删除：左偏移与侧栏宽度现在都读 --rf-sider-width，不需要媒体查询。 */
```

```diff
- /* styles/base-tasks.css:113 */
- .app-content { padding: 24px; }
+ .app-content { padding: var(--rf-content-pad); }
```

**新增 hook（约 40 行，`frontend/src/hooks/useResponsiveShell.ts`）**：

```ts
// 只负责"是/不是折叠"，不负责像素宽度（宽度归 CSS）。这样只有一个布尔需要同步。
export function useResponsiveShell() {
  const collapsed = useMediaQuery(mqMax("narrow"));   // ≤1092 → 折叠
  return { collapsed };
}
// useMediaQuery：matchMedia + change 监听 + SSR/jsdom 兜底 false。
// jsdom 无 matchMedia → 一律返回 false（与现状"默认展开"一致，既有测试不红）。
```

### 3.4 字号与圆角的密度分级（同样用断点覆盖，但只动两处）

字号是"可读性"的载体，**不能跟着宽度缩**：`tokens.ts: fontSize` 的 11/12/13/14/16/17 是全站唯一的字号标尺，本方案**不改任何一个值**。只有两处例外，都属"密度"而非"字号"：

| 维度 | D 档（≤1092） | C 档（1366–1535，基线） | A 档（≥1920） | 理由 |
|---|---|---|---|---|
| 正文 | 14px（不动） | 14px | 14px | 13px 中文在 100% 缩放下已经偏小；**禁止**为了"放得下"而缩正文 |
| 说明/次要文字 | 12px（不动） | 12px | 12px | 同上 |
| 卡片内边距 `--rf-card-pad` | 14 | 20 | 24 | 密度唯一该变的地方：留白 |
| 栅格间距 `--rf-grid-gap` | 12 | 16 | 20 | 同上 |
| 内容内边距 `--rf-content-pad` | 16 | 24 | 32 | 同上 |
| 面板圆角 `--rf-radius-panel` | 12 | 16 | 16 | 小面板配大圆角会显"胖"；只降一档，且 ≥16 不再变 |
| 控件圆角 `--rf-radius-control` | 8（不动） | 8 | 8 | 与 antd 的 `borderRadius` 绑定，改它会与组件库不一致（`appTheme.ts` 已设） |
| 卡片最小可读宽 `--rf-stat-min` | 150 | 150 | 150 | 语义下限，不随档位变 |

**一句话**：能变的只有"留白"，不能变的是"字号与控件圆角"。这条规矩写进 §7 的 rubric（R4 只判宽度与每行字数，不判字号；因为字号全站恒定，判它等于判了个常量）。

**antd 设计令牌是写死的三处**（不是变量，改就是改代码）：

| 文件 | 内容 |
|---|---|
| `theme/appTheme.ts:26-27` | `controlHeight: 40, fontSize: 14` |
| `theme/darkTheme.ts:94-95` | 同值（注释明写"几何：与浅色逐项一致，只换颜色"） |
| `theme/tokens.ts:59` 起的 `fontSize` | `caption 11 / small 12 / body 13 / base 14 / subtitle 16 / title 17` |

**本方案不改这三处，所以波及面为零。** 若有人日后要改（例如把 `controlHeight` 40→36 做"紧凑密度"），必须知道会踩到这些：

| 波及 | 具体位置 | 后果 |
|---|---|---|
| 主题一致性断言 | `theme/darkTheme.test.ts:48` 逐键比较 `borderRadius / controlHeight / fontSize / lineHeight` 两主题必须相等 | 只改一套 → **必红**；两套同改才过 |
| 需要 40px 控件高的布局假设 | `modules-layout.css:127/133/218` 的 200px 侧栏项、`mobile.css` 的 48px 触控目标（`:110-121`） | 缩到 36 会让触控目标与菜单项高不一致，`mobile.css` 那套 48px 规则要重算 |
| 以 40px 为基准的视觉断言 | `components/common/LoadingBlock.test.tsx`、`components/analytics/FunnelChart.test.tsx`、`features/assistant/components/AssistantComposer.test.tsx`、`components/profile/swapFlip.test.ts`、`utils/resumeLayoutMeasure.test.ts`（grep `40px`/`fontSize` 命中） | 部分用例按像素断言高度/换行，需逐条复核 |
| 简历纸面 | `frontend/src/utils/resumeLayoutMeasure.ts` 与后端 `resume_labels.py` 的基准字号 | 前端 antd `fontSize` 与纸面字号**无关**（纸面字号走 `--fs`/模板变量），但 `LayoutMeasure` 的探针盒宽依赖容器字号 → 改前先跑 `resumeLayoutMeasure.test.ts` |

**结论**：密度分级只动 §3.3 的 `--rf-content-pad / --rf-card-pad / --rf-grid-gap / --rf-radius-panel`，**不动 antd 的三个令牌**。这也是"改 CSS 变量而不改组件库"这条边界的实际意义。

### 3.5 为什么不用容器查询统一解决

容器查询（`@container`）能彻底消灭"媒体查询用视口、约束是内容盒"这一错配。但它有一个在本仓**会直接咬人**的副作用：`container-type: inline-size` 隐含 `contain: layout`，**使该元素成为 `position: fixed` 后代的包含块**。

实测仓内 `position: fixed` 的元素（`grep -rn "position: fixed" frontend/src/styles/*.css`）：

| 位置 | 元素 | 祖先 |
|---|---|---|
| `tou-tou-orb.css:16` | 悬浮球 | `App` 根（在 `.app-shell` 之外）✅ 不受影响 |
| `base-panels.css:70/105` | 全局拖入遮罩、后台任务条 | `.app-main`（`.app-content` 之外）✅ |
| `modules-templates.css:442` | `.app-exited-overlay` | 组件树顶层 ✅ |
| `aiPolish.css:11/57` | AI 润色浮层 | `App` 根 ✅ |
| **`modules-webform.css:127`** | **`.webform-target-floating-balls`（网申页右下悬浮页签）** | **`WebFormPage` → `.app-content`** ❌ 一旦给 `.app-content` 加 `container-type`，这组按钮会改为相对 `.app-content` 定位，bottom 会落到页面内容底部而不是视口底部，滚动后飞出屏幕 |

**决定**：
- 整页布局用 `@media`（保守，零副作用）。
- **只在工作台弹窗体内用 `@container`**（`.resume-zoom-workbench-wrap .ant-modal-body`）。理由：它自己是一个独立滚动体、内部没有 `position:fixed` 后代、且它的宽度（`100vw − 24`）与视口只差 48px——用容器查询是为了让"三栏还是两栏"跟着**这个弹窗真实的宽度**走，而不是靠 `1000/1280` 两个魔法视口值。
- 若将来要在 `.app-content` 上开容器查询，**前置条件**写进任务：先把 `webform-target-floating-balls` 改成 portal（`createPortal` 到 `body`），否则浮层会错位。

---

### 3.6 侧栏两条路线：保留 `fixed`（推荐）vs 放回文档流

现状的结构（已实读，不是推测）：

```css
/* base-shell.css:56-70 */ .app-sider { position: fixed !important; inset: 0 auto 0 0; height: 100vh !important; }
/* base-shell.css:73-85 */ .app-main  { margin-left: 200px; overflow-y: auto; scrollbar-gutter: stable; }
/* base-tasks.css:106-115 */ .app-content { padding: 24px; }
```

即"侧栏浮在上面、主区用 `margin-left` 让位、`.app-main` 自己是唯一的滚动容器"。这不是随手写的，它牵动三处隐式契约：`#root{height:100vh;overflow:hidden}`（`base-shell.css:45`）、`.app-content` 的 `min-height: calc(100vh − header − announcement)`（`base-tasks.css:113`）、以及多处 `calc(100vh − …)` 的页面高度（如助手 `assistant-layout.css:7/127`）。

| | **路线 A：保留 fixed + 令牌化（推荐）** | **路线 B：放回文档流（flex/grid 外壳）** |
|---|---|---|
| 改什么 | `.app-main{margin-left: var(--rf-sider-width)}`；Sider 的 `width/collapsedWidth` 传同一个变量；删 `responsive.css` 的 64px 覆盖 | 去掉 `.app-sider` 的 `position:fixed`，`.app-shell` 改 `display:flex`；侧栏给 `flex: 0 0 var(--rf-sider-width)`；`#root` 与 `.app-main` 的 `height/overflow` 全部重新定义 |
| 解决 | 三处硬编码合一、宽度单一来源 | 同上，且语义更"现代"（不再靠 margin 模拟栅格） |
| 新增风险 | 侧栏仍是 fixed → 打印/长截图时侧栏不参与文档流（现状已如此，非新增） | **高**：① `.app-main` 的 `scrollbar-gutter: stable` 与 `overflow-y:auto` 要重新验证（滚动条会从主区移到 `#root` 或某层，`gutter ≈10px` 的宽度预算全变）；② 所有 `calc(100vh − …)` 的页面高度基准要重算（助手、A4 预算、`--rf-modal-body-max-h`）；③ `position:fixed` 的浮层（网申页右下页签 `modules-webform.css:127`、全局拖入遮罩 `base-panels.css:70`）若被新的包含块捕获会错位；④ 至少 3 条既有测试按 DOM 结构断言（`App.test.tsx`、`App.shortcuts.test.tsx`、`ui-quality.spec.ts` 的 `main` 可见性） |
| 工时 | 0.5 天 | 2–3 天 + 一轮全量视觉回归 |
| 结论 | ✅ **采用**。它已经达成"单一来源"这个目标——那才是本次的真实需求 | ❌ 不做。收益是"更干净的结构"，代价是"重算所有高度预算 + 浮层定位风险"，与本需求（不同分辨率下不崩）无关 |

**落地细节（A 路线的关键，别写错）**：antd 6 的 `SiderProps.width` 类型是 `number | string`（`node_modules/antd/es/layout/Sider.d.ts:30`），且 `Sider.js:123-125` 会做 `isNumeric(rawWidth) ? `${rawWidth}px` : String(rawWidth)`，所以传 `"var(--rf-sider-width)"` 会原样写进 inline style（`divStyle` 在 `:142-155`）。**同时必须给 `collapsedWidth` 传同一个变量**，否则折叠态会退回 antd 默认（80px）。折叠类名仍由 `collapsed` 决定（`Sider.js:157`），所以 `.ant-layout-sider-collapsed` 的既有样式（隐藏品牌文案、居中 footer）不受影响。

---

## 4. 逐页面 / 逐组件适配方案

> 每小节格式：**文件 → 加什么规则 → 断点值 → 预期效果 → 验收**。所有 `@media` 数值必须来自 §3.1 的 6 个值。

### 4.1 外壳（Sider / Header / Content）

| 项 | 文件 | 改动 | 断点 | 预期 |
|---|---|---|---|---|
| 侧栏宽度 | `App.tsx:294-300`（批 1 后迁到 `AppShell.tsx`，见 T03） | `width="var(--rf-sider-width)"`、`collapsedWidth="var(--rf-sider-width)"`、`collapsed={shell.collapsed}`，删 `breakpoint="lg"` | 1092 / 767 / 1920 | 200 → 64 → 0 → 216，四处一致；折叠类名仍来自 `collapsed`，`.ant-layout-sider-collapsed` 的既有规则（隐藏品牌文案、居中 footer）全部继续生效 |
| 左偏移 | `base-shell.css:79` | `margin-left: var(--rf-sider-width)` | — | 与 Sider 宽度恒等 |
| 内容内边距 | `base-tasks.css:113`、`responsive.css:162-163`（删）、`mobile.css:108`（删） | 统一读 `--rf-content-pad` | 1092 / 1920 | 24 → 16 → 32 |
| 页头 | `base-header.css` | **新增** `@media (max-width: 1092px)`：`.app-header{padding:0 16px}`、`.app-model-profile-select{width:168px}`、`.app-dataset-chip{max-width:160px}`。**删除** `:252` 的 `@media (max-width:700px)`（它的 4 条规则移到 767 块内，避免 700/767 两级几乎重叠） | 1092 / 767 | 992–1092 时标题从"约 6 字"恢复到 ≥12 字 |
| 移动页头 | `mobile.css:25-49` | 保持不动 | 767 | 已有两行网格 + 48px 触控，**这是全仓唯一已经做对的地方，不要改** |

**验收**：`1093` 与 `1092` 两个视口下，`getBoundingClientRect().width` 的 `.app-sider` === `getComputedStyle(.app-main).marginLeft`。

### 4.2 首页（`/`）

现状：`StatsCards.tsx` 用 antd `Row/Col`（`xs={24} sm={12} xl={6}`，即 576/768/1200）；`modules-home.css:55` 快捷入口 `repeat(auto-fill, minmax(168px,1fr))`。

| 项 | 改动 | 断点 | 预期 |
|---|---|---|---|
| 统计卡 | `StatsCards.tsx`：`xl={6}` → `lg={6}`（4 张并排从视口 1200 提前到 992） | antd `lg=992` | D 档（内容盒 932）也是 4 张并排、每张 218px，而不是 2×2 浪费高度 |
| 快捷入口 | `modules-home.css:55` 不变（`auto-fit` 已自适应）；`gap:12px` → `var(--rf-grid-gap)` | — | 1790 → 5 列；1108 → 5 列；986 → 4 列 |
| 待办列表 | 无需改动（单列） | — | — |

**验收**：8 个视口下首页无横向溢出；统计卡在 1092 与 1366 都是 4 列。

### 4.3 岗位广场（`/jobs`）

| 项 | 文件 | 改动 | 预期 |
|---|---|---|---|
| 搜索框 | `jobs.css:13` `.jobs-search-input{width:260px}` → `flex: 1 1 200px; max-width: 260px; min-width: 160px;` | 在 `.rf-filter-bar`（`foundation.css:150`，已是 `flex-wrap`）里参与收缩，768–991 不再把整行挤成两行 |
| 筛选行间距 | `foundation.css:150`（`.rf-filter-bar`）`gap:16px` → `var(--rf-grid-gap)` | D 档变 12 |
| 卡片网格 | `jobs.css:7` `.candidate-job-card-grid{display:grid;gap:16px}` → `gap: var(--rf-grid-gap)`；若内部有固定列宽，改 `repeat(auto-fill, minmax(min(100%, 320px), 1fr))` | 1108 内容盒 → 3 列；986 → 3 列；662 → 2 列 |
| **岗位表（宽表）** | QA 实测：`/jobs` 的 `div.ant-table-content > table` **溢出 188px @1366、462px @1092**（`innerScrollers.hiddenPx` 496 @1092）。与 §4.4 同一处方：`scroll={{x: 列宽之和}}` + **「操作」列 `fixed:"right"`**，<1092 走卡片回退（P1，见 §4.11） | 需横滚距离 188 @1366 → 462 @1092 |

**不做**：岗位详情抽屉的双列正文 → 单列（`JobDetailDrawer` 已是单列）。

### 4.4 简历中心（`/resumes`）：宽表在窄屏的三选一（**P1，不是 P0**）

**先定级**：这一条**不是 P0**。判定口径（已写进 §7.4 的采集脚本）：

> `overflow-x` 祖先链上存在 `auto`/`scroll` → 内容**能滚动到达** → **P1**；
> 一路 `hidden` 直到 `.app-main`（`base-tasks.css:114`）→ 内容**真的丢了** → **P0**。

`/resumes` 属于前者。DOM 链路实测（1280 视口）：

```
table                  w=1494   overflow-x: visible
div.ant-table-content  w=1022   overflow-x: auto     ← 真正的滚动容器（foundation.css:133）
```

10 列全部带显式 `width`（64 + 220 + 200 + 100 + 150 + 180 + 110 + 160 + 160 + 150 = **1494**），所以表格**不会**被压扁；问题是**需要横滚**，而 8px 细滚动条 + 无固定列 + 无边缘提示，普通用户不知道右边还有内容。

| 视口 | 表格可视宽 | 需要横滚的距离 | 首屏看不到的列 |
|---|---|---|---|
| 1536 | 1278 | 216px | 「最近修改」右半 |
| 1440 | 1182 | 312px | 「最近修改」+「操作」 |
| 1366 | 1108 | 386px | 「操作」整列 |
| 1280 | 1022 | 472px | 「操作」整列 |
| 1092 | 834 | **660px（44%）** | 「美化拓展」起共 3 列 |

> ⚠️ 上表的后两列是"要滚多远"，**不是"被裁掉多少"**——数据没丢。（旧版本文写错过，已更正。）

#### 三选一

| 方案 | 做法 | 优点 | 代价 | 适用档 |
|---|---|---|---|---|
| **① 冻结操作列 + 横滚 + 边缘渐变**（推荐用于 B/C/D） | `<Table scroll={{ x: 1494 }}>` + 「操作」列 `fixed: "right"` + `.ant-table-content` 右缘 `mask-image` 渐变 | 改动最小（**+2 行 CSS/TSX**）；宽屏像素级不变；操作永远在屏上 | 其余列仍要横滚才能看全 | 1536 / 1440 / 1366 / 1280 |
| ② 列折叠（3 个低优列进「更多」） | 加一个"列显示"下拉，默认收起「模型 / 美化拓展 / 来源」→ 1494 → ~1034 | 一屏看全 | 要新组件 + 记住偏好 + 表头再挤一个控件；且**用户感知是"功能被藏了"** | 不建议 |
| **③ 卡片化**（推荐用于 D/E） | <1092 用卡片列表（标题/匹配度/时间/操作），**零横滚** | 彻底解决；触控友好 | 要新增两个组件（≈220 行）；表格与卡片两套要同时维护 | 1092 及以下 |

**推荐组合：①（≥1092）+ ③（<1092），不做 ②。** 理由：② 是"把问题藏起来"，而 ③ 在窄屏上本来就更好（一行一条、操作 48px）；① 在宽屏上成本几乎为零，且它把"操作不可见"这个真问题直接消掉。

> **绝对不要写 `scroll={{x:900}}`**：那会把 1494 压成 900，220px 的标题列与 180px 的备注列**反而被压扁**（`scroll.x` 必须 ≥ 各列 width 之和）。

| 项 | 文件 | 改动 | 预算 |
|---|---|---|---|
| ① 冻结操作列 | `pages/resumes/ResumeTable.tsx` | `<Table>` 加 `scroll={{ x: 1494 }}`；「操作」列加 `fixed: "right"`（**+2 行**） | 484 → 486（**只剩 14 行余量**） |
| ① 右缘渐变 | `styles/foundation.css` 或新增 `responsive-narrow.css` | `.app-content .ant-table-content { mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent) }` + `@supports` 门控（不影响无横滚的表：用 `:has(> table)` 无法判）→ 改由 JS 加类，避免误伤 | +12 |
| ③ 卡片回退 | 新增 `pages/resumes/ResumeResultList.tsx`（70）+ `ResumeCardList.tsx`（150）；`ResumesPage.tsx:396` 换组件 | `useMediaQuery(mqMax("narrow"))` | 新文件，不影响顶格 |

### 4.5 简历工作台：**对齐与校验**，不是重做

> **定位先说清**：工作台今天已经做过一版窄屏适配，设计与验收写在 `deliverables/software-company/resume-workbench-20261023/design.md`（2026-10-23 落地）。本节的任务是**校验它是否真的按设计工作、把它纳入全局断点体系、修掉实测暴露的三个缺口**——**不是推倒重写**。凡是与 `design.md` 冲突的地方，以本文为准但必须在 PR 里写明理由与代价。

#### 4.5.1 既有契约（直接引用，不重复设计）

| 项 | 出处 | 内容 |
|---|---|---|
| 断点 1 | `design.md:430` | `@media (max-width:1280px)`：三栏 → 两栏 + 中栏**改抽屉**（`position:absolute; width:360px; z-index:2`） |
| 断点 2 | `design.md:430` | `@media (max-width:1000px)`：抽屉 → 上下布局（`grid-template-rows: minmax(180px,32dvh) minmax(0,1fr)`），中栏 `display:none` |
| 单一事实源 | `design.md` §7.1（"断点"行） | **「CSS 与 `Grid.useBreakpoint` 不许各写一套」** ——这条**已经是仓库共识**，本方案 §3.2 的三方同源守卫就是它的延伸，可直接引用 |
| 文件预算 | `design.md:77` + `:430` | `styles/resume-workbench.css` 预估 **210 行**、验收线 **≤260 行** |

**实测：预算已被突破，而且守卫抓不到。** `wc -l frontend/src/styles/resume-workbench.css` = **453 行**。它没红，是因为全局守卫的预算是 500（`test_file_size_budget.LINE_BUDGET`），而 `design.md` 自己定的 260 线**没有任何自动检查**。→ 结论：**在动这个文件之前先按 §5.1 的分片方案拆**（T08），否则"替换两条断点 + 新增容器查询"会把它推到 500+。

#### 4.5.2 校验结论：三个断点里有两个"按设计工作"，第三个（1280）**触发得太晚**

| 视口 | 现状应为 | 实测（QA 截图 + `metrics.json`） | 结论 |
|---|---|---|---|
| 1092×614 | 两栏 + 中栏抽屉 | ✅ 中栏确实是抽屉 | 符合设计；但纸面被压到 **34%**（§4.6 的 G2） |
| 1280×720 | 两栏 + 抽屉 | ⚠️ 是两栏，但**只差 1px 就还在三栏**（触发条件 `max-width:1280`，而视口 1281 仍是三栏） | **边界脆** |
| 1366×768 | **三栏** | ⚠️ 三栏确实在，但**表单已被挤坏**：邮箱 `user@exa…` 被截断、「跟随模板」折成两行 | **断点太晚**（详见 4.5.3） |

#### 4.5.3 为什么 `@media (max-width:1280px)` 会在"Modal 还很宽"时提前/延后触发

这是本节技术含量最高的一处，必须讲透。工作台是 **Modal**，`width: calc(100vw − 24px)`（`ResumeZoomModal.tsx:220`），所以：

```
弹窗体宽  = 100vw − 24（Modal width）− 24（wrapper padding 12×2） = 100vw − 48
每一栏宽  = 弹窗体宽的三等分（含 minmax 约束）
```

**媒体查询看的是 `100vw`，而真正决定"挤不挤"的是 `100vw − 48`。** 两者只差 48px，看上去无伤大雅——但三栏的每栏还要再减内边距（左栏 20×2、中栏 16×2）与滚动条（6px），所以**误差会被放大到 100px 量级**：

| 视口 | 弹窗体宽 | 中栏宽 | 中栏内可用宽 | 中栏里"3 个字段一排"每个字段宽 | 判定 |
|---|---|---|---|---|---|
| 1281（三栏，刚好没触发） | 1233 | ≤400 | 400−32−6 = **362** | (362−2×8)/3 ≈ **115** | 邮箱必然截断 |
| 1366 | 1318 | 400 | 362 | ≈115 | 实测：截断 + 换行 ✅ 一致 |
| 1536 | 1488 | 400 | 362 | ≈115 | **也一样挤**（说明：**这不是"窄屏"问题，是"中栏 400px 装不下 3 列表单"**） |
| 1280（两栏，刚触发） | 1232 | 抽屉 360 | 360−32−6 = 322 | 抽屉里字段变 1 列 | 反而更好用 |

**这就是"容器宽 ≠ 视口宽"的实证，而且它揭示了一个更重要的结论**：

> **实测在 1536 上同样挤（每字段 115px）。** 所以把断点从 1280 往上挪（挪到 1415 / 1566）**治不好这个问题**——中栏只要还是 400px、只要还排 3 列，就会挤。真正的修法是**让中栏内部的表单栅格跟着"中栏自己的宽"走**（容器查询 3 列 → 2 列 → 1 列），而不是让中栏消失。

于是本方案对 4.5 的处置分三层，代价从低到高：

| 层 | 做什么 | 解决什么 | 代价 |
|---|---|---|---|
| **L1（必做，P0）** | 用 `@container` 替换两条视口媒体查询（阈值换算成 **1232 / 952**，与 `design.md` 等价），并把**中栏内部表单**改为容器查询（3 列 → 2 列 → 1 列） | 「1366 三栏表单被挤坏」+「边界只差 1px」 | 低。数值不变、只是判据从视口换成容器 |
| **L2（必做，P0）** | 修 F1/F2/F3（下面 4.5.5） | 参数栏被盖、内容编辑不可达、参数栏恒定溢出 47px | 中。动 `ResumeZoomModal` 的渲染分支 |
| **L3（不做）** | 把 1280 上移到 1415/1566（即"1440/1536 变两栏"） | 只是把挤压从 1366 挪到 1536 | **不值得**：L1 已治本，L3 会让 1440/1536 用户多一次点击而纸面不变（高度才是约束，§4.6） |

> 因此**三栏阈值不需要用户拍板**（不再上移）。真正需要处置的是"纸面触底之后怎么办"——**已拍板（附录 D 的 D0）：保可读 0.55 + 纵向滚动**，原『1440/1536 是否变两栏』的旧 D0 已作废。

#### 4.5.4 `@container` 能不能用：查了 Electron 与仓库惯例，结论是**能用，但要 `@supports` 门控**

| 证据 | 值 | 结论 |
|---|---|---|
| `desktop/package.json:13` | `"electron": "^44.7.0"` | Electron 44 ≈ Chromium 137+，**远超** `@container` 的 Chrome 105 门槛 |
| `frontend/package.json` | `vite ^8.3.1`（默认 target `baseline-widely-available`） | 覆盖 Chrome 107+；`@container` 需 Chrome 105 / Safari 16 / Firefox 110 —— **Firefox 104–109 是唯一缺口** |
| 仓库惯例 | `resume-panels.css:98` `@supports (grid-template-columns: subgrid)`；`design-tokens.css:153` `@supports (height:100dvh)` | **新特性一律 `@supports` 门控**，不裸用 |

**照惯例落地**（零风险，降级即今天的视口行为）：

```css
/* workbench-narrow.css —— 默认（降级）：仍是视口断点，行为与今天完全一致 */
@media (max-width: 1280px) { /* 两栏 + 抽屉 */ }
@media (max-width: 1000px) { /* 单栏 */ }

/* 支持容器查询时：判据换成「弹窗体自己的宽」。
   阈值换算：弹窗体宽 = 视口 − 48，所以 视口 >1280 ⇔ 弹窗体 ≥1233；视口 >1000 ⇔ 弹窗体 ≥953 */
@supports (container-type: inline-size) {
  .resume-zoom-workbench-wrap .ant-modal-body {
    container-type: inline-size;
    container-name: wb;
  }
  @container wb (min-width: 1233px) { /* 三栏 */ }
  @container wb (min-width: 953px) and (max-width: 1232.98px) { /* 两栏 + 抽屉 */ }
  @container wb (max-width: 952.98px) { /* 单栏 */ }
}
```

若将来必须支持"不支持 `@container` 且又不想要视口近似"的环境，退路是 JS：`Math.min(Grid.useBreakpoint(...) 推出的宽, 弹窗实测宽)`——但**不需要**，因为 `@supports` 的降级分支就是今天的精确行为。

#### 4.5.5 三个必须修的缺口

| # | 缺口 | 证据 | 用户后果 |
|---|---|---|---|
| F1 | 1000–1280 之间中栏是 `position:absolute; inset:0 auto 0 0`，**盖住左参数栏**；`collapsed` 只改 `grid-template-columns`，对绝对定位元素无效 | `resume-workbench.css:403-416` 与 `:91` 的 grid 定义互不作用 | 参数栏被永久盖住，折叠按钮点了没反应 |
| F2 | <1000 时中栏 `display:none`，而 `ResumeZoomModal.tsx:246` 仍渲染它（`showEditor` 只看 `resumeId`），**没有任何入口能打开** | `:419-441` + `ResumeZoomModal.tsx:252` | 窄屏下**内容编辑功能不可达**（不是不好看，是做不了事） |
| F3 | 参数栏在**全部 8 个视口**都横向溢出 47px（`clientWidth 339 / scrollWidth 386`） | QA `metrics.json` 的 `innerScrollers`；与视口无关 | 参数栏底部一条横向滚动条 / 右侧被裁——她在 2048 上也看得到 |

**F1/F2 的修法**：抽屉必须是**真抽屉**（`<Drawer size="default">`），不是在栅格里绝对定位；渲染分支由"弹窗体宽 + 是否只读"共同决定，而不是由 `display:none` 表达。

**F3 的修法**（不要"把栏加宽"）：缩小滑杆基准宽 + 允许读数与胶囊换行：

```css
/* workbench-params.css */
.resume-wb-col-params .resume-measure-grid.is-stacked { gap: 14px; }   /* 18 → 14 */
.resume-wb-col-params .resume-measure-cell > .ant-space { flex-wrap: wrap; row-gap: 4px; }
.resume-wb-col-params .resume-measure-grid.is-stacked .ant-space-item:has(> .ant-slider) {
  flex: 1 1 96px;          /* 132 → 96：给后面的读数留 36px */
  min-width: 80px;
}
```

验收：8 视口下 `.resume-wb-col-params` 的 `scrollWidth − clientWidth ≤ 1`。

#### 4.5.6 三档去向（与 `design.md` 一致，只是判据换成容器宽）

| 弹窗体宽 | 对应视口 | 栏数 | 参数去哪 | 内容编辑去哪 | 动作条出现什么 |
|---|---|---|---|---|---|
| ≥1233 | >1280 | 三栏 | 左栏常驻 | 中栏常驻（**内部表单按中栏宽 3→2→1 列**） | 折叠内容栏 + 导出 |
| 953–1232 | 1001–1280 | 两栏 | 左栏常驻 | `<Drawer size="default">`（378，**已拍板 D3**），由「编辑内容」打开 | 「编辑内容」+ 导出 |
| <953 | ≤1000 | 单栏 | `<Drawer>`，由「排版参数」打开 | `<Drawer>`，由「编辑内容」打开 | 两个按钮 + 导出 |

- 两个 Drawer **互斥**（同一个 `openPanel: "params" | "content" | null`，不要两个 boolean）：768 宽时两个 378 会把画布全盖住，且 `popupStackGuard` 要求同层弹层有明确先后。
- `<Drawer>` 只能用 `size=`（`popupGuard` P4 禁 `width=`；antd 6 的取值见 `node_modules/antd/es/drawer/Drawer.d.ts:6` → `"default" | "large"`）。
- 脏态关闭走 `useDiscardGuard`。
- **补一个 `design.md` 里写但没落地的验收**：它要求画布高度"由容器测量（`ResizeObserver`）而非 `window.innerHeight*0.72`"（T09 条目）。实测 `ResumePreview.tsx:147-149` 仍在用 `window.innerHeight → 0.62×`。→ 归入 §4.6 的 G2，T10 一起做。

### 4.6 A4 画布：容器宽 × 高 → scale 的**策略表**（不是新算法）

缩放已实现（§1.5）。本节只定三件事：**下限多少、触底怎么办、高度预算从哪来**。

#### 4.6.1 公式（在既有实现上加两个夹取）

```ts
// config.ts 新增
/** 可读下限：0.55 → 纸面 437px，14px 正文渲染成 7.7px（≈8pt 脚注）。
 *  低于此值不再缩小，改为滚动——"看不清"比"要滚一下"更糟。 */
export const MIN_READABLE_SCALE = 0.55;
/** 用户手动缩放的档位（Ctrl+滚轮 / 工具栏 ±）：只有用户意图是离散的。 */
export const ZOOM_STOPS = [0.55, 0.65, 0.75, 0.85, 1, 1.1, 1.25, 1.4] as const;

// geometry.ts 内（替换 :75-76）
const rawFit = Math.min(viewportWidth / A4_WIDTH_PX, viewportHeight / contentUnitHeight);
// fit 不吸附：它必须"恰好装得下"，吸附会让纸比容器宽而凭空多出一条滚动条。
const fitScale = Math.min(maxFitScale, Math.max(MIN_READABLE_SCALE, rawFit));
const scale = Math.min(MAX_ZOOM, Math.max(MIN_READABLE_SCALE, fitScale * zoom));
// 渲染统一 Math.round(794 × scale)：半像素由取整消化。
```

`maxFitScale` 从 CSS 变量 `--rf-a4-max-fit` 读（§3.3 已按断点给了值），TS 只留兜底 `MAX_FIT_SCALE_DEFAULT = 1`。

**高度预算（本节最实质的改动，G2）**：

```diff
- const viewportHeight = window.innerHeight;
- const budget = Math.round(viewportHeight * PREVIEW_HEIGHT_RATIO);        // 0.62
- const ceiling = Math.max(MIN_PREVIEW_HEIGHT, viewportHeight - PREVIEW_BOTTOM_RESERVE);
- setAvailableSpace({ width: container.clientWidth, height: Math.min(ceiling, Math.max(MIN_PREVIEW_HEIGHT, budget)) });
+ // 用容器自身高度。0.62×innerHeight 在工作台里系统性低估 60–170px：1092×614 时它给
+ // 381px，而容器实际有 450px —— 纸被缩到 0.339，正是截图上的「34%」。
+ const box = container.getBoundingClientRect();
+ const height = box.height || Math.round(window.innerHeight * PREVIEW_HEIGHT_RATIO);
+ setAvailableSpace({ width: container.clientWidth, height: Math.max(MIN_PREVIEW_HEIGHT, height) });
```

配套：`@media (max-height: 839px)` 时把画布说明条（`.resume-wb-canvas-bar`，约 56px）折成一行并收进 Tooltip → 回收 56px 高度。**这是唯一能真正让纸变大的手段**（宽度加了也没用，见 4.6.2）。

#### 4.6.2 策略主表（逐格验收）

`H_in` = 弹窗体高（`dvh−24`）− 动作条 56 − 画布说明条与内边距（高屏 56+28=84；**矮屏折条后 28**）。
`W_in` = 画布列宽 − 32。

> **⚠️ 2026-10-23 实测更正（本条由用户拍板「按实测改文档」）**：下表是按"预览内部 chrome = 84px"
> 推的，而实测 chrome（预览工具条 + 缩放条 + 间距，**在画布列内部、不在这个公式里**）是
> **116–176px**——1366 的中栏只有 481 宽时工具条还会折行，chrome 到 176。于是：
> - **1536 及以下全部触底在 0.55（纸面 438）**，不是下表里 467/495 的逐档递增；
> - 2048 仍是 0.709（纸 563）、2560×1440 实测 0.797（纸 633，不是 902——同样因为 chrome）。
>
> 见下表后面的「2026-10-23 实测值」小表。**验收以实测表 + R7（scale ≥ 0.55 且纸面 ≥ 437px）
> 为准**；原推演表保留作"为什么是高度而不是宽度在约束"的论证。

| 视口 | 弹窗体宽 | 栏数 | W_in | H_in | 宽度允许 | 高度允许 | **改造后 scale** | **纸面宽** | 现状 scale（`0.62×innerH`）→ 纸宽 | 是否触底 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2560×1440 | 2512 | 三栏 | 1740 | 1276 | 2.19 | 1.136 | 1.136 | 902 | 0.778 → 618 | 否（封顶 `maxFit`） |
| 2048×1280 | 2000 | 三栏 | 1228 | 1116 | 1.55 | 0.994 | 0.994 | 789 | 0.707 → 561 | 否 |
| 1920×1080 | 1872 | 三栏 | 1100 | 916 | 1.39 | 0.816 | **0.816** | 648 | 0.596 → 473 | 否（高度） |
| 1536×864 | 1488 | 三栏 | 716 | 700 | 0.90 | 0.623 | **0.623** | 495 | 0.477 → 379 | 否（高度） |
| 1440×900 | 1392 | 三栏 | 620 | 736 | 0.78 | 0.655 | **0.655** | 520 | 0.497 → 395 | 否（高度） |
| 1366×768 | 1318 | 三栏 | 546 | 660 | 0.69 | 0.588 | **0.588** | 467 | 0.424 → 337 | 否（高度） |
| 1280×720 | 1232 | 两栏 | 860 | 612 | 1.08 | 0.545 | **0.55** | 437 | 0.397 → 315 | **是**（高度） |
| 1092×614 | 1044 | 两栏 | 672 | 506 | 0.85 | 0.451 | **0.55** | 437 | 0.339 → 269 | **是**（高度） |
| 768×1024 | 720 | 单栏 | 688 | 916 | 0.87 | 0.816 | 0.816 | 648 | 0.565 → 449 | 否 |

**2026-10-23 实测值**（`harness/capture.mjs` 的 `metrics.json`，`P05-workbench`）：

| 视口 | 实测 scale | 实测纸面宽 | 是否触底 | 原表预测 |
|---|---|---|---|---|
| 2560×1440 | 0.797 | 633 | 否 | 902 |
| 2048×1280 | 0.709 | 563 | 否 | 789 |
| 1920×1080 | 0.598 | 475 | 否 | 648 |
| 1536×864 | 0.551 | 438 | **是** | 495 |
| 1440×900 | 0.551 | 438 | **是** | 520 |
| 1366×768 | 0.551 | 438 | **是** | 467 |
| 1280×720 | 0.551 | 438 | **是** | 437 |
| 1092×614 | 0.551 | 438 | **是** | 437 |
| 768×1024 | 0.567 | 450 | 否 | 648 |

结论：**可读下限在 1536 以下全部生效**（这正是 D0 要的效果），纸面从 337→438（1366，+30%）、
270→438（1092，+62%）；而原表"逐档递增"的假设不成立——高度预算不是 84px 的固定开销。

读这张表的三个要点：

1. **「高度允许」列几乎每行都小于「宽度允许」** → `scale` 由高度决定。所以"把某一栏改成两栏/单栏让纸变大"在本仓不成立（最多 ±3%）。
2. **最差的三行（1366 / 1280 / 1092）全是矮屏**：768、720、614 高。1366×768 从 337 → **467（+39%）**；1092×614 从 269 → **437（+62%）**——这 39%/62% 全部来自"高度预算改用容器实测 + 矮屏折条"，不来自任何栏位调整。
3. **`maxFit 1.35` 的生效条件是"高度允许 > 1.0"，不是 > 1.35**：2560×1440 的 `scale` 是 1.136（高度封顶），纸 902——**这是 1.35 带来的**（旧的 `Math.min(1, …)` 会把它压回 794）；而 2048×1280 的高度允许只有 0.994，两种设置下纸都是 789，**这条对用户当前这台机器没有观感变化**，收益落在更高的屏（2560×1600@100%、4K@100%）。

#### 4.6.3 触底（`scale = 0.55`）之后怎么办：四选一

先给结论：**在本仓的实际形态里，"强制两栏"和"横向滚动"都不是有效手段**——触底是高度造成的，宽度还富余（1092 时 W_in 672、纸只要 437）。所以真正的选项是下表第 1、2 条。

| 方案 | 可读性 | 整页可见 | 实现成本 | 副作用 | 取舍 |
|---|---|---|---|---|---|
| **① 保下限 + 纵向滚动 + 提示**（推荐）**← 已拍板 D0，执行此条** | 保住了 | 否（要滚 6–112px） | 极低（已有滚动） | 用户要上下拖动看整页 | **采用**。用户的原话是"字看不清"，不是"必须一屏看全"；6px 与 112px 的滚动量在可接受范围 |
| ② 继续缩小到能看全页（= 今天的行为） | 不可读（0.34） | 是 | 0 | 纸面 269px 宽，正文 4.7px，**等于放弃了预览** | 拒绝 |
| ③ 切"单页视图 / 只渲染当前页" | 无改善（单页时页数已是 1，`contentUnitHeight` 就是 1123） | 否 | 中 | 对单页无效果；对本仓（1 页上限是常态）等于空操作 | 不采用 |
| ④ 横向滚动（把纸放到 794 原尺寸再横滚） | 最好 | 否 | 低 | 1092 时纸 794、容器 672 → 要横滚 122px，且纵滚 618>506 | **不做默认**，只作为用户手动 `zoom=1` 时的行为 |

**触底时的界面行为（必须实现，否则用户以为坏了）**：

- 画布右下角显示实际百分比（今天的 `34%` 就在这个位置），触底时改为可点击的胶囊：**`55% · 已到最小可读缩放`**，点开一句 `窗口太窄，可拖动查看整页，或放大窗口 / 收起侧栏`（文案走 `t()`：`responsive.a4.minScaleHint`）。
- 纵向滚动条必须可见（`.resume-wb-canvas-scroll` 已有 `overflow:auto`），并且**不要**为了"整页可见"再去缩 `scale`。
- `zoom` 手动倍数仍然可用（`0.55–3.5`），用户想放大就放大，此时允许横滚。

#### 4.6.4 导出不受影响（已核实，不是推测）

导出走**服务端纯 Python 渲染**：`backend/app/services/pdf_exporter/render.py:10` 用 `fpdf2`，`fit.py` 头部明确写"**这里没有『缩字号把内容塞进一页』这一步**……参数是权威"。前端 `scale` 只是把 iframe 做 `transform: scale()`，**不进入导出链路**。所以本节的任何改动都不会改变导出 PDF 的字节。

#### 4.6.5 单调性判据（可自动化，比单点断言强）

在 480→2560 之间以 8px 步长扫视口宽，**同时**在 560→1440 之间以 8px 步长扫视口高：

- `paperWidth = Math.round(794 × scale)` 必须对**宽和高都单调不降**（容差 1px）；
- `scale ≥ 0.55` 恒成立；
- `scale = 0.55` 时必须 `canvas.scrollHeight > canvas.clientHeight`（否则说明下限没生效、纸被裁掉了）。

### 4.7 投递看板（`/tracker`）

现状（**2026-10-23 补测 768 后更正**）：`tracker-board.css:21` 是 `repeat(5, minmax(130px,1fr))`，但 `tracker-form.css:198` 的 `@media (max-width:900px)` **已经把它改成 2 列**——所以这一行是**死代码**，768 视口实测溢出 **0px**（662px 内容盒 / 2 列 × 325px）。原判断"768–794 溢出 26px 被裁"**不成立**。

本节因此改为**防御性统一**（不是修 bug）：把"列数怎么算"从 `tracker-form.css` 的隐式覆盖搬进 `tracker-board.css` 的显式 `auto-fit`，消除两处规则打架；将来若有人删掉那条 900 断点，也不会退化成溢出。优先级 **P2**。

```diff
- .tracker-summary { grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 12px; }
+ /* 自适应列：130px 是"数字 + 一行标签"的硬下限，改成 token 化的 150px 之后
+    5 列需要的宽度 5×150+4×12 = 798 —— 内容盒 986（1092 视口）仍放得下 5 列。
+    768 视口不是靠这里降到 2 列的（≤900 的 tracker-form.css:198 早已接管），
+    这条只是把决策搬到这里、消除两处规则打架。 */
+ .tracker-summary {
+   grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--rf-stat-min)), 1fr));
+   gap: var(--rf-grid-gap);
+ }
+
+ /* 基线及以上固定 5 列：auto-fit 在 1108 时算出 5 列（5×150+48=798 ≤ 1108），
+     但列宽会到 213 而显得过宽；固定 5 列让 5 张卡等宽铺满。 */
+ @media (min-width: 1366px) {
+   .tracker-summary { grid-template-columns: repeat(5, minmax(0, 1fr)); }
+ }
```

| 视口 | 内容盒 | 结果列数 | 每列宽 | 备注 |
|---|---|---|---|---|
| 2048 | 1790 | 5（固定） | 345 | |
| 1366 | 1108 | 5（固定） | 209 | |
| 1280 | 1030 | 5（`auto-fit`） | 195 | |
| 1092 | 986 | 5 | 188 | |
| 768 | 662 | **2** | 325 | **实测**：≤900 由 `tracker-form.css:198` 接管，溢出 0px |
| 639 | 591 | **2** | 287 | 同上 |

漏斗条 `:66` 已是 `auto-fit minmax(220px)`，不动；`gutter` 改 `var(--rf-grid-gap)`。

### 4.8 求职助手（`/assistant`）

现状：`assistant-layout.css:5` `280px minmax(0,1fr)`；`responsive.css:75` 在 ≤991 转单栏并把历史侧栏压成 `max-height:220px` 的横条。

| 项 | 改动 | 断点 | 预期 |
|---|---|---|---|
| 主栅格 | `responsive.css:75`/`:111` 两块的 `991` → **1092**（归一） | 1092 | 与侧栏折叠同步，规则数量 −1 种 |
| 历史侧栏 | 768–1092：**不**再压成 220px 横条，改为「历史会话」按钮 + `<Drawer size="default">` 包住既有 `ConversationSidebar`（**新增 60 行 `features/assistant/components/ConversationDrawer.tsx`，不改 493 行的 `ConversationSidebar.tsx`**）；≤767 保持现状横条 | 767 / 1092 | 768 高的屏幕上，消息区恢复 220px 的垂直空间 |
| 消息宽度 | `responsive.css:28` `.assistant-message{width:94%}` 只在 ≤575；D 档 720 宽时消息 100% → 加 `max-width: min(100%, 68ch)`（≈ `--rf-prose-max`） | — | 大屏不再出现"一行 60 个字"的长句 |
| 高度 | `assistant-layout.css:7` `min-height: calc(100vh - 116px)`、`:127` `max-height: calc(100vh - 116px)` → 改用 `dvh` 并抽成 `--rf-assistant-h: calc(100dvh - 116px)` | — | 与 `mobile.css` 的 `dvh` 口径一致 |

### 4.9 设置 / 使用指南 / 资料箱 / 知识库 / 技能

| 页面 | 现状 | 改动 | 结论 |
|---|---|---|---|
| 设置 | `modules-layout.css:44/75/304` 都是 `auto-fit minmax(min(100%,300/340px),1fr)` | 仅把 `gap` 换成 `var(--rf-grid-gap)` | **本来就对**，不需要断点 |
| 使用指南 | `base-guide.css` 两栏，`responsive.css:52`（块首 `:45`）在 ≤991 转单栏 | 991 → **1092** | 归一 |
| 资料箱/知识库 | `mobile.css:163` 在 ≤767 转单列；`modules-workspace.css:19/94` `auto-fill minmax(280/300px)` | `gap` 令牌化 | 986 内容盒 → 3 列；662 → 2 列 |
| 技能 | `resume-panels.css:64` `auto-fill minmax(150px)` | 不动 | — |

**这一节的价值是"明确不改"**：执行者容易在这里做无谓改动。上面 3 个"本来就对"的，只改 gap 令牌。

### 4.10 弹窗 / 抽屉内部栅格

- 弹窗宽度用 antd 默认（520 / 640）时不设断点：`mobile.css:168` 已有 `max-width: calc(100vw - 16px)` 兜底。
- **弹窗内两列布局**（`.style-template-editor` `modules-templates.css:84`、`.template-recognition-editor` `:203`）在 900 已转单列，归一为 **1092**（`base` 之前一档），并把 `minmax(320px,460px)` 改为 `minmax(min(320px, 100%), 460px)` —— 否则在 520 宽的弹窗里第二列强制 320px 会把容器撑破。
- **表单双列 → 单列**：`tracker-form.css:198` 的 `900` → `1092`；`resume-panels.css:252` 的 `900` → `1092`。
- **窄高屏**（`≤768` 高）：`--rf-modal-body-max-h` 现为 `calc(100vh − 240px)` = 528；加一档 `@media (max-height: 760px) { :root{ --rf-modal-body-max-h: calc(100dvh - 200px) } }`（P2）。**这是本方案唯一使用高度媒体查询的地方**，理由：1366×768 与 1280×720 的可用高度直接决定弹窗能不能露出底部按钮。

### 4.11 宽表 → 卡片式列表（其他表）

| 表 | 处理 | 优先级 |
|---|---|---|
| 简历中心 | §4.4（`scroll.x` + 卡片回退） | **P1**（优先级等同 P0：1280 下 46% 内容在首屏外、横向滚动条在表体底部看不见） |
| 投递记录（`tracker` 列表） | 已是卡片（`.tracker-list`），无需改 | — |
| **岗位广场（`/jobs`）** | **QA 实测有新发现**：岗位表溢出 188px @1366、462px @1092 → 与简历中心同处方（`fixed:"right"` + `scroll.x`），P1 | **P1** |
| 岗位收藏（`FavoritesPage`） | 已有 `scroll={{x:760}}`（见 `FavoritesPage.test.tsx:168` 注释），不动 | — |
| 面经 / 题库 / 网申记录 | 加 `scroll={{x}}` 保住单元格最小宽（各自 +1 行），**不做卡片回退** | P2 |
| 使用指南/设置里的说明表 | 非数据表，不处理 | — |

---

## 5. 代码改动清单

### 5.0 样式挂载点（**每个新分片都必须登记，否则整份样式不生效**）

`frontend/src/index.css` 是**唯一**的样式聚合入口（23 行 `@import`），而 `base.css` / `modules.css` / `resume.css` / `tracker.css` 都已经是 10–13 行的"纯 `@import` 聚合清单"。

```css
/* index.css 现状顺序（不可随意打乱——@import 顺序就是层叠顺序） */
@import "./theme/design-tokens.css";   /* 1. 令牌最先 */
@import "./styles/base.css";           /* 2. 全局基础（外壳/页头/内容/面板） */
@import "./styles/resume.css";         /* 3. 简历族（含 resume-workbench.css） */
...
@import "./styles/responsive.css";     /* 4. 跨页窄屏覆盖 */
@import "./styles/foundation.css";
@import "./styles/accessibility.css";
@import "./styles/mobile.css";         /* 5. 手机档最后：优先级最高 */
@import "./theme/dark-tokens.css";     /* 6. 主题变量最后覆盖 */
```

**本次新增分片的挂载位置（逐条指定，不要"找地方塞"）**：

| 新文件 | 挂在哪 | 具体写法 | 为什么是这个位置 |
|---|---|---|---|
| `styles/workbench-shell.css` / `-params` / `-canvas` | `styles/resume-workbench.css`（改为聚合清单） | `resume.css:9` 的那一行保持不变：`@import "./resume-workbench.css";`；由 `resume-workbench.css` 内部按 shell → params → canvas → **narrow** 顺序 `@import` | 与 `modules.css`/`base.css` 完全同构；层叠顺序即原文件的段落顺序 |
| **`styles/workbench-narrow.css`** | **必须是 `resume-workbench.css` 聚合清单里的最后一条**（等价于"紧跟 `resume.css` 之后"） | `@import "./workbench-narrow.css";` 放在清单末尾 | 它覆写工作台规则（三档切换 + 抽屉 + 中栏表单列数），**必须晚于** shell/params/canvas 才能赢；放在 `resume.css` 之外会丢掉这个顺序保证 |
| `styles/responsive-narrow.css` | `index.css`，紧接 `responsive.css` **之前** | `@import "./styles/responsive-narrow.css";` 然后 `@import "./styles/responsive.css";` | 窄档覆盖必须能被 `responsive.css` 里的手机档（≤767）继续覆盖；放在它之前才符合"越窄越后" |
| 任何**改 antd 组件**的规则 | 不要新建文件 | 写进既有 `styles/modules-layout.css` 或本分片，并用自定义类做前缀 | `antdOverrideGuard` 只扫 `styles/` 顶层目录（非递归），新建子目录会从守卫视野里消失 |

> 一句话：**新文件 → 必须有一行 `@import` 落进 `index.css`（或其直接子聚合清单）；没写 = 白改。** 这条在 T08/T09 的验收里已作为检查项。

### 5.1 新增文件（全部平铺，`styles/` 下禁止建子目录）

> **禁止建子目录的原因**：`theme/antdOverrideGuard.test.ts:76-84` 的 `collectCssFiles()` 用非递归 `readdirSync`，放进子目录的 CSS 会从守卫视野里消失（等于让 `.ant-*` 覆写失控）。

| 路径 | 行数估计 | SPDX | 说明 |
|---|---|---|---|
| `frontend/src/theme/breakpoints.ts` | 45 | ✅ | 断点单一事实源 |
| `frontend/src/theme/breakpointGuard.test.ts` | 110 | ✅ | 三方对齐 + 棘轮 |
| `frontend/src/hooks/useMediaQuery.ts` | 35 | ✅ | `matchMedia` + jsdom 兜底 |
| `frontend/src/hooks/useResponsiveShell.ts` | 25 | ✅ | 只给 `collapsed` 布尔 |
| `frontend/src/components/shell/AppShell.tsx` | 250 | ✅ | 从 `App.tsx` 抽出的 Sider+Header+Content（T03） |
| `frontend/src/styles/workbench-shell.css` | 75 | ✅ | 工作台分片 1（弹窗外壳/动作条） |
| `frontend/src/styles/workbench-params.css` | 200 | ✅ | 分片 2（三栏/左栏分组/参数行/色块） |
| `frontend/src/styles/workbench-canvas.css` | 110 | ✅ | 分片 3（中栏/画布/纸张） |
| `frontend/src/styles/workbench-narrow.css` | 120 | ✅ | 分片 4：`@supports (container-type: inline-size)` 门控的容器查询（**1233/953**）+ 中栏表单 3→2→1 列 + 降级用原视口断点 |
| `frontend/src/components/resume/WorkbenchPanelsDrawer.tsx` | 130 | ✅ | 参数/内容的 Drawer 外壳 |
| `frontend/src/components/resume/WorkbenchActions.tsx` | 90 | ✅ | 动作条按钮组（折叠/参数/编辑/导出） |
| `frontend/src/pages/resumes/ResumeResultList.tsx` | 70 | ✅ | 表格/卡片的切换器 |
| `frontend/src/pages/resumes/ResumeCardList.tsx` | 150 | ✅ | 窄屏卡片列表 |
| `frontend/src/features/assistant/components/ConversationDrawer.tsx` | 60 | ✅ | 助手历史抽屉 |
| `frontend/src/i18n/messages/zh-CN.responsive.ts` | 60 | ✅ | 新增文案（§5.4） |
| `frontend/src/styles/responsive-narrow.css` | 120 | ✅ | 新增的"窄档覆盖"分片（把 `responsive.css` 里的跨页规则按档整理） |
| `desktop/lib/window-state.js` | 120 | ✅ | 窗口状态读写 + 纯函数 |
| `desktop/scripts/test-window-state.js` | 90 | ✅ | `node --test` 用例（CI 的 `scripts/test-*.js` glob 自动收） |
| `frontend/playwright.responsive.config.ts` | 45 | — | **独立** Playwright 配置（不进默认 `npx playwright test`） |
| `frontend/tests/responsive/overflow.spec.ts` | 130 | — | CI 硬指标（R1/R2/R3） |
| `frontend/tests/responsive/helpers.ts` | 90 | — | 视口矩阵与路由清单 |
| `deliverables/software-company/responsive-20261023/harness/capture.mjs` | 220 | — | 截图 + 指标采集（node + playwright API） |
| `deliverables/software-company/responsive-20261023/harness/rubric.mjs` | 150 | — | 指标 → rubric 判定 |
| `deliverables/software-company/responsive-20261023/harness/report.mjs` | 120 | — | 生成对照页 `report.html` |

### 5.2 修改文件（逐个核过 500 行预算）

| 路径 | 当前行数 | 预计改动 | 改后 | 是否逼近预算 | 需要先拆？ |
|---|---|---|---|---|---|
| `frontend/src/App.tsx` | **455** | −250（抽 MainLayout） | ~205 | 否 | **是 → T03 先抽 `AppShell.tsx`** |
| `frontend/src/styles/base-shell.css` | 174 | −1 / +2 | 175 | 否 | 否 |
| `frontend/src/styles/base-tasks.css` | 115 | ±1 | 115 | 否 | 否 |
| `frontend/src/styles/base-header.css` | 276 | +25 / −18 | 283 | 否 | 否 |
| `frontend/src/styles/responsive.css` | 179 | 数值归一 + 拆出一条 120 行分片 | ~90 | 否 | 否 |
| `frontend/src/styles/mobile.css` | 189 | −6 | 183 | 否 | 否 |
| `frontend/src/styles/tracker-board.css` | 308 | +12 / −2 | 318 | 否 | 否 |
| `frontend/src/styles/resume-workbench.css` | **453** | 变 13 行聚合清单，规则搬进 4 个分片 | 13 | 否（拆分后） | **是 → T08** |
| `frontend/src/styles/assistant-layout.css` | 262 | +6 | 268 | 否 | 否 |
| `frontend/src/styles/modules-templates.css` | **449** | +8（`min(320px,100%)`） | 457 | ⚠️ 距 500 剩 43 | 否，但**本批之后不许再加别的规则** |
| `frontend/src/styles/modules-layout.css` | 442 | +2 | 444 | ⚠️ 距 500 剩 56 | 否 |
| `frontend/src/styles/foundation.css` | 172 | +4 | 176 | 否 | 否 |
| `frontend/src/theme/design-tokens.css` | 172 | +45 | 217 | 否 | 否 |
| `frontend/src/index.css` | 23 | ±2 | 23 | 否 | 否 |
| `frontend/src/components/ResumePreview.tsx` | **424** | +12 / −8 | 428 | 否 | 否 |
| `frontend/src/components/resume-preview/geometry.ts` | 113 | +25 | 138 | 否 | 否 |
| `frontend/src/components/resume-preview/config.ts` | 138 | +18 | 156 | 否 | 否 |
| `frontend/src/components/resume/ResumeZoomModal.tsx` | 279 | +15 / −10 | 284 | 否 | 否 |
| `frontend/src/pages/ResumesPage.tsx` | **469** | +2 / −2（换组件） | 469 | ⚠️ 距 500 剩 31 | 否（只换一个组件名） |
| `frontend/src/pages/resumes/ResumeTable.tsx` | **484** | **+2**（`scroll.x` + `fixed:"right"`） | 486 | ⚠️ 剩 14 | 否，但**只许 +2 行** |
| `frontend/src/pages/home/StatsCards.tsx` | 47 | ±1（`xl`→`lg`） | 47 | 否 | 否 |
| `frontend/src/i18n/messages/zh-CN.ts` | **463** | +3（import + spread） | 466 | ⚠️ 剩 34 | 否 |
| `frontend/src/pages/TrackerPage.tsx` | **449** | 0（纯 CSS 改动） | 449 | — | 否 |
| `desktop/main.js` | **445** | +18 | 463 | ⚠️ 距 500 剩 37 | 否 |
| `frontend/src/pages/resumes/ResumeTable.tsx` 的测试 | 233 | 0 | 233 | 否 | 否 |

### 5.3 顶格文件核对（⚠️ 与交接信息不一致，见附录 B）

交接说「`components/ResumeEditorModal.tsx` 恰好 500 行，`pages/AssistantPage.tsx`、`features/tou-tou/TouTouOrb.tsx`、`services/sites/boss_search.py`、`services/settings_service.py` 顶格」。**实测当前工作树已全部拆完**：

```
160  frontend/src/components/ResumeEditorModal.tsx
395  frontend/src/pages/AssistantPage.tsx
373  frontend/src/features/tou-tou/TouTouOrb.tsx
297  backend/app/services/sites/boss_search.py
306  backend/app/services/settings_service.py
```

对应提交 `4504b2da refactor(frontend): 拆分顶格组件与类型文件`。**本方案不依赖这 5 个文件**，无需为它们先拆。真正需要小心的顶格文件是 **`pages/resumes/ResumeTable.tsx`（484）**、**`pages/ResumesPage.tsx`（469）**、**`i18n/messages/zh-CN.ts`（463）**、**`App.tsx`（455）**。

### 5.4 新增文案（必须走 `t()`）

`i18n/cjkRatchet.test.ts` 按**逐文件**比较基线：给已有 `.tsx` 新增一行中文即红。因此：

1. 所有新增界面文案 → `i18n/messages/zh-CN.responsive.ts`（在 `src/i18n/messages/**` 下，**被棘轮排除**——那是"迁移目的地"），在 `zh-CN.ts` 末尾 `...responsive` 展开。
2. **新文件的注释可以用中文**，但同批必须执行基线再生成（见 §6 通用约束 G3）。

需要的新 key（约 14 条）：

| key | 文案 | 用在 |
|---|---|---|
| `responsive.action.params` | 排版参数 | 工作台动作条（弹窗体 <953，即视口 ≤1000 时出现） |
| `responsive.action.editContent` | 编辑内容 | 工作台动作条（弹窗体 <1233，即视口 ≤1280 时出现） |
| `responsive.drawer.params.title` | 排版参数 | Drawer 标题 |
| `responsive.drawer.content.title` | 内容编辑 | Drawer 标题 |
| `responsive.assistant.history` | 历史会话 | 助手按钮 |
| `responsive.assistant.history.title` | 历史会话 | Drawer 标题 |
| `responsive.resumes.card.meta` | 更新于 {time} | 卡片列表 |
| `responsive.zoom.reset` | 重置为 100% | 设置页（P2） |
| `responsive.zoom.current` | 当前缩放 {value}% | 设置页（P2） |
| `responsive.a4.minScaleHint` | 已到最小可读缩放，可横向滚动查看整页 | 画布（scale 触底时） |
| `workbench.narrow.editor`（**已有，需改文案**） | 原"内容编辑去了哪里" → 改为"点上方「编辑内容」打开" | 与新的可达路径对齐，否则提示指路错误 |

> ⚠️ 改已有 key 的**值**不触发棘轮（它只数字符串所在**文件**的 CJK 行数），但会触发 `userGuideCopyRef.test.ts`（指南引用了界面文案的子串）——改完必须跑那一条。

### 5.5 预算红线自查命令（每批合并前必跑）

```bash
cd D:/ResumeForge
python -m pytest backend/tests/test_file_size_budget.py -q
cd frontend && npx vitest run src/i18n/cjkRatchet src/theme/antdOverrideGuard src/theme/breakpointGuard
```

---

## 6. 实施任务分解（T01–T16 / 5 批）

> **范围已拍板（附录 D 的 D7）：本次一次做完 5 批，不切 MVP。**
> 但"一次做完"只表示**不砍范围**，不表示可以合并提交：仍是**一批一提交**、每批独立可回滚，且**批 3 结束就要出一次 after 截图**（详见附录 D.1 的四条约束）。

### 通用约束（每个任务都适用，不再重复）

- **G1 样式分片**：新增 CSS 必须 ≤500 行/文件；新文件平铺在 `frontend/src/styles/`；首行 `/* SPDX-License-Identifier: Apache-2.0 */`；聚合文件用 `@import` 且必须在任何规则之前。
- **G2 守卫**：`.ant-*` 覆写只能写在本文件自定义类的**后代**选择器里，或加行内 `antd-override: <理由>`。
- **G3 中文棘轮**：新增/移动含中文注释的 `.ts/.tsx` 后，跑
  `cd frontend && $env:CJK_BASELINE_WRITE="1"; npx vitest run src/i18n/cjkRatchet; Remove-Item Env:CJK_BASELINE_WRITE`
  然后 `git diff frontend/src/i18n/i18nBaseline.json` **必须只出现文件间搬运、`total` 不变**。`total` 变大 = 你在写不该写的中文，回退。
- **G4 弹层**：`<Drawer>` 只能用 `size=`（禁 `width=`）；`<Modal>` 必须有 `footer=` 或 `okText=`；表单弹层必须 `mask={{closable:false}}`；脏态关闭走 `useDiscardGuard`。
- **G5 不许放宽测试**：任何"为了跑得快"改断言的做法都算失败。
- **G6 I 类不进验收**：`squeeze`（单行 <4 字）这类**与分辨率无关**的既有缺陷见 §1.9——**只在"本批本来就要改的文件"里顺手修**，其余登记不动，**绝不作为 rubric 或 CI 的验收项**。

### 批 1 —— 地基（可独立合并，行为变化仅"侧栏提前到 1092 折叠"）

| ID | 任务 | 文件 | 怎么做 | 验收 | 风险 |
|---|---|---|---|---|---|
| **T01** | 断点单一事实源 | 新增 `theme/breakpoints.ts`、`theme/breakpointGuard.test.ts`；改 `theme/design-tokens.css` | 按 §3.2 落地；`LEGACY` 初值 = 实测 14 种数值逐文件行数 | `npx vitest run src/theme/breakpointGuard` 绿；故意把 `base-header.css` 的 700 改成 701 → 必须红 | 低。纯新增 + 一条测试 |
| **T02** | 外壳令牌化（含 **D6** 的 768 页头修复） | `App.tsx:294-300`、`base-shell.css:79`、`base-tasks.css:113`、`responsive.css:111-121/162-163`、`mobile.css:20/108`、`base-header.css`（+ `.app-header-actions{flex-wrap:wrap}`、`.app-exit-button{flex:0 0 auto}`）、新增 `hooks/useMediaQuery.ts` `hooks/useResponsiveShell.ts` | 按 §3.3 的 diff 逐条替换；`--rf-sider-width`/`--rf-content-pad` 三档；**D6**：页头操作区允许换行、退出按钮不收缩 | 在 1093 与 1092：`sider.width === parseFloat(marginLeft)`；**768×1024：`.app-header` 的 `scrollWidth === clientWidth` 且退出按钮 `rect.right ≤ innerWidth`（D6 新增）**；`npm run typecheck` 绿；`App.test.tsx` `App.shortcuts.test.tsx` 绿 | 中。`collapsed` 从 antd 内部受控改为外部受控 → 必须验证 `.ant-layout-sider-collapsed` 类仍出现（`Sider.js:157` 由 `collapsed` 决定，确认过） |
| **T03** | 抽出 `AppShell` | `App.tsx` → 新增 `components/shell/AppShell.tsx` | 把 `MainLayout` 里的 Sider/Header/Content/Outlet 与品牌区搬走，`App.tsx` 只留 Routes + providers | `App.test.tsx`、`App.shortcuts.test.tsx` 全绿；`wc -l App.tsx` ≈205、`AppShell.tsx` ≈250；**G3 的 `total` 不变** | 中。`registerTaskNavigate`、preload 预热、导游弹窗都在 MainLayout 里，搬错会静默失效 → 搬完必须手点一次侧栏 18 项与快捷键 |

### 批 2 —— 页面栅格（可独立合并）

| ID | 任务 | 文件 | 怎么做 | 验收 | 风险 |
|---|---|---|---|---|---|
| **T04** | 投递看板自适应 | `tracker-board.css:21/66` | 按 §4.7 的 CSS | 768 视口 `/tracker` `main.scrollWidth − main.clientWidth ≤ 1`（现状应为 +26）；1092 与 1366 都是 5 列 | 低 |
| **T05** | 岗位广场 / 首页密度 | `jobs.css:13`、`foundation.css:150`、`modules-home.css:55`、`StatsCards.tsx`（4 处 `Col`） | 按 §4.2 / §4.3 | 768 视口 `/jobs` 筛选行不出横向滚动；1092 与 1366 首页统计卡都是 4 列 | 低 |
| **T06** | 助手 / 指南 / 表单断点归一 | `responsive.css:52/75`、`tracker-form.css:198`、`resume-panels.css:252`、`modules-templates.css:89/215`、新增 `styles/responsive-narrow.css` | `991/900` → `1092`；把跨页规则搬进新分片，`responsive.css` 只留 767 以下的手机覆盖 | `npx vitest run src/theme/breakpointGuard` 绿（LEGACY 条目清零）；1092 视口 `/assistant` 单栏、`/assistant` 在 1093 是两栏 | 中。断点右移 100px 会让 992–1092 这段从"单栏"变"两栏"→ **必须截图比对这一段**（§7 矩阵含 1024） |
| **T07** | 页头紧凑档 | `base-header.css` | 新增 1092 块；删 700 块并把它并入 767（`mobile.css`） | 992 视口页头标题可见字数 ≥12；无横向溢出 | 低 |
| **T08** | 工作台样式分片 | `resume-workbench.css` → 13 行聚合 + 4 分片；`resume.css:9` 的 import 顺序 | **逐字节搬迁**：按文件内 `===== 段落标题 =====` 切 | `git diff --stat` 显示 4 新增 + 1 缩水；`npx vitest run src/theme/antdOverrideGuard` 绿；页面像素级不变（截图 A/B 比对 1440 视口，diff = 0） | 中。`@import` 顺序决定层叠，顺序错了滚动条/边框会变 |

> T08 是批 3 的**前置**：`resume-workbench.css` 453 行，容器查询要 +95 行 → 548，必红。

### 批 3 —— 工作台与画布（可独立合并；**用户可感知的最大变化**）

| ID | 任务 | 文件 | 怎么做 | 验收 | 风险 |
|---|---|---|---|---|---|
| **T09** | 工作台：校验既有两档 + 容器化 + 抽屉化 | `workbench-narrow.css`（新）、`ResumeZoomModal.tsx`、新增 `WorkbenchPanelsDrawer.tsx` `WorkbenchActions.tsx` | **不改 `design.md` 的 1280/1000 数值**，只把判据换成弹窗体宽（1232/952，等价换算）；中栏内部表单加容器查询 3→2→1 列；`showEditor` 改为"渲染进 Drawer 或中栏"；修 F1/F2/F3 | 在 **768 / 1092 / 1280 / 1366 / 1536 / 2048** 六个视口各截一张工作台：<br>· 768（弹窗体 720，<952）：**单栏**，两个抽屉互斥可达<br>· 1092（1044，两栏）：**两栏 + 抽屉**，参数栏不被盖（F1）<br>· 1280（1232，三栏边界）：**三栏**，中栏字段不截断<br>· 1366 / 1536（三栏）：中栏「邮箱」输入框**完整可见**（`scrollWidth ≤ clientWidth`），「跟随模板」不折行<br>· 2048：三栏，纸面 ≥ 700px<br>· 任一档：参数栏 `scrollWidth − clientWidth ≤ 1`（F3）；脏态关 Drawer 弹确认<br>· 480→2560 扫场：`paperWidth` 对宽与高均单调不降（§4.6.5） | **高**。动的是编辑主链；且 `resume-workbench.css` 现状 453 行已超 `design.md` 的 ≤260 线，**必须先做 T08 分片**。保留 `ResumeZoomModal.test.tsx` 的 3 条既有断言语义 |
| **T10** | A4 画布：加下限 + 修高度预算 | `geometry.ts`、`config.ts`、`ResumePreview.tsx`、`workbench-canvas.css`、`geometry.test.ts`（**+8 用例**） | 按 §4.6.1：`Math.max(MIN_READABLE_SCALE, …)` + 高度改容器实测 + `max-height:839px` 折条回收 56px + 触底胶囊提示 | `npx vitest run src/components/resume-preview` 绿；8 条新用例覆盖 §4.6.2 主表 9 行中的 8 行边界；1366 纸面 467±5、1092 纸面 437±5；1092 下 `scale=0.55` 且 `scrollHeight>clientHeight`；导出 PDF 字节不变（`pytest backend/tests/test_pdf_exporter*`） | 中。**实测：`geometry.test.ts` 完全没有覆盖 `fitScale`/`scale`**（现有 4 条只断言多页堆叠）→ 先补用例再改；文件头注释仍写"多页横向并排"（P3 顺手改） |

### 批 4 —— 表与缩略图（可独立合并）

| ID | 任务 | 文件 | 怎么做 | 验收 | 风险 |
|---|---|---|---|---|---|
| **T11** | 简历列表：钉住操作列 + 卡片回退 | `ResumeTable.tsx`（**+2 行**：`scroll={{x:1494}}` 与 `fixed:"right"`）、新增 `ResumeResultList.tsx` `ResumeCardList.tsx`、`ResumesPage.tsx`（换组件） | 按 §4.4；`useMediaQuery(mqMax("narrow"))` | 1536/1366 视口下「操作」列常驻可见（`getBoundingClientRect().right ≤ innerWidth`）且其余列可横滚；768 视口出卡片；`ResumeTable.test.tsx` 绿；`wc -l ResumeTable.tsx` ≤ 495 | 中。`ResumeTable.tsx` 484 → 486，**只剩 14 行余量**；`ResumesPage.tsx` 469 行，只许换组件名 |
| **T12** | 弹层内部栅格 | `modules-templates.css:84/203`、`tracker-form.css:198`、`resume-panels.css:252`、`design-tokens.css`（窄高档） | `minmax(min(320px,100%), 460px)`；窄高屏 `--rf-modal-body-max-h` | 520 宽弹窗内两列不再撑破（`scrollWidth ≤ clientWidth`）；1280×720 下弹窗底部按钮可见 | 低 |
| **T13** | 模板缩略图等比 | `TemplateGalleryModal.tsx:201`、`modules-templates.css:255-275`、`BuiltinStyleGallery.tsx` 的 `THUMB_*` | 用既有 `A4PreviewFrame`（已解析式测量）替换手写 `scale(0.36)` + `margin-left:-143px`；删两条规则 | 8 视口下缩略图**左右都不被裁**（`iframe` 的 `rect` ⊆ 容器 `rect`）；缩略图高度随卡片宽变化 | 低-中。`A4PreviewFrame` 没有上限夹取，缩略图场景需传 `maxHeight` 并确认 `scale ≤ 1` |

### 批 5 —— 桌面与验证（T14 可独立；T15/T16 必须最后）

| ID | 任务 | 文件 | 怎么做 | 验收 | 风险 |
|---|---|---|---|---|---|
| **T14** | Electron 窗口策略 | `desktop/main.js`、新增 `desktop/lib/window-state.js` `desktop/scripts/test-window-state.js` | 按 §2.3：`initialBounds` / `minWidth 1120` / 状态读写 / `zoom-changed` 持久化 + `[0.8,1.5]` 夹取 | `cd desktop && node --test "scripts/test-*.js"` 绿（新用例覆盖 5 条 `clampToWorkArea` 边界）；手动：拉窗口到 1120 宽 → 关 → 开 → 尺寸不变；拔副屏重启 → 窗口回到主屏可见区 | 中。`main.js` 445 行 → 463；`nodeIntegration:false` 不受影响；**不要动 `close` 的 hide-to-tray 语义** |
| **T15** | 截图验证 harness | 新增 `deliverables/.../harness/*.mjs`、`frontend/playwright.responsive.config.ts` | 按 §7；用 `createRequire("D:/ResumeForge/frontend/package.json")` 取 `playwright`（QA 的 `_probe.mjs` 已验证这条路可行） | `node harness/capture.mjs --base http://127.0.0.1:8123` 产出 8×13 张 PNG + `metrics.json` + `report.html`；`node harness/rubric.mjs` 打印每格 PASS/FAIL | 低。**不许放进 `frontend/tests/`（会牵动既有 smoke 体系）** |
| **T16** | CI 门槛 + 收口 | `frontend/tests/responsive/overflow.spec.ts`、`.github/workflows/ci.yml`（在既有 e2e 作业后加一步） | 只跑 R1/R2/R3（无截图、纯断言），8 视口 × 18 路由 | `npx playwright test -c playwright.responsive.config.ts` 绿；**`npx playwright test`（默认配置）运行的用例数不变** | 低。默认 `testDir` 是 `./tests/smoke`（`playwright.config.ts:17`），新配置另起 `testDir`，互不干扰 |

### 依赖图

```
T01 ──┬─> T02 ──> T03
      ├─> T04
      ├─> T05
      ├─> T06 ──> T07
      └─> T08 ──> T09 ──> T10
                        ├─> T11
                        ├─> T12
                        └─> T13
T14（独立）
T09/T10/T11/T12/T13 ──> T15 ──> T16
```

**每批的独立合并条件**：`npm run typecheck` + `npx vitest run`（全量）+ `pytest backend/tests/test_file_size_budget.py` 三项全绿，且该批自己的验收项全过。回滚 = revert 该批，不留半成品（每批内部不跨文件留 TODO）。

---

## 7. 截图验证协议

> 用户的原话要求：「改完必须**实际模拟演示 + 截图判断**，**仍然不好看的要返工**」。
> 所以这一节定义的不是"顺手截个图"，而是**可判定、可复跑、会失败**的闭环。

### 7.1 视口矩阵（10 个真实档位：8 个主档 + 2 个回归保护档）

| # | 视口（CSS px） | 对应真实机器 | 所在档 |
|---|---|---|---|
| V1 | 2560×1440 | 4K@150% / 2560@100 | A |
| V2 | 2048×1280 | **用户的 2560×1600@125%** | A |
| V3 | 1920×1080 | 1080p@100 / 4K@200 | A |
| V4 | 1536×864 | **1080p@125%（最常见）** | B |
| V5 | 1440×900 | **Electron 默认窗口 / MacBook Air** | C |
| V6 | 1366×768 | **用户底线 / 1080p@—** | C |
| V7 | 1280×720 | **1080p@150%** | D |
| V8 | 1092×614 | **1366×768@125%** | D（最窄） |
| V8b | 960×600 | Electron 1440 窗口 @150% 缩放 | E（回归保护） |
| V8c | 768×1024 | 平板竖屏 | E |

`deviceScaleFactor` 只影响截图清晰度，**不影响布局**：指标采集统一 `deviceScaleFactor: 1`；另出一份 `2` 的"观感图"供人工看（PDF/高分屏用户看到的锐度）。

### 7.2 页面 / 场景清单（13 个）

| # | 场景 | 入口 | 前置数据 |
|---|---|---|---|
| P1 | 首页 | `/` | sample |
| P2 | 岗位广场（列表 + 筛选行） | `/jobs` | sample |
| P3 | 岗位详情抽屉 | `/jobs` → 点第一行 | sample |
| P4 | 简历中心（表格） | `/resumes` | sample |
| P5 | 简历工作台 · 三栏/两栏/单栏 | `/resumes` → 「预览」→ 制作台 | sample |
| P6 | 投递看板（统计卡 + 漏斗 + 列表） | `/tracker` | sample |
| P7 | 求职助手（含历史侧栏） | `/assistant` | sample |
| P8 | 设置（卡片网格） | `/settings` | — |
| P9 | 我的资料（表单双列） | `/profile` | sample |
| P10 | 使用指南（两栏 → 单栏） | 侧栏「使用指南」 | — |
| P11 | 模板一览（缩略图网格） | `/resumes` → 版式一览 | sample |
| P12 | 生成简历弹窗 | `/resumes` → 「新建」 | sample |
| P13 | 助手浮窗卡（右下） | 点悬浮球 | — |

### 7.3 数据准备（一条命令，可重复）

```bash
# 幂等：已存在同 seed_version 的示例数据集时直接复用（backend/app/services/sample_dataset.py 的约定）
curl -X POST http://127.0.0.1:8123/api/settings/datasets/sample/load
```

覆盖：岗位、简历、投递记录、资料箱、知识库、面经/题库、网申资料（`sample_dataset.py:38-46` 的 import 清单）。**这是唯一允许的播种方式**——手搓数据会让"每行字数"这类指标失去可比性。

### 7.4 采集的量化指标（每格一份 JSON）

在页面里 `page.evaluate` 采集，全部是**可断言的数字**：

**定级口径（写进脚本，不靠人工判）**：

```
overflowPx > 1 且 祖先链无 auto/scroll  → P0（内容丢失，必须修）
overflowPx > 1 且 祖链有 auto/scroll    → P1（能到达，登记 + 需要提示）
overflowPx ≤ 1                          → 通过
```

> 这条口径来自一次真实的误判：`/resumes` 的表格在 1280 视口超出 `.app-main` 472px，但它的父级 `.ant-table-content` 是 `overflow-x:auto`，所以是 **P1（要横滚）**而不是 P0（内容丢失）。**没有这条口径，每次评审都要人工复核一遍。**

| id | 指标 | 计算 | 期望 |
|---|---|---|---|
| `docOverflow` | 文档级横向溢出 px | `document.documentElement.scrollWidth − innerWidth` | ≤ 1。⚠️ **这一列今天就已经全绿**（`.app-content{overflow-x:hidden}` 把溢出裁掉了），**不能单独作为 R1 的判据**，必须配 `offenders`/`hiddenPx` 一起看 |
| `mainOverflow` | 内容区横向溢出 px | `main.scrollWidth − main.clientWidth` | ≤ 1 |
| `clipped[]` | **真的丢了**的文本容器（P0） | `scrollWidth > clientWidth + 1` 且 `overflow-x` ∈ {hidden, clip} **且祖先链上不存在 `auto`/`scroll`** | 空 |
| `scrollable[]` | **能滚到**的溢出（P1） | `scrollWidth > clientWidth + 1` 且祖先链（含自身）存在 `overflow-x ∈ {auto, scroll}` | 允许存在，但必须**逐条登记**（今天只有 `.ant-table-content` 与助手会话列表） |
| `dimmed[]` | 有横滚但**没有视觉提示**的容器 | 命中 `scrollable` 且其右缘没有 `mask-image` 渐变或固定列 | 空（否则用户不知道右边还有内容） |
| `outOfViewport[]` | 越界元素 | `rect.left < −1 || rect.right > innerWidth + 1`，排除 `position:fixed` 与 antd 门户（`.ant-drawer`, `.ant-modal-root`, `.ant-tooltip`） | 空 |
| `overlaps[]` | 控件重叠 | 对可见 `<button>, <a>, input, .ant-select` 两两求交，面积 > 4px² 且不相邻（非父子） | 空 |
| `prose[]` | 正文列宽 | 对选择器表 `[.assistant-message, .app-content p, .rf-prose, .ant-typography]` 取 `clientWidth` 与 `fontSize` | `width ≥ 280`；`width / fontSize ≥ 8`（中文 8 字/行） |
| `toolbarLines[]` | 工具栏换行 | 对 `[data-rf-toolbar]` 内每个控件取 `rect.top`，统计 distinct 值 | 1 行；`data-rf-wrap="1"` 的除外 |
| `gridGapDelta` | 卡片间距一致性 | 同一网格内相邻卡片 `gap` 实测值的极差 | ≤ 4px |
| `a4` | 画布缩放 | `纸面 rect.width / 794`、`paper.width` | 见 §4.6 边界表 |
| `emptyRight` | 大屏右侧空白 | 内容区最右元素 `rect.right` 到 `main.rect.right` 的距离 | ≥1920 时 ≤ 320（防止"全挤左边"） |

### 7.5 目视 rubric（7 + 1 条，全部可判定）

| # | 判据 | 判定方式 | 档 |
|---|---|---|---|
| **R1** | 页面没有横向滚动条，且**溢出可被解释** | `docOverflow ≤ 1 && mainOverflow ≤ 1` **且** 每个 `offenders` 命中项都能在其祖链上找到 `auto/scroll`（= P1 横滚）或已登记为 I 类 | A–E 全档 |
| **R2** | 没有被裁掉的内容 | `clipped` 为空 | A–E |
| **R3** | 控件不重叠、不出屏幕 | `overlaps` / `outOfViewport` 为空 | A–E |
| **R4** | 正文可读：任一正文容器 ≥280px，且每行中文 ≥8 字 | `prose` 全项达标 | A–E |
| **R5** | 同组按钮不换行（除标注 `data-rf-wrap`） | `toolbarLines` 全为 1 | A–D |
| **R6** | 同一网格内卡片间距差 ≤4px | `gridGapDelta ≤ 4` | A–E |
| **R7** | A4 纸面可辨：`scale ≥ 0.55` 且纸面宽 ≥437px | `a4` | A–E |
| **R8**（附加） | 大屏不空：≥1920 时正文单行 ≤900px，或列数已增加 | `prose[i].width ≤ 900` ∨ `emptyRight ≤ 320` | A |

**"好看"的兜底判据**（主观项的最小化）：一张截图若 R1–R7 全过，就认为"能用"；**"好看"额外要求**：同屏同组元素左边缘对齐（同一 `left` 值，容差 1px），且垂直节奏落在 8px 网格上（相邻块间距 ∈ {8,12,16,20,24,32}）。这两条由 `report.mjs` 额外输出一列"对齐偏差"，供人工扫一眼。

### 7.6 返工闭环（谁判 / 怎么回 / 几轮）

```
T15 产出 PNG + metrics.json + report.html
      │
      ├─ 机器判定（rubric.mjs）：R1–R7 → 任何 FAIL 直接判不通过
      │        └─ 归因表：FAIL 项 → 必回任务
      │             R1/R2 → T04/T06/T09/T11（按页面归属）
      │             R3     → T09（抽屉/覆盖层）
      │             R4     → T10（画布）/ T06（正文列）
      │             R5     → T05 / T07
      │             R6     → T02（gap 令牌）
      │             R7     → T10
      │
      └─ 人工判定（QA 出报告 + 用户拍板）：主观项 → 写成"哪一屏、哪个元素、差多少"
               └─ 回对应任务，**最多 2 轮**；第 3 轮仍不过 → 停下来问用户
                  （说明"这条判据本身可能需要改"，而不是无限返工）
```

**判定责任人**：机器部分由 CI 与人各跑一次（结果应一致）；主观部分由 **QA 出报告 → 主理人汇总 → 用户拍板**。执行者不得自己宣布"好看了"。

### 7.7 回归门槛（哪些进 CI，哪些留人工）

> **验收形态已拍板（附录 D 的 D5）：一律跑打包同源 `http://127.0.0.1:8123`**，不用 dev 5173。理由：那才是用户双击打开的形态；dev 注入了 code-inspector 等插件，截图与实际发行版不一致。

| 项 | 进 CI | 理由 |
|---|---|---|
| R1 / R2 / R3（8 视口 × 18 路由） | ✅ `frontend/tests/responsive/overflow.spec.ts` | 纯断言、无截图、单次约 40s |
| R6（gap ≤4px） | ✅ 同一 spec 里对 5 个主要网格断言 | 便宜且客观 |
| R1–R8 的**截图**比对 | ❌ 留人工 | 截图 diff 会被字体渲染/抗锯齿噪声淹没，维护成本 > 收益 |
| R4 / R5 / R7 / R8 | ⚠️ 只在 `harness` 里跑并出报告，不进 CI 断言 | 依赖真实数据与弹层交互，进 CI 会变脆 |

**CI 接入方式（不新建作业，避免重复下载运行时）**：在 `.github/workflows/ci.yml` 的 `Browser smoke (Playwright)`（`:244`）之后加一步：

```yaml
      - name: Responsive layout gate (8 viewports)
        working-directory: frontend
        env:
          SMOKE_FRONTEND_URL: "http://127.0.0.1:8123"
        run: npx playwright test -c playwright.responsive.config.ts
```

> **为什么不复用默认配置**：`playwright.config.ts:17` 的 `testDir` 是 `./tests/smoke`，且既有用例的断言是在 1200px 下校准的。把 10 视口矩阵塞进默认配置，会让**页面加载次数从 18 路由 × 3 视口 = 54 次涨到 18 × 10 = 180 次**（`ui-quality.spec.ts` 现在就是这个循环结构），并让"冒烟"这个词失去意义。

> **为什么不放 `scripts/` 或 `deliverables/` 下跑断言**：`@playwright/test` 只装在 `frontend/node_modules`（根目录没有 `package.json`，实测），测试文件放在 `frontend/` 之外会导致模块解析失败。QA 的 `_probe.mjs` 用 `createRequire("D:/ResumeForge/frontend/package.json")` 绕过了这一点——**探针可以这么干，CI 门槛不要这么干**（脆弱且不可移植）。

### 7.8 截图产物布局

```
deliverables/software-company/responsive-20261023/
├── PLAN.md                     ← 本文
├── AUDIT.md                    ← QA 的现状审计（附录 A 引用）
├── screenshots/
│   ├── before/                 ← 改造前（QA 采集）
│   ├── after/                  ← 改造后 T15 产出
│   │   ├── V2-2048x1280/P06-tracker.png
│   │   └── ...
│   ├── metrics.json            ← 全部指标
│   └── report.html             ← 对照页（左 before / 右 after / 下指标表）
└── harness/{capture,rubric,report}.mjs
```

---

## 8. 风险与回滚

### 8.1 主要风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R-1 | `collapsed` 改为外部受控后，antd 内部 `onCollapse('responsive')` 链路断掉，某些既有测试依赖它 | 中 | 中 | T02 里保留 `onBreakpoint` 不用、只改 `collapsed`；跑 `App.test.tsx` / `App.shortcuts.test.tsx` / `ui-quality.spec.ts` |
| R-2 | 断点右移 100px（991→1092）让 992–1092 从单栏变两栏，那段宽度下的排版没被验证过 | 高 | 中 | §7 矩阵含 1024 与 1092 两档；批 2 单独截这一段 |
| R-3 | `@container` 在 Electron 内置 Chromium 上的行为差异 | 低 | 高 | Electron 版本见 `desktop/package.json`；上线前在打包态跑一次 P5 场景（§7.2） |
| R-4 | 工作台抽屉改动打断 `ResumeZoomModal.test.tsx` 的 3 条既有断言 | 高 | 中 | 先读那 3 条断言（`:113/114/142/149`），**保留语义**：折叠=中栏不占栅格；隐藏=只读宿主；预览-only=无参数栏 |
| R-5 | A4 缩放算法改动后视觉行为变化（纸变大/触底不再缩）超出预期 | 中 | 中 | `geometry.test.ts` 现在**没有**覆盖 `fitScale`，所以不会红——这既是安全（不用改断言）也是风险（改了没人拦）。缓解：先补 6 条边界用例（T10 第一步），再改算法 |
| R-6 | 中文棘轮在"抽文件"时变红 | 高 | 低 | G3 流程；`total` 必须不变 |
| R-7 | `modules-templates.css`（449）与 `modules-layout.css`（442）本批后接近预算 | 中 | 低 | 本批只加 ≤8 行；后续任何新增先进 `responsive-narrow.css` |
| R-8 | 桌面 `window-state.json` 写失败（磁盘满/只读）导致启动崩溃 | 低 | 高 | `writeWindowState` 必须 try/catch 静默；`readWindowState` 任何异常返回 `null` |
| R-9 | 用户在 125%/150% 缩放之间来回切，窗口尺寸记忆把"物理尺寸"记成"CSS 尺寸" | 中 | 低 | 只记 DIP（Electron 原生单位），不记物理像素；`zoomFactor` 单独记 |

### 8.2 回滚

- **按批回滚**：每批一个独立 commit 序列，`git revert <batch>` 即可；批内不留半成品。
- **行为开关**：只有两个值得留开关，都用 CSS 变量（不是代码分支）：
  - `--rf-a4-max-fit`（1 = 保持现状的"永不放大"，1.35 = 大屏放大）
  - `--rf-sider-width`（改回 `200px` 常量即可回到"永不折叠"）
- **数据无损**：本方案不改数据库、不改 API、不改导出/PDF 链路 → 无需数据回滚。

### 8.3 明确不做的事

| 不做 | 理由 |
|---|---|
| 手机端完整适配 | 用户要的是"桌面 + 浏览器"，1366 是底线；767 以下只保"能用"（`mobile.css` 已有 48px 触控） |
| 重写布局（`position:fixed` 侧栏 → flex/grid 外壳） | 收益小、风险大：`#root{height:100vh;overflow:hidden}`、`.app-main` 是唯一滚动容器、多处 `window.innerHeight` 计算（助手 `calc(100vh − 116px)`、A4 高度预算）都依赖这个结构。令牌化已能达到"单一来源"的目的 |
| 引入 CSS-in-JS / Tailwind / styled-components | 与现状（46 个平铺 CSS 文件 + 9 条样式守卫）冲突，且会让 `antdOverrideGuard` / `colorGuard` / `inlineColorGuard` 失效 |
| 双页并排 / 横向分页 | 用户 2026-10-21 明确改为竖排（`config.ts:13`、`geometry.ts:67`） |
| 用 `clamp()` 做流式字号 | 破坏 4/8 网格（§3.3）；且 `--rf-space-*` 是语义令牌，不能被插值 |
| 暗色主题单独一套断点 | 两套主题共用同一套几何令牌（`dark-tokens.css` 只管颜色） |
| 为 500 行预算新增豁免 | 本方案所有新文件均 ≤250 行；`_EXEMPTIONS` 当前 CSS 部分**已清空**（附录 B），不重新打开 |
| 改 antd `screen` token | 会影响 `Row/Col` 与内部组件的断点计算，第三方行为与官方文档不一致（§3.1） |

---

## 9. 验收清单

> 用法：逐格打勾。`[ ]` 未验；`[x]` 通过；`[!]` 不通过（必须写清"哪一屏、哪个元素、差多少"）。

### 9.1 机器可判（每批合并前）

- [ ] `cd frontend && npm run typecheck` 绿
- [ ] `cd frontend && npx vitest run` 全绿（含 `cjkRatchet` / `antdOverrideGuard` / `breakpointGuard`）
- [ ] `cd backend && python -m pytest tests/test_file_size_budget.py -q` 绿
- [ ] `cd desktop && node --test "scripts/test-*.js"` 绿（T14 后）
- [ ] `cd frontend && npx playwright test -c playwright.responsive.config.ts` 绿（T16 后）
- [ ] `cd frontend && npx playwright test` 用例数与改造前**完全一致**（证明默认配置未被污染）
- [ ] 容器查询守卫：`npx vitest run src/theme/breakpointGuard` 且 `grep -n "container-type" styles/*.css` 命中的文件数 = 2（仅 `workbench-narrow.css` 与模板缩略图所在分片）
- [ ] 工作台参数栏零溢出：8 视口下 `.resume-wb-col-params` 的 `scrollWidth − clientWidth ≤ 1`
- [ ] A4 单调性扫场：宽 480→2560 / 高 560→1440 各步长 8px，`paperWidth` 单调不降且 `scale ≥ 0.55`
- [ ] **I 类未被偷偷算进验收**：`grep -n "squeeze" ` 在 `frontend/tests/responsive/*.spec.ts` 里应**为 0 命中**（I 类只登记，§1.9 / G6）
- [ ] A.1 的 72 行明细可用 `metrics.json` 重跑复现（脚本在 `harness/`），且 `offenders` 总数随视口单调不增

### 9.2 逐档 × 逐页（R1/R2/R3 必须全过；R4–R7 见 rubric）

P5（工作台）除整格打勾外，还须逐行核对 **§4.6.2 主表的 9 行**（`scale` ±0.01、`paperWidth` ±5px）；P4（简历中心）须确认 **「操作」列在首屏可见**（`fixed:"right"` 生效）。

**逐档备注（记录"不算降级但要留痕"的项）**：C 档无；D 档工作台内容栏进抽屉（+1 次点击）、看板列数降档；E 档工作台单栏+抽屉。**I 类（§1.9）一律不在此表内**。

| 场景 \ 档 | V1 2560 | V2 2048 | V3 1920 | V4 1536 | V5 1440 | V6 1366 | V7 1280 | V8 1092 | V8b 960 | V8c 768 |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 首页 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P2 岗位广场 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P3 岗位详情抽屉 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P4 简历中心 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P5 工作台 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P6 投递看板 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P7 求职助手 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P8 设置 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P9 我的资料 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P10 使用指南 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P11 模板一览 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P12 生成弹窗 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| P13 助手浮窗 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

### 9.3 按需求逐条对齐（用户的 6 条诉求）

| # | 用户诉求 | 验收 | 结论 |
|---|---|---|---|
| 1 | 别人机器上排版不乱 | 9.2 全表 R1/R2/R3 无 FAIL | [ ] |
| 2 | 覆盖常见分辨率与系统缩放 | §2.1 的 16 行换算表逐行有对应视口在矩阵里 | [ ] |
| 3 | 桌面与浏览器同等重要 | 桌面：T14 四条验收；浏览器：9.2 全表 | [ ] |
| 4 | 最低 1366×768，以下只要求能用 | C 档（V5/V6）rubric 全过 **且** P5 三栏下中栏「邮箱」不截断、「跟随模板」不折行；D/E 档 R1/R2/R3/R7 全过 | [ ] |
| 5 | 混合策略（元素重排 + A4 等比） | P5 在「三栏 / 两栏 / 单栏」三种形态各一张截图；纸面 **≥437px（可读）** 且对宽高均单调不降（§4.6.5 扫场脚本）；整页可见与否按 §4.6.3 的触底策略验收（允许纵向滚动 + 出现胶囊提示） | [ ] |
| 6 | 截图判断，不好看要返工 | `report.html` 存在、rubric 无 FAIL、返工记录（若有）附在 PR | [ ] |

### 9.4 交付物清单

- [ ] `PLAN.md`（本文）
- [ ] `screenshots/before/`（QA 采集，附录 A 引用）
- [ ] `screenshots/after/` + `metrics.json` + `report.html`
- [ ] `harness/capture.mjs` `harness/rubric.mjs` `harness/report.mjs`
- [ ] `AUDIT.md`（QA 定稿）与 `metrics.json`（8 视口 × 9 页面），且 A.1 的「待回填」全部回填
- [ ] 5 个批次的 PR 链接与各自的验收截图（含 P5 的 6 个视口）

---

## 附录 A：现状证据摘要

> **数据来源与时间**：QA 于 2026-10-23 采集。截图已齐（`screenshots/<viewport>/`，8 档 × 9 页 × 2 种截法 = **144 张**）；`metrics.json` 仍在重写中（写作时只有 4 行），**A.1 里标「实测」的单元格来自已完成的测量，标「待回填」的等 `AUDIT.md` 定稿**。
> 回填规则：只填数字与选择器，不改结论；若数字与正文冲突 → 改正文并在 A.3 记一条。

### A.1 量化问题表（`metrics.json`，72 行 = 8 视口 × 9 页，已实测）

**先讲清字段含义，否则这张表会被读错**（三个坑，都有实际后果）：

| 字段 | 结构 | 它到底在量什么 | 怎么用 |
|---|---|---|---|
| `overflowPx` | 数字 | `document.documentElement.scrollWidth − innerWidth` | ⚠️ **今天 8 个视口全是 0，但这不代表没问题**——`.app-content{overflow-x:hidden}`（`base-tasks.css:114`）把溢出裁掉了，所以文档级永远不溢出。**只看这一列 = 假绿** |
| `offenders[]` | 数组 `{selector, overPx, side, width…}` | 右/左边缘超出**其裁剪祖先**的元素 | 用来定位"谁出去了"；配合下一条判断是 P0 还是 P1 |
| `innerScrollers[]` | 数组 `{selector, clientWidth, scrollWidth, hiddenPx}` | 内部带 `overflow:auto/scroll` 且内容更宽的容器 | **`hiddenPx` 是全表最有说服力的一列**（= 要滚多远）。存在这条 → 该处是 **P1**（能滚到），不存在但 `offenders` 命中 → **P0**（真丢了） |
| `squeeze{count,samples}` | 对象（**不是数组**，取 `.count`） | 单行文字被压到 <4 字/行的容器 | 见 **§1.9**：这一列与分辨率**无关**，不是本次 KPI |
| `clipped{count,samples}` | 对象（同上） | 文本被 `overflow:hidden` 真裁掉 | 8 个视口全为 0 ✅ |
| `vertical.forcedScroll` | 布尔 | **文档**是否被迫纵向滚 | 恒 `false`（因为 `.app-main` 才是滚动容器） |
| `vertical.inner.forcedScroll` | 布尔 | `main#main-content` 是否被迫纵向滚 | ⚠️ **长页面必然为 true，不是缺陷**。8 档 9/9 或 3/9 只是"页面高矮"差异，**不要当问题修** |
| `containerWidths` | 对象 | `sider / main / header` 的实测宽 | 实证"1092 视口下 sider 仍是 200px"（`main.clientWidth = 882`） |

**每视口汇总（本表数字由 `metrics.json` 现算，可复算）**：

| 视口 | overflowPx>1 的页面数 | offenders 总数 | squeeze 总数 | clipped | 最大 `hiddenPx` | 出现位置 |
|---|---|---|---|---|---|---|
| 1092 | 0 | **3** | 21 | 0 | **660** | `/resumes` 表格 |
| 1280 | 0 | 2 | 22 | 0 | 472 | `/resumes` 表格 |
| 1366 | 0 | 2 | 24 | 0 | 386 | `/resumes` 表格 |
| 1440 | 0 | 2 | 24 | 0 | 312 | `/resumes` 表格 |
| 1536 | 0 | 2 | 24 | 0 | 216 | `/resumes` 表格 |
| 1920 | 0 | **0** | 23 | 0 | **47** | 工作台参数栏 |
| 2048 | 0 | 0 | 23 | 0 | 47 | 工作台参数栏 |
| 2560 | 0 | 0 | 23 | 0 | 47 | 工作台参数栏 |

**这张汇总表一眼能看出三件事**（也是 A.1 的三条最严重实证）：

1. **`offenders` 随视口单调收敛到 0（1092:3 → 1920:0），`hiddenPx` 从 660 降到 216** —— 这是**真·分辨率问题**，正是本方案的主战场（§4.3 / §4.4）。
2. **到 1920 以上，唯一残留的溢出是工作台参数栏的 47px**（`clientWidth 339 / scrollWidth 386`）—— 它在**全部 8 个视口都一样**，连 2560 也不消失。→ 它不是分辨率问题，是**内在缺陷**（§4.5.5 F3、§1.9）。
3. **`squeeze` 从 1092 到 2560 恒定在 21–24，`clipped` 恒为 0** —— 挤压（单行 <4 字）与宽度/缩放**无关**，改造前后都会存在。→ **§1.9 单独立项，不进本次 KPI**。

**新发现（本文原本漏了）**：`/jobs` 也有一张宽表，同样溢出——**188px @1366、462px @1092**（`offenders` 命中 `div.ant-table-content > table`）。§4.11 的宽表清单已补上它。

### A.1.1 逐视口 × 逐页明细（72 行）

<!-- A1-DETAIL-START -->

| 视口 | 页面 | overflowPx | offenders | squeeze | clipped | 最大 hiddenPx |
|---|---|---|---|---|---|---|
| 1092 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 1092 | 岗位广场 | 0 | 1 | 0 | 0 | 496 |
| 1092 | 简历中心 | 0 | 1 | 2 | 0 | 660 |
| 1092 | 工作台 | 0 | 0 | 3 | 0 | 660 |
| 1092 | 投递台 | 0 | 1 | 4 | 0 | 46 |
| 1092 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 1092 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 1092 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 1092 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 1280 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 1280 | 岗位广场 | 0 | 1 | 0 | 0 | 308 |
| 1280 | 简历中心 | 0 | 1 | 2 | 0 | 472 |
| 1280 | 工作台 | 0 | 0 | 3 | 0 | 472 |
| 1280 | 投递台 | 0 | 0 | 5 | 0 | 0 |
| 1280 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 1280 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 1280 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 1280 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 1366 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 1366 | 岗位广场 | 0 | 1 | 0 | 0 | 222 |
| 1366 | 简历中心 | 0 | 1 | 2 | 0 | 386 |
| 1366 | 工作台 | 0 | 0 | 3 | 0 | 386 |
| 1366 | 投递台 | 0 | 0 | 7 | 0 | 0 |
| 1366 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 1366 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 1366 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 1366 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 1440 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 1440 | 岗位广场 | 0 | 1 | 0 | 0 | 148 |
| 1440 | 简历中心 | 0 | 1 | 2 | 0 | 312 |
| 1440 | 工作台 | 0 | 0 | 3 | 0 | 312 |
| 1440 | 投递台 | 0 | 0 | 7 | 0 | 0 |
| 1440 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 1440 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 1440 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 1440 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 1536 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 1536 | 岗位广场 | 0 | 1 | 0 | 0 | 52 |
| 1536 | 简历中心 | 0 | 1 | 2 | 0 | 216 |
| 1536 | 工作台 | 0 | 0 | 3 | 0 | 216 |
| 1536 | 投递台 | 0 | 0 | 7 | 0 | 0 |
| 1536 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 1536 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 1536 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 1536 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 1920 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 1920 | 岗位广场 | 0 | 0 | 0 | 0 | 0 |
| 1920 | 简历中心 | 0 | 0 | 2 | 0 | 0 |
| 1920 | 工作台 | 0 | 0 | 3 | 0 | 47 |
| 1920 | 投递台 | 0 | 0 | 6 | 0 | 0 |
| 1920 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 1920 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 1920 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 1920 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 2048 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 2048 | 岗位广场 | 0 | 0 | 0 | 0 | 0 |
| 2048 | 简历中心 | 0 | 0 | 2 | 0 | 0 |
| 2048 | 工作台 | 0 | 0 | 3 | 0 | 47 |
| 2048 | 投递台 | 0 | 0 | 6 | 0 | 0 |
| 2048 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 2048 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 2048 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 2048 | 投递看板 | 0 | 0 | 5 | 0 | 0 |
| 2560 | 首页 | 0 | 0 | 3 | 0 | 0 |
| 2560 | 岗位广场 | 0 | 0 | 0 | 0 | 0 |
| 2560 | 简历中心 | 0 | 0 | 2 | 0 | 0 |
| 2560 | 工作台 | 0 | 0 | 3 | 0 | 47 |
| 2560 | 投递台 | 0 | 0 | 6 | 0 | 0 |
| 2560 | 求职助手 | 0 | 0 | 0 | 0 | 0 |
| 2560 | 设置 | 0 | 0 | 1 | 0 | 0 |
| 2560 | 使用指南 | 0 | 0 | 3 | 0 | 0 |
| 2560 | 投递看板 | 0 | 0 | 5 | 0 | 0 |

<!-- A1-DETAIL-END -->

> **回填口径**：本表由 `metrics.json` 生成，**重跑即可刷新**（脚本见 §5.1 的 `harness/`）。`AUDIT.md` 定稿后，若它给出的 `offenders` 明细比本表更细（例如带修复建议），只补注在 A.3，不改本表数字。

### A.2 截图索引

| 视口档 | 目录 | 页数 × 截法 | 文件命名 | 对应本文档位 |
|---|---|---|---|---|
| 2560×1410 | `screenshots/2560/` | 9 × 2 = 18 | `<page>-full.png`（整页）/ `<page>-viewport.png`（首屏） | A |
| 2048×1280 | `screenshots/2048/` | 18 | 同上 | A（用户机） |
| 1920×1080 | `screenshots/1920/` | 18 | 同上 | A |
| 1536×864 | `screenshots/1536/` | 18 | 同上 | B |
| 1440×861 | `screenshots/1440/` | 18 | 同上 | C（Electron 默认） |
| 1366×768 | `screenshots/1366/` | 18 | 同上 | C（底线） |
| 1280×720 | `screenshots/1280/` | 18 | 同上 | D |
| 1092×614 | `screenshots/1092/` | 18 | 同上 | D（最窄） |

页面清单（9）：`home` `jobs` `resumes` `workbench`（工作台弹窗打开态）`apply` `assistant` `settings` `guide`（使用指南弹窗）`tracker`。
另有工作台单页探针 `_probe-wb-{1092,1280,1366,1440,1536,1920,2048,2560}.png`（8 张，同尺寸对比用）。

### A.3 本文判断被实测**推翻或细化**的点（可信度来源，逐条改过正文）

| # | 本文早期判断 | 实测结果 | 处置 |
|---|---|---|---|
| 1 | §1.2 原写「三栏把画布压到 0.41，正文 5px」（按**宽度**推算） | 1092 实测 **0.34**，且是**高度**造成（`0.62×innerHeight` 低估容器 69px） | **已重写 §1.5**：新增 G2（高度预算取错来源）与"高度才是主约束"三行对比表；`0.41` 与"宽度决定"的说法已删除 |
| 2 | §4.4 原写「表格单元格被压到 60–80px、中文竖排」 | 实测表格宽**恒定 1494**（10 列都带显式 width），列宽没变，是**整表横滚** | **已重写 §4.4**：降级 P0→**P1**；补 §7.4 的"能滚到 vs 真丢失"判定口径；并更正"不要写 `scroll={{x:900}}`" |
| 3 | §4.5 原建议「三栏阈值上移到 1566/1166，用纸面等宽解方程」 | 实测 **1536 上中栏同样挤**（每字段 ≈115px）→ 不是阈值问题，是**中栏 400px 装不下 3 列表单** | **已重写 §4.5**：阈值不动（1280/1000 → 容器等价 1233/953），改为"中栏内部表单容器查询 3→2→1 列"；原 D0 决策作废 |
| 4 | §1.2 原写「工作台三栏最小 620 + 画布 437 = 1057，视口 <1105 会溢出」 | 实测**从不溢出**（≤1280 已转两栏） | 已改为"真实后果不是溢出而是纸被压小 + 中栏表单被挤坏" |
| 5 | §5.2 原以为 `ResumeTable.tsx` +1 行即可 | 需要 `scroll.x:1494` **且** `fixed:"right"`（+2 行） | 已更正为 484 → 486，并标注"只剩 14 行余量" |

| 6 | 本文隐含地把 `squeeze`（单行 <4 字）当成"窄屏适配问题"（rubric R4 原本会把它算进去） | 实测 `squeeze` 在 8 档恒定 **21/22/24/24/24/23/23/23**，在 2560 上与 1366 完全相同 | **新增 §1.9**：按"同一 selector 在 2048 与 1366 是否都命中"区分 I 类/R 类；**I 类排除出 rubric 与 CI**（§6 G6），只登记 |
| 7 | §4.7 原写「768–794 视口下 `.tracker-summary` 5 列溢出 **26px** 被裁」（按 `5×130+4×12=698` 推算，标着"待确认"） | **768 实测溢出 0px**：`tracker-form.css:198` 的 `@media (max-width:900px)` 早已把它改成 2 列（662px 内容盒 / 2 列 × 325px），`tracker-board.css:21` 的 5 列是**死代码** | **已重写 §4.7 与 §1.2 该行**：从"修溢出"降级为 **P2 防御性统一**（把隐式规则搬成显式 `auto-fit`，消除两处打架）；TL;DR 的"会溢出被裁"同步更正 |
| 8 | 原方案未覆盖 768 档（矩阵最窄 1092），默认 `mobile.css` 已兜住 | 768 下 **`.app-header-actions` 宽 702px、`right=798`，被 `.app-header{overflow:hidden}` 裁掉 30px**，「退出」按钮**彻底不可达**（无滚动容器）→ 按判据是 P0 | 登记为 **§2.1 E 档「已知不达标项」**，并注明**桌面壳 `minWidth:1080` 触发不到**、仅浏览器直连 768 或 1080 窗口叠加 140% 缩放时出现；修法一行 CSS（`.app-header-actions{flex-wrap:wrap}` + 退出按钮 `flex:0 0 auto`），列 P2 |

> **768 档的补测结论（2026-10-23 追加）**：`tracker` / `home` / `materials` 三页已补测并写入 `metrics.json`（共 75 组）。**768 视口唯一的 P0 是页头 30px 裁切**（见上表第 8 条）；看板、首页、资料库在 768 下均零横向溢出。A.1 明细表已含这三行。

## 附录 B：与交接信息不一致的四处（已实测更正）

> 这四条会直接导致执行者"去改不存在的问题""以为有豁免可用"或"重复造已有的轮子"，必须先更正。

| # | 交接说法 | 实测（2026-10-23 当前工作树） | 证据 | 影响 |
|---|---|---|---|---|
| B1 | 「`styles/` 下已有 5 个 CSS 存量豁免（`modules.css` 2056 / `base.css` 1039 / `resume.css` 803 / `tou-tou.css` 554 / `tracker.css` 514），豁免册 `_EXEMPTIONS` 共 16 条」 | **CSS 豁免已全部清空**。5 个文件已按 2026-12-31 到期日拆成"聚合清单 + 平铺分片"，`modules.css` 现在只有 **13 行**（纯 `@import`） | `backend/tests/test_file_size_budget.py` 的注释「CSS 豁免清单现为空，与既有 `.ts/.tsx` 一样零豁免」；`wc -l frontend/src/styles/modules.css` = 13 | **新增 CSS 没有任何豁免余地**，必须 ≤500 行/文件；同时**不要**为本次改动登记新豁免（`test_exemptions_only_for_over_budget_files` 会抓"幽灵豁免"） |
| B2 | 「顶格文件：`ResumeEditorModal.tsx` 恰好 500 行，`AssistantPage.tsx`、`TouTouOrb.tsx`、`boss_search.py`、`settings_service.py` 顶格；碰它们之前必须先拆」 | 全部**已拆完**：160 / 395 / 373 / 297 / 306 行 | `git log` 的 `4504b2da refactor(frontend): 拆分顶格组件与类型文件` | 本方案不依赖这 5 个文件，**不需要为它们先拆**。真正的顶格风险在 §5.2 表里 |
| B3 | 「992–1366 这一段几乎没有规则」 | **半对**。整页布局确实没有规则（`@media` 数值清单见 §1.3），但三栏工作台**有两条**：`resume-workbench.css:403`（≤1280 转两栏）与 `:419`（≤1000 转单栏） | 实读 `resume-workbench.css` | 执行者不要"从零加断点"，而是**替换**这两条：问题不是"缺失"而是"用视口值判弹窗宽度"，且 <1000 时把中栏 `display:none` 造成功能不可达（§4.5.5 的 F1/F2） |
| B4 | 「`resume-workbench.css` 是新文件」 | 是新的，但**已经超了它自己的预算**：`design.md:77` 预估 210 行、`:430` 验收 ≤260 行，实测 **453 行**。全局守卫（500）没红，是因为**没人检查 `design.md` 那条 260 线** | `wc -l frontend/src/styles/resume-workbench.css` = 453；`deliverables/software-company/resume-workbench-20261023/design.md:77/430` | 动这个文件之前**必须先分片**（T08）。也给了一条更普遍的教训：**设计文档里的预算如果没有对应守卫，等于没写** |

**另注**：`frontend/playwright.config.ts` 的 `testDir` 是 `./tests/smoke`（7 个 spec、22 处 `test()`、`workers:1`；其中 `ui-quality.spec.ts` 的 3 档视口是一个 `for` 循环），**不是** `frontend/tests/` 根目录。新增响应式用例必须另起配置（§7.7）。

---

## 附录 C：复现与自证命令

```bash
# ---------- 0. 起环境 ----------
# 形态 A（快，dev server 5173，代理 /api → 8000）—— 日常改动用这个
cd D:/ResumeForge && ./start.cmd                # 或分两步：后端 + cd frontend && npm run dev
# 形态 B（权威，同源 8123，与 CI 的 e2e 作业一致）—— 出截图与验收用这个
cd D:/ResumeForge/frontend && npm run build && cd ..   # 由后端同源挂载 dist

# ---------- 1. 播种示例数据（幂等） ----------
curl -X POST http://127.0.0.1:8123/api/settings/datasets/sample/load

# ---------- 2. 三道守卫 ----------
cd D:/ResumeForge/frontend
npx vitest run src/theme/breakpointGuard src/theme/antdOverrideGuard src/i18n/cjkRatchet
cd D:/ResumeForge && python -m pytest backend/tests/test_file_size_budget.py -q

# ---------- 3. 截图与指标 ----------
cd D:/ResumeForge/deliverables/software-company/responsive-20261023
node harness/capture.mjs --base http://127.0.0.1:8123 --out screenshots/after
node harness/rubric.mjs --metrics screenshots/after/metrics.json
node harness/report.mjs --before screenshots/before --after screenshots/after
# 产物：screenshots/after/report.html（浏览器打开逐屏看）

# ---------- 4. CI 门槛（本地复跑） ----------
cd D:/ResumeForge/frontend
npx playwright test -c playwright.responsive.config.ts

# ---------- 5. 桌面壳 ----------
cd D:/ResumeForge/desktop && node --test "scripts/test-*.js"

# ---------- 6. 中文基线再生成（仅在搬运含中文注释的文件后） ----------
cd D:/ResumeForge/frontend
$env:CJK_BASELINE_WRITE = "1"; npx vitest run src/i18n/cjkRatchet; Remove-Item Env:CJK_BASELINE_WRITE
git diff src/i18n/i18nBaseline.json
# 判据：只看得到文件间搬运行，total 行必须与改动前完全相同
```

**手动复现 Electron 的缩放差异**（这是 §1.1 的核心论点，建议执行者亲手验一次）：

1. Windows 设置 → 显示 → 缩放 125% → 用浏览器打开应用 → F12 执行 `innerWidth`（在 1920×1080 上应得 1536）。
2. 同一台机器改成 100% → 重启浏览器 → 再看 `innerWidth`（应得 1920）。
3. 用桌面壳打开同一台机器，`Ctrl+Shift+I` 里看 `innerWidth`（1440 窗口下应始终 ≈1424，与系统缩放无关）。
4. **结论**：同一份代码，网页形态的宽度基准是 1536/1920，桌面形态是 1424。两者必须分别验收。

---

## 附录 D：已拍板的决策（2026-10-23，8 条全部确认）

> **本附录是执行依据。** 下表「决定」列就是最终口径，执行者照做即可，**不要再回来问**。
> 若要变更任何一条：必须显式说明理由，并同步修改「落地位置」列出的**全部**小节（漏一处就会出现文档自相矛盾）。

| # | 决策点 | **决定（已确认）** | 未采用的备选（留档） | 落地位置（改这些地方） |
|---|---|---|---|---|
| **D0** | A4 触底（`scale = 0.55`）之后怎么办 | **保可读 0.55 + 纵向滚动 + 「55% · 已到最小可读缩放」胶囊提示**；矮屏（<840 高）额外收起画布说明条（实测只回收 20px，不是 56px——说明条本身 52 高，折行只能省一行）。落地后**1536 及以下全部触底在 438px**，见 §4.6.2 的实测表 | B 继续缩到 0.34 保整页（正文 4.7px） | §4.6.1 算法、§4.6.2 主表最后一列、T10 验收 |
| **D1** | CSS 1280（=1080p@150%）算不算"要好看" | **只保"能用、不重叠、关键动作 ≤2 次点击"**（D 档）。**返工线仍卡 1366** | B 1280 也要好看（工作量 +30%，且与 1366 标准打架） | §2.1 D 档、§9.2 逐档备注、§7.5 rubric 适用范围 |
| **D2** | 大屏上 A4 要不要放大 | **≥1920 允许 1.35**（`--rf-a4-max-fit`）。**生效条件**：只有"高度允许 > 1.0"的高屏才吃得到——2560×1440 → 纸 **902**（旧的 `Math.min(1,…)` 封顶时是 794）；**2048×1280 受高度限制（0.994），纸仍是 789，两种设置下都一样**。一个变量可回退到 1.0 | A 永远 100% | §4.6.2 首行与"读表要点 3"、T10、设置页（P2） |
| **D3** | 窄屏「内容编辑」抽屉宽度 | **`size="default"` = 378px** | B 736px（1024 下占 72%，会盖住画布）／C 自适应 `min(560, innerWidth-64)` | §4.5.6 三档去向表、T09 |
| **D4** | 桌面壳 `minWidth` | **1120**（`minHeight` 保持 700）。保证窗口再小也不掉进 E 档，同时 1366×768 笔记本仍能拖动窗口 | B 1366（一开窗就贴满全屏） | §2.3.2、T14 |
| **D5** | 截图验收的"权威形态" | **打包同源 8123**（与 CI、与用户双击打开的形态一致） | B dev 5173（快，但注入 code-inspector 等插件） | §7.7 CI 接入、附录 C 复现命令、T15/T16 |
| **D6** | 768 视口页头「退出」被裁 30px（P0-2） | **修**：`.app-header-actions{flex-wrap:wrap}` + `.app-exit-button{flex:0 0 auto}`。**并入 T02，不新增任务**（页头属外壳） | B 只登记不修 | §2.1 E 档"已知不达标项"、T02 验收（**新增** 768×1024 断言） |
| **D7** | 首批交付范围 | **一次做完 5 批（T01–T16）**，不切 MVP | 只做批 1–3／批 1–2 | §6 开头、§9 验收清单 |

### D.1 D7 的执行约束（"一次做完"≠"一次提交"）

1. **仍然一批一提交**：5 个批次 = 5 组可独立回滚的提交序列，不是巨型提交。
2. 每批合并前跑 §5.5 的三道守卫；**批 3 结束就要出一次 after 截图**，不要等批 5。
3. 批 5 的 T16 是最终验收，**它跑完之前不得宣布完成**。
4. "一次做完"不允许并行改同一批文件——同一文件被两个任务同时改，是本仓踩过的坑（2026-10-22 任务板双写）。

### D.2 拍板后仍存在的开放项（不是决策，是执行时才能定的）

| 项 | 为什么现在定不了 | 什么时候定 |
|---|---|---|
| `--rf-a4-max-fit` 的最终数值 | 1.35 按 2048 宽算出；实机若仍显空，可在 **[1.2, 1.45]** 内调 | 批 3 出截图后按 rubric R8 调一次，记进 PR |
| 大屏侧栏是否加宽到 216 | 属 P2，且依赖 D2 的观感结论 | 5 批之后单独立项，不在本次范围 |
| 768 以下的手机档 | 用户要的是"桌面 + 浏览器"，1366 是底线 | 不在范围；只保证 `mobile.css` 现状不回退 |

---

## 附录 E：原始选项留档（已作废，仅供追溯）

> 下表是拍板前的原始选项与建议，**已全部按附录 D 执行**。保留它只有一个用途：日后追溯"当时为什么这么选"。**执行时只看附录 D。**

| # | 决策点 | 选项 | 建议 | 原"不拍板"的后果 |
|---|---|---|---|---|
| **D0** | A4 纸面触底（`scale = 0.55`）之后：**保可读（+ 纵向滚动）** 还是 **保整页可见（继续缩小）**？ | A. 保可读 0.55 + 纵向滚动 + 「55% · 已到最小可读缩放」提示（本方案默认）<br>B. 保整页可见，继续缩到 0.34（= 今天的行为）<br>C. 保可读，但在矮屏（<840 高）额外把画布说明条收起、把 A4 顶到最上 | **A**（C 是 A 的增强，一起做）。用户原话是"字看不清"，不是"必须一屏看全"；1092×614 时 A 的滚动量是 112px，B 的代价是正文 4.7px（等于没有预览） | 执行者不知道触底后该不该继续缩——这会直接决定 §4.6.2 主表的最后一列 |
| **D1** | CSS 1280（= 1920×1080@150%）算不算"要好看"（口径见 §2.1 的"降级只指功能可达性"） | A. 只保证"能用不重叠"（D 档，本方案默认）<br>B. 也要好看（等于把底线从 1366 下移到 1280，工作量 +30%） | **A**。1280 的机器很多，但"好看"的标准在 1280 上会与 1366 打架（1366 是用户明确给的下沿） | 执行者不知道 V7 这一列要返工到什么程度 |
| **D2** | 大屏上 A4 要不要放大（`--rf-a4-max-fit`） | A. 保持 1.0（纸永远 100%）<br>B. ≥1920 视口允许 1.35 | **B**。2048×1280 用户机上，高度允许 0.994、宽度允许 1.55 → 封顶 1 时纸 789px、留白 439px 显得空；放到 1.35 后（2560×1440 档）纸 902px。注意：**在 1280 高的屏上 1.35 基本用不到**（高度先封顶），它主要是给 ≥1440 高的屏用的 | 大屏"显得空"（rubric R8）判不了 |
| **D3** | 工作台在「两栏（弹窗体 952–1231）」与「单栏（<952）」两档，内容编辑进 Drawer（宽 378）够不够 | A. `size="default"`（378px）<br>B. `size="large"`（736px，1024 视口下占 72%）<br>C. 数字宽度 `size={Math.min(560, innerWidth-64)}` | **A**。内容编辑是"逐字段改"，378 与当前 360 的中栏宽度几乎一致，用户不会感到变化 | 选太大 → 窄屏上 Drawer 把画布完全盖住，看不到"改完什么样" |
| **D4** | 桌面壳 `minWidth` 定 1120（允许掉进 D 档）还是 1366（永不掉档） | A. 1120（本方案默认）<br>B. 1366 | **A**。1366×768 笔记本的工作区只有 1366×728，`minWidth:1366` 会让窗口一开就贴满、无法拖动 | 小屏笔记本用户抱怨"窗口不能缩小" |
| **D5** | 验证 harness 的"权威形态"用 dev（5173）还是同源打包（8123） | A. 8123（与 CI 一致，多花一次 build）<br>B. 5173（快，但 dev 注入了 code-inspector 等插件） | **A**。用户看到的形态是打包态；截图必须与她看到的一致 | 截图与实际发行版不一致 → 验了等于没验 |
