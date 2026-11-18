# 简历制作台小步改进与缺陷清单（QW-1 — QW-7 / DF-1 — DF-10）

> **历史记录（2026-11-18 快照）**：本文描述当时的判断、落点与验收标准，不保证与后续代码一致；五项完成或方案变更后应更新或归档。

> 日期：2026-11-18。代码基线 `509c28d0`。
> 来源：从 `resume-workbench-wordlike-plan-20261118.md`（W01—W19）中筛出的**不依赖段落身份、不升格式协议、不改分页/单位语义**的项。
> 用途：可直接交给新对话开工。每项独立交付、独立回退，**不需要 feature flag**。
> 本文只描述"做什么 / 怎么验收"，不代表已经实施。

## 0. 先看这段：范围边界

**本清单刻意不碰**：段落身份（W03）、pt/mm 绝对单位（W04）、标尺（W08）、Proview 辅助视图（W09）、四档工作区模式（W13）、版面优化器（W15）、属性面板整体重构（W02）。

原因：这些项共享同一个地基——`content` schema 与 `format_config` 协议版本。开工就必须走完，中途停下会同时存在两套格式语义。原计划因此已整体搁置。

**所以**：本清单全部做完，用户**仍然不能**"只把第二段字号改成 11 pt"。这是刻意的取舍，不是遗漏。实施时不得以"顺手"为由引入段落级或绝对单位能力。

## 1. 总览（按建议实施顺序）

| 编号 | 名称 | 用户症状 | 主要改动面 | 风险 |
|---|---|---|---|---|
| QW-1 | 顶栏撤销/重做按钮 | 能力存在但看不见，只能靠快捷键 | 2 个前端文件 + 语言包 | 低 |
| QW-2 | 保存结果说诚实 | 版式成功提示先弹，正文可能失败 | 1 个 hook + 动作栏 + 文案 | 低 |
| QW-3 | 旧分页规则可见可清 | "这页莫名被推下去"无法解释也无法关闭 | 汇总条 + 收集函数 | 低 |
| QW-4 | 全局字号精确输入 | 只能拖滑杆，调不准 | 1 个控件 | 低 |
| QW-5 | 会话草稿恢复 | 关掉/刷新就丢，只有手动保存 | 新增 hook + 恢复条 | 中 |
| QW-6 | 基本信息字段名/值可逐字段调参 | 基本信息只能整体调，改不了单个字段 | 纸面拆段 + 前后端白名单 + 面板作用域 | 中 |
| QW-7 | 纸面缩放更精细、更丝滑 | 滚轮每一下跳 10%+，且以左上角为中心，看着"跳" | 缩放 hook + 滚动锚点补偿 | 中 |

前四项合计约 300 行，可当天分四个提交交付。QW-5 建议单独排期；QW-6 要同时改纸面规划与前后端白名单，建议单独一次交付，不要和其他项混在一个提交里。

另有 10 项缺陷，均与 QW 各项无依赖，可以最先做：**DF-1（P0）** 划词浮条压住随后弹出的卡片，**DF-2（P1）** 行内格式右键菜单点击外部难以关闭，**DF-3（P1）** 该菜单的落点总在光标上方，**DF-4（P1）** 应用行内格式后选中会出现一条"空蓝带"，**DF-5（P2）** 工具条颜色按钮恒显红块，**DF-6（P1）** 行内标记的源串在只读展示里直接露出来，**DF-7（P1）** 左栏滑杆与表单行不随栏宽连续变化，**DF-8（P1）** 字段级"缩进"在草稿里不生效（PDF 却生效），**DF-9（P1）** "清除行内格式"对拖选的可见文字无效，**DF-10（P1）** 新建的条目自定义字段没有名字入口、chip 上直接显示内部键。前四条 + DF-9 都在行内格式这一带，建议同批修；其余可独立做。详见 §4。

---

## 2. 逐项说明（QW-1 — QW-7）

每条都按「症状 / 现状证据 / 要做 / 不做 / 落点 / 可观察验收」六段写；实施时不要跳过"不做"那一段。

### QW-1 顶栏撤销/重做按钮

**症状**：撤销/重做能力已经完整存在，但制作台里没有任何可见入口。`ResumeWorkbenchActionBar.tsx` 内 `grep -n "undo\|redo"` 为空。

**现状证据**
- `useWorkbenchV2History.ts:268` 提供 `undo`，同文件 `:387` 一并导出 `redo`/`jumpTo`；
- `ResumeWorkbenchV2.tsx:152-156` 已把它们交给 `useWorkbenchV2Shortcuts`，所以快捷键可用；
- 历史条目本身带可读摘要（`useWorkbenchV2History.ts:378` 的 `summaryOf`），可直接做 tooltip。

**要做**
- 在固定动作区加两颗按钮，与"保存/导出"同一行，顺序为 撤销 → 重做；
- 禁用态：无可撤销/可重做、`saving` 期间、只读宿主（`editorEnabled === false`）；
- tooltip 显示"将要撤销什么"（用 `summaryOf`），无历史时显示"没有可撤销的操作"；
- 与快捷键调用同一个函数，不新增第二份状态；
- 文案进语言包（中英），带 `aria-label`。

**不做**：不改历史栈结构、不改快照合并策略、不新增"历史面板"入口（已有版本弹层）。

**落点**：`frontend/src/features/resume/editor/ResumeWorkbenchActionBar.tsx`、`ResumeWorkbenchV2.tsx`、`frontend/src/i18n/messages/zh-CN.workbench.ts` 与对应英文包（以实际检索为准）。

**验收（可观察）**
1. 改一次正文 → 撤销按钮可用 → 点一次正文回到上一版 → 重做按钮可用 → 点一次恢复；
2. 无历史时两颗按钮均为 disabled，且 aria 上可被判为不可用；
3. 输入框聚焦时点击按钮，不触发输入框原生撤销、不丢焦点；
4. 中英文均有文案；Tab 可聚焦、回车可触发。

---

### QW-2 保存结果说诚实（版式成功 + 正文失败）

**症状**：保存是两步（先版式后正文）。版式那步成功后立刻弹成功 toast（`resumeDocumentHost.ts` 的 `commitLayoutWithRevision`，约 `:201-228`，`message.success(t("workbench.save.layout-saved"))`），随后正文那步仍可能失败或冲突（`useWorkbenchV2Save.ts:147-176`）。用户先看到"保存成功"，再看到失败——多数人只记住第一条。

**现状证据**
- `useWorkbenchV2Save.ts:143-186` 内部已有 `savedLayout` / `savedDocument` 两个布尔，只是没有对外表达；
- 两步之间不自动重试，失败即停，只对齐成功那一半的基线（`:184-186`）。

**要做**
- `perform()` 的结果扩展为二维：版式、正文各自 `saved | unchanged | failed | conflict`；
- 部分成功时只出一条提示：「版式已保存，正文未保存」+「重试正文」动作；不连弹两个 toast；
- 两步都成功 → 一条成功提示；版式失败 → 不再尝试正文，提示"未保存"；
- 冲突仍走既有三选一浮层，不新增第二条冲突路径。

**不做**：不改保存顺序、不做组合写入接口、不改后端 `document_save`。

**落点**：`useWorkbenchV2Save.ts`、`ResumeWorkbenchActionBar.tsx`、`zh-CN.conflict.ts`（`workbench.save.layout-saved` 邻近）。

**验收（可观察）**
1. 用例注入 `pipeline.saveContent` 抛错 → 只出现一条"部分成功"提示，且"重试正文"点击后能成功；
2. 两步都成功 → 只有一条成功提示；
3. 版式一步失败 → 正文不发起请求（断言调用次数为 0）。

---

### QW-3 旧分页规则：显示出来并可清除

**症状**：`section.layout.keep_together` 在界面上既设不了也清不了——`paginationBreaks.ts:43` 的 `SECTION_FLAGS` 只含 `start_on_new_page`。但导出端当真：PDF 逐条预留（`pdf_exporter/document_render.py:309-340`），DOCX 变成整块 `keepNext`（`docx_document_render.py:290` 起）。用户遇到"这一页莫名被推到下一页"，既看不出原因也无法关闭。

**已确认决定（2026-11-18，用户选择）**：显示为"旧版规则"并允许单独清除；新建简历不再产生该字段。

**要做**
- `paginationBreaks.ts` 增加 `LEGACY_SECTION_FLAGS = ["keep_together"]`，`collectPageBreaks` 收集时标记 `legacy: true`；
- 汇总条该行显示「旧版规则」标签与 ✕；清除只清这一个键（复用 `patchSectionLayout`）；
- 旁注说明：这条规则来自旧版本、会影响分页，清除后页数可能变化；
- 不把它加进设置面板的开关列（"谁能设置，谁才能清除"的例外只用于清除）。

**不做**：不改 PDF/DOCX 的消费逻辑，不迁移历史数据，不给它新建设置入口。

**落点**：`frontend/src/features/resume/pagination/paginationBreaks.ts`、`SectionPaginationPanel.tsx`、`zh-CN.pagination.ts` 与对应英文包。

**验收（可观察）**
1. 构造带 `section.layout.keep_together = true` 的文档 → 汇总条出现一条带「旧版规则」标签的芯片；
2. 点 ✕ → 该字段变为 `false`，芯片消失，其它分页设置不受影响；
3. 不含该字段的文档不出现任何空行或占位；
4. 设置面板里仍然只有"从新页开始"一个开关（没有新增入口）。

---

### QW-4 全局字号支持精确输入

**症状**：全局字号只有滑杆（`FontSizeControl.tsx:190` 的 `<Slider>`，文件内无 `InputNumber`），拖到具体数值很难；而局部样式行已有"直接输入 + 步进 + 恢复继承"（`typography.row.reset`、`StyleValueRow`）。同一件事两套交互。

**要做**
- 把全局字号换成与局部一致的行走控件：数值输入 + 步进 + 滑杆作为辅助 + 「恢复继承」；
- 存储形状不变（仍是相对倍数），**界面不得出现 pt/mm 字样**；
- 空输入不等于 0；非法值提交前给提示且不写入；
- 恢复继承写入的是"删声明"，不是写 1.0。

**不做**：不引入绝对单位、不改 `type: "scale"` 的解析、不动 `render_config_fingerprint`。

**落点**：`frontend/src/features/resume/layout/FontSizeControl.tsx`（必要时抽公共行控件，避免与 `StyleValueRow` 重复）。

**验收（可观察）**
1. 输入 1.15 → 滑杆位置与纸面同步；保存重开仍为 1.15；
2. 输入空/非数字 → 有提示，文档不变；
3. 恢复继承后回到模板值，`format_config` 里对应键被删除（而不是写成 1）；
4. 老简历打开后显示值与改动前一致（无浮点漂移）。

---

### QW-5 会话草稿恢复（仅当前标签页）

**症状**：制作台只有手动保存，关掉或刷新即丢。通用草稿 hook 已存在，但只被 `batch` / `claims` / `settings` / `tracker` 使用，简历未接入（`grep -rn "useFormDraft"` 无 `features/resume` 命中）。

**要做**
- 新增独立模块 `useWorkbenchResumeDraft`，用 `sessionStorage`（**不得写 localStorage**）；
- 键包含：`resumeId` + 数据集作用域 + 打开时的 server revision；切简历/切数据集不得交叉恢复；
- 载荷 = `content` + `layout`；**忽略照片二进制**，只保留引用；
- 有界预算单独定（通用表单的 32KB 是别的场景口径，不能盲套）；超限或存储不可用时明确提示"未能暂存"，**不静默截短正文**；
- 恢复条展示暂存时间与基准 revision；必须用户显式点「恢复」才应用；
- 服务端已有更新版本时，走既有冲突流程，不覆盖；
- 保存成功、用户放弃、切数据集、恢复历史版本后按身份清理或更新草稿；异步旧写入不得覆盖新简历草稿。

**不做**：不改自动保存、不做跨标签页合并、不持久化到后端、不在打开制作台时静默应用草稿。

**落点**：新增 `frontend/src/features/resume/editor/useWorkbenchResumeDraft.ts`；接线 `ResumeWorkbenchV2.tsx`、`useWorkbenchV2Save.ts`；恢复条复用 `components/common/DraftRestoreBar`。

**验收（可观察）**
1. 改正文 → 刷新 → 出现恢复条 → 恢复后内容与刷新前一致；
2. 点「放弃」后草稿被删除，再刷新不再出现；
3. 两份简历、两个数据集之间不串稿；
4. 构造 `QuotaExceeded` → 有可读提示，当前内存内容不丢；
5. 服务端 revision 已前进时，恢复要求走冲突流程。

---

### QW-6 基本信息字段名 / 字段值可逐字段调参（2026-11-18 记录，未实施）

**目标**：基本信息（页眉）里的每个字段，能像其他板块一样**单独**调参——既能调字段名（如"电话："），也能调字段值。

**现状：基本信息根本没有"字段名"这个可样式化对象**，三层原因缺一不可：

1. **纸面上标签和值是同一个字符串**。`plan_header` 拼的是 `display = label + "：" + item.value`，然后整条 `Inline(text=display, role="meta", path="header."+item.id)`（`backend/app/services/resume/document_plan.py:160-176`）。标签与值共享 `meta` 角色，无法只调标签。求职意向是唯一例外（标签单独成段 `role="field_label"`），但该段**刻意不带 path**（同文件 `:150-153` 注释），所以也不能按字段单独调。
2. **`header.{id}` 进不了白名单**。前端 `isFieldStylePath`（`frontend/src/features/resume/layout/fieldStyleTarget.ts:12-16`）与后端 `_FIELD_PATH`（`backend/app/services/resume/field_style_target.py:20-23`）都要求 **3~4 段**，而 header 路径只有 2 段（`document/paths.ts:21-24`）→ 写入被拒。
3. **后端会把 header 路径当"失效路径"剪掉**：`content_field_paths`（`field_style_target.py:34-60`）只遍历 `sections[].entries[].items[]`，**完全不看 `header.items`**。就算放宽正则，样式也会在保存时被清掉。

**已确认决定（2026-11-18，用户选择）**
- 作用域：**字段名 + 字段值一起做**（否则会出现"能调标签、不能调值"的怪状态）；
- 标签段**可点击定位**（带 `data-resume-path`，与其他板块一致）。

**修法（四处必须同批，少一处就静默失效）**

1. **纸面拆段**（`document_plan.py::plan_header`）：
   - 联系方式行：`label + "：" + value` 拆成两段 —— 标签段 `role="field_label"`、值段 `role="meta"`，**两段都带 `path="header."+item.id`**；
   - 求职意向行：现有标签段补上同一 path，与联系方式统一；
   - `label_mode` 三态（`auto` / `show` / `hide`）语义不变：`hide` 与"auto 下只印值"的字段**不产生标签段**；
   - `：` 归属标签段（跟着标签一起被样式化），不做独立标点段；分隔符 `contact_separator` 不动。
2. **前后端白名单**：后端 `_FIELD_PATH` 保持三段规则不动，**另加**一条 `^header\.[A-Za-z0-9_-]{8,32}$`，`is_field_path` 二者取或；前端 `fieldStyleTarget.ts` 镜像同一对正则。**不要**为了省事把段数下限改成 2（那等于放宽所有路径）。`fieldStyleEntryId` 对 header 路径返回 `null`（header 没有 entry）。
3. **有效路径收口**：`content_field_paths` 增加遍历 `content["header"]["items"]`，把 `header.{id}` 纳入；否则保存时仍被剪。
4. **面板作用域**：`ObjectStylePanel` 现在只在 `scope === "field"`（依赖 3 段路径）时提供"字段名/字段值"切换。header item 需要新增一个作用域（如 `header_item`），两种目标分别写 `object_roles["header.{id}:field_label"]` 与 `object_roles["header.{id}:meta"]`。
   - **注意 header 的默认角色**：`roleForDocumentPath` 只认条目路径，header 会落到 `body`；必须先补 header placement → 角色的映射（name / name_meta / subtitle / contact → 对应角色，以 `plan_header` 实际写的 `role` 为准），否则面板默认值会读错。

**不做**：不改 `format_config` 协议版本（只是新增合法的 object 键）；不改 `label_mode` 三态；不做"自定义每个字段的标签文案"（是另一件事）；不动照片字段。

**风险**
- 拆段后同一个 item 会出现**两个**相同 `data-resume-path` 的 span；`useStructureHighlightTargets`、纸面点击映射、`path_spans` 需要确认"取第一个即可"，不要重复高亮或重复滚动。
- `plan_header` 的标签文本来自 `field_labels(language)` 与 `item.label`，拆段时不得改变最终文本（`：` 只能出现一次），否则四个出口的导出产物都会变（golden 指纹会红）。
- `header.{id}` 的 id 段长必须满足 8~32；先确认 id 生成规则（`document_identity.py`），历史 id 若更短会被白名单拒。
- 路径一旦纳入 `content_field_paths`，删字段后的残留样式会开始参与 prune，需确认清理行为符合预期。
- 配额 `MAX_OBJECT_ROLES = 400`：header 一般 5—10 个字段 × 2 个目标，影响很小，但验收要确认没炸。

**验收（可观察）**
1. 把"电话"的**字段名**改红/加粗 → 只有这个标签变，其他字段与值不变；
2. 把该字段的**值**单独调字号 → 只有值变；
3. 保存重开，以及 HTML / PDF / DOCX / Markdown 四个出口都保持；
4. 点标签与点值都会选中同一个字段（定位一致）；
5. `label_mode=hide` 的字段没有标签段：调"字段名"时面板给空态或禁用，**不写无效键**；
6. 删除该字段后，对应覆盖不再生效（`content_field_paths` 收口的验证）；
7. 旧文档（没有任何 header 覆盖）外观逐像素不变。

### QW-7 纸面缩放更精细、更丝滑（2026-11-18 记录，未实施）

**目标**：Ctrl+滚轮 / `+/-` 缩放时，颗粒更细、视口不跳、正在看的内容不跑掉。

**现状：三条原因叠加，不是单一"步长太大"**

1. **粒度粗且与可见百分比不一致**：Ctrl+滚轮与 `+/-` 都是每次 **±0.1 系数**（`usePreviewZoom.ts:65`、`ResumePreview.tsx:439-440`）。系数 1 = 适宽，所以可见百分比 = 系数 × `fitScale`；窗口一变，同一次点击在屏幕上跳的幅度就不同。
2. **锚点在左上角**：`resume-canvas.css:85` 是 `transform-origin: top left`，配一个宽高已按 scale 算好的 scale-box。放大时纸面向右下长，用户正在看的位置被推出视口，只能再滚回来——这才是"卡顿感"的主因。
3. **没有过渡**：`transform: scale(...)` 每步直接落位（`ResumePreviewCanvas.tsx:101`），所以是"跳"而不是"变"。

**已确认决定（2026-11-18，用户选择）**
- 粒度：**滚轮连续 + `+/-` 固定 5%**；
- 锚点：**以光标为中心**（按钮缩放时用视口中心）；
- 过渡：**不加 CSS transition**（保证文字始终锐利）。

**修法**

1. **滚轮连续**（`usePreviewZoom.zoomByWheel`）：由"固定 ±0.1"改成按 `deltaY` 的指数缩放，例如 `nextScale = currentScale * Math.exp(-deltaY * K)`（K ≈ 0.0015），再夹回区间。
   - 必须处理 `deltaMode`：Firefox 的 `DOM_DELTA_LINE` 下 `deltaY` 是行数，要乘行高（或按模式换 K），否则同一次滚动快慢差几十倍。
   - 只用 `deltaY`，且要求 `|deltaY| > |deltaX|`：触控板横滑不该缩放。
   - 仍返回 `true`，让调用方继续 `preventDefault`（浏览器自己的 Ctrl+滚轮页面缩放必须拦住）。
2. **按钮 5% 按"可见百分比"算**：目标是屏幕上的缩放变化 5%，而不是系数加 0.05。即 `setZoom(currentScale * 1.05 / fitScale)`（缩小用 `/1.05`）。这样不同窗口宽度下步长一致。
3. **光标锚点**（不动 `transform-origin`，也不改 scale-box 的宽高算法——那是布局测量的基础）：缩放前记录光标在**未缩放坐标系**里的位置，缩放后补偿滚动：
   ```
   contentX = (scrollLeft + pointerX - boxLeft) / oldScale
   scrollLeft = contentX * newScale + boxLeft - pointerX
   ```
   - 滚动容器与 scale-box 的左上都已在画布几何里；`ResumePreviewCanvas` 已有 viewport ref，不要再加一份。
   - 按钮缩放时 `pointerX/Y` 取视口中心。
   - 内容比视口矮时不做补偿（避免负 scroll 或跳动）。
4. **不加过渡**（写进"不做"，防止以后有人顺手加）。

**不做**：不加 `transition`、不改 `transform-origin`、不改 scale-box 的宽高算式、不改三个档位按钮（「整页 / 适宽 / 100%」仍按 `zoomFactorForMode` 精确落位）、不做"记住上次缩放"。

**风险 / 注意**
- 连续缩放下 `resolveZoomMode` 大多返回 `null`（不命中档位），这是正常表现，不要为了"点亮档位"去吸附。
- 边界处理：到 `MIN_ZOOM / MAX_ZOOM` 时**停住**，不要"弹回"或"跳档"。
- 高 DPI 下 `transform` 缩放本来就略糊，本次不引入也不解决。
- 缩放不得触发 iframe 重载（不能闪白）；现有实现是纯 transform，别改成重建 iframe。

**验收（可观察）**
1. Ctrl+滚轮缓慢滚动 → 缩放连续、无阶跃；快速滚动能迅速到边界且不越界；
2. 缩放时光标下方的文字基本不动（偏差 ≤ 2px）；
3. `+/-` 单击的可见变化约 5%，改变窗口宽度后仍接近 5%；
4. 三个档位按钮仍精确回到「整页 / 适宽 / 100%」；
5. 触控板横向滑动不触发缩放；
6. 缩放过程中纸面不闪白、不重载、不出现横向滚动条抖动；
7. 缩到最小时不出现负滚动或整页位置漂移。

## 3. 复核后撤掉的 4 项 + 1 条被推翻的"假 bug"（不要重新加回来）

这 4 项在初版筛选中列出过，核对代码后确认**已经是现状或不算缺陷**：

| 原项 | 结论 | 证据 |
|---|---|---|
| "恢复自然分页"名不副实 | 已有说明文案「清除所有板块的断页设置，条目级断页不受影响」；条目级芯片不给 ✕ 是刻意设计（谁能设置，谁才能清除） | `zh-CN.pagination.ts:52-65`、`SectionPaginationPanel.tsx:267-276` |
| 预检结果不会过期 | 缓存已按 `key` 判 stale，`usePreflight` 用 `resultKey !== currentKey` 表达"结果基于上一版" | `preflightCache.ts:6-15` |
| 缺"恢复继承 / 来源显示" | 已存在：`typography.row.reset`、`ParamResetButton`、`StyleSourceTag` | `zh-CN.typography.ts:96`、`FontSizeControl.tsx:224`、`ObjectStylePanel.tsx:47-48` |
| 隐藏/移除/删除三者混淆 | 菜单已分「隐藏条目」「移除条目」两项；剩下只是文案解释，收益过低 | `entryMenuItems.ts:47-56` |
| "前端漏读 `objects[<字段路径>]`，前后端解析顺序不一致" | **不成立，不要去"修"**：`objects` 的写入方只写**条目级**键，字段级一律走 `object_roles`；实际数据形状下两层解析一致 | `layout/entryStyleScopes.ts:13`、`styleOverrides.ts:389` 同款 `parent ?? objectId`、`resume_style_types.py:102-116` |

## 4. 缺陷记录（DF）

### DF-1 划词浮条压住随后弹出的卡片（P0，2026-11-18 记录，未修）

**现象**：在制作台输入框里选中文字后，投投划词浮条（`简历经历 ｜ 改写这段话 ｜ 按 STAR 补结构 ｜ 找出可量化的数字 ｜ 查重复条目`）浮在选区旁；此时右键打开「行内格式」菜单（加粗 / 字号 / 颜色 / 插入链接 / 清除行内格式），只要两者几何重叠，浮条就会盖在菜单上面，菜单的后半截点不到。

**时序还原（这是"该消失时又出现"，不是层级排错位）**

1. 右键 `mousedown`：`TouTouSelectionMenu.tsx:92-95` 关闭浮条（**不区分按键**）；
2. 右键 `mouseup`：`onMouseUp`（`:85-91`）**也不区分按键**，一帧后 `requestAnimationFrame(refresh)`；
3. `refresh()`（`:59-74`）重读选区。输入框的选区来自 `activeElement.selectionStart/End`（`touTouSelection.ts:258-265`），**右键不会清掉它** → 浮条重新浮出；
4. 浮条层级为 `--rf-layer-orb-tooltip` = **3700**（`tou-tou-selection.css:6`），高于 antd 浮层基准（3100；Modal 内弹层约 3250—3280）与全部投投卡片（3400 / 3450 / 3500 / 3550，见 `design-tokens.css:187-195`）→ 重叠时浮条恒在上。

**根因**：两件事叠加 ——「右键后浮条自己弹回来」＋「浮条被放在投投族最高层（比助手卡、保存卡、剪贴板卡都高）」。

**已确认决定（2026-11-18，用户选择）**
- 修法：**行为修复 + 层级归一**，两段一起做；
- 优先级：**P0，下一次改动先做**（排在 QW-1 之前）。

**修法**

1. **行为（解决本次现象）**：`onMouseUp` 只处理主键——

   ```ts
   if (event.button !== 0) return; // 右键交给原生 contextmenu，浮条不重开
   ```

   不新增 `contextmenu` 监听、不 `preventDefault`，因此既有用例「不拦原生右键菜单」（`TouTouSelectionMenu.test.tsx:132`）仍然成立。

2. **层级（解决"浮条压住投投卡片"这一类）**：`design-tokens.css` 阶梯新增

   ```
   --rf-layer-selection-bar: 3300;  /* 划词浮条：高于编辑器 Modal（3200），低于所有投投卡片（3400+） */
   ```

   `.tt-selection-bar` 从 `--rf-layer-orb-tooltip` 改用这一档，并在注释里写明：**浮条永远不该盖住由它触发的卡片**。

**必须写明的边界**：3300 仍**高于** Modal 内 antd 弹层（约 3250—3280），所以层级这一半**不能**解决"浮条压住行内格式菜单"。那一半只能靠行为修复（两者不同时出现）。若要让层级也覆盖它，浮条需降到 3210 左右（高于 Modal 3200、低于 3250），但该值未在浏览器中实测，且遇到 Drawer/嵌套 Modal（3300）时会被盖住，**本期不采用**，只在注释里留待验证。

**影响面**：改的是全局划词浮条，所有页面都受影响（不只是制作台）；`TouTouSelectionMenu` 是单点实现。

**验证与验收（可观察）**
1. 选中文字 → 右键 → 浮条消失，菜单完整可点，关闭菜单后浮条不自动重开；
2. 左键拖选、Shift + 方向键扩选，浮条仍正常出现（不回归）；
3. `contextmenu` 仍未被 `preventDefault`（原有用例通过）；
4. 浮条残留时不再压住投投助手卡/保存卡/剪贴板卡（层级 3300 < 3400）；
5. 跑 `TouTouSelectionMenu.test.tsx`、`touTouInteractiveSurfaces.test.ts`、`darkTheme.test.ts`（浅/深色层级基准需同值）；
6. 新增一条用例：「右键 `mouseup`（button=2）后浮条保持关闭」。

**残余边角**：键盘（Shift+F10）打开菜单时没有 `mousedown`，浮条不会先关；此路径本期不解决，已记在上一段的边界里。

### DF-2 行内格式右键菜单点击外部难以关闭（P1，2026-11-18 记录，未修）

**现象**：右键选中文字弹出的「加粗 / 字号 / 颜色 / 插入链接… / 清除行内格式」菜单，点菜单外很难让它消失——点纸面没反应，点同一张条目卡片的其他位置也没反应，只能点别的卡片/面板或按 Esc。

**根因（两条独立，缺一不可修）**

1. **纸面是 iframe，父页面收不到事件**。预览每页一个 `<iframe>`（`ResumePreviewCanvas.tsx:43-52`、`:116`），而关闭逻辑挂在父 `document` 捕获阶段的 `mousedown` 上（`InlineMarkContextMenu.tsx:113`）。点击落在 iframe 里时，事件不会冒泡到父 `document`，监听器永远不触发。
2. **同一张卡片内部被整体豁免**。`InlineMarkContextMenu.tsx:105-106` 只要 `hostRef.current.contains(node)` 就直接 `return`，而 `hostRef` 包住的是整张条目卡片（`:244` 的 `.rf-inline-mark-host` 是 `children` 的外层）。所以左键点这张卡片的任何位置都不会关闭；只有 `onContextMenu`（右键）会重新定位。

**已确认决定（2026-11-18，用户选择）**
- 纸面这一半：**透明遮罩层**（不用 iframe 监听桥接）；
- 卡片内部这一半：**左键也关**（把 `hostRef` 豁免限定为右键）。

**修法**

1. **遮罩层**：菜单打开时，在弹层内加一层覆盖视口的透明遮罩 `.rf-inline-mark-mask`（`position: fixed; inset: 0; background: transparent`），`mousedown` 与 `wheel` 都关闭菜单；菜单本体在遮罩之上（同一弹层内 `position: relative`，必要时给一层 `z-index`）。因为遮罩与菜单同属弹层的 stacking context，它既能盖住页面（含 iframe），又不会挡住菜单自身点击。
   - 遮罩不承担任何视觉，只用 `aria-hidden="true"`；
   - 菜单开着时点不动纸面是**预期行为**（点一下即关闭，第二次点击才落到纸面）。
2. **收窄宿主豁免**：`mousedown` 落在 `hostRef` 内时，只有 `button === 2`（右键）才 `return`（交给 `onContextMenu` 重新定位），其余按键一律 `close()`。
3. 保留现有 Esc 关闭；不改 iframe 内部、不给预览加任何监听。

**不做**：不改纸面渲染、不给 iframe 挂同源监听、不改 `document-chip-style-popover`（那是另一套右键浮层，不受本缺陷影响）。

**影响面**：`InlineMarkContextMenu` 是单点实现，作用于所有条目与页眉字段编辑器；不涉及后端。

**验收（可观察）**
1. 打开菜单 → 点纸面任意位置 → 菜单关闭；
2. 打开菜单 → 在同一张卡片内左键点另一个字段 → 菜单关闭；
3. 打开菜单 → 点菜单项 → 功能正常、菜单关闭（不被遮罩拦掉）；
4. 打开菜单 → 按 Esc → 关闭；
5. 打开菜单 → 滚轮 → 关闭；
6. 菜单关闭后，纸面的点击编辑恢复（遮罩不可残留）；
7. 右键另一处选中文字 → 菜单在新位置出现（不闪两次、不丢选区）。

**残余风险**：弹层入场动画（约 120ms，antd motion 带 `transform`）期间，`position: fixed` 的遮罩可能相对弹层而非视口定位，表现为遮罩只盖住菜单周围一小块。若复现，改为把遮罩 `createPortal` 到 `document.body`，层级取弹层 z-index 减一。

### DF-3 行内格式菜单总是出现在光标上方（P1，2026-11-18 记录，未修）

**现象**：右键后菜单出现在指针**上方**，光标落进菜单内部或下缘之外，不符合右键菜单"贴着指针向下展开"的习惯。

**根因**

- 定位参数是 `align={{ points: ["tl", "tl"], targetOffset: offset, overflow: { adjustX: true, adjustY: true } }}`（`InlineMarkContextMenu.tsx:210-214`）；
- `offset` 是「点击点相对宿主左上角」的坐标（`:129-130`），所以基准落点是**菜单左上角 = 光标**，方向本身是对的；
- 但 `overflow.adjustY` 会在下方放不下时把**整个菜单上移**（必要时翻到上方），而这个菜单没有高度上限——`inline-mark-menu.css` 只给了 `min-width: 168px / max-width: 240px`，没有 `max-height`。6 项 + 1 条分隔线约 260—280px，「插入链接…」展开后更高；
- 编辑区里卡片通常位于弹窗中下部，只要光标距视口底部不足一个菜单高度就会触发上移，所以体感是"总是"在上方。

**已确认决定（2026-11-18，用户选择）**
- 规则：**下方优先；放不下时翻到光标上方**（菜单底边贴光标），而不是整体挪开；
- 优先级：**P1，与 DF-1 / DF-2 同批修**（同一组件，一次改完只跑一轮回归）。

**修法（推荐实现）**

1. **先测后定**：菜单打开后用 `popupRef` 量实际高度，写入 state；测量完成前用 `visibility: hidden` 避免闪跳。
2. **落点规则**（`GAP = 4px`）：
   - `spaceBelow = window.innerHeight - clientY - GAP`；
   - `menuHeight <= spaceBelow` → 向下：`points: ["tl", "tl"]`；
   - 否则 → 向上：`points: ["bl", "tl"]`（菜单左下角贴光标）；
   - 两种都保留 `adjustX`，并对左右边缘做视口夹取。
3. **高度兜底**：给菜单 `max-height: calc(100vh - 16px)` + 内部滚动，避免"插入链接"展开后再次溢出。
4. **不要每帧重排**：只在打开时、以及窗口 resize 后重新判定；滚动时按现有行为关闭（与 DF-2 的遮罩关闭一致）。

**复用建议**：`touTouSelection.ts` 里已有 `selectionMenuPosition(rect, viewport, menu)`，做的就是"下方优先 + 翻转 + 夹取"。建议抽成 `frontend/src/utils/anchoredPlacement.ts` 纯函数供两处共用，而不是在 resume 域再写一份（仓库要求"一处逻辑一份实现"）。**不要**让 resume 域直接 import tou-tou 域。

**不做**：不改菜单项、不改子菜单展开方向（antd 自行处理）、不与 DF-2 的遮罩逻辑耦合。

**验收（可观察）**
1. 光标在视口中上部右键 → 菜单出现在光标**右下方**，左上角贴光标并留 4px；
2. 光标距底部不足一个菜单高度 → 菜单翻到光标上方，**底边贴光标**；
3. 光标贴近右边缘 → 菜单左移夹取，不溢出；
4. 打开「字号 / 颜色」子菜单不改变主菜单落点；
5. 「插入链接…」展开后菜单变高，但不溢出视口（限高 + 内部滚动）；
6. 窗口缩放后再次右键，落点仍符合上述规则。

**残余注意**：翻转判定只用**打开时**的基准高度；子菜单与链接输入框造成的增高由 `max-height` 兜底，不应反过来推动主菜单跳动。

### DF-4 应用行内格式后，选中会出现一条"空蓝带"（P1，2026-11-18 记录，未修）

**现象**：给字段应用颜色（或其他行内格式）后，选中该字段，蓝底会拉出一条**没有文字的长条**——看起来像"透明的、但里面明明有东西"。

**机制（不是数据问题，导出不受影响）**

1. 应用颜色时，值里写入 `{@color=#c0392b}…{@}`（`inlineMarks.ts:98`、`:322`）。**开标记 17 字符 + 收标记 3 字符，比"个人项目"四个字还长**。
2. 编辑态是两层叠：上层 `<textarea>` 字形透明、下层遮罩层画字（`InlineMarkTextArea.tsx:17-24`）。标记语法必须**占宽但不可见**（`inline-mark-overlay.css:92-95` 的 `visibility: hidden`），否则后面的字全部左移、光标落进字缝。
3. 选区由**上层文本域**画，`::selection` 只把背景染 26%（`inline-mark-overlay.css:48-54`）。选区一覆盖到那 20 个隐形字符，就成了一条空蓝带。

**已确认决定（2026-11-18，用户选择）**
- 处理方式：**遮罩层自绘选区**（只高亮可见文字），不采用"加淡底纹"或"只加说明"；
- 优先级：**P1，与 DF-1 / DF-2 / DF-3 同批修**。

**修法**

1. **暴露 raw 区间**：`inlineMarkRuns.ts` 里 `placedRuns`（`:396`）目前是私有，`parseInlineMarkRuns`（`:415`）只返回可见文本、丢了 raw 偏移。新增一个导出（如 `parseInlineMarkRanges`）返回 `{ rawStart, rawEnd, visibleStart, visibleEnd }[]`；**不要复制一份解析**，`visibleInlineMarkLength`（`:428`）可作为可见总长的一致性锚点。
2. **订阅选区**：`InlineMarkTextArea` 增加 `selection` state（raw 偏移 `{start, end}`），在 `onSelect` / `onMouseUp` / `onKeyUp` / `onChange` / `onFocus` 更新，失焦清空。注意只能用 `event.currentTarget.selectionStart/End`，`document.getSelection()` 读不到 textarea。
3. **映射**：raw 选区 → 可见区间列表（对每个 run 求交集、跳过 hidden 段），可能得到多段。
4. **渲染**：`InlineMarkOverlay` 多收一个 `selection` prop，在可见文本段内切出高亮 `<span>`，底色沿用现在的 `color-mix(in srgb, var(--rf-info) 26%, transparent)`。
5. **关掉上层选区底色**：`.is-masked::selection` 的 `background` 改为 `transparent`（`color: transparent` 保留），否则会叠出第二条空带；`caret-color` 不动。
6. **组合期例外**：`is-composing` 时遮罩层被隐藏（`:110-112`），选区反馈必须交回文本域——补一条 `.is-composing` 下的 `::selection` 恢复 26% 底色，否则打拼音时看不到选区。

**不做**：不改标记语法（`{@size=…}` 仍与后端 `resume_inline_style` 逐字一致）、不改导出的渲染、不重写 I-26 阶段 3 的整体计划。

**风险（必须在开工前认下）**：这正是 `InlineMarkOverlay.tsx:25-31` 明确"不在本次范围"的坐标映射，等于提前做 I-26 阶段 3 的前置。**先补"raw ↔ 可见偏移"的往返用例**（未闭合标记、`**` 加粗、`[文字](链接)`、emoji、多个相邻标记），再动组件；否则会引入新的错位，而错位不会报错，只会让光标落在字缝里。

**验收（可观察）**
1. 选中含 `{@color=…}` 的字段 → 蓝底只覆盖可见文字，标记区没有蓝带；
2. `Ctrl+A` 全选 → 高亮覆盖全部可见字符，尾部无空带；
3. 反向拖选（从后往前）结果与正向一致；
4. 加粗 + 颜色 + 字号混合的字段，高亮分段正确；
5. 长文本滚动时高亮跟随，不错位；
6. IME 组合期间选区仍可见（由文本域提供）；
7. 失焦后高亮清除；
8. 导出与纸面渲染不受影响（标记仍被消费）。

### DF-5 工具条颜色按钮恒显红块，容易被读成"当前颜色"（P2，2026-11-18 记录，未修）

**现象**：行内格式工具条上，颜色按钮永远是一个**红色方块**（`#c0392b`），即便这段文字没有任何颜色。用户会把它读成"当前颜色 = 红"或"已经应用了红色"。

**证据**：`InlineMarkButtons.tsx:338-351`，其中 `:345` 是 `defaultValue={COLOR_PRESETS[0]}`，色板常量在 `:80` 的首项就是强调红。源码注释自己也写着：`defaultValue` 只是色块初值、**不是**"当前选区已有颜色"的指示，给强调红是为了避免 antd 的透明色警告。

**已确认决定（2026-11-18，用户选择）**
- 按钮外观：**改中性图标**（不再用色块表示颜色）；
- 面板初值：**改成正文黑 `#111111`**，不再用强调红。

**修法**

1. 用 `ColorPicker` 的 `children` 自定义触发器：`Button type="text" icon={<FontColorsOutlined />}`，与加粗 / 字号 / 链接同一形态（`size="small"`、`type="text"`、`aria-label` 用 `typography.inline.color`）。这样按钮上不再出现任何色块。
2. `defaultValue` 从 `COLOR_PRESETS[0]` 改为 `"#111111"`（与正文色一致，不暗示"已用红"）；保留 `allowClear` / `disabledAlpha` / `presets`。
3. 保持**非受控**（`defaultValue` 而不是 `value`）：本期不反推"选区已有颜色"，避免每次选区变化去解析正文。
4. 顺手收一处重复：`COLOR_PRESETS` 在 `InlineMarkButtons.tsx:80` 与 `InlineMarkContextMenu.tsx:54` 各有一份，值完全相同。建议抽到 `inlineMarks.ts` 导出一次。**注意它是数据不是主题变量**，不要搬进 `design-tokens.css`。

**不做**：不实现"按钮反映选中文字的真实颜色"（要 `raw ↔ 可见` 映射，见 DF-4，本期不做）；不改色板顺序（用户已把颜色写进内容）；不改右键菜单里的同一组预设。

**验收（可观察）**
1. 未选中任何文字时，工具条上没有红块，只有中性图标；
2. 点开色板，高亮为 `#111111`，6 个预设仍在、顺序不变；
3. 选一段文字点某个预设 → 颜色生效，纸面与导出一致；
4. `allowClear` 仍能清除颜色；
5. 深色主题下图标可见（用主题文字色，不要写死黑）；
6. 控制台无"透明色"警告（这是当初给红色的原因，不能回归）；
7. 若做了第 4 条收拢，`InlineMarkContextMenu` 的色板顺序与工具条逐项一致。

### DF-6 行内标记的源串在只读展示里直接露出来（P1，2026-11-18 记录，未修）

**现象**：结构面板等只读位置直接显示 `{@color=#ac3224}个人项目{@}`，而不是"个人项目"。

**关键事实**：`stripInlineMarks`（`inlineMarkRuns.ts:420`）**在整个前端零调用**，也就是说所有只读展示都在输出源串。

**漏点清单**

| 位置 | 用途 |
|---|---|
| `document/summarize.ts:102`（`itemPlainValue`） | 条目显示名、分页芯片、拖拽标签 |
| `document/summarize.ts:165-166` | 树行的"值"显示（**截图这一处**） |
| `document/summarize.ts:296` | 字段行兜底标签 |
| `document/changeSummary.ts:72` | 变更摘要 |
| `document/view.ts:28` | 视图取显示值 |
| `editor/ItemChip.tsx:263` | `aria-label` 里也带原始值（读屏会念出 `{@color=…}`） |

**已确认决定（2026-11-18，用户选择）**
- 剥离范围：**可见文字 + `aria-label` + 搜索/匹配 + AI 上下文**（编辑态输入框保留标记，不动）；
- 优先级：**P1，与 DF-1—DF-4 同批**。

**⚠️ 先修剥离函数，再接展示层**

后端 `strip_style_markers`（`resume_inline_style.py:240`）是**保守剥离**：只删掉识别成功的标记，未闭合与越界标记**原样保留**（`backend/tests/test_resume_inline_style.py:179-186` 明确守这两条）。前端 `stripInlineMarks` 的语义**相反**——它只 `join` 可见片段（`:420-425`），凡 `placedRuns` 没认出来的部分会被整段丢掉。直接把它接到展示层，遇到"未闭合标记"会**吞掉正文**，比现在露出源串更糟。

所以顺序是：

1. **改 `stripInlineMarks`**：从"只留可见片段"改成"剪掉已识别标记的区间、其余原样保留"，与后端语义对齐；补未闭合 / 越界 / 嵌套三类用例。
2. **共享用例向标**：新增 `frontend/src/features/resume/editor/inlineMarks.cases.json`（照 `preview/richText.cases.json` 的做法），前端与后端各跑一遍同一组 `raw → expected`。两份实现不可能互相 import，只能靠用例咬住。
3. **建唯一展示出口**：在 `document/summarize.ts` 内把 `itemPlainValue` 改成"取值 → 剥离"，并把 `:165-166`、`:296`、`changeSummary.ts:72`、`view.ts:28` 全部改为走这一个出口；`ItemChip.tsx:263` 的 `aria-label` 同步。
4. **搜索/匹配**：结构树的筛选框（`outline/StructurePanel.tsx:302`）匹配的就是 `itemLabel` 的结果，**剥离后自动生效**——不需要额外映射，也不要为了"还能搜到标记"而保留源串匹配。
5. **AI 上下文**：前端组装请求前剥离；后端在拼提示词处复用已有的 `strip_style_markers`，**不要新写一份**。

**不做**：不改存储格式、不改编辑态输入框（那里必须保留标记，否则光标与写回链路全乱）、不改导出（后端已消费标记）、不做"显示/隐藏标记"开关。

**风险（最容易引入新 bug 的两处）**
- `changeSummary` 若用剥离后的文本做相等判断，**"只改了颜色"会显示成"没有变化"**。差异判定必须留在源串上（或按结构比对），剥离只用于"展示给人看的文字"。
- 结构树筛选是"过滤"而不是"高亮"，不涉及命中位置映射；**将来**若加带高亮的全文搜索，才需要 raw↔可见 映射（与 DF-4 同一套能力）。

**验收（可观察）**
1. 截图那一行显示"个人项目"，界面上任何位置都不再出现 `{@`；
2. 结构树、分页芯片、条目名、拖拽标签、变更摘要、视图取数六处全部干净；
3. 读屏念出的是可见文字，不含 `{@color=…}`；
4. 搜索"个人项目"能命中；搜 `{@color` 不再命中；
5. `{@size=0.9}未闭合` 这类非法标记在展示里**原样保留**，不吞字；
6. 发给 AI 的上下文不含标记；
7. 编辑输入框里的标记仍隐藏、光标不错位（DF-4 不回归）。

**若只做一部分**：优先做第 1 步（修剥离函数）与第 3 步（展示出口）——这两步就能解决截图里的全部现象；搜索与 AI 上下文可以后置。

### DF-7 左栏滑杆与表单行不随栏宽连续变化（P1，2026-11-18 记录，未修）

**现象**：拖动左栏宽度时，参数滑杆的长度基本不动，只有把栏拉到某个宽度之后才**一下弹长**；「文档模式 / 篇幅上限 / 字段语言 / 联系方式换行 / 联系方式分隔 / 技能每行」这些行也不是随宽度连续调整，而是到某个点整体换一种排法。

**现状机制**

- 参数行**每行都是独立 grid**，列模板写在 `resume-workbench-controls.css:33-44`：`标签 72px ｜ minmax(132px, 152px) ｜ minmax(min-content, 1fr)`。变量定义在 `:17-30`。弹性全给了第三列（读数 + 来源胶囊），所以滑杆恒为 88px，栏变宽只是把胶囊推远。
- 宽档在 `resume-workbench-controls-wide.css:22`：`@container rf-wb-params (min-width: 520px)` 命中后，控件列改成 `minmax(152px, 1fr)`、尾部退回 `min-content`，滑杆这才变长——所以是**断点式**，不是连续式。
- 做成断点的原因（`resume-workbench-controls-wide.css:1-8` 与 `resume-workbench-controls.css:11-37` 的注释）：每行独立 grid 时，若让控件列吃弹性、尾部按内容算，**含"随模板"胶囊的行与不含的行控件列宽度不同**，滑杆右缘与读数左缘立刻错开（2026-11-06 修过三轮的老问题）。
- 第二张图那类行（标签 + 下拉/分段）：`usePanelNarrow.ts:16` 硬阈值 `NARROW_PANEL_WIDTH = 420`，≤420 时把 antd `Segmented` 切成 `vertical`。必须用它的 `vertical` 属性而不是 CSS 强转，原因见该文件 `:1-12`。

**已确认决定（2026-11-18，用户选择）**
- 弹性方案：**JS 量测写 CSS 变量**（不用纯 CSS 定宽尾部，也不直接删断点）；
- 窄到极限：竖排阈值从 420 **降到约 340**，且只对确实挤不下的控件（`Segmented`）生效。

**修法**

1. **一个数值源**：新增（或扩 `usePanelNarrow`）一个量测 hook，用 `ResizeObserver` 盯 `.resume-wb-group-body`，算出
   `controlsWidth = clamp(132px, 面板内容宽 − 标签 72 − 尾部下限 − 两道 6px 间隙, +∞)`，
   写到列根元素的 `--resume-wb-controls-w`。**所有行继承同一个变量**，列宽自然一致，这是"不再错位"的关键。
   - 量测点必须与容器查询的容器一致（`.resume-wb-group-body`）。不要改成整列：`container-type` 会建立包含块，把 `position: fixed` 的 `ChipStylePopover` 困在左栏里（`resume-workbench-controls-wide.css:10-16`）。
   - 变量只写到列根，**不要写 `:root`**（多实例会串）。
2. **CSS**：`minmax(var(--resume-wb-controls-min-w), var(--resume-wb-controls-w))` 两面都吃变量；删除 `@container (min-width: 520px)` 那一档（或只留作兜底，且不再与连续值冲突）。
3. **滑杆**：`flex: 1 1 auto; max-width: none; min-width: 64px`，去掉 `flex: 0 0 88px`（`chip-menu.css:47` 提到的那条规则的来源）。
4. **第二张图的行**：`NARROW_PANEL_WIDTH` 420 → **340**；标签允许 `ellipsis`、控件 `flex: 1 1 auto`；其余行不再随阈值整体换排法。
5. **拖动同步**：`ResizeObserver` 每帧回调直接写变量，**不要防抖**——防抖会退回"松手才跳"，正是本条要修的现象。

**性能注意**：回调里只做「读 `clientWidth` → 算 → 一次 `setProperty`」，不要在写样式后再读布局（避免 forced reflow）。若仍掉帧，用 `requestAnimationFrame` 合并，而不是加防抖。

**风险**
- `workbenchLayoutContract.test.ts` 钉住了"72 + 6 + 132 + 6 + 15px 滚动条"这套算式（`resume-workbench-controls.css:37-42` 注释明说），改完必须同步更新，否则守卫会红——**不要为了让测试变绿去改宽算式**。
- 分边页边距四行的滑杆有 `!important` 定宽（`resume-workbench-controls-wide.css:45-54`），改成连续后这批 `!important` 要一并清理，否则四条滑杆仍不跟随。
- 窄屏（`tier === "one"`）走抽屉，不受本项影响，别顺手改抽屉。

**验收（可观察）**
1. 从最窄拖到最宽，滑杆**连续**变长，全程没有"跳一下"；
2. 同一屏内所有行的 `−`、`+`、读数左缘保持对齐（不能因为某些行没有"来源胶囊"而错开）；
3. 「分边页边距」四行滑杆同样连续、且四条等长；
4. 第二张图的行：控件随宽度拉伸，只有最窄时才竖排 `Segmented`；
5. 拖动过程中不出现横向滚动条、不抖；
6. 更新后的 `workbenchLayoutContract.test.ts` 仍通过；
7. 窄屏抽屉布局无变化。

### DF-8 字段级"缩进"在草稿里不生效，但 PDF 里生效（P1，2026-11-18 记录，未修）

**现象**：属性面板把"缩进"调到 8×，显示"本条已调整"，但右侧草稿预览的文字完全不动。

**更要紧的是：这不是"没生效"，而是"只在一半出口生效"**。PDF 侧用 `role_style("body", object_id=block.path)` 取到字段级覆盖（`backend/app/services/pdf_exporter/document_body.py:106-108`），并在 `:118-124` 把 `indent` 应用为行首偏移——所以导出 PDF 是有缩进的，草稿和 HTML 导出没有。面板值与纸面**脱节**。

**根因（HTML 侧）**

`entry_style_css`（`backend/app/services/resume/resume_style.py:285-300`）对**字段路径**的覆盖只走 `_declarations(field_style)`；而 `_declarations`（`:66-96`）的固定属性集 `_TEXT_PROPS` **不含 `indent` / `bullet` / `meta_align`**。这三个属性在 HTML 侧只有两个合法落点：

- `_INDENT_SELECTOR`（`ul, .body-paragraph`）与 `_BULLET_SELECTOR`（`ul`）—— 角色层用；
- `_object_spatial_rules(prefix, …)` —— 前缀必须是**条目 id**（`[data-object-id="…"]`）。

字段分支两条都没走，生成的 CSS 里根本没有 `padding-left` / `list-style-type`。

**已确认决定（2026-11-18，用户选择）**
- 缩进落点：**作用于承载该字段的块**（`li` / `p`），与 PDF 现有行为对齐；
- 同批范围：**缩进 + 项目符号生效**；`meta_align`（日期位置）在字段层**隐藏**（字段层没有 flex 容器可作用）。

**修法**

1. **给字段作用域补空间规则**（`resume_style.py` 的 field 分支）：
   - 缩进：`li:has([data-resume-path="X"]), p:has([data-resume-path="X"]), .body-paragraph:has([data-resume-path="X"]) { padding-left: calc(var(--fs) * k); }`
   - 项目符号：`ul:has([data-resume-path="X"]) { list-style-type: …; }`
   - 用 `:has()` 而不是给 span 加 `display:inline-block`：后者只推文字、不动符号，与条目级/角色级语义不一致（项目里已在 `modules-layout.css` 用 `:has()`，不是新依赖）。
   - 若 `:has()` 在长文档上有明显开销，退路是让 `path_spans` 给字段所在的**块**打一个 `data-block-for="X"` 标记（要动模板与 planner，成本更大）——**先测再决定**。
2. **字段作用域的属性清单收口**：`OBJECT_STYLE_PROPS`（前端 `styleCatalog.ts`）是对象级 12 项；字段作用域需要一份**独立的、只含真有落点**的清单（去掉 `meta_align`），并让后端写入校验用同一份，避免"面板可调、渲染丢弃"。
3. **面板隐藏**：`ObjectStylePanel` 在字段作用域下不渲染"日期位置"。
4. **加一条守卫用例**：断言"面板可调的每个属性，至少在一个出口产出非空声明"。这条是本缺陷的根因防护——现在没有任何机制阻止"加一个属性、只有 PDF 认"。

**不做**：不改 `format_config` 协议版本；不改 PDF 现有行为（它是对的，把 HTML 补齐即可）；不动角色层与条目层；不改 DOCX（见下面的未确认项）。

**风险 / 未确认**
- **DOCX 未核实**：需要确认 `docx_document_render.py` 对字段级 `indent` 是否生效。若生效，则 DOCX 与 PDF 一致、只差 HTML；若不生效，则是"两个出口各自缺一块"。
- `:has()` 命中的是**块**，一个块里若有多个字段路径（同一 `li` 里既有正文又有要点），缩进会叠加或取谁取决于实现——需要规定"取最大值"或"只认第一个"，并在用例里钉住。
- 面板"本条已调整"只表示 `format_config` 里有键，不表示渲染端支持；本次不修这个指示器，但要记着它放大了本缺陷的误导性。

**验收（可观察）**
1. 字段缩进 8× → 该字段所在行整体右移，同一条目的其他字段不动；草稿与 PDF 表现一致；
2. 字段项目符号改"短横"→ 该行符号变化，其他行不变；
3. 字段作用域不再出现"日期位置"；
4. 条目层与角色层的缩进/符号/日期位置行为完全不变；
5. 同一 `li` 内含多个字段路径时，缩进结果确定且有用例；
6. 新增守卫用例通过：面板属性集 ⊆ 有落点的属性集。

### DF-9 "清除行内格式"对拖选的可见文字无效（P1，2026-11-18 记录，未修）

**现象**：右键菜单点「清除行内格式」，文字没有任何变化，像是坏了。

**根因（可复现到字符）**

`clearInlineMarks`（`frontend/src/features/resume/layout/inlineMarks.ts:345-363`）只在**选区切片**里找标记：

```ts
const selected = text.slice(safe.start, safe.end);
const runs = parseStyleRuns(selected);   // 只看选区内部
```

而编辑态是两层（标记占宽但不可见，见 DF-4）。用户拖选看得见的"个人项目"时，选区落在 `{@color=#c0392b}` 与 `{@}` **之间**——切出来的 `selected` 里一个标记都没有 → `runs` 为空 → 输出与原文逐字相同 → `InlineMarkButtons.commitIfChanged`（`InlineMarkButtons.tsx:190-193`）判定"没变"直接跳过。

`**` 同理：选区内只有一个 `**` 时，`boldPairs % 2 === 0`（`:359-360`）不成立，也不会清。

现有用例只覆盖**全选整串**（`inlineMarks.test.ts:165` 用的是 `{start:0, end:text.length}`），所以这个场景一直没被抓到。

**已确认决定（2026-11-18，用户选择）**
- 语义：**整段清除**——选区碰到哪个格式段，就把那整段的标记去掉；
- 优先级：**P1，与 DF-1—DF-4 同批**。

**修法**

1. 改成在**整串**上解析：用 `parseStyleRuns(text)`（或已暴露的 `placedRuns` 区间）找出与选区**内容区间**相交的 run。
   - 相交判定必须用 run 的 **content 区间**（`contentStart/contentEnd`），不能用整段 raw 区间：否则"光标紧贴 `{@}` 之后"也会被判成相交，误清相邻段。
2. 对每个相交 run：删掉 opener 与 closer，保留内容；多个 run 相交时**从后往前**处理，避免偏移累积。
3. `**` 加粗同规则：相交的整对 `**` 删除；**落单的 `**` 仍原样保留**（现有约束不变，`inlineMarks.test.ts:170-173` 已钉住）。
4. 返回值 `start/end` 要在**新串**上重算（开头标记被删后偏移会变），保证光标或选区仍落在原来那几个字上。
5. 一个相交 run 都没有时返回原文（调用方不产生空历史点）。

**不做**：不改 `applyStyleMark` / `toggleBoldMark`；不改菜单项文案与结构；不改"全选整串"的既有行为。

**风险**
- 整段清除会多清几个字（用户只选了半段）。这是已确认的取舍；若以后想更精确，再做成"拆分只清选区"或拆成两个菜单项（Word 的做法是拆分）。
- 多个相邻 run（`{@a}x{@}{@b}y{@}`）只选 `x` 时，必须只清 `x` 段——相交判定写成"与整段 raw 相交"就会连 `y` 一起清。

**验收（可观察）**
1. `{@color=#c0392b}个人项目{@}` 只选中间两个字 → 结果为 `个人项目`（整段清除）；
2. `**重点**` 只选其中一个字 → 结果为 `重点`；
3. `a{@size=0.9}b` 只选 `a` → 文本不变（无相交 run）；
4. `{@a}x{@}{@b}y{@}` 只选 `x` → 只清 `x` 段，`y` 段保留；
5. 清除后光标/选区落在原文字范围内，不跳到行尾；
6. 全选整串的结果与现有断言一致（`inlineMarks.test.ts:165-168` 不回归）；
7. 落单的 `**` / `{@` 仍原样保留（`:170-173` 不回归）。

### DF-10 新建的条目自定义字段没有名字入口，chip 上直接显示内部键（P1，2026-11-18 记录，未修）

**现象**：点「添加正文后字段」后，chip 上出现 `custom:ob_jhdfjembnz3u` 这样的内部键，看起来像乱码。

**三层证据**

1. `AddFieldMenu.tsx:104-106`（另一条路径 `:147`）新建字段时写的是 `{ key: "custom:" + newObjectId(), label: "" }` —— **label 主动留空**。
2. 标签兜底链在 `document/summarize.ts:167`：`item.label || value || catalogLabel || item.key`。新字段前三项都是空，于是落到 `item.key`。
3. **全仓库没有重命名入口**（`grep "renameField|setItemLabel|item.label ="` 零命中）。唯一能改 `label` 的是**页眉**字段（`HeaderItemEditor.tsx:218` 的 `value={item.label}`），条目字段没有对应输入框。

所以这不是"多显示了一串字"，而是**新建的字段永远没法起名**。

**已确认决定（2026-11-18，用户选择）**
- 命名入口：**新建时弹框填名**（可预填占位），确认后创建；
- 空名字：**允许**，UI 显示「未命名字段」，**任何位置都不再出现 `custom:` 开头的内部键**。

**修法**

1. **新建时弹框**：`AddFieldMenu` 在"自定义字段"分支先开一个命名弹层（仓库约定用 `components/common/FormModal` + `useFormDraft`），确认后把 `label` 一起传给 `defaultFieldItem`；取消则不创建、不产生空历史点。
2. **`defaultFieldItem` 支持 `label` 入参**（默认空串），不要在调用点直接改对象。
3. **兜底文案**：`summarize.ts` 的 `itemLabel` 最后一档 `item.key` 换成 i18n 的「未命名字段」（新增 `document.field.unnamed`）。**所有走 `itemLabel` 的位置一起生效**：结构树、chip、分页芯片、拖拽标签、变更摘要。`ItemChip.tsx:263` 的 `aria-label` 同批处理（与 DF-6 有交集）。
4. **老数据**：历史 `label: ""` 的字段显示「未命名字段」，不做迁移、不回写。

**不做**：本次**不给条目字段加内联/右键改名**（用户选的是"只弹框"；页眉字段已有输入框，保持不变）；**不改 key 的生成规则**。

**风险**
- **绝不能把 key 改成人类可读**：`custom:` 前缀是多处逻辑的判据——`bilingual/fieldPairs.ts:48`、`document/coverageGroups.ts:131`、`document/fieldCatalog.ts:204-205` 的自建字段分支、后端 coverage 都按这个前缀判断。改格式会连带破坏。
- `label` 只用于显示，但仍要限长（与 chip 宽度/省略规则一致），否则长名字会把 chip 撑开。
- 兜底文案是"散点"修改，容易漏；建议加一条守卫用例：渲染一个 `label === ""` 的自定义字段，断言 DOM 文本**不含** `custom:`。

**验收（可观察）**
1. 新建字段 → 弹框 → 填"证书编号" → chip 显示"证书编号"；
2. 名字留空 → chip 显示"未命名字段"，文本与 `aria-label` 都不含 `custom:`；
3. 取消弹框 → 不创建字段、不产生空历史点；
4. 老数据（`label` 为空）打开即显示"未命名字段"；
5. 结构树、chip、分页芯片、拖拽标签、变更摘要五处显示一致；
6. 新建字段仍能正常写入、保存、导出（key 未被改动）。










## 5. 交付约定

- **每项一次独立改动，但不做 commit / push**（用户未要求；收尾后由用户决定怎么提交）。
- 每项都要带**能在修复前失败、修复后通过**的回归用例；改到守卫类断言（如 `formatPainterRemoved.test.ts` 这种）必须先做反证。
- 多项同改语言包时由同一人统一落，避免并发覆盖；`docs/**`、`CHANGELOG.md`、`doc-registry.json` 同样单写者。
- 不新增依赖、不改 schema、不加迁移。
- **前端只跑相关用例 + 对改动文件跑 `prettier`/`eslint`/`tsc`**；**不跑** `pnpm build`、不跑全量 `test`、不跑 `test:coverage`（用户收尾统一跑）。
- **会触及后端的项**：QW-6、DF-8、DF-6（AI 上下文）。这三项补 `ruff check` 与**相关** pytest 文件，同样不跑全量、不跑覆盖率。
- 界面文案改动同步四处：`userGuideSteps.ts` → `docs/user-guide.md` → `README.md` → `CHANGELOG.md`（若该项没有新增用户可见文案，可跳过）。
- **本文档只追加、不改写**：它曾被另一条会话并发编辑过；执行方需要补充信息时在对应小节末尾追加，不要重排或重写全文。

## 6. 本轮决策与边界（2026-11-18）

| 编号 | 决定 | 影响 / 约束 |
|---|---|---|
| S1 | `resume-workbench-wordlike-plan-20261118.md`（W01—W19）**整体搁置** | 不实施、不改代码。理由：体量与风险不匹配，且没有新旧并存方案，做一半会同时存在两套格式语义。该文档转 `historical` 留档 |
| S2 | 只保留 7 项可独立交付的增量（QW-1—QW-7） | 均不依赖段落身份、不升格式协议、不改三套渲染器；每项可独立回退，不需要 feature flag（QW-6 需要同批改纸面与前后端白名单，但不动协议版本） |
| S3 | 明确不做：段落身份（W03）、pt/mm 绝对单位（W04）、标尺（W08）、Proview（W09）、四档工作区模式（W13）、版面优化器（W15）、属性面板整体重构（W02） | 因此 QW 全部做完后，用户**仍然不能**"只把第二段字号改成 11 pt"；这是刻意取舍，实施时不得顺手扩张 |
| S4 | 幽灵字段 `section.layout.keep_together`：显示为"旧版规则"并可单独清除，新建简历不再产生 | 对应 QW-3；不迁移历史数据、不改渲染端消费逻辑 |
| S5 | DF-1 修法：行为修复 + 层级归一；优先级 P0 | 见 §4。行为修复解决"浮条压住行内菜单"，层级归一解决"浮条压住投投卡片"；两者不可互相替代 |
| S6 | 本轮不改任何业务代码 | 只动 `docs/`（本文与登记表、索引），代码基线仍为 `509c28d0` |
| S7 | DF-2 修法：**透明遮罩层**（不桥接 iframe）+ **左键也关**（`hostRef` 豁免只留给右键）；默认优先级 P1 | 见 §4。遮罩挂在弹层 stacking context 内，天然覆盖纸面 iframe；菜单开着时点不动纸面属于预期 |
| S8 | DF-3 规则：**下方优先，放不下翻到光标上方**（底边贴光标）；P1，与 DF-1 / DF-2 同批 | 见 §4。翻转判定用打开时的实测高度；"插入链接…"造成的增高用 `max-height` 兜底，不推动主菜单跳动 |
| S9 | DF-4 处理：**遮罩层自绘选区**（只高亮可见文字），不加淡底纹、不只加说明；P1，同批 | 见 §4。等于提前做 I-26 阶段 3 的坐标映射，开工前必须先补"raw ↔ 可见偏移"往返用例；`::selection` 底色改为透明，组合期例外恢复 |
| S10 | DF-5 处理：颜色按钮改**中性图标**（不再用色块），面板初值由强调红改为**正文黑 `#111111`**；默认 P2 | 见 §4。保持非受控、不反推"选区已有颜色"；色板是数据不是主题变量，两处重复的 `COLOR_PRESETS` 建议收拢到 `inlineMarks.ts` |
| S11 | DF-6 范围：**可见文字 + aria-label + 搜索匹配 + AI 上下文**都剥离；编辑输入框保留标记；P1 | 见 §4。**顺序不可颠倒**：先修 `stripInlineMarks`（当前会吞掉未识别片段，与后端 `strip_style_markers` 语义相反），再接展示层；`changeSummary` 的相等判断必须留在源串上（否则"只改颜色"会显示成"没变化"） |
| S12 | DF-7 方案：**JS 量测写 `--resume-wb-controls-w`**（所有行共享一个值）+ 竖排阈值 420 → **340**；默认 P1 | 见 §4。量测点必须与容器查询容器一致（`.resume-wb-group-body`），变量只写到列根；拖动时**不要防抖**，否则退回"松手才跳" |
| S13 | QW-6 范围：基本信息的**字段名 + 字段值**都支持逐字段调参；标签段**可点击定位** | 见 §2。四处必须同批：纸面拆段（`plan_header`）、前后端路径白名单（另加 header 规则，不放宽三段规则）、`content_field_paths` 纳入 header、面板作用域与 header 角色映射 |
| S14 | DF-8 修法：字段级缩进/符号**作用在承载该字段的块**（`li:has(...)` / `ul:has(...)`），与 PDF 对齐；`meta_align` 在字段层隐藏 | 见 §4。别给 span 加 `display:inline-block`（只推文字、不动符号）；收口字段作用域的属性清单并加"面板可调 ⊆ 有落点"的守卫；DOCX 行为未核实，实施前先确认 |
| S15 | QW-7 方案：滚轮**连续**（按 `deltaY` 指数）+ `+/-` **5% 按可见百分比**；**以光标为锚点**补偿滚动；**不加过渡** | 见 §2。不动 `transform-origin` 与 scale-box 宽高算式；处理 `deltaMode` 与触控板横滑；连续缩放下不吸附档位 |
| S16 | DF-9 语义：**整段清除**（选区碰到哪个格式段就清整段），不平分拆；P1 同批 | 见 §4。相交判定必须用 run 的**内容区间**，不能用整段 raw 区间；多 run 从后往前处理；落单 `**` 仍保留 |
| S17 | DF-10 方案：新建自定义字段时**弹框填名**（可留空）；空名显示「未命名字段」，永不显示 `custom:`；P1 | 见 §4。**不改 key 生成规则**（`custom:` 前缀是 `fieldPairs` / `coverageGroups` / `fieldCatalog` 的判据）；兜底散点多，加一条"DOM 不含 `custom:`"的守卫 |












**留给后续决策的三件事**（本文不预设结论）

1. 浮条是否要彻底低于 Modal 内 antd 弹层：需把层级降到 3210 左右，但会被 Drawer/嵌套 Modal（3300）盖住，必须先做浏览器实测。
2. QW-5 的载荷预算具体数值：通用表单的 32KB 不适用，实施时按"典型简历 + 版式"实测后再定上限。
3. QW-2 部分成功时的文案措辞（"版式已保存，正文未保存"是否需要更短的版本）。

## 7. 执行编排（难度优先 + 文件不重叠的并行轨道）

> 本节是给"执行方 agent"的施工图；上面 §2/§4 是"做什么、为什么"，这里只回答"按什么顺序、谁和谁能并行、怎么算做完"。

### 7.1 任务总表（按难度降序 = 建议开工顺序）

| 序 | ID | 任务 | 难度 | 主要落点 | 轨道 |
|---:|---|---|---|---|---|
| 1 | QW-6 | 基本信息字段名/值逐字段调参 | 高 | `document_plan.py`、`field_style_target.py`、`fieldStyleTarget.ts`、`ObjectStylePanel.tsx`、`styleCatalog.ts` | T1 |
| 2 | DF-4 | 遮罩层自绘选区（raw↔可见映射） | 高 | `inlineMarkRuns.ts`、`InlineMarkTextArea.tsx`、`InlineMarkOverlay.tsx`、`inline-mark-overlay.css` | T2 |
| 3 | DF-7 | 左栏连续弹性（量测写 CSS 变量） | 高 | `resume-workbench-controls*.css`、`usePanelNarrow.ts`、`WorkbenchParamsColumnV2.tsx` | T3 |
| 4 | QW-5 | 会话草稿恢复（同标签页） | 高 | 新增 `useWorkbenchResumeDraft.ts`、`ResumeWorkbenchV2.tsx`、`useWorkbenchV2Save.ts` | T4 |
| 5 | QW-7 | 缩放精细丝滑（连续 + 光标锚点） | 中高 | `usePreviewZoom.ts`、`ResumePreview.tsx`、`ResumePreviewCanvas.tsx` | T3 |
| 6 | DF-9 | "清除行内格式"整段清除 | 中 | `inlineMarks.ts` + 用例 | T2 |
| 7 | DF-8 | 字段级缩进/符号落到所在块 | 中 | `resume_style.py`、`styleCatalog.ts`、`ObjectStylePanel.tsx` | T1 |
| 8 | DF-6 | 行内标记源串剥离（六处 + AI） | 中 | `stripInlineMarks`、`summarize.ts`、`changeSummary.ts`、`view.ts`、`ItemChip.tsx` | T2 |
| 9 | DF-10 | 自定义字段命名（弹框 + 兜底文案） | 中 | `AddFieldMenu.tsx`、`summarize.ts`、i18n | T2 |
| 10 | QW-2 | 保存结果说诚实（两维结果） | 中 | `useWorkbenchV2Save.ts`、`ResumeWorkbenchActionBar.tsx`、i18n | T4 |
| 11 | QW-3 | 幽灵字段可见可清 | 中 | `paginationBreaks.ts`、`SectionPaginationPanel.tsx`、i18n | T4 |
| 12 | QW-4 | 全局字号精确输入 | 中 | `FontSizeControl.tsx` | T3 |
| 13 | DF-2 | 菜单点外关闭（透明遮罩） | 中低 | `InlineMarkContextMenu.tsx`、`inline-mark-menu.css` | T2 |
| 14 | DF-3 | 菜单落点翻转 | 中低 | `InlineMarkContextMenu.tsx` | T2 |
| 15 | DF-1 | 划词浮条遮挡（行为 + 层级） | 低 | `TouTouSelectionMenu.tsx`、`design-tokens.css` | T5 |
| 16 | DF-5 | 颜色按钮中性化 | 低 | `InlineMarkButtons.tsx`、`inlineMarks.ts` | T2 |
| 17 | QW-1 | 撤销/重做按钮 | 低 | `ResumeWorkbenchActionBar.tsx`、`ResumeWorkbenchV2.tsx`、i18n | T4 |

### 7.2 并行轨道（同一轨道内**串行**，跨轨道才并行）

| 轨道 | 包含 | 为什么这样切 |
|---|---|---|
| T1 | QW-6 → DF-8 | 两者都改 `ObjectStylePanel` + `styleCatalog` + `resume_style.py`，同一批人顺序做不会互相覆盖 |
| T2 | DF-4 → DF-9 → DF-6 → DF-10 → DF-2 → DF-3 → DF-5 | 全部围绕行内标记与字段显示；`inlineMarks.ts` / `summarize.ts` 是共享文件，必须一个写入者 |
| T3 | DF-7 → QW-7 → QW-4 | 都在左栏/预览区，`FontSizeControl` 与参数栏 CSS 有交叉 |
| T4 | QW-5 → QW-2 → QW-1 → QW-3 | `ResumeWorkbenchActionBar` 与 `useWorkbenchV2Save` 被 QW-1/2/5 共用 |
| T5 | DF-1 | 独立（tou-tou 域），可与任何轨道并行 |

**硬约束**
- 跨轨道文件不重叠才可并行；同一文件出现两个写入者时，后开的那个必须停下来等。
- **i18n 语言包由一个人统一落**（每条新增 key 只提交"需要什么"，不各自改 `zh-CN.*.ts`）。这条最容易在并行时冲突。
- `docs/**`、`CHANGELOG.md`、`doc-registry.json` 同样单写者。
- 并行不是目的：轨道之间没有依赖就并行，有依赖宁可串行，不做"先合并再修"。

### 7.3 完成定义（DoD，任一项必须全满足才算 done）

1. 代码改动落在 §2/§4 指定的落点文件（或注明的等价位置），没有顺手改无关文件；
2. 该项"验收（可观察）"里的每一条都逐条走查过，结果写进 `STATE.md`；
3. **实机截图**已存在 `deliverables/resume-workbench-20261118/screenshots/`，文件名以任务 ID 开头；
4. 只跑了**相关**用例与静态检查（见 §8.5），全量测试**不跑**（用户统一跑）；
5. 没有引入新的 `TODO/FIXME`，没有把"以后再说"写成注释里的承诺；
6. `STATE.md` 该行状态更新为 `done`，并写明改动文件与证据；
7. 该项至少新增/更新一条用例，且**修复前会失败、修复后通过**；改到守卫类断言还要做反证（改坏 → 精确变红 → 复原）。

## 8. 每项验证协议（实机 + 真实数据 + 截图 + 自动返工）

### 8.1 启动链（不要用空库、不要只跑单测）

```bash
# 后端（必须用 venv 的 python，系统 python 缺 pypinyin 会静默退出）
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005

# 前端（必须带 VITE_BACKEND_URL，默认代理打 8000，漏了会"页面能开、接口全拒连"）
cd frontend && VITE_BACKEND_URL=http://127.0.0.1:8005 pnpm exec vite --port 5173 --strictPort
```

需要长期存活时改用 `scripts/Start-ResumeForge.ps1 -FrontendMode production -NoBrowser`（手工 `Start-Process` 起的后端约 5 分钟会被回收）。

### 8.2 真实数据要求

- 必须用**本地现有数据集里的真实简历**：至少包含 1 份带颜色/加粗行内标记、1 条含要点列表的条目、1 个自定义字段。
- **不允许**用空白新建简历充当证据（"空库冒烟 ≠ 本地有数据"）。
- 涉及数据集切换后，用 `POST /api/settings/datasets/<id>/activate` + `X-Dataset-Scope` 恢复，避免 409。
- 改了数据要先备份（整库快照），验证完恢复原状。

### 8.3 截图

- 存 `deliverables/resume-workbench-20261118/screenshots/<ID>-<序号>-<说明>.png`；
- 用 Playwright 时**先写 `resumeforge.user-guide.seen=1`**（`addInitScript`），否则首访指南弹窗会盖住整页；
- 本机 playwright 在 `frontend/node_modules/.pnpm/playwright@1.64.1/...`，`require("playwright")` 解析不到，要用绝对路径；
- 前后对比类改动（如 DF-7、QW-7）**必须**给"改前 / 改后"两张，否则无法判断。

### 8.4 自动返工

- 每项实机走查后与 §2/§4 的"验收"逐条比对：**有一条不符就返工，不许写进报告"基本符合"**。
- 单任务最多返工 **2 轮**；第 2 轮仍不符 → 状态置 `blocked`，写清"卡在哪条验收、证据是什么、怀疑原因"，继续下一项，不要死磕。
- 返工时先看快照再改，**禁止** `git checkout --` / `git stash` / `git restore`（会连带回滚别人的未提交改动）。

### 8.5 测试口径（用户明确要求：不跑全量）

| 改动类型 | 跑什么 | 不跑什么 |
|---|---|---|
| 前端纯函数/hook | 只跑对应的 `Xxx.test.ts(x)` | 不跑 `pnpm test` 全量、不跑 `test:coverage` |
| 前端组件 | 对应组件用例 + `tsc --noEmit`（或只对该文件 `prettier --check`） | 不跑全量 lint/build |
| 后端服务 | 只跑相关 `pytest -q <file>` | 不跑全量 pytest、不跑覆盖率、不跑 `pip check` |
| 守卫/检查脚本 | 反证：先改坏 → 目标用例精确变红 → 复原 | — |

交付时在报告里写明"哪些检查**没有**跑、为什么"，把全量留给用户。

## 9. 中断接续协议（额度断了就靠这一节）

**状态文件**：`deliverables/resume-workbench-20261118/STATE.md`（已在本次创建，含 17 行空表）。

- 每完成一项（或每次上下文即将用尽）就更新该行：`状态 | 改动文件 | 证据（截图/命令） | 返工次数 | 备注`。
- **每次开工第一件事**：读 `STATE.md` + 本文 §7.1，再执行 `git rev-parse --short HEAD` 与 `git status --porcelain`，确认工作区里有哪些是上一轮留下的。
- 新对话接续：从 §7.1 里**第一个状态不是 `done` 的任务**继续；已 `done` 的不重做（除非用户说效果不对）。
- **不要**重新规划任务、不要改 §7 的顺序、不要"顺手优化"已完成项。
- 若某项处于 `doing` 但没有任何改动痕迹，视为 `todo` 重做；若已有改动，先审查改动再决定继续还是回退到快照。
- 回滚只能按快照：改动前把要动的文件复制到 `deliverables/resume-workbench-20261118/snapshots/<ID>/`（保持相对路径），回退时按文件覆盖。

## 10. 最终报告要求

全部做完（或触发停止条件）后，在对话里输出并同时落盘 `deliverables/resume-workbench-20261118/REPORT-<YYYY-MM-DD>.md`，至少包含：

1. **TL;DR**：17 项里完成几项、阻塞几项、有无返工后仍不达标的；
2. **总表**：`ID | 状态 | 改动文件 | 截图 | 返工次数 | 备注`；
3. **逐项说明**：改了什么、为什么这么改、验收逐条结论；
4. **用户自验清单**：分成"5 分钟能验完的"与"需要细看的"两档，每档写清"打开哪个页面 → 做什么 → 应该看到什么"；
5. **未完成 / 阻塞项**：卡在哪条验收、证据、怀疑原因、建议下一步；
6. **没有跑的检查**：明确列出（全量 pytest、覆盖率、构建等），并给出建议命令；
7. **风险与遗留**：本次引入的已知取舍、需要用户决策的点。


