// SPDX-License-Identifier: Apache-2.0
/** 使用指南正文（续）：简历 / 助手 / 数据备份 / 快速开始 / 弹窗外壳（2026-10-28 从 userGuide 包拆出，压 500 行预算）。 */
/**
 * 使用指南：八步的标题、导语、要点与动作按钮，以及首启动「快速开始」与弹窗自身的按钮文案。
 *
 * 数据文件（components/user-guide/*.ts、quickStartPaths.ts）只存 `userGuide.*` key，
 * 正文里的 `**强调**` 与「引用控件名」原样保留：前者由 `UserGuideModal` 渲染成粗体，
 * 后者由 `components/userGuideCopyRef.test.ts` 校验它确实存在于源码里。
 */
const userGuideFlow = {
  // ── 第 1 步 · 制作简历（resumeSteps.ts） ──
  "userGuideFlow.resume.step1.title": "制作简历",
  "userGuideFlow.resume.step1.heading": "按岗位生成，或写一份通用的",
  "userGuideFlow.resume.step1.description":
    "从岗位进入简历流程，预览后可只改点中的那一处，或用「手动调整」通改，再保存历史记录并导出。",
  "userGuideFlow.resume.step1.point1.lead": "三种入口",
  "userGuideFlow.resume.step1.point1.text":
    "本页页头的「AI 生成」不绑定岗位，生成一份通用简历（按当前方案包含的板块取资料，不按方向筛选）；「新建简历」是按当前方案资料预填的手写入口，页签也只显示当前方案有的分区；从岗位详情进入的 AI 生成会按该岗位筛选资料并可选择美化程度。",
  "userGuideFlow.resume.step1.point2.lead": "长 CV 生成",
  "userGuideFlow.resume.step1.point2.text":
    "生成弹窗的「文档模式」可选「普通简历」（1–3 页）或「长 CV」（最多 10 页）。长 CV 只是显式选择的页数策略，不会自动切换；超页会如实提示，不自动缩小字号。",
  "userGuideFlow.resume.step1.point3.lead": "用于本次生成",
  "userGuideFlow.resume.step1.point3.text":
    "生成弹窗里的「职业场景（用于本次生成）」默认关闭；打开并选中场景后，服务端只发送允许的表达维度并冻结一份快照（不发送姓名、联系方式；就业状态默认不发送）。关闭时请求与旧版本完全一致。",
  "userGuideFlow.resume.step1.point4.lead": "通用简历",
  "userGuideFlow.resume.step1.point4.text":
    "方向还没定时用：不绑定岗位，入口是本页页头「新建简历」（标题「从头编写通用简历」），按当前方案预填资料；页签、页签名与可见字段随当前方案在创建时冻结，之后改方案不影响这份简历。另一个窗口改资料/切组后自动刷新；有未保存修改先问覆盖还是保留。保存只写这份简历、不改资料。",
  "userGuideFlow.resume.step1.point5.lead": "从资料填入",
  "userGuideFlow.resume.step1.point5.text":
    "自己写简历时，每个条目（含自建板块）旁都有「从资料填入本条」：选中一条点「填入」，只补当前这条的空字段；已在其它条目用过的标「已在其他条目」、本条自己标「当前条目」并禁用，不重复也不覆盖手写内容。候选跟随当前方案，资料变化或切组后自动刷新。",
  "userGuideFlow.resume.step1.point6.lead": "生成是后台任务",
  "userGuideFlow.resume.step1.point6.text":
    "弹窗里显示「整理资料 → 筛选资料 → 调用模型生成 → 校验修复 → 完成」的阶段条和「已接收 N 字」的实时计数——没有百分比，因为模型逐字输出、总长未知。",
  "userGuideFlow.resume.step1.point7.lead": "可以关掉弹窗",
  "userGuideFlow.resume.step1.point7.text":
    "生成期间放心关掉，任务会在后台继续，完成后会弹「简历已生成」通知并直接打开结果；点「取消生成」才真正中断，且取消后不保存任何半成品。",
  "userGuideFlow.resume.step1.point8.lead": "篇幅与字号",
  "userGuideFlow.resume.step1.point8.text":
    "生成前可选最大篇幅（1-3 页 A4）与字号（5-18px、0.1px 步进，小于 8px 会提示打印可能看不清），默认一页 + 标准字号；旁边「字体」可按这份简历挑一款已下载或已导入的字体（内置的思源黑体要先在设置里下载）。",
  "userGuideFlow.resume.step1.point9.lead": "简历语言",
  "userGuideFlow.resume.step1.point9.text":
    "导出前可以在排版设置里选「简历语言」，它只改小节标题与字段名（如 Education / Skills），不会翻译你写的内容。",
  "userGuideFlow.resume.step1.point10.lead": "版面诊断",
  "userGuideFlow.resume.step1.point10.text":
    "预览上方会显示正文**占了页面**的百分之多少，并告诉你该按什么顺序改；多页简历另看末页是否太空。",
  "userGuideFlow.resume.step1.point11.lead": "自动一页",
  "userGuideFlow.resume.step1.point11.text":
    "内容塞不下时按钮才会出现：它按「页边距 → 区块间距 → 行高 → 字号」逐档收紧，**够放下就停**，不会一步把字缩到最小。",
  "userGuideFlow.resume.step1.point12.lead": "缩到多小为止",
  "userGuideFlow.resume.step1.point12.text":
    "**自动一页**最多把字号缩到 11px（手动滑块可以更小，最小 5px）；排版参数收到最紧还是放不下时，它会如实说，而不是假装成功。",
  "userGuideFlow.resume.step1.point13.lead": "科研简历",
  "userGuideFlow.resume.step1.point13.text":
    "制作台中栏有学术成果、科研项目、知识产权三栏：题目、作者顺序与本人标记、发表状态（在投不会被写成已发表）、DOI / 链接都能录；参数栏「文档模式」可切「长 CV」（上限 10 页，普通简历 1–3 页）。",
  "userGuideFlow.resume.step1.point14.lead": "语言能力独立栏目",
  "userGuideFlow.resume.step1.point14.text":
    "语言能力在简历里是独立栏目（制作台左栏也有独立「语言能力」页签），按语言（水平 · 证书 · 分数）展示、取得时间作行尾说明，不再并入专业技能；模型漏写时后端也会按资料补回。",
  "userGuideFlow.resume.step1.point15.lead": "版面优化",
  "userGuideFlow.resume.step1.point15.text":
    "预览「版面诊断」卡下方能按条件优化版面：先设「不动字号 / 最小页边距 / 目标篇幅」，再看最多 3 个候选（改了哪些参数、减少多少溢出、可读性影响）；点「应用这个方案」会把数值写回滑杆，不偷偷缩字号。",
  "userGuideFlow.resume.step1.point16.lead": "内容精简候选",
  "userGuideFlow.resume.step1.point16.text":
    "版面优化除收紧排版，还给内容层候选：合并重复条目、删除重复要点、合并短要点，有岗位信号时精简低相关要点；每个候选列出改动，先看差异、确认才写入（可撤销），无方案时说明原因。",
  "userGuideFlow.resume.step1.point17.lead": "来源与事实锁",
  "userGuideFlow.resume.step1.point17.text":
    "制作台左栏「来源」显示选中内容来自哪条资料、关联时是哪一版，未关联不猜；可建立关联（含手工来源），来源更新后可确认后采纳写回。事实锁锁住关键事实，AI 改写被拒并逐条列值，手动编辑不受限。",
  "userGuideFlow.resume.step1.point18.lead": "外发预览与用量",
  "userGuideFlow.resume.step1.point18.text":
    "设置页能看「外发前预览」（这次要发什么：目标服务、资料类别、附件、排除字段与正文）和「模型用量」（按任务 / 模型列调用数与 token；未知 token 不算 0）；预览正文只存在内存、不落盘。",
  "userGuideFlow.resume.step1.point19.lead": "文档大纲",
  "userGuideFlow.resume.step1.point19.text":
    "制作台左栏「文档大纲」按板块列条目与要点：可排序、复制、隐藏、锁内容或锁排版；顶部可搜索大纲并从纸面定位后恢复滚动，要点也能单独隐藏或复制；隐藏内容不进任何导出。拖拽排序时大纲树与右侧预览实时跟随（屏幕窄、编辑内容收进抽屉时同样生效，并会算进保存修改），松手才记一步历史；条目与要点手柄样式不同。",
  "userGuideFlow.resume.step1.point20.lead": "保存冲突",
  "userGuideFlow.resume.step1.point20.text":
    "在「简历制作台」保存时，如果同一份简历已在别的窗口改过，会先让你选「用最新的 / 比较差异 / 另存副本」，**不会直接覆盖**别人的改动。",
  "userGuideFlow.resume.step1.point21.lead": "检查简历",
  "userGuideFlow.resume.step1.point21.text":
    "制作台动作条「检查简历」三层检查内容、排版与导出产物，问题分级并给修复入口，修完可复检；还会查关键链接与导出脱敏状态，导出前核对用服务端同快照摘要。",
  "userGuideFlow.resume.step1.point22.lead": "专业视图",
  "userGuideFlow.resume.step1.point22.text":
    "画布工具条能整页 / 适宽 / 100% 缩放、翻页、开辅助线和灰度校样；「命令」或 Cmd/Ctrl+Shift+P 打开命令面板，工作区预设只切面板可见性；「照片裁剪」只改取景、原图不动，可恢复原图，参数随这份简历保存；没裁剪时照片按原图比例展示、不会被强制裁成方框。",
  "userGuideFlow.resume.step1.point23.lead": "撤销与恢复",
  "userGuideFlow.resume.step1.point23.text":
    "制作台左栏的「历史」能一步步撤销或恢复：内容、排版、结构操作各记一步（连续输入合并成一步）；点某一步只看当时的摘要，真正的回退按「撤销」。",
  "userGuideFlow.resume.step1.point24.lead": "局部排版",
  "userGuideFlow.resume.step1.point24.text":
    "制作台左栏「局部排版」按六类段落微调字号、颜色、行距与缩进，未设过的属性跟随模板并可逐项恢复继承；格式刷能把一条的排版复制到另一条，正文选中文字可用斜体 / 链接按钮。",
  "userGuideFlow.resume.step1.point45.lead": "文字级别",
  "userGuideFlow.resume.step1.point45.text":
    "选中内容后可套用「一级标题 / 二级标题 / 三级标题 / 正文 / 次要说明」五个固定文字级别，可多选批量应用、可恢复跟随模板；大纲里多选条目也能批量套用。",
  "userGuideFlow.resume.step1.point46.lead": "字段排版",
  "userGuideFlow.resume.step1.point46.text":
    "「文字级别」可按作用范围套用（整个条目 / 条目标题 / 正文 / 说明）；排版参数新增「条目字段排版」按字段微调字号，补充字段可按 1–3 列分行。",
  "userGuideFlow.resume.step1.point25.lead": "分页控制",
  "userGuideFlow.resume.step1.point25.text":
    "制作台左栏「分页」可给板块设「从新页开始」、续页重复姓名与页码；页缩略图显示实际页数与末页占用，PDF/Word 避免标题或要点孤行；草稿不显示真实分页，切精确或导出核对。板块分页方式可整份切换自然填充/每板块新页；已设断页可见，可一键恢复自然分页。",
  "userGuideFlow.resume.step1.point26.lead": "表达资产",
  "userGuideFlow.resume.step1.point26.text":
    "制作台左栏的「表达资产」收藏可复用的表达，按关键词 / 类型 / 语言 / 岗位标签检索；选中要插入的位置后一键插入（生成新对象），删除会进回收站、可在 Toast 里撤销。",
  "userGuideFlow.resume.step1.point27.lead": "命名版本",
  "userGuideFlow.resume.step1.point27.text":
    "制作台顶部「版本」保存不可变命名版本：可冻结、比较、恢复，恢复生成新的当前版本且历史与已投递记录不变。「岗位变体」独立编辑并可选路径同步；变体还能存独立排版并按变体导出。想按职业场景调整表达，可在「岗位变体」页先派生一条场景变体，再生成候选、看差异后采纳——源简历不会被改写。",
  "userGuideFlow.resume.step1.point28.lead": "双语版本",
  "userGuideFlow.resume.step1.point28.text":
    "制作台左栏的「双语版本」做正文翻译：左右对照后点「生成翻译候选」，逐项勾选「采纳选中」只写入该语言变体，不改当前简历；人名 / 公司名等固定译法先记进「术语表」（数据集级、可锁定），删除进回收站可恢复。生成要等整份简历翻完（通常几十秒），等待时不要重复点击。",
  "userGuideFlow.resume.step1.point29.lead": "改写某一栏",
  "userGuideFlow.resume.step1.point29.text":
    "在「手动调整」里**选中要改的那段文字 → 右键 →「AI 润色」**：写下要求 → 生成 → 结果先给你看，点「替换选中」才写回；只把选中的那一段发给模型。不满意可以直接关掉，原文一字不动。",
  "userGuideFlow.resume.step1.point30.lead": "生成完会提醒你",
  "userGuideFlow.resume.step1.point30.text":
    "简历生成、岗位解读、匹配度分析、岗位优化建议这类要等模型的任务都先说明再开跑，生成中给「后台继续」——关掉窗口也能跑完（建议生成可随时取消），结束**弹窗提醒并响一声**（声音可在设置 → 提醒与提示音里关）。",
  "userGuideFlow.resume.step1.point31.lead": "写作增强",
  "userGuideFlow.resume.step1.point31.text":
    "编辑简历时**选中一段文字 → 右键 →「写作增强」**：可做 STAR 量化改写、话术生成器（简历版 / STAR 版 / 口述版）、多风格润色、中英互译。结果**写回你刚选中的那一段**（右键落在不可编辑的位置时动作变成「复制」）；还能任选两份简历做「版本对比」（纯本地计算、不调模型）。",
  "userGuideFlow.resume.step1.point32.lead": "选中就能润色",
  "userGuideFlow.resume.step1.point32.text":
    "选中文字后右键，菜单里有剪切/复制/粘贴/全选；在输入框、多行文本框或可编辑区域里还会多出「写作增强」与「AI 润色」两项。写一句要求 → 看结果 → 点「替换选中」才写回；只发送选中的这一段，不发送整份简历。",
  "userGuideFlow.resume.step1.point33.lead": "放大预览",
  "userGuideFlow.resume.step1.point33.text":
    "按住 **Ctrl**（macOS 为 **Cmd**）滚鼠标滚轮即可缩放预览，工具栏上也有放大 / 缩小 / 适应页面三个按钮。预览下方的「简历制作台」把参数、内容编辑、版面放在同一屏；**分边页边距只在制作台里**——「分边调整页边距」这个开关在生成前的配置页和预览工具栏都已经没有了。栏宽可拖动、可一键复位。",
  "userGuideFlow.resume.step1.point34.lead": "精确预览",
  "userGuideFlow.resume.step1.point34.text":
    "工具栏第一行的「草稿 / 精确」切换：**草稿**是浏览器实时排版，改一下立刻看到、可点选编辑；**精确**显示服务端按导出引擎排好的 PDF，与点「导出」下载到的完全一致，页数也照它报。",
  "userGuideFlow.resume.step1.point35.lead": "保存前自检",
  "userGuideFlow.resume.step1.point35.text":
    "「质量检测」要先点「开始扫描」才跑：查重、敏感词、夸大风险、深挖风险点、合规与 ATS 本地检测；扫描中可取消，关掉窗口也会在后台跑完并通知。ATS 另给分项、覆盖率与逐条建议，关联了岗位时打开就自动带入 JD（只填不跑检测）。",
  "userGuideFlow.resume.step1.point36.lead": "模板",
  "userGuideFlow.resume.step1.point36.text":
    "五套模板另有只调参数的版式，生成前与预览时都能切换，模板一览可点缩略图看大图；还能用「试用与对比」拿当前内容并排比较两套模板（显示真实页数与溢出），采纳后才生效。同一条工具栏里可调板块顺序、给联系方式指定强制换行（每个字段整体不拆行，长网址不会被截断）。技术/社论/分栏已不出现。",
  "userGuideFlow.resume.step1.point37.lead": "导出格式",
  "userGuideFlow.resume.step1.point37.text":
    "PDF 可直接下载（服务端生成），也可以走浏览器打印（版式与预览一致）；此外还有 Word、纯文本、Markdown、JSON。",
  "userGuideFlow.resume.step1.point38.lead": "水印与脱敏",
  "userGuideFlow.resume.step1.point38.text":
    "导出时可加自定义水印（**仅 HTML / PDF / Word**，纯文本与 Markdown、JSON 不支持，同时勾选会报错），或一键隐私脱敏（姓名 / 电话 / 邮箱 / 公司 / 学校等）。",
  "userGuideFlow.resume.step1.point39.lead": "导出交付包",
  "userGuideFlow.resume.step1.point39.text":
    "已保存简历的导出窗口可保存导出配置（格式、命名规则、水印/脱敏），水印/脱敏可先预览真实 PDF；还能成套导出 zip（逐项哈希）并可选归档交付原件（哈希与字体/渲染版本清单）。",
  "userGuideFlow.resume.step1.point40.lead": "给别人看",
  "userGuideFlow.resume.step1.point40.text":
    "用「离线分享包」：脱敏 HTML/PDF + 只读快照 + 评论回传文件，可选只读或可评论。可评论的包生成后详情里会出现「对象批注」：导入别人交回的 annotations.json，逐条「标记已解决」「忽略这条」；对象改过的批注要「重新关联」，不会自动挂到别的条目上——批注只存在分享包里，不会进投递的简历。",
  "userGuideFlow.resume.step1.point41.lead": "内容超出页数",
  "userGuideFlow.resume.step1.point41.text":
    "草稿预览会把多页**上下摞成几张 A4**（按 A4 高度切分的近似分页）并提示约需几页、超出多少；要看真实分页就切「精确」——那是导出引擎排出的同一份 PDF。",
  "userGuideFlow.resume.step1.point42.lead": "保存之后",
  "userGuideFlow.resume.step1.point42.text":
    "可回看关联岗位，也能给每条简历加一条**备注**标记用途；列表还能按**岗位**筛选（地址里带 `?job_id=`，存成书签可直达）。",
  "userGuideFlow.resume.step1.point43.lead": "投递存档",
  "userGuideFlow.resume.step1.point43.text":
    "每条交付记录旁都能**下载存档**；简历中心的「交付存档」还能在原简历删除后按标题、公司和来源找回历史记录。文件按冻结内容与参数重新生成，可能略有差异，界面会说明并给出历史指纹。",
  "userGuideFlow.resume.step1.point44.lead": "批量选择",
  "userGuideFlow.resume.step1.point44.text":
    "在简历中心、备选岗位、助手会话或消息、历史面试、深挖、提醒、题库、填充记录、知识库、资料箱、事实台账、面经、内推与投递记录明细等列表的条目上**右键**，选择「批量选择」进入多选，统一确认后删除（都进回收站可恢复）。",
  "userGuideFlow.resume.step1.actionLabel": "查看简历中心",
  // ── 第 1 步 · 求职助手（assistantSteps.ts） ──
  "userGuideFlow.assistant.step1.title": "求职助手",
  "userGuideFlow.assistant.step1.heading": "让助手直接帮你处理数据",
  "userGuideFlow.assistant.step1.description":
    "可以问它项目里的任何事，也可以让它在明确告知后直接改动数据；在其它页面遇到问题时，单击投投悬浮球即可打开它，**双击**则打开「投投剪贴板」存放常贴的资料片段。",
  "userGuideFlow.assistant.step1.point1.lead": "它能查到什么",
  "userGuideFlow.assistant.step1.point1.text":
    "岗位、备选岗位、资料箱、简历版式、个人资料之外，还能查提醒、内推、面经、题库历史、复盘历史、知识库、求职统计和分享包；也能汇总投递记录的失败原因帮你诊断。",
  "userGuideFlow.assistant.step1.point2.lead": "它能改什么",
  "userGuideFlow.assistant.step1.point2.text":
    "能**新增和修改知识库条目、记一条提醒、新建或更新求职进度记录**，还能录入面经与内推、把提醒标记完成、给简历收藏或备注；结构化条目（教育 / 工作 / 项目 / 技能 / 奖项）只能**追加一条**。",
  "userGuideFlow.assistant.step1.point3.lead": "时间感知",
  "userGuideFlow.assistant.step1.point3.text":
    "回答前会拿到本地日期、时间与星期；深夜提问，它会先提醒你早点休息。",
  "userGuideFlow.assistant.step1.point4.lead": "不会替你删除",
  "userGuideFlow.assistant.step1.point4.text":
    "**但它不会替你删除任何数据**：没有删除类工具，要删只能你自己在对应页面或回收站操作。",
  "userGuideFlow.assistant.step1.point5.lead": "会先查证",
  "userGuideFlow.assistant.step1.point5.text":
    "涉及你数据的结论（「你有几个岗位 / 提醒 / 内推」）会先用工具查证再回答，不凭猜；只在你明确要求时才写入。",
  "userGuideFlow.assistant.step1.point6.lead": "一眼可见",
  "userGuideFlow.assistant.step1.point6.text":
    "每次改动记在回复里的「助手做了什么」，标题**直接写明「改动了 N 项」或「N 项失败」**，不展开也知道。",
  "userGuideFlow.assistant.step1.point7.lead": "读取范围",
  "userGuideFlow.assistant.step1.point7.text":
    "会**自动带上当前数据集里的个人资料**，但发送给模型前会去掉姓名、电话、邮箱和照片；岗位与简历仍由你按需关联。",
  "userGuideFlow.assistant.step1.point8.lead": "贴图提问",
  "userGuideFlow.assistant.step1.point8.text":
    "输入框里可以**直接粘贴截图**（Ctrl+V）或点「附件」选文件（最多 4 个、单个 ≤ 2 MB）；贴着图的那一步问完，紧接的下一句里这张图还会再带上一次，再往后就不重复发了。悬浮球卡片里一样能用。",
  "userGuideFlow.assistant.step1.point9.lead": "联网搜索",
  "userGuideFlow.assistant.step1.point9.text":
    "打开后助手会先自动搜一次，还能自己换关键词多搜（一轮合计最多 3 次），来源收在回答下方「参考来源（N）」，点标题可开原网页。",
  "userGuideFlow.assistant.step1.point10.lead": "技能开关",
  "userGuideFlow.assistant.step1.point10.text":
    "输入框下方工具条里的「技能」按钮可以直接开关已启用的技能。",
  "userGuideFlow.assistant.step1.point11.lead": "新建技能",
  "userGuideFlow.assistant.step1.point11.text": "要新建或改提示词，去侧栏的「**工作台 → 技能**」。",
  "userGuideFlow.assistant.step1.point12.lead": "会话管理",
  "userGuideFlow.assistant.step1.point12.text":
    "左侧会话列表的「⋮」或右键可重命名、置顶、复制分享链接、在新对话中继续、归档与删除，也能导出 Markdown 或存进资料箱。",
  "userGuideFlow.assistant.step1.point13.lead": "消息操作",
  "userGuideFlow.assistant.step1.point13.text":
    "右键任意一条消息可以「引用这条继续问」、复制或删除；要一次删掉几条，右键任意一条消息选「批量选择」，勾好后点「删除所选」。",
  "userGuideFlow.assistant.step1.point14.lead": "思考过程",
  "userGuideFlow.assistant.step1.point14.text":
    "有思考模式的模型可以在输入框右侧调「思考强度」，开启后回复下方会出现默认折叠的「思考过程」。",
  "userGuideFlow.assistant.step1.actionLabel": "打开求职助手",
  // ── 第 2 步 · 资料箱、知识库与工作台（assistantSteps.ts） ──
  "userGuideFlow.assistant.step2.title": "资料箱、知识库与工作台",
  "userGuideFlow.assistant.step2.heading": "存放资料与知识，打造自己的助手与模板",
  "userGuideFlow.assistant.step2.description":
    "资料箱放零散资料，知识库沉淀成文笔记，工作台里自制技能与模板。",
  "userGuideFlow.assistant.step2.point1.lead": "资料箱",
  "userGuideFlow.assistant.step2.point1.text":
    "支持写正文、贴链接、传图片与文本文件，文件可以直接拖进来；点卡片看详情（正文全文、备注与附件清单），助手能读取它们并帮你整理。",
  "userGuideFlow.assistant.step2.point2.lead": "我的文件",
  "userGuideFlow.assistant.step2.point2.text":
    "存入的文件都收在资料箱「我的文件」页签：图片、文档、PDF 一眼可见、随时打开；它们属于当前数据集，导出/导入与升级都不会丢",
  "userGuideFlow.assistant.step2.point3.lead": "知识库",
  "userGuideFlow.assistant.step2.point3.text":
    "沉淀成文内容——面经总结、简历技巧、求职策略、面试问答、行业笔记等；带分类与标签，正文支持 Markdown，可搜索、增删改，点卡片直接读全文。",
  "userGuideFlow.assistant.step2.point4.lead": "两者的分工",
  "userGuideFlow.assistant.step2.point4.text":
    "资料箱放**还没成体系的零散资料**，知识库放**整理成文、愿意反复看的笔记**。",
  "userGuideFlow.assistant.step2.point5.lead": "编辑快捷键",
  "userGuideFlow.assistant.step2.point5.text":
    "资料箱与知识库编辑弹窗支持 **Ctrl / ⌘ + S** 或 **Ctrl / ⌘ + Enter** 保存；标题报错时保留正文，修正后可继续保存。",
  "userGuideFlow.assistant.step2.point6.lead": "对话也能存",
  "userGuideFlow.assistant.step2.point6.text":
    "助手对话右侧的「⋮」可以把这段对话导出成 Markdown，或一键存进资料箱。",
  "userGuideFlow.assistant.step2.point7.lead": "技能",
  "userGuideFlow.assistant.step2.point7.text":
    "工作台的「技能」是一段长期生效的提示词，勾选后就对之后每次对话生效；也能带上知识文件。",
  "userGuideFlow.assistant.step2.point8.lead": "版式",
  "userGuideFlow.assistant.step2.point8.text":
    "工作台「版式」里内置版式直接列出来，点「自制版式」只填参数（行高、页边距、区块间距、强调色），不用写代码；想压进一页时这是最快的办法。自制模板与导入 HTML 的入口已下线，已有模板仍按原样渲染。",
  "userGuideFlow.assistant.step2.point9.lead": "找助手做版式",
  "userGuideFlow.assistant.step2.point9.text":
    "版式页有「找求职助手制作」入口，可以让助手新建或修改**版式**，最终仍要在工作台里保存；助手只改你提到的参数，清不掉已经设过的项。",
  "userGuideFlow.assistant.step2.actionLabel": "打开资料箱",
  // ── 第 1 步 · 数据备份与更新（dataBackupSteps.ts） ──
  "userGuideFlow.dataBackup.step1.title": "数据备份与更新",
  "userGuideFlow.dataBackup.step1.heading": "把数据带走，或换一份",
  "userGuideFlow.dataBackup.step1.description": "所有数据都在这台电脑上；换机器前先导出一份。",
  "userGuideFlow.dataBackup.step1.point1.lead": "删除先进回收站",
  "userGuideFlow.dataBackup.step1.point1.text":
    "岗位、备选岗位、简历、投递记录、事实台账条目、资料箱里的资料、助手会话、内推、提醒、面经、分享包，以及资料方案、自建板块/字段和资料条目，删除后先进侧栏「回收站」。",
  "userGuideFlow.dataBackup.step1.point2.lead": "能恢复",
  "userGuideFlow.dataBackup.step1.point2.text":
    "在回收站可以一键恢复，也能多选后一次性恢复或彻底删除；只有点「彻底删除」才会真正抹掉，而且会再确认一次。",
  "userGuideFlow.dataBackup.step1.point3.lead": "回收站之外查不到",
  "userGuideFlow.dataBackup.step1.point3.text":
    "回收站里的内容不会再出现在其它页面（列表、首页统计、搜索都查不到）。",
  "userGuideFlow.dataBackup.step1.point4.lead": "导出备份",
  "userGuideFlow.dataBackup.step1.point4.text":
    "设置里的「数据集」可把当前（或全部）数据集连同附件、自定义字体与全局模型配置导出成一个压缩包，新电脑上导入即可还原；自动备份只是数据库快照，不含附件与字体。包外还有数据目录项时会提示「另有 N 项未纳入备份」，明细在包内 manifest.json。",
  "userGuideFlow.dataBackup.step1.point5.lead": "保存位置",
  "userGuideFlow.dataBackup.step1.point5.text":
    "设置「数据」页签可指定导出内容的保存文件夹；本机前端导出时会同时写入该目录，远程或跨站请求不会触发本机文件读写",
  "userGuideFlow.dataBackup.step1.point6.lead": "多份数据集",
  "userGuideFlow.dataBackup.step1.point6.text":
    "导入默认新建一份，不碰当前正在用的那份；也能**新建一份空白数据集**从头开始记录。导入前先检查整包附件（校验和/同名冲突），有问题整次拒绝且本机原文件不动；确认后可选择跳过有问题的附件只导入库内容。",
  "userGuideFlow.dataBackup.step1.point7.lead": "存储与备份",
  "userGuideFlow.dataBackup.step1.point7.text":
    "设置 → 数据底部能看到数据目录各分项占了多少磁盘；迁移时留在 backups/ 里的数据库快照也会列出来——不需要的可以逐份确认后移到本地数据目录下的回收目录，随时能在文件管理器里找回来，系统不会自动清理。",
  "userGuideFlow.dataBackup.step1.point8.lead": "Key 去留",
  "userGuideFlow.dataBackup.step1.point8.text":
    "备份默认包含大模型 API Key，不需要时可在导出前取消勾选「备份中包含大模型 API Key」；恢复后建议到模型配置测试连接；旧版本导出的备份仍可导入，含 Key / 含字体（格式 5 与 6）的新包被旧版导入时会提示升级——跨大版本迁移请在同版本之间导出/导入。",
  "userGuideFlow.dataBackup.step1.point9.lead": "精简侧栏",
  "userGuideFlow.dataBackup.step1.point9.text":
    "设置 → 应用 → 「界面与导航」里可以关掉侧栏里用不到的模块，卡片标题栏的「恢复默认显示」一键还原。隐藏只收起入口——不删数据，首页、岗位广场、简历中心、我的资料、投递台与设置始终保留。",
  "userGuideFlow.dataBackup.step1.point10.lead": "窄屏与键盘",
  "userGuideFlow.dataBackup.step1.point10.text":
    "窄窗口点**「打开导航」**切换页面，「我的空间」仍在页头；键盘按 Tab 可先到「跳到主要内容」，按回车直接进入正文。常用动作有快捷键：Ctrl/⌘+K 搜索、Ctrl/⌘+S 保存、Ctrl/⌘+Z 撤回、Ctrl/⌘+J 开关助手；「设置 → 应用 → 快捷键」可改键。",
  "userGuideFlow.dataBackup.step1.point11.lead": "检查更新",
  "userGuideFlow.dataBackup.step1.point11.text":
    "页头刷新图标可检查更新。设置 → 应用支持下载、进度与后台下载；读取失败先点「重试读取状态」。Windows 确认「重启并安装」，macOS 用 update.command；只换程序，保留 data/、.env 与备份，结果以实际版本和日志为准。",
  "userGuideFlow.dataBackup.step1.point12.lead": "想卸载",
  "userGuideFlow.dataBackup.step1.point12.text":
    "Windows 双击项目目录里的 uninstall.cmd：默认只删启动器生成的环境与缓存，保留 data/ 与 .env；确认连数据一起删用 uninstall.cmd -Purge。macOS 不需要卸载脚本——直接删掉项目文件夹就是干净卸载。",
  "userGuideFlow.dataBackup.step1.point13.lead": "开始与停止",
  "userGuideFlow.dataBackup.step1.point13.text":
    "Windows 双击 start.cmd / stop.cmd，macOS 双击 start.command / stop.command；两边都是零依赖一键启动。macOS 上第一次打开可能被系统拦一次，**右键点它 → 打开**即可，只需一次。",
  "userGuideFlow.dataBackup.step1.point14.lead": "看源码",
  "userGuideFlow.dataBackup.step1.point14.text":
    "**页头「退出」左边**是 GitHub 图标，点开就是源码与 Issue 页面；更靠左那个标签显示**当前数据集**（点它直接打开菜单切换，菜单底部的「新建数据集…」还能就地再建一份）。**头像左边的「我的空间」** 是「我的资料」等私人页面的入口，头像本身则是你资料里当前用的那张照片。",
  "userGuideFlow.dataBackup.step1.point15.lead": "再看指南",
  "userGuideFlow.dataBackup.step1.point15.text":
    "侧栏底部的「使用指南」随时可以再打开；「退出」在页头，会把前端与后端进程一起停掉（浏览器不允许脚本关闭本页，退出后顺手关掉标签页即可）。",
  "userGuideFlow.dataBackup.step1.point16.lead": "先在线试用",
  "userGuideFlow.dataBackup.step1.point16.text":
    "还没装或想先熟悉界面，可以去官网页的「在线体验」点一遍；那是只读演示版，**没有接入真实模型**，AI 回复是预录回放，改动不会保存。",
  "userGuideFlow.dataBackup.step1.actionLabel": "前往设置",
  // ── 首启动「快速开始」的三条路径卡（quickStartPaths.ts） ──
  "userGuideFlow.quickStart.existingResume.lead": "我有一份现成简历",
  "userGuideFlow.quickStart.existingResume.text": "粘贴或上传 pdf/docx，识别成资料草稿",
  "userGuideFlow.quickStart.fromScratch.lead": "从零开始填写",
  "userGuideFlow.quickStart.fromScratch.text": "手动录入经历，全程不需要模型",
  "userGuideFlow.quickStart.sample.lead": "先体验示例数据",
  "userGuideFlow.quickStart.sample.text": "载入一份完整示例，与你的真实资料相互独立",
  // ── 弹窗自身的文案与 toast（UserGuideModal.tsx） ──
  "userGuideFlow.modal.title": "欢迎使用简历通",
  "userGuideFlow.modal.quickStart.heading": "从这里开始",
  "userGuideFlow.modal.quickStart.description": "三条路都通向你的第一份可交付简历，选一条顺的走。",
  "userGuideFlow.modal.action.viewFullGuide": "查看完整指南（8 步）",
  "userGuideFlow.modal.action.loadSample": "载入示例数据体验",
  "userGuideFlow.modal.action.later": "稍后查看",
  "userGuideFlow.modal.action.prev": "上一步",
  "userGuideFlow.modal.action.next": "下一步",
  "userGuideFlow.modal.action.start": "开始使用",
  "userGuideFlow.modal.toast.sampleReady": "示例数据已就绪，正在进入首页",
  "userGuideFlow.modal.toast.sampleReused": "已回到体验示例数据",
  "userGuideFlow.modal.toast.sampleFailed": "示例数据载入失败",
} as const;

export default userGuideFlow;
