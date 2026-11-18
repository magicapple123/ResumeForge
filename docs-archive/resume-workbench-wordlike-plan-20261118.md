# 简历制作台 Word 式操作改造清单

> **历史记录（2026-11-18 已搁置）**：本文是讨论中的方案快照，未实施、未改任何业务代码；与现状不一致处以此为准。

> 日期：2026-11-18。状态：产品方向已确认，详细实施方案待执行。
> 本文是讨论中的持续清单，不代表所有问题已经问完，也不代表功能已实现。
> 当前会话仅讨论、核对代码和维护方案文档；禁止据此自行开始修改业务代码、迁移数据、提交或发布。

## 1. 范围、基线与决定

目标：在现有 ResumeForge 制作台上统一工具组织、选中范围、精确输入、术语、样式与分页操作，使用户能够明确地完成“选择目标 → 调整格式 → 查看结果 → 撤销或保存”。

本次范围是学习 Word 的操作逻辑。外部 PDF 导入、任意 PDF 还原编辑、全面纸面文字光标编辑、自由浮动文本框和用户自建命名样式没有进入本期实施范围。本期纸型明确为 A4；Letter 与任意自定义纸型留作后续扩展。后续如确认这些需求，另加清单，不能借本次改造默认扩张。

- 代码基线：`509c28d0`；本轮开工时 `git status --porcelain` 为 0 条。
- 核对方式：只读源码、类型、测试定义与项目规范；没有启动应用或运行功能测试。
- 本文由本轮对话创建并持续扩充；此前 W01—W12 已在本文，竞品复核新增 W13—W19。
- 所有实施勾选框初始均未完成。源码证据说明当前结构，不表示运行验证已通过。
- 后续执行前重新记录 HEAD、他人未提交改动和相关测试基线；文件位置、行数以执行时仓库为准。
- 代码路径按仓库根目录描述，Markdown 链接相对本文；任务编号沿用本轮讨论的 W01—W19，区别于历史同名计划。

### 1.1 用户已经明确确认的决定

| 编号 | 决定 | 实施约束 |
|---|---|---|
| D01 | 采纳工具归位、选中范围、精确输入、术语统一，以及样式、交互、分页改进方向 | W01—W12 为首轮清单；竞品复核补入 W13—W19 |
| D02 | 第一阶段完善已有角色样式、局部覆盖、恢复继承与格式复制 | 不增加用户自建命名样式管理 |
| D03 | 标尺可拖动页边距与当前段落缩进，数字输入同步 | 不能仅交付只读刻度 |
| D04 | 显式设为 11 pt 的字段保持 11 pt；继承样式的内容才随上层改变 | 绝对单位必须真实保存，不能显示 pt、实际仍存相对比例 |
| D05 | 同一字段内只调整光标所在段；选中多段则一起调整 | 需要段落身份、范围解析与格式存储；整字段调整不等同于此能力 |
| D06 | 新建简历默认标题与后文同页、启用跨页上下各至少两行的孤行控制 | 旧简历维持旧效果，主动应用新规则后才切换 |
| D07 | 分别提供“尽量保持整个板块完整”和“让板块内每条内容各自保持完整” | 两种语义独立，不复用一个含义模糊的开关 |
| D08 | 本期只完成 A4 编辑与分页，不纳入 Letter | 标尺、页面数据、预览、PDF/DOCX 与分页测试均先闭合 A4；其他纸型另立后续任务 |
| D09 | 采纳竞品复核中与现有架构兼容的补强建议 | 接入已有工作区、恢复、优化、检查、模板和变体能力；不重复建设平行子系统 |

### 1.2 方案默认与实施冻结点

除 D01—D09 外，本文标明的具体交互、默认值和模块名称是建议采用的实施方案，不冒充用户逐条确认过的决定。常规细节按本文推进；若必须改变公共接口、现有文档语义或保存工作流，应先拿出具体兼容方案再确认。

编码前必须冻结：段落元数据的存储形状、格式域版本与旧客户端行为、绝对值和旧比例的互斥规则、分页新旧语义标记、跨格式测试矩阵。冻结不等于要求本次讨论会话开始写代码。

## 2. 当前代码事实与复用边界

| 核对结果 | 代码依据 | 对方案的影响 |
|---|---|---|
| v2 制作台统一持有正文、版式、历史和选择 | [ResumeWorkbenchV2](../frontend/src/features/resume/editor/ResumeWorkbenchV2.tsx)、[useWorkbenchV2History](../frontend/src/features/resume/editor/useWorkbenchV2History.ts) | 只扩展现有状态链，不另建文档或撤销栈 |
| 顶栏有保存、放弃、导出、检查、版本，没有撤销/重做接口 | [ResumeWorkbenchActionBar](../frontend/src/features/resume/editor/ResumeWorkbenchActionBar.tsx) | 撤销能力已有，需接线与展示 |
| 左栏并列参数、结构、双语、表达资产、来源、历史 | [WorkbenchParamsColumnV2](../frontend/src/features/resume/editor/WorkbenchParamsColumnV2.tsx) | 需要任务分组和明确的主入口 |
| 字段样式、条目排版、内容编辑分散在不同位置 | [DocumentEditor](../frontend/src/features/resume/editor/DocumentEditor.tsx)、[ChipStylePopover](../frontend/src/features/resume/editor/ChipStylePopover.tsx)、[StructureTab](../frontend/src/features/resume/outline/StructureTab.tsx) | 统一选择与属性面板，快捷入口共用命令 |
| 已有单选、多选、悬停和定位来源控制 | [useWorkbenchSelectionSync](../frontend/src/features/resume/editor/useWorkbenchSelectionSync.ts) | 保留“点击纸面不再次滚纸面”的契约 |
| 全局字号是滑杆/加减/只读数值，局部已有数字输入 | [FontSizeControl](../frontend/src/features/resume/layout/FontSizeControl.tsx)、[StyleValueRow](../frontend/src/features/resume/layout/StyleValueRow.tsx) | 统一精确输入，而非重复造另一套数值控件 |
| 六个固定角色、对象覆盖、对象角色/字段覆盖已经存在 | [styleOverrides](../frontend/src/features/resume/layout/styleOverrides.ts)、[resume_style_types](../backend/app/services/resume/resume_style_types.py) | 完善继承及有效值呈现 |
| 多数局部长度是字号倍数；只有一个通用 indent 和倍数 line_height | [resumeStyleParams](../frontend/src/utils/resumeStyleParams.ts)、[resume_style_schema](../backend/app/services/resume/resume_style_schema.py) | 绝对字号、左右/首行/悬挂缩进和固定行距需前后端扩展 |
| 字段/正文是字符串，列表 values 是字符串数组 | [resumeDocument](../frontend/src/types/resumeDocument.ts)、[resume_document](../backend/app/schemas/resume_document.py) | 没有足以承载本期要求的稳定段落级格式模型 |
| 格式刷曾因复制差异难预测而下线，固定当前样式仍存在 | [styleFreeze](../frontend/src/features/resume/layout/styleFreeze.ts)、[formatPainterRemoved.test](../frontend/src/features/resume/layout/formatPainterRemoved.test.ts) | 本次重新定义有效格式复制，须更新旧产品守卫 |
| 文字级别是四项格式补丁，不是命名样式引用 | [textLevels](../frontend/src/features/resume/layout/textLevels.ts) | 与角色样式分开解释，不能伪称已有自建样式体系 |
| 专业视图/辅助线已有代码，生产源码未发现 Provider 的挂载点 | [ProviewContext](../frontend/src/features/resume/preview/ProviewContext.tsx)、[ResumePreview](../frontend/src/features/resume/preview/ResumePreview.tsx)、[guideGeometry](../frontend/src/features/resume/preview/guideGeometry.ts) | 接入当前宿主前先复核，复用已有能力；未做浏览器确认 |
| 板块分页汇总只列 start_on_new_page，恢复自然分页也只清板块断页 | [paginationBreaks](../frontend/src/features/resume/pagination/paginationBreaks.ts) | 清除操作必须明确范围，不宣称一键清全部 |
| 板块 keep_together 的前端注释与后端消费不一致；PDF 与 DOCX 行为也有差别 | [PDF document_render](../backend/app/services/pdf_exporter/document_render.py)、[docx_document_render](../backend/app/services/docx_document_render.py) | 旧字段要兼容，新两种保持语义必须明确区分 |
| 格式域目前只接受版本 1，更高版本被忽略；样式属性和条目有配额 | [formatDomains](../frontend/src/features/resume/layout/formatDomains.ts)、[resume_config_domains](../backend/app/services/resume/resume_config_domains.py)、[resume_style_schema](../backend/app/services/resume/resume_style_schema.py) | 新能力不能只增加 JSON 字段，必须同步协议、配额与丢失防护 |
| 工作区已有 default/writing/typography/delivery 面板预设，但当前 v2 制作台未发现接线 | [workspacePresets](../frontend/src/features/resume/preview/workspacePresets.ts)、[ResumeWorkbenchV2](../frontend/src/features/resume/editor/ResumeWorkbenchV2.tsx) | W13 复用模式，只加集成、入口及回归，不再造一套面板布局状态 |
| 通用会话草稿 hook/存储存在，尚未发现 v2 简历文档接入；存储带 dataset 隔离、24h TTL、32KB 上限 | [useFormDraft](../frontend/src/hooks/useFormDraft.ts)、[formDraftStorage](../frontend/src/utils/formDraftStorage.ts) | W14 沿用 sessionStorage 隐私原则，但需简历专用载荷、容量边界及版本冲突处理；不能盲套 32KB |
| 版面优化器已有字号锁、最小边距、候选变化/可读性展示及无可行方案原因 | [LayoutOptimizerPanel](../frontend/src/features/resume/optimizer/LayoutOptimizerPanel.tsx)、[constraints](../frontend/src/features/resume/optimizer/constraints.ts) | W15 升级到新绝对单位、段落和分页约束，不另建优化器 |
| 预检已有多层检查、产物机器文本视图和问题修复，缓存有范围 | [PreflightModal](../frontend/src/features/resume/preflight/PreflightModal.tsx)、[CheckPanel](../frontend/src/features/resume/preflight/CheckPanel.tsx)、[ScannerReadView](../frontend/src/features/resume/preflight/ScannerReadView.tsx)、[preflightCache](../frontend/src/features/resume/preflight/preflightCache.ts) | W16 补“定位—修改—旧结果失效—复检”，不另建 ATS 检查器 |
| 模板试用/对比、选择保留或清理覆盖、具名版式预设都已有 | [TemplateTrialPanel](../frontend/src/features/resume/template-trial/TemplateTrialPanel.tsx)、[layoutWithFormatPreset](../frontend/src/features/resume/layout/layoutWithFormatPreset.ts)、[FormatTemplateEditorModal](../frontend/src/features/templates/FormatTemplateEditorModal.tsx) | W17 展示采纳差异并升级单位/域语义；具名版式不等于 D02 排除的任意命名段落样式 |
| 岗位变体选择性同步已存在；当前场景条展示生成时冻结的历史场景快照 | [VariantsPanel](../frontend/src/features/resume/versions/VariantsPanel.tsx)、[ScenarioContextBar](../frontend/src/features/resume/editor/ScenarioContextBar.tsx) | W18 新增当前编辑目标身份与传播范围说明时，不改写历史快照含义 |
| 隐藏字段属于当前 ResumeDocument；个人资料库有独立边界，隐藏位置恢复也有字段类型差异 | [mutations](../frontend/src/features/resume/document/mutations.ts)、[placement](../frontend/src/features/resume/document/placement.ts) | W18 分清本稿隐藏、本稿移除与个人资料删除；页眉位置恢复另测 |
| 预览和 PDF 当前几何采用 A4 | [preview config](../frontend/src/features/resume/preview/config.ts)、[PDF layout](../backend/app/services/pdf_exporter/layout.py) | D08 固定本期 A4；标尺读取页面几何，Letter 不通过比例假装支持 |

## 3. 主改造清单 W01—W19

### W01 工具归位与轻量功能区

- [ ] 固定动作区：保存、撤销、重做、导出；保留可理解的保存状态、失败与冲突出口。
- [ ] 功能区按常用、插入、布局、设计、检查、视图组织；按目标是否适用展示能力。
- [ ] 将现有 default/writing/typography/delivery 面板预设接入 v2；默认、内容撰写、精细排版、投递检查四档只控制面板与命令可见性，画布始终保留。
- [ ] 常用组优先显示高频格式；高级精确单位与低频分页规则按当前选中目标展开，提供稳定的搜索/命令入口，不另造“简易编辑器”和“高级编辑器”两份状态。
- [ ] 常用：字体/字号、颜色、对齐、段落间距、格式复制；只展示全链路支持的操作。
- [ ] 插入：沿用添加板块、条目、字段、照片现有能力；不额外混入任意浮动对象设计。
- [ ] 布局：页边距、分栏、列宽/列间距、段落与分页；设计：模板、版式、角色样式。
- [ ] 左栏保留结构导航、当前对象详细属性和专项页签；继续使用现有三栏与窄屏抽屉。
- [ ] 建立命令对照表，列出每条命令的主入口、快捷入口、目标范围、禁用原因、历史写入方式。
- [ ] 可见按钮、右键和快捷键使用同一动作与校验，不各自维护状态。

落点：`editor/ResumeWorkbenchActionBar.tsx`、`WorkbenchParamsColumnV2.tsx`、`WorkbenchParamsTab.tsx`、`WorkbenchColumnsBody.tsx`、`WorkbenchPanelsDrawer.tsx`（均位于 `frontend/src/features/resume/`）。

验收：三种宽度档都能访问全部能力；模式切换不改变正文、版式、历史、选中或画布；偏好恢复与默认重置不清除辅助线以外的其他偏好；无重复保存出口；功能区不遮挡画布和关闭控件；失效命令有具体原因；中英文与键盘访问均可用。

### W02 统一选中范围与属性面板

- [ ] 属性面板显示对象路径、范围与属性来源；支持全文、角色、板块、条目、字段、段落、多段。
- [ ] 文字选区与对象选中分别表示；段落设置按涉及段落处理，不误作字符格式。
- [ ] 多选显示相同值或“多个值”；布尔使用混合状态；批量写入只修改用户触碰的属性。
- [ ] 无有效对象时显示明确空态，不悄悄改全文；全文设置通过显式入口进入。
- [ ] 同步结构树、中栏和纸面定位；纸面点击只定位编辑器，避免二次滚动。
- [ ] 选中内容锁/排版锁、隐藏项、已删除项及只读宿主按既有约束处理。
- [ ] 区分“当前简历隐藏”（只影响本稿上纸面）、“从当前简历移除”和“删除个人资料”；三个动作的影响范围必须在执行前可见。
- [ ] 当前稿的隐藏状态不能改动个人资料库或另一份简历；岗位变体的同步只改用户选择的对象/路径。
- [ ] 点击工具栏/标尺不丢失最后有效的编辑目标；切文档、关闭制作台则清理相关状态。

落点：[useWorkbenchSelectionSync](../frontend/src/features/resume/editor/useWorkbenchSelectionSync.ts)、[fieldStyleTarget](../frontend/src/features/resume/layout/fieldStyleTarget.ts)、[lastFocusedTextarea](../frontend/src/features/resume/editor/lastFocusedTextarea.ts)。

验收：单选、多选、切简历、删除选中项、隐藏项、输入框失焦后操作均不串目标；混合值不在仅打开面板时被写回；在 A 稿隐藏经历不影响个人资料和 B 稿；恢复位置遵守条目类型规则，并覆盖页眉既有回退行为。

### W03 段落身份、选区与格式存储

- [ ] 扩展可独立排版的段落身份，覆盖 text、正文 field 和列表要点；不把自动折行当新段落。
- [ ] 推荐采用与既有 item 关联的可选段落元数据，保持正文只有一个权威来源；最终字段名/版本先冻结。
- [ ] 元数据应包含稳定段落 ID、与当前正文的对应关系和局部段落格式；单纯固定数组序号或永久字符偏移不够。
- [ ] 输入框登记包含 document/item 身份与当前光标/选区，复用已有行内选区基础，不能仅凭某个 DOM 节点全局猜目标。
- [ ] 建立段落拆分、合并、插入、删除、列表重排、粘贴、撤销的确定性重映射。
- [ ] 建议 Enter 新建段落并继承原段格式；合并保留前段格式；跨段粘贴沿用目标格式；软换行需独立标记，不能与段落边界混为一个换行符。
- [ ] 旧字符串可在内存构建段落索引，不因 GET 或打开制作台回写；第一次主动编辑/保存才写新增元数据。
- [ ] AI 改写、资料填入、来源采纳、版本恢复等替换正文的入口必须使用同一映射规则；不能可靠对应时不把旧格式随机贴到新段，保留撤销路径并说明重置范围。
- [ ] 原字段路径、来源、锁、差异比较和导出仍能识别原对象；补充新段落身份的保存、复制及备份往返测试。

落点：[resumeDocument](../frontend/src/types/resumeDocument.ts)、[resume_document](../backend/app/schemas/resume_document.py)、[ItemEditor](../frontend/src/features/resume/editor/ItemEditor.tsx)、[InlineMarkTextArea](../frontend/src/features/resume/editor/InlineMarkTextArea.tsx)、文档 mutations 与保存归一化层。

验收：只改字段第二段，第一/三段不变；在前面加段后原样式仍跟随原段；空段、末尾选区、emoji、中文输入法、撤销和保存重开均有用例。硬换行和软换行在各输出中含义一致。

### W04 精确输入与真实绝对单位

- [ ] 字号 pt、段前/段后 pt、页边距与左右/首行/悬挂缩进 mm；倍数行距明确显示“倍”。
- [ ] 提供数值输入、步进、常用值、恢复继承；滑杆为辅助，不是唯一入口。
- [ ] 复用 `resumeFontScale.ts`、`resumeStyleParams.ts`、`entryColumnGeometry.ts` 已有换算，补齐共享转换与统一舍入规则。
- [ ] 字号与长度属性支持“继承 / 绝对值 / 旧比例兼容”；绝对字号按 D04 保存和渲染。
- [ ] 建立能力表：前端、后端、各渲染器允许范围/单位/精度/用途；区分推荐值与硬边界。
- [ ] 复用现有具名版式预设与预设编辑器，把绝对单位和支持的角色参数纳入读写、预览与导出；具名版式参数包不等于本期排除的任意命名段落样式。
- [ ] 切换版式前后并列显示被预设改变、继承、保留的参数；不能因嵌套域同名而清空整份 roles/objects/object_roles。
- [ ] 空输入不是 0；零间距是合法显式值；恢复继承是删声明；多值状态不能默认写第一个对象的值。
- [ ] 无效值在提交前有明确反馈；后端保留历史读取容错，新写入不能静默截掉属性或留下错误的界面读数。
- [ ] 统一模式和值作为原子属性处理，具体规则见 §4；不能用两个独立字段竞相覆盖。

落点：[FontSizeControl](../frontend/src/features/resume/layout/FontSizeControl.tsx)、[ResumeMeasureControls](../frontend/src/features/resume/layout/ResumeMeasureControls.tsx)、[ResumeSpacingControls](../frontend/src/features/resume/layout/ResumeSpacingControls.tsx)、[StyleValueRow](../frontend/src/features/resume/layout/StyleValueRow.tsx)、[resume_style_schema](../backend/app/services/resume/resume_style_schema.py)。

验收：11 pt 在切模板、切具名版式、改基础字号、保存重开、PDF 与 DOCX 中保持；只改颜色不固定字号；旧比例文档外观保持；换算不累计漂移；套用版式后的清理范围准确且可撤销。

### W05 角色样式、局部覆盖与继承

- [ ] 复用六个已有角色与 `roles / objects / object_roles`，不另外创建平行样式系统。
- [ ] 分别提供“修改同类样式”和“仅修改当前目标”；面板显示有效值与来源。
- [ ] 恢复单属性/当前范围/清除下级覆盖是不同动作，不能一个按钮无提示扩大范围。
- [ ] 段落级局部格式加入现有继承关系；协议和解析详见 §4。
- [ ] 固定当前样式、快捷格式、格式复制、模板切换使用同一有效值解析。
- [ ] 修正“固定当前样式”仍保存比例的局限，真正固定显式长度。

落点：[styleOverrides](../frontend/src/features/resume/layout/styleOverrides.ts)、[styleValueResolution](../frontend/src/features/resume/layout/styleValueResolution.ts)、[RoleStylePanel](../frontend/src/features/resume/layout/RoleStylePanel.tsx)、[ObjectStylePanel](../frontend/src/features/resume/layout/ObjectStylePanel.tsx)、[StyleSourceTag](../frontend/src/features/resume/layout/StyleSourceTag.tsx)、[resume_style_types](../backend/app/services/resume/resume_style_types.py)。

### W06 有效格式复制

- [ ] 重新设计“复制格式 / 粘贴格式”，不直接恢复旧格式刷实现。
- [ ] 复制指定范围的当前有效格式快照，明确文字格式/段落格式；保留目标身份、正文、来源、锁和分页。
- [ ] 同类目标对应属性匹配源；跨角色只应用允许属性并列明跳过项；没有可用属性则禁用。
- [ ] 复制操作不改文档；粘贴只写目标、一次撤销；修改源不会继续联动。
- [ ] 与多选批量调整区分：前者复制已有外观，后者只修改这次输入的属性。
- [ ] 格式缓存仅存必要格式数据，初期限定当前制作台会话；关闭/切简历清理，不带正文进入系统剪贴板。
- [ ] 同步改写 `formatPainterRemoved.test.ts` 中已被新决定取代的断言，保留仍有效的约束，并为新守卫做反证。

落点：[styleFreeze](../frontend/src/features/resume/layout/styleFreeze.ts)、[MultiStyleBar](../frontend/src/features/resume/layout/MultiStyleBar.tsx)、[formatPainterRemoved.test](../frontend/src/features/resume/layout/formatPainterRemoved.test.ts)；新增独立的快照/粘贴规则小模块。

### W07 命令、键盘与撤销

- [ ] 顶部撤销/重做使用 `useWorkbenchV2History`，状态与快捷键一致。
- [ ] 为字段隐藏/移除等右键操作增加可见入口，复用现有菜单与能力检查。
- [ ] 保留 F2 编辑、键盘拖动、Esc 分层关闭；输入框原生编辑与输入法优先。
- [ ] 对象 Delete/Backspace 作为新增能力明确验证，不误写成已存在；只能在对象明确聚焦时使用。
- [ ] 增加格式操作事务边界：开始 → 临时预览 → 提交或取消；滑杆、标尺、批量粘贴各一次历史。
- [ ] 文字输入合并沿用现有机制；标尺不能靠 300ms 停顿猜一次操作是否结束。
- [ ] 明确“撤销操作 / 放弃未保存修改 / 恢复历史版本”的不同范围。

落点：[useEditorChipMenu](../frontend/src/features/resume/editor/useEditorChipMenu.ts)、[ItemChip](../frontend/src/features/resume/editor/ItemChip.tsx)、[useWorkbenchV2History](../frontend/src/features/resume/editor/useWorkbenchV2History.ts)、[useWorkbenchV2Shortcuts](../frontend/src/features/resume/editor/useWorkbenchV2Shortcuts.ts)。

### W08 可拖动标尺

- [ ] 横向标尺控制左右页边距、选中段落左右缩进及首行/悬挂缩进；纵向标尺控制上下页边距。
- [ ] 首行/悬挂是互斥模式；数值、单位、手柄用途可读，多段不同值显示混合状态。
- [ ] 指针坐标经实际缩放、滚动、页偏移与内容区换算为文档单位；不保存屏幕坐标。
- [ ] 标尺与数值输入共用命令；实时反馈但不在每次 pointermove 直接保存到服务器。
- [ ] 鼠标、键盘微调、触控和 Esc 取消有等价行为；越界不使正文可用宽度小于合法最小值。
- [ ] 没有段落目标时仅允许页面设置；精确预览保留选择，但不假设已有 PDF 点击段落映射。

依赖：W02、W03、W04、W07。复用：[geometry](../frontend/src/features/resume/preview/geometry.ts)、[ResumePreviewCanvas](../frontend/src/features/resume/preview/ResumePreviewCanvas.tsx)。标尺视图、几何换算与拖动事务分别成模块。

验收：50%/100%/适宽、多页、滚动、改变栏宽时，拖动同一文档距离结果一致；一次拖动撤销一步；缩进不串段；辅助元素不导出。

### W09 辅助视图与布局边界

- [ ] 复核并接通已有 Proview 能力到 v2 宿主，避免新建平行辅助线/命令面板。
- [ ] 提供页边距、真实栏边界、段落边界开关；读取真实页面几何，不把多列简化为一条中线。
- [ ] 辅助层不改变文档流、不挡住正文交互、不进入导出。
- [ ] 统一缩放、标尺、辅助线和预览入口；保留各预览模式的实际能力边界。
- [ ] 只将视图偏好作为偏好持久化；正文/格式仍进入文档保存链。

落点：[ProviewLayer](../frontend/src/features/resume/preview/ProviewLayer.tsx)、[ProviewContext](../frontend/src/features/resume/preview/ProviewContext.tsx)、[guideGeometry](../frontend/src/features/resume/preview/guideGeometry.ts)。

### W10 分页与段落布局交互

- [ ] 当前对象属性面板统一呈现段落/条目/板块适用的分页规则，细则见 §5。
- [ ] 段落左右/首行/悬挂缩进、段前段后和倍数/固定行距需同时接入 HTML、PDF、DOCX。
- [ ] 区分手动分页、自动分页、保持规则和页数上限；设置、汇总、定位、清除共用对象身份。
- [ ] 按 D06 为新建文档写入明确的新默认规则，旧文档缺字段不默认升级。
- [ ] 按 D07 分离整个板块保持与板块内逐条保持；旧 keep_together 走兼容处理。
- [ ] 超页对象自然拆分并给出可解释结果；不自动缩字号，不无限换页。
- [ ] 保留真实 PDF 报告作为页数依据；PDF 精确预览与导出配置和内容指纹一致。

落点：[SectionPaginationPanel](../frontend/src/features/resume/pagination/SectionPaginationPanel.tsx)、[EntryLayoutPagination](../frontend/src/features/resume/layout/EntryLayoutPagination.tsx)、[paginationBreaks](../frontend/src/features/resume/pagination/paginationBreaks.ts)、[resume_document_layout](../backend/app/schemas/resume_document_layout.py)、[document_pagination](../backend/app/services/resume/document_pagination.py)。

### W11 术语规范升级

- [ ] 先修订 `docs/ui-copy-guide.md`；现有“正文前灰字 / 正文后灰字”是旧规范规定，不是旧实现擅自命名。
- [ ] 同一概念统一“板块”；标题大小改为标题字号；正文前/后灰字建议改为正文前/后信息。
- [ ] “元信息”可保留并解释用途；不得混同位置、颜色与角色层。
- [ ] 模板、版式、排版参数、版面继续保留现有四层区别；六类角色样式与文字级别快捷格式另作解释。
- [ ] 恢复继承、恢复模板默认、放弃修改、清除分页等动作按实际结果命名。
- [ ] 中英文语言包、Tooltip、aria-label、用户指南、相关后端纸面标签和文案测试同步。
- [ ] 协议值 `meta / lead / trail`、API 字段、数据库列和内部文件名不因界面改名而改动。

落点：[ui-copy-guide](ui-copy-guide.md)、`frontend/src/i18n/messages/zh-CN.{document,typography,workbench,pagination,structure}.ts` 及实际对应英文文件；具体命名空间以检索为准，不假定全部已存在。

### W12 保存、兼容与全链路验证

- [ ] 正文、布局、段落元数据、撤销快照与预览始终对应同一草稿；保留 revision 条件写和 409 冲突处理。
- [ ] 当前先版式后正文的保存顺序不得无意破坏；新段落格式的存储必须考虑两步之间的失败。
- [ ] 推荐将随段落文本一起变化的身份与局部格式放在同一 content 事务，减少悬空引用；若放入 format_config，则必须验证新正文未写入时的引用及 prune 行为，再决定是否需要组合写入接口。
- [ ] 页面刷新后的临时恢复按 W14 单独设计；“暂存在当前标签页”与“服务器已保存”状态不可共用同一成功文案。
- [ ] 未保存内容继续进入精确预览、分页报告；保存中暂停/作废旧预览结果的逻辑保留。
- [ ] 模板/版式变化摘要、预检结果和优化候选均绑定当前 resume id、revision、内容/版式指纹；任一变化后标记过期并要求复核/重算。
- [ ] 变体复制和选择性同步包含段落元数据时重新映射段落身份；不得因同步一段而覆盖目标稿未选对象的岗位定制。
- [ ] 未知格式版本、备份恢复、版本恢复、复制简历、AI/来源替换与旧客户端回退均不得静默丢格式。
- [ ] 全格式支持指语义与参数一致；PDF 与 DOCX 可能由不同引擎分页，不承诺每页像素一致。
- [ ] 更新文档模型、术语、使用指南、必要的 README/API 说明和 CHANGELOG；执行验证见 §7。

落点：[useWorkbenchV2Save](../frontend/src/features/resume/editor/useWorkbenchV2Save.ts)、[document_save](../backend/app/services/resume/document_save.py)、[resume_render_overrides](../backend/app/services/resume/resume_render_overrides.py)、[export_pipeline](../backend/app/services/export_pipeline.py)。

### W13 工作区模式与渐进展示

- [ ] 将现有 default/writing/typography/delivery 预设接入 v2 制作台；标签可沿用“默认 / 内容撰写 / 精细排版 / 投递检查”。
- [ ] 预设只控制参数栏、内容栏、画布和专项面板的可见性；同一份正文、版式、历史、选中、保存状态跨模式共享。
- [ ] 画布始终可见；模式作为用户偏好恢复，不写入简历正文或 revision。
- [ ] 新建参数默认渐进展示：常用控件直接可见，低频参数分组展开；目标对象选中时优先显示其属性。
- [ ] 保留可搜索命令入口，避免“收起高级选项”后不可发现；窄屏仍通过现有抽屉完成相同任务。
- [ ] 复核 Proview 与工作区预设的职责：一个管可见任务模式，一个管缩放/辅助视图，不重复存布局状态。

验收：切换四种模式不改变文档或 undo 栈；跨 reload 恢复用户模式；恢复默认模式不清理辅助线、导出或主题偏好；键盘和窄屏可达所有命令。

### W14 会话草稿恢复

- [ ] 在 v2 手动保存之外增加当前标签页会话恢复：写作期间防抖暂存正文、版式、段落身份/格式和恢复所需 revision；不改成静默服务器自动保存。
- [ ] 复用 `useFormDraft` 的 sessionStorage、pagehide/beforeunload flush、显式恢复/放弃交互原则；不得把简历正文写入 localStorage。
- [ ] 草稿键至少包含简历身份、数据集作用域和打开时 server revision；切简历/数据集不能交叉恢复。
- [ ] 现有通用表单草稿是 32KB 上限，不能盲套。为简历载荷制定有界预算；忽略大照片二进制，保留有效照片引用或重新提示；超限/存储不可用时明确说明未能暂存，不静默截短正文。
- [ ] 恢复条展示时间与基准 revision；确认恢复前检查服务端 revision，过期时接已有冲突解决流程，不覆盖更新内容。
- [ ] 保存成功、用户放弃、切换数据集、恢复历史版本后按对应身份清理或更新草稿；异步旧写入不能覆盖新简历草稿。
- [ ] 恢复需用户显式采纳，不能打开制作台后静默应用；暂存不计入 server revision 或已保存历史。

验收：刷新后可以选择恢复/放弃；键入后立即 pagehide 可 flush；超限正文仍留在当前内存并收到提示；已有服务端新版本时要求走冲突流程；隐私模式/QuotaExceeded 有可理解状态；两数据集及两简历不会串稿。

主要落点：[useFormDraft](../frontend/src/hooks/useFormDraft.ts)、[formDraftStorage](../frontend/src/utils/formDraftStorage.ts)、[useWorkbenchV2History](../frontend/src/features/resume/editor/useWorkbenchV2History.ts)、[useWorkbenchV2Save](../frontend/src/features/resume/editor/useWorkbenchV2Save.ts)。简历专用接线应独立模块，不将整份 `ResumeDocument` 强转为通用表单字典而漏校验。

### W15 版面优化器接入新约束

- [ ] 保留现有候选测量、锁字号、最小页边距、可读性级别、候选变化说明和无可行解原因；这是升级，不是新建优化器。
- [ ] 新绝对字号、字段/段落覆盖、首行/悬挂缩进、keep rules 和 D07 两种板块保持加入候选可行性判断。
- [ ] 用户固定的字号与被锁定范围是硬约束；手动分页、板块/条目保持等显式分页意图不能被自动清掉来制造“可行”。
- [ ] 区分全局/角色可改值与当前段落局部例外；优化全局间距不应把所有 11 pt 段落重写成比例，优化局部段落也不波及全文。
- [ ] 每个候选明确显示参数前后值、实际页数/溢出和可读性变化；没有符合约束候选时说明具体被锁定项/不可行约束。
- [ ] 应用是显式动作，先成为当前草稿的一次历史事务，再由主保存动作提交；若既有优化入口暂时仍直接落库，需单独标注其保存/冲突语义并先统一再对外呈现。
- [ ] 不自动缩小字号、不删正文、不改变纸型（本期 A4 固定）。

验收：固定 11 pt 不被优化候选改动；布局锁和显式分页保持；候选按新的真实 PDF 测量；应用一次撤销完整还原；没有方案时列出约束原因而不是空白区域。

主要落点：[LayoutOptimizerPanel](../frontend/src/features/resume/optimizer/LayoutOptimizerPanel.tsx)、[constraints](../frontend/src/features/resume/optimizer/constraints.ts)、[ResumeLayoutDiagnosisCard](../frontend/src/features/resume/layout/ResumeLayoutDiagnosisCard.tsx)、[resume_fit](../backend/app/services/resume/resume_fit.py)。

### W16 检查到修复的闭环

- [ ] 复用现有内容/版面/产物预检、PDF/DOCX 机器读取视图、字体覆盖和导出预检，不再新增一个平行 ATS 扫描器。
- [ ] 每个可定位问题携带 W02 目标路径；点击后打开对应工作模式、选中对象并聚焦适用属性。
- [ ] 修改正文、布局、模板、纸面配置或导出选项后，对应检查结果标记过期；报告展示所绑定的内容与 layout fingerprint。
- [ ] 对“通过 / 有待确认 / 有问题 / 未检查 / 检查失败 / 结果已过期”分别呈现状态；预检失败允许继续导出时，必须明确展示跳过风险，不显示为通过。
- [ ] 复检只跑受影响范围或提示需要重跑产物层；返回结果必须与当前 revision 和配置指纹匹配。
- [ ] 视觉效果、PDF 实际抽取文本顺序、缺字和结构化内容并列呈现；机器可读不等于视觉质量，也不保证录用。

验收：问题定位到实际字段/段落；应用修复后旧通过状态立即失效；旧异步响应不覆盖当前检查；检查失败与“没有问题”可区分；导出跳过检查时留明确信息。

主要落点：[usePreflight](../frontend/src/features/resume/preflight/usePreflight.ts)、[preflightCache](../frontend/src/features/resume/preflight/preflightCache.ts)、[CheckPanel](../frontend/src/features/resume/preflight/CheckPanel.tsx)、[ScannerReadView](../frontend/src/features/resume/preflight/ScannerReadView.tsx)、[exportPreflightGate](../frontend/src/features/resume/delivery/exportPreflightGate.tsx)。

### W17 模板与具名版式的采纳影响摘要

- [ ] 沿用现有试用与对比：用户内容、双栏候选、真实页数、格式能力、保留覆盖/模板默认选项。
- [ ] 采纳前把“变化”按模板、具名版式、角色默认、局部例外、段落绝对值和分页规则分组，分别标记将改变/保留/不支持。
- [ ] 明示当前前后页数、超页状态、字形/机器阅读能力变化；数据缺失时显示无法预判，不能静默报一个估计值。
- [ ] 套用具名版式只清除它明确声明会覆盖的参数；嵌套 roles/objects/object_roles/段落规则按属性或范围合并，不删除整个域。
- [ ] 保留覆盖和采用默认仍是两个清晰选择；采纳仅写一次历史且可撤销。没有提交时的预览退出不得污染简历。
- [ ] 现有格式模板编辑器将绝对长度和角色样式加入可编辑/可保存白名单；不把段落局部例外、内容 ID、来源和锁打包成跨简历的版式参数。
- [ ] 版式模板与本期排除的用户命名段落样式分开命名和维护。

验收：某模板不支持属性时采纳前可见；保留 11 pt 局部覆盖后仍生效；采用模板默认仅清指定覆盖；采纳后页数与新导出一致；一次撤销回到采纳前完整状态。

主要落点：[TemplateTrialPanel](../frontend/src/features/resume/template-trial/TemplateTrialPanel.tsx)、[TrialCapabilityStrip](../frontend/src/features/resume/template-trial/TrialCapabilityStrip.tsx)、[layoutWithFormatPreset](../frontend/src/features/resume/layout/layoutWithFormatPreset.ts)、[FormatTemplateEditorModal](../frontend/src/features/templates/FormatTemplateEditorModal.tsx)。

### W18 当前稿身份、岗位变体与内容边界

- [ ] 制作台展示当前简历标题、主稿/岗位变体身份及可用的岗位关联；缺少岗位关联时如实显示无关联，不从旧场景快照推断。
- [ ] 保留场景历史条只读语义；新建的当前编辑目标条与历史生成场景分开。
- [ ] 任何影响范围明显的修改在动作附近说明“仅当前简历 / 选中变体”；跨变体同步复用现有路径选择与确认。
- [ ] 新段落元数据随变体复制、版本恢复和选择性同步时重映射稳定 ID；只同步所选路径时，目标变体其他岗位定制保持不变。
- [ ] 明确本稿隐藏、从本稿移除、个人资料隐藏/删除的对象及数据后果；制作台中不能因隐藏字段而删除源个人资料。
- [ ] 验证 A 稿隐藏或改排版不影响 B 稿与个人资料；同步到目标变体只作用于用户选定对象。
- [ ] 对现有 `hidden_from` 缺省、页眉字段回退和恢复位置差异进行可见说明与测试，不承诺所有类型都按原位恢复。

主要落点：[VariantsPanel](../frontend/src/features/resume/versions/VariantsPanel.tsx)、[VersionsModal](../frontend/src/features/resume/versions/VersionsModal.tsx)、[ScenarioContextBar](../frontend/src/features/resume/editor/ScenarioContextBar.tsx)、[toggleItemHidden](../frontend/src/features/resume/document/mutations.ts)。

### W19 本期页面规格：A4

- [ ] 本期标尺、页边距、页面坐标、分页报告和 PDF/DOCX 导出均以 A4 为唯一纸型；页面规格统一取公共几何来源，不在新组件散落第二份宽高常量。
- [ ] 新功能不能让前端草稿画布与后端 PDF 使用不同的 A4 边距/内容区换算。
- [ ] 用户选择 A4 时，保存/重开/打印/报告保持 A4；导出若下游或打印端缩放纸张，提示由用户的打印设置决定。
- [ ] Letter、Legal、用户自定义页面尺寸明确排除在本期范围；后续扩展需另行覆盖 schema、预览、标尺、分页引擎与打印验证，不能只改 A4 常量。
- [ ] 若未来引入可选纸型，需重新打开兼容与默认值决策；旧文档仍默认 A4。

验收：高 DPI 与不同预览缩放下，A4 文档单位和导出毫米值一致；页面边缘、标尺及 PDF 真实边距一致；代码没有新增第二份页面规格常量。

## 4. 样式体系详细规则（W03—W06）

### 4.1 对象、角色与格式能力矩阵

| 目标 | 常用操作 | 范围说明 |
|---|---|---|
| 全文 | 基础字体/字号、页边距、模板、版式 | 只改变继承它的属性；已明确的局部绝对字号不被普通全局调整冲掉 |
| 同类角色 | 姓名、板块标题、条目标题、正文、元信息、字段标签的支持属性 | 继续用现有角色白名单，不把任意属性强塞给所有角色 |
| 条目 | 整条或指定内部角色的局部覆盖 | 明确“整条 / 标题 / 正文 / 元信息”的范围 |
| 字段 | 当前字段可用的文字/段落属性 | 精确字段覆盖不能串到同条其他字段 |
| 当前段落或多段 | 字号、支持的段落样式、缩进、间距、分页 | 使用 W03 稳定身份；混合值只改指定属性 |
| 几个字的文字选区 | 保留现有加粗、相对字号、颜色和链接 | 现有相对字号为当前 run 的 0.5—1.6 倍；本期新绝对 pt 确认范围是字段/段落，不自动扩张成字符级绝对字号或字体 |

六类角色样式与五个文字级别是两回事：后者现为四项覆盖补丁。建议在界面中归为“快捷格式”，只改它声明的字号、加粗、段前、段后，保留颜色、缩进、分页等其他属性。

### 4.2 继承、绝对值和冲突规则

当前后端有效值顺序包含：角色 → 所属条目对象 → 所属条目角色 → 当前对象 → 当前对象角色；角色和全文值又有模板/版式基准。新段落覆盖加入目标字段之后，已有行内标记仍在文本 run 层生效。行内 size 是相对当前 run 的比例，不能被当作绝对字号，也不能因段落设为 11 pt 而被抹去。

字符层依据：[InlineMarkButtons](../frontend/src/features/resume/layout/InlineMarkButtons.tsx)、[resume_inline_style](../backend/app/services/resume/resume_inline_style.py)。例如段落为 11 pt、局部文字显式 size=0.9 时，该文字应保持一次相对缩放的含义；复制段落格式不复制或清除正文里的行内标记。

1. 按属性逐层解析，具体层的显式声明优先；下层没有声明才继承。
2. 字号的模式和值作为一个逻辑声明，例如“绝对 11 pt”或“旧比例 1.1”；不得把上层绝对键和下层比例键同时合并后硬选绝对键。
3. 同层同一属性不能同时写绝对和相对两种声明。新写入校验冲突；历史异常输入按明确兼容规则处理并测试。
4. 下层比例覆盖上层绝对、下层绝对覆盖上层比例都必须有确定行为；旧比例继续按原有模板/角色基准求值，不擅自改成乘上任意父层绝对字号。
5. 恢复继承删除本层该逻辑声明的全部模式/值，不写回当前默认值；显式 false、零间距不是缺失。
6. 新手动 pt/mm 输入保存为绝对值；旧比例不批量转换。只修改颜色时，不生成字号声明。
7. 字号、段距、缩进、字距等长度在共享解析层求得实际物理值；HTML/PDF/DOCX 消费解析结果，防止重复乘角色比例。
8. 前后端通过同一组黄金样本对拍有效值、来源、模式及舍入；界面显示的值必须是渲染实际使用的值。

### 4.3 样式动作的明确语义

| 动作 | 写入行为 | 不应影响的内容 |
|---|---|---|
| 修改同类样式 | 写目标角色的指定属性 | 下级显式覆盖、其他角色 |
| 修改当前范围 | 写当前字段/条目/段落的指定属性 | 未选对象、未操作属性 |
| 恢复此属性继承 | 删除当前层此属性声明 | 本层其他属性、下级局部覆盖 |
| 恢复当前范围继承 | 删除当前范围允许清除的覆盖 | 子对象独立覆盖；如要一并清除须另一明确动作 |
| 固定当前样式 | 将当前范围有效格式显式固化，长度用绝对单位 | 正文、来源、身份、分页 |
| 复制格式 | 生成范围明确的有效值快照，不写文档 | 文本和源身份不入格式快照 |
| 粘贴格式 | 把支持的快照属性写为目标局部覆盖，一次历史 | 正文、锁、来源、分页及快照未包含属性 |
| 应用快捷格式 | 只写快捷格式规定的属性；新长度建议固化为当时实际 pt | 颜色、缩进、分页等其他手调项 |

格式复制建议分“文字格式 / 段落格式 / 两者”；多段来源有混合值时，不任意取第一段：只复制值明确的属性并展示范围，或者要求先选择单个源段。第一阶段不加入不易退出的连续刷涂模式。

切模板时继续区分“保留调整”与“采用模板默认”等实际入口。普通切换保留显式绝对值；用户明确选择清除覆盖的动作才清除，并作为一次可撤销操作。旧快捷格式的比例仍可识别；新格式不再匹配旧比例补丁时显示“自定义”，不能错误标成同一标题级别。

### 4.4 协议、配额与保存约束

- 当前 `formatDomains.ts` 读更高版本会返回空，写时强制版本 1；后端支持版本表也只有 1。新增绝对字段或域要同时修改读写、白名单、归一化和版本策略。
- 旧 schema 的 `extra="ignore"` 不能替新协议兜底：新段落元数据必须真实进入类型/校验，否则经过保存或导出会被丢弃。
- 当前 `MAX_ROLE_PROPS=12`、`MAX_OBJECTS=400`、`MAX_OBJECT_ROLES=400`。新增缩进/行距属性、逐段覆盖需重新设计有界预算，超过时明确拒绝新写入并保留原稿，不能静默保留前若干项。
- 本期优先扩展 JSON 契约，不预设必须加数据库表。若确需迁移，另依仓库迁移规则设计升级/降级和备份。
- 格式版本不能靠全局“把 1 改成 2”处理所有域；按实际变更域制定兼容表，检查旧版本、混合版本和未来版本。
- 新应用必须读旧文档；旧应用未必能安全写新格式。新特性启用后的最低读取/写入版本、回退备份路径及阻止静默丢失的机制属于交付前置条件。
- 新段落身份若在 content、覆盖在 layout，两步保存会暂时引用未落库身份；必须做失败注入测试。推荐相关段落元数据与局部格式同 content 写入，其角色继承仍使用现有格式域。

### 4.5 样式验收场景

| 编号 | 场景 | 预期 |
|---|---|---|
| S01 | 字段设 11 pt，全文字号增大，切模板，保存重开 | 字段仍 11 pt，继承字段按规则变化 |
| S02 | 字段仅改颜色，然后修改正文角色字号 | 字段字号仍跟随；颜色保留 |
| S03 | 下层比例/上层绝对及其反向组合 | 按明确层级取整条声明，不被另一个模式键截胡 |
| S04 | 恢复字段字号继承 | 删除字号声明，重新显示上层实际值和来源 |
| S05 | 三段正文只调整第二段，再在前面加一段 | 原第二段格式不串位 |
| S06 | 选中三个段落，仅输入段后距 | 仅段后距统一，其他混合属性不变 |
| S07 | 源从角色继承格式，复制到不同基础字号的目标 | 支持属性按有效格式匹配源；正文/分页不变 |
| S08 | 粘贴或固定后再改源或全局样式 | 已固定属性不联动；未固定属性继续继承 |
| S09 | 应用快捷格式后撤销一次 | 完整恢复原有覆盖，不丢其他属性 |
| S10 | 旧比例文档仅打开、预览 | 无回写；与基线效果一致 |
| S11 | 属性超过原 12 项、覆盖数达到新配额边界 | 有明确接受或拒绝结果，不静默丢尾部属性 |
| S12 | 新格式版本恢复/备份恢复/未知版本/保存失败 | 格式不被静默降版或删除，可解释并可恢复 |
| S13 | 带行内 size/color/加粗/链接的段落设置绝对字号、复制格式、拆分合并并导出 | 标记不丢失、范围不串位，字号比例仅应用一次；段落复制不覆盖目标行内标记 |

## 5. 分页与段落交互详细规则（W08—W10）

### 5.1 能力与默认值

| 对象 | 新界面操作 | 默认与范围 |
|---|---|---|
| 页面 | 页边距、页数上限、当前实际页数 | 继续采用既有页面参数；上限不代表段落分页规则 |
| 板块 | 从新页开始；尽量保持整个板块完整；板块内每条各自保持完整 | 两种保持分别表达，默认关闭；已确认 D07 |
| 条目 | 从新页开始；尽量保持本条完整 | 保留现有独立对象能力；新协议允许对板块默认作明确覆盖 |
| 段落/多段 | 段前分页、段中不分页、与下段同页、孤行控制 | 默认普通正文可跨页；多选只改被操作属性 |
| 标题 | 与首个可见后文同页 | 新建默认开启；旧文档保留旧策略 |
| 普通段落 | 孤行控制 | 新建默认跨页两侧各至少 2 行；不足 4 行且无法合法拆分时尽量整体移动 |

上表中“普通正文不默认段中不分页”和“板块保持默认关闭”是方案默认。D06 只规定新增默认规则，不能反过来关闭旧渲染器已存在的标题预留或保留策略。

新建包含手动创建和生成的新文档；复制旧简历、历史恢复按旧文档继续解释。新默认必须在创建链显式记录，不能按打开日期或全局默认值猜测新旧。

### 5.2 属性面板、纸面和汇总的操作流程

1. 选中板块/条目/段落，面板显示对应范围、当前有效分页设置及来源。
2. 修改某条规则后先更新本地历史与预览；保存仍由统一动作触发。
3. “手动分页”标记可定位到设置来源并取消；自动分页线只表示结果，不提供删除自动分页线的假操作。
4. 设置汇总列出对象、规则、作用范围、有效状态和实际页码；隐藏对象标注“当前不上纸面”，保留其设置。
5. 分别提供“清除此处手动分页”“清除全文手动分页”“恢复所选分页规则”等明确动作；不能继续用一个泛化名称掩盖只清板块的实际范围。
6. 清除全文手动分页涵盖新协议识别的板块/条目/段落显式断页，不清保持/孤行规则；一次操作可一次撤销。
7. 旧版保持规则只显示可解释的兼容状态，明确转换后再改新语义；不因打开汇总就迁移或清除历史键。
8. 报告加载/过期/失败有独立状态；异步返回与当前文档、格式和版本不一致时不覆盖新报告。

### 5.3 两种板块保持及旧数据兼容

现有 PDF 对板块 `keep_together` 主要逐条预留；DOCX 还会为整块追加 keepNext 链。因此旧字段不能直接改名成任一新开关。

建议新契约使用两个明确的逻辑属性（字段名编码前冻结）：

- “整个板块尽量保持完整”：整个可见板块能装进一页时作为组预留；装不下时允许拆分，继续应用内部条目/段落规则。
- “本板块条目默认保持完整”：是板块对每个条目的默认；条目可以继承或明确开启/关闭。新协议三态不能继续只用布尔 OR，否则用户无法对某条关闭默认。
- 两者可以同时开启：先尝试整块保持，超页再逐条保持，过长条目再按段落拆分。
- 旧文档缺新语义标记时维持原出口行为，不在读取、保存无关字段时自动迁移；相同旧布尔跨出口曾有差异，要如实记录。
- 用户主动应用新分页规则时，针对选定范围生成明确新属性，保留可撤销的前态；新旧字段优先级必须唯一，防止重复生效。

### 5.4 规则优先级与终止

| 情形 | 方案规则 |
|---|---|
| 明确段前分页与上一段 keep-with-next 冲突 | 显式断页切断保持链；不能忽略用户断页 |
| 板块、首条、首段同时要求新页 | 合并为一次断页；已在页首不再生成空白页 |
| 短保持组当前页放不下、下一页放得下 | 整组移动到下一页 |
| 整板块超页 | 放宽整板块保持，继续尊重内部逐条/段落规则 |
| 单条/单段超页 | 允许合法拆分；保留手动断页和能满足的孤行规则，必要时说明保持未能完全满足 |
| 连续 keep-with-next 形成超页组 | 保持链按明确边界拆开，有界测量、有限回退，不能循环 add_page |
| 隐藏内容位于两个段落之间 | 按实际可见顺序判断相邻；不把隐藏节点当真实下段 |
| 不同栏之间的内容 | 保持关系只在同一可读流里建立；列布局映射需由 planner 明确 |
| 字号/行距导致当前页装不下 | 按真实参数换页，禁止自动压缩字号或行距 |
| 超出用户页数上限 | 完整测量所需页数后依现有导出策略处理上限并提示，不修改源正文 |

孤行控制建议语义：跨页时上一页该段至少两行、下一页该段至少两行；不足条件则移动更多行或整段。单行内容不凭空补空行；若极端页面高度无法满足，应终止并报告具体规则未满足，不能无限尝试。

### 5.5 缩进、行距和段距

- 左右缩进相对所在段落内容区；首行/悬挂相对普通行起点，模式互斥；列表已有自动悬挂要纳入解析，不能叠加两次。
- 字号使用 pt；段前/段后使用 pt；页边距与缩进使用 mm；倍数行距与固定行距分别带模式。
- 固定行距推荐按用户值执行；过小可能发生重叠时给出具体提示，不静默转回倍数；PDF 测量和绘制必须使用同一规则。
- 相邻段落间距的合成规则先以当前实现建基线，再统一新语义；不能依浏览器 margin collapse、DOCX 自身行为和 PDF 手算各自猜值。
- 段距、条目间距、板块间距是不同层，不为“看起来一样”重复写多处；面板必须说明作用范围。
- 标尺修改进入同一个样式解析和历史事务；选择变化、模板重排、取消拖动都有确定结果。

### 5.6 输出链与分页报告

统一语义应经文档/格式归一化 → planner/有效样式 → HTML、PDF、DOCX 各适配层输出。PDF 的预留高度、折行、实际绘制同源；真实 PDF 报告继续用 `document_pagination.py` 的输出，不能用前端高度另算权威页数。

HTML 负责草稿视觉与必要分页 CSS；PDF 负责确定的导出分页；DOCX 写入对应的段落属性和 XML，验证设置语义及可编辑性。DOCX 最终分页受打开软件与字体环境影响，不设“和 PDF 每页像素一致”这种不真实验收。

主要扩展点：[resume_style.py](../backend/app/services/resume/resume_style.py)、[document_plan.py](../backend/app/services/resume/document_plan.py)、[PDF document_body.py](../backend/app/services/pdf_exporter/document_body.py)、[PDF style_blocks.py](../backend/app/services/pdf_exporter/style_blocks.py)、[docx_document_body.py](../backend/app/services/docx_document_body.py)、[docx_blocks.py](../backend/app/services/docx_blocks.py)。

### 5.7 分页验收场景

| 编号 | 场景 | 预期 |
|---|---|---|
| P01 | 标题恰好落在页尾 | 新规则下与首个可见后文同页 |
| P02 | 板块、首条、首段同时从新页开始 | 仅一次断页，无空白页 |
| P03 | 页首再次设置段前分页 | 不多一页 |
| P04 | 短板块剩余空间放不下、下一页可容纳 | 整板块保持开启时整体移页 |
| P05 | 长板块跨多页，仅逐条保持开启 | 每条能容纳则完整；板块可分多页 |
| P06 | 板块两种保持均开启且整块超页 | 放宽整块保持，继续逐条，再处理长条目 |
| P07 | 条目/段落长度超过一页 | 正常拆分、报告原因、不循环、不缩字号 |
| P08 | 跨页上下 2 行及 1/2/3/4 行短段边界 | 两行规则正确；单行不补行；无法满足时可解释 |
| P09 | 连续与下段同页构成超高链 | 有限回退，手动断页优先 |
| P10 | 隐藏字段/条目位于相邻目标之间 | 按可见序列链接，隐藏设置保留 |
| P11 | 仅取消一处或清除全文手动分页 | 范围准确，其他保持/孤行设置保留，一次撤销可恢复 |
| P12 | 修改未保存正文后请求报告 | 使用眼前草稿；旧响应不会覆盖新结果 |
| P13 | 旧 keep_together=true 文档 | 未主动转换前保持旧各出口效果；转换后两种新规则语义明确 |
| P14 | 切模板、改变边距/固定行距、恢复版本 | 设置和身份不丢，页面重新测量 |
| P15 | PDF 报告、精确预览与导出 | 同份内容与配置下页数/截断信息一致；DOCX 对应规则 XML 正确 |

## 6. 模块边界与实施顺序

### 6.1 当前体积预算

以下是本轮只读计数，后续执行前复测。项目代码/测试/CSS 单文件硬预算 500 行，不通过增加豁免规避。

| 文件 | 当前行数 | 处理 |
|---|---:|---|
| `frontend/src/features/resume/editor/ResumeWorkbenchV2.tsx` | 447 | 仅装配，新增功能区/面板各自拆出 |
| `frontend/src/features/resume/layout/ResumeMeasureControls.tsx` | 471 | 新增数值职责前先拆现有内聚块 |
| `frontend/src/features/resume/layout/ResumeSpacingControls.tsx` | 406 | 数值转换和控件职责独立 |
| `frontend/src/features/resume/layout/styleOverrides.ts` | 413 | 新模式解析独立，兼容导出路径 |
| `frontend/src/features/resume/preview/ResumePreview.tsx` | 450 | 标尺与专业视图通过薄适配接入 |
| `backend/app/services/pdf_exporter/document_render.py` | 431 | 分页策略不继续塞入绘制主文件 |
| `backend/app/services/pdf_exporter/style_blocks.py` | 454 | 段落测量/样式解析拆出 |
| `backend/app/services/docx_document_render.py` | 450 | 新分页适配另立小模块 |

### 6.2 拟新增模块（名称可随既有目录调整）

| 层 | 拟放位置/文件 | 单一职责 | 目标行数 |
|---|---|---|---:|
| UI 装配 | `frontend/src/features/resume/editor/WorkbenchRibbon.tsx` | 功能区装配，不写状态机 | 100—180 |
| 命令 | 同目录 `workbenchCommands.ts` | 可见入口、右键、快捷键共享命令与可用性 | 150—250 |
| 选择 | 同目录 `selectionDescriptor.ts` | 从已有选择派生目标、范围、混合值 | 120—220 |
| 属性 UI | 同目录 `WorkbenchSelectionInspector.tsx` | 当前对象摘要与属性面板装配 | 100—180 |
| 段落模型 | `frontend/src/features/resume/document/paragraphIdentity.ts` | 稳定身份与编辑后映射 | 150—250 |
| 段落选择 | 同目录 `paragraphSelection.ts` | 光标/跨段选区解析 | 100—180 |
| 长度语义 | `frontend/src/features/resume/layout/styleMeasurements.ts` | 绝对/比例声明及物理单位解析 | 150—250 |
| 格式复制 | 同目录 `formatClipboard.ts` | 有效格式快照及目标补丁 | 120—220 |
| 标尺 UI | `frontend/src/features/resume/preview/WorkbenchRulers.tsx` | 手柄、读数、键盘操作视图 | 150—250 |
| 标尺几何 | 同目录 `rulerGeometry.ts` | 屏幕/文档坐标转换纯函数 | 100—180 |
| 标尺事务 | 同目录 `useRulerDrag.ts` | 开始、预览、提交、取消 | 120—220 |
| 简历恢复 | `frontend/src/features/resume/editor/useWorkbenchResumeDraft.ts` | 有界 sessionStorage 暂存、显式恢复、丢弃及 revision 核对 | 160—260 |
| 后端段落契约 | `backend/app/schemas/resume_paragraph.py` | 新段落元数据类型与校验 | 100—220 |
| 后端样式解析 | `backend/app/services/resume/style_measurements.py` | 模式互斥、继承、有效长度 | 150—250 |
| 后端分页语义 | 同目录 `paragraph_pagination.py` | 新旧规则解析、保持关系与冲突优先级 | 150—250 |
| PDF 适配 | `backend/app/services/pdf_exporter/paragraph_layout.py` | 行测量、缩进、分页执行 | 150—250 |

此表是规划，不表示文件已经存在。每个新模块配同目录或现有测试目录的行为测试；DOCX/HTML 适配先复用现有小模块，实际超预算再按职责拆。依赖方向为 UI → 命令/选择 → 文档变更/有效格式 → 既有历史与保存；后端 schema 不导入 services，渲染器消费统一语义而不反向依赖 UI。

### 6.3 分阶段实施

| 阶段 | 工作 | 阶段出口 |
|---|---|---|
| A | 复测基线；冻结新段落/单位/版本协议与旧行为样本；W11 术语、W01/W02/W07 交互合同、D08 A4 几何契约 | 有代码证据、接口形状、入口地图、测试样本；需要的拆分先保持行为不变 |
| B | W03 段落身份、W04 物理单位、W05 样式解析；同步 HTML/PDF/DOCX 最小闭环 | 单段 11 pt、行内标记、局部继承、保存重开与旧文档兼容通过 |
| C | W01/W02 工作区预设与属性整合、W07 事务、W06 格式复制、W14 会话恢复 | 选择正确、混合值正确、恢复明确、一次操作一次撤销 |
| D | W08 A4 标尺、W09 辅助视图、W10 分页新语义与默认值 | 所有 S/P 场景及响应式浏览器行为通过；PDF/Word语义对拍 |
| E | W15 优化器、W16 检查闭环、W17 模板/版式影响摘要、W18 变体和内容范围 | 新约束一致，报告/预设/变体不会覆盖未选内容 |
| F | W12 兼容、文档、完整质量检查与交接 | 明确通过、失败、跳过、风险及回退方式 |

共享文件（语言包、类型入口、schema、规范、CHANGELOG）由一个写入者统一修改。并行只能按不重叠文件划分；本计划文档也由主代理单写。

## 7. 验证与文档同步

### 7.1 直接相关的现有测试

前端优先扩展：

- `frontend/src/features/resume/editor/useWorkbenchSelectionSync.test.ts`
- `frontend/src/features/resume/editor/useWorkbenchV2History.test.tsx`
- `frontend/src/features/resume/editor/useWorkbenchV2Shortcuts.test.ts`
- `frontend/src/features/resume/editor/inlineFormatEntry.test.tsx`
- `frontend/src/features/resume/editor/ResumeWorkbenchOverallSave.test.tsx`
- `frontend/src/features/resume/layout/styleOverrides.test.ts`
- `frontend/src/features/resume/layout/styleParity.test.ts`
- `frontend/src/features/resume/layout/formatDomains.test.ts`
- `frontend/src/features/resume/layout/StyleValueRow.test.tsx`
- `frontend/src/features/resume/layout/formatPainterRemoved.test.ts`
- `frontend/src/features/resume/pagination/paginationBreaks.test.ts`
- `frontend/src/features/resume/pagination/SectionPaginationPanel.test.tsx`
- `frontend/src/features/resume/layout/EntryLayoutPanel.pagination.test.tsx`
- `frontend/src/features/resume/preview/workspacePresets.test.ts`
- `frontend/src/hooks/useFormDraft.test.tsx`
- `frontend/src/utils/formDraftStorage.test.ts`
- `frontend/src/features/resume/optimizer/constraints.test.ts`
- `frontend/src/features/resume/optimizer/LayoutOptimizerPanel.test.tsx`
- `frontend/src/features/resume/preflight/usePreflight.test.tsx`
- `frontend/src/features/resume/preflight/preflightCache.test.ts`
- `frontend/src/features/resume/preflight/CheckPanel.test.tsx`
- `frontend/src/features/resume/preflight/ScannerReadView.test.tsx`
- `frontend/src/features/resume/template-trial/TemplateTrialPanel.test.tsx`
- `frontend/src/features/resume/layout/formatPresetSwitch.test.ts`
- `frontend/src/features/resume/versions/VersionsModal.test.tsx`
- `frontend/src/features/resume/versions/ScenarioVariantSection.test.tsx`

后端优先扩展：

- `backend/tests/test_resume_style_object_roles.py`
- `backend/tests/test_resume_field_styles.py`
- `backend/tests/test_resume_field_style_exports.py`
- `backend/tests/test_pdf_exporter_style.py`
- `backend/tests/test_docx_exporter_style.py`
- `backend/tests/test_entry_pagination_v2.py`
- `backend/tests/test_document_pagination_v2.py`
- `backend/tests/test_pagination_export.py`
- `backend/tests/test_pdf_exporter_pagination.py`
- `backend/tests/test_resume_document_save.py`

新增测试应验证实际语义：段落身份编辑映射、绝对/比例继承、保存部分失败、超配额反馈、标尺坐标与拖动事务、分页冲突和有界终止；再覆盖模式切换不改文档、恢复草稿不跨简历/数据集、优化器尊重固定字号、检查失效与复检、切版式影响范围、变体选择性同步及 A4 尺寸对拍。真实浏览器验证焦点、输入法、字体加载、三栏/两栏/单栏及真实 PDF；不能只靠源码文本守卫证明交互完成。

### 7.2 实施时的检查顺序

1. 先运行改动直接相关用例；修 bug 先建立复现。前端 `pnpm exec vitest run <相关文件>`；后端 `python -m pytest -q <相关文件>`，子集不带覆盖率。
2. 静态检查：前端 `pnpm run format:check`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run build`；后端 `python -m ruff check .`、`python -m pip check`。
3. 全量测试与覆盖率按当前 AGENTS.md 和实际配置执行，不能用子集覆盖率替代。后端门槛 80%；当前前端 `vitest.config.ts` 的棘轮阈值为 statements 63 / branches 58 / functions 56 / lines 65，只升不降。本期不得降低阈值，也不把前端存量未到 80% 认定为本次回归；若要额外提升前端全量目标，应另立质量任务并确认。
4. 后端覆盖率串行、显式根配置；并行通过性测试与覆盖率分开。使用 backend 虚拟环境：`coverage run --rcfile=../pyproject.toml -m pytest -q`，随后 `coverage combine --keep`、`coverage report --rcfile=../pyproject.toml --fail-under=80`。
5. 判绿同时看汇总 failed=0、前端 Errors 行以及覆盖率报告真实完成。具体环境问题按 `docs/maintenance.md`，不把检查未执行写成通过。
6. 守卫变化做反证：在实施授权范围内备份到仓库外，精确变红后逐字节还原，再复跑；不得使用 checkout/restore/stash 回滚共享工作区。
7. 前端依赖校验使用钉定的 pnpm、冻结锁文件；执行规定的依赖审计。本轮仅维护本文，未安装依赖或运行全量业务测试。
8. 文档运行 `python scripts/check_docs_pii.py`；检查新增 Markdown 内引用文件存在、UTF-8/LF 与无无关改动。

### 7.3 同步文档

- `docs/ui-copy-guide.md`：术语、位置名称、样式动作、分页清除范围。
- `docs/resume-document-model.md`：段落身份、新格式模式、继承层、分页新旧语义。
- `docs/user-guide.md` 与应用内使用指南的真实入口：操作步骤、默认行为、兼容说明。
- 中英文语言包：名称、提示、错误、无障碍文本成对更新。
- README 功能说明（受影响时）、API/备份格式说明（受影响时）、CHANGELOG。
- 本文：实施时逐项补证据和状态，未完成事项不得直接勾选。

## 8. 竞品参考（2026-11-18 核验）

下列产品只用于比较操作模式和成熟工作流；官网用户数是各家自报数据，统计口径不一致，不构成横向排名，也不证明 ResumeForge 应复制其商业模型。

| 产品与可核验热度 | 本轮读取到的官方做法 | 对本方案的参考范围 |
|---|---|---|
| [Reactive Resume](https://github.com/reactive-resume/reactive-resume)：GitHub API 显示约 45,856 stars，仓库最近推送 2026-11-16 | 当前 README 用 Write/Design/Check 组织；提及预览、自动保存/未保存恢复、键盘快捷键、可搜索命令栏、模板与恢复历史 | W13 工作模式与命令入口；W14 会话草稿；W16 检查闭环。ResumeForge 正文按自己的 sessionStorage 隐私规则恢复 |
| [FlowCV](https://flowcv.com/)：官网自报 6.9M+ 求职者 | 官网说明账户自动保存、可调整设计并实时并排预览，支持保存/复用自定义设计 | W14 的保存状态区分；W17 对模板与版式采纳前后差异的展示 |
| [Rezi](https://www.rezi.ai/)：官网自报约 4.8M 用户 | 字号指南 2026-07-20 更新，字号范围 6—16 pt；行距指南 2026-07-23 更新，说明行高与板块间距分别调节并可实时预览 | W04 推荐范围与硬限制分开、准确单位输入；本文仍使用用户确认的 11 pt 稳定语义，不照搬对方上/下限 |
| [Enhancv](https://enhancv.com/)：官网自报创建 15M+ 份简历 | 官网列出可定制板块、字体、颜色、背景、单/双栏和多页，并把 ATS 检查与岗位定制放在同一产品流程 | W16 检查闭环、W17 模板能力摘要；不因此新增未经确认的自由画布 |
| [Kickresume](https://www.kickresume.com/en/)：官网自报 8M+ 求职者 | 官网把模板、ATS 检查与内容撰写能力并列呈现 | W01/W16 的任务分组与检查入口；不以模板数量作为本期验收目标 |
| [超级简历 WonderCV](https://www.wondercv.com/)：官网自报 30M+ 用户选择 | 官网突出岗位分类、简历问题定位和修改建议 | W16 的可定位问题与修复/复检；不将 AI 得分表述成录用保证 |
| [OpenResume](https://github.com/xitanggg/open-resume)：GitHub API 显示约 8,989 stars | README 描述实时预览等 builder 能力；API 显示最近推送为 2024-10-29 | 热度较高但更新较旧，本轮不把它作为“当前最新交互”的主要依据 |

本轮对 Teal 官方网站/帮助页收到了 Cloudflare 403；Zety 多个官方入口超时；FlowCV 帮助子域无法解析；Rezi 曾引用的旧 auto-format 路径返回 404。以上页面不作为具体功能依据。Teal 先前被报告的特定日期和 11.5 pt 细节未取得可重复核验的页面正文，已从本计划中排除。Reactive Resume 旧编辑器 overview 路径超时，但其当前 GitHub README 与 v6 更新页面可访问，因此只采用当前 README 明列的功能。

## 9. 本轮记录结果

- 首轮工具归位、选中范围、精确输入、术语统一及样式/分页：W01—W12 与 §4、§5 已记录。
- 竞品复核补充：W13—W19 已加入，重点复用已有工作区预设、会话草稿工具、优化器、预检、模板试用、具名版式和岗位变体。
- 本期范围：D08 明确只做 A4，不含 Letter。
- 本次只更新方案文档；业务代码、测试、数据库与现行规范未改动，未运行业务测试。
- 本文是当前已确认问题的持续清单；后续提问可继续增补，全部问完后再交付给新对话实施。
