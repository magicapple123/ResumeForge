// SPDX-License-Identifier: Apache-2.0
/**
 * 使用指南：八步的标题、导语、要点与动作按钮，以及首启动「快速开始」与弹窗自身的按钮文案。
 *
 * 数据文件（components/user-guide/*.ts、quickStartPaths.ts）只存 `userGuide.*` key，
 * 正文里的 `**强调**` 与「引用控件名」原样保留：前者由 `UserGuideModal` 渲染成粗体，
 * 后者由 `components/userGuideCopyRef.test.ts` 校验它确实存在于源码里。
 */
const userGuide = {
  // ── 第 1 步 · 配置 AI（setupProfileSteps.ts） ──
  "userGuide.setupProfile.step1.title": "配置 AI",
  "userGuide.setupProfile.step1.heading": "选择预设或自定义模型",
  "userGuide.setupProfile.step1.description":
    "需要模型的功能都走这里配置的接口；不需要模型的功能可以先跳过。",
  "userGuide.setupProfile.step1.point1.lead": "要不要配",
  "userGuide.setupProfile.step1.point1.text":
    "手动管理岗位、资料和自行编写简历**不需要**模型；AI 生成、岗位需求解读、优化建议、截图识别和求职助手需要一个。",
  "userGuide.setupProfile.step1.point2.lead": "快速预设",
  "userGuide.setupProfile.step1.point2.text":
    "覆盖常见服务商，选中即填好地址与模型名；DeepSeek 预设使用账号模型列表中的 `deepseek-flash`。",
  "userGuide.setupProfile.step1.point3.lead": "直连官方",
  "userGuide.setupProfile.step1.point3.text":
    "选「Claude（Anthropic 原生协议）」这个预设，会把地址、模型名和接口协议一次填好。",
  "userGuide.setupProfile.step1.point4.lead": "自定义",
  "userGuide.setupProfile.step1.point4.text":
    "「自定义模型」保留已填内容；**纯手动配置** 会清空 Base URL 与模型名称，适合中转站或公司网关。",
  "userGuide.setupProfile.step1.point5.lead": "不知道模型名",
  "userGuide.setupProfile.step1.point5.text":
    "点「模型名称」旁的「获取可用模型」按账号拉取列表；没有返回时可重试，或按服务商文档手动填写模型名。",
  "userGuide.setupProfile.step1.point6.lead": "接口协议",
  "userGuide.setupProfile.step1.point6.text":
    "走 OpenAI 兼容接口的服务商选「OpenAI 兼容」，直连 Claude 官方接口选「Anthropic 原生」并把 Base URL 填成 https://api.anthropic.com/v1；选错会报 404 或 400。",
  "userGuide.setupProfile.step1.point7.lead": "测完再存",
  "userGuide.setupProfile.step1.point7.text":
    "配置弹窗里可以直接「测试连接」；确认成功后再保存。常用配置可命名保存为记录，点记录卡上的「使用」一键切换。",
  "userGuide.setupProfile.step1.point8.lead": "配置记录",
  "userGuide.setupProfile.step1.point8.text":
    "设置页分「AI 模型 / 数据 / 应用」三页。已保存的配置以记录卡片列出：点 **新建配置** 或记录卡上的「编辑」在弹窗中填写，点卡片本体查看详情，带「使用中」标记的是当前生效的那份；其余两页始终可直接操作。「应用」页还可以随时开启或关闭投投悬浮球，不喜欢它的提示标语也可以单独关掉。",
  "userGuide.setupProfile.step1.point9.lead": "API Key",
  "userGuide.setupProfile.step1.point9.text":
    "保存在本机数据库；模型请求仍会发送到你选择的服务商。编辑记录时密钥留空即沿用原密钥。",
  "userGuide.setupProfile.step1.actionLabel": "前往设置",
  // ── 第 2 步 · 完善资料（setupProfileSteps.ts） ──
  "userGuide.setupProfile.step2.title": "完善资料",
  "userGuide.setupProfile.step2.heading": "建立你的个人资料库",
  "userGuide.setupProfile.step2.description":
    "13 个板块、当前方案与字段设置都在这里；再把能对外说的话在事实台账里逐条核实。",
  "userGuide.setupProfile.step2.point1.lead": "怎么录",
  "userGuide.setupProfile.step2.point1.text":
    "可手动填写，也可粘贴整段个人资料；还能按 Ctrl+V 贴截图，或上传 **pdf/docx 简历文档**（文字在本机提取）识别成草稿。",
  "userGuide.setupProfile.step2.point2.lead": "13 个板块",
  "userGuide.setupProfile.step2.point2.text":
    "资料页按 13 个板块组织：基本信息、教育、实习/工作、项目、技能、校园、荣誉、总结、学术成果、科研项目、知识产权、证书资质、语言能力；每个板块下有默认字段。字段改成响应式多列排列，单行文本宽屏最多 3 列、多行文本与日期整行。",
  "userGuide.setupProfile.step2.point3.lead": "当前方案",
  "userGuide.setupProfile.step2.point3.text":
    "页头「当前方案」决定生成、新建简历和网申读取哪些板块；点「管理方案」勾选板块清单，基本信息恒在首位、不可移出。",
  "userGuide.setupProfile.step2.point4.lead": "板块显示与隐藏",
  "userGuide.setupProfile.step2.point4.text":
    "每个板块都能单独显示/隐藏：隐藏 = 从当前方案移出，不参与生成、导出与网申；资料页顶部「已隐藏的板块」清单可随时恢复（查看态也能点），基本信息不可隐藏。新建方案默认隐藏全部板块（基本信息除外）；非编辑态创建后会自动切到新方案，再逐项打开需要的分区。",
  "userGuide.setupProfile.step2.point5.lead": "字段始终显示",
  "userGuide.setupProfile.step2.point5.text":
    "字段不再默认折叠，进入编辑态就能看到当前方案里的全部可见字段；不想让某条参与 AI 与导出的，在字段设置里设为隐藏即可，内容仍会保存在库里、可随时恢复。",
  "userGuide.setupProfile.step2.point6.lead": "用户隐藏",
  "userGuide.setupProfile.step2.point6.text":
    "在「字段设置」里隐藏的字段不参与 AI 与导出，值仍留在库里；点已隐藏字段入口可随时恢复（按钮为「恢复显示」）。板块也有一层「在资料页显示」开关，它管整块分区是否在当前方案，和字段的隐藏是两层。",
  "userGuide.setupProfile.step2.point7.lead": "字段设置",
  "userGuide.setupProfile.step2.point7.text":
    "每个板块都能加自定义字段（单行、多行、日期文本三种）并调整顺序；默认字段只能隐藏，不能改名或删除。",
  "userGuide.setupProfile.step2.point8.lead": "判定规则表",
  "userGuide.setupProfile.step2.point8.text":
    "资料页帮助入口的判定表讲「同一段经历只填一个板块」：按素材特征选板块，避免同一段经历在纸面上出现两次。",
  "userGuide.setupProfile.step2.point9.lead": "培训怎么办",
  "userGuide.setupProfile.step2.point9.text":
    "培训与课程不再是板块：需要时在项目或教育经历下加自定义字段，或自建一个培训与课程板块。",
  "userGuide.setupProfile.step2.point10.lead": "升级后旧资料",
  "userGuide.setupProfile.step2.point10.text":
    "从旧版本升级时，旧资料不再显示、但仍在本地与备份里；可按页面顶部提示从备份取出后手动重填。",
  "userGuide.setupProfile.step2.point11.lead": "事实台账",
  "userGuide.setupProfile.step2.point11.text":
    "在**侧栏最下方、「设置」上面**：把每条要写进简历的话记成一条——原始事实、简历表述、承担程度（参与 / 负责模块 / 主导 / 负责人）与个人边界。",
  "userGuide.setupProfile.step2.point12.lead": "从资料生成",
  "userGuide.setupProfile.step2.point12.text":
    "事实台账里可以「从资料生成」一批草稿再逐条核对，也可以手工新建。",
  "userGuide.setupProfile.step2.point13.lead": "只有已确认算数",
  "userGuide.setupProfile.step2.point13.text":
    "只有标成「已确认」的条目会作为事实用于生成简历；没核实的说法会被明确排除，不会悄悄写进简历。",
  "userGuide.setupProfile.step2.point14.lead": "面试深挖",
  "userGuide.setupProfile.step2.point14.text":
    "事实台账页头、与「新建条目」并列的「**开始深挖**」把已确认的主张逐条压力测试，每道题的标准**在你看到问题之前就定下来**，之后不因答得流利而放宽。",
  "userGuide.setupProfile.step2.point15.lead": "深挖的结论",
  "userGuide.setupProfile.step2.point15.text":
    "用「已验证 / 部分验证 / 未验证 / 存在矛盾」代替分数，结束时给「面试前的行动清单」和复练队列。",
  "userGuide.setupProfile.step2.point16.lead": "【待补】会拦导出",
  "userGuide.setupProfile.step2.point16.text":
    "正文里留着【待补：…】时导出会被拦下并指出位置；只想导草稿自查，在弹窗里选「仍要导出草稿」。",
  "userGuide.setupProfile.step2.point17.lead": "网申资料",
  "userGuide.setupProfile.step2.point17.text":
    "「我的资料」横向切换简历资料与统一网申资料。后者补充证件、家庭等网申字段，教育、经历、证书、作品等可新增多条；教育补充里的是否境外教育、是否统招、是否最高学历、是否辅修可直接选择是/否。编辑态可**粘贴文本识别**一屏栏目，目录外的新栏目先列成待确认项。附件需手动上传。**生成简历只读简历资料，网申填表合并两区**。",
  "userGuide.setupProfile.step2.point18.lead": "简历照片",
  "userGuide.setupProfile.step2.point18.text":
    "只显示**正在使用的那一张**；换或删点「照片库」。照片留在本机，不会发送给模型。",
  "userGuide.setupProfile.step2.point19.lead": "分区折叠",
  "userGuide.setupProfile.step2.point19.text":
    "每个分区默认展开；点标题可收起该分区，页头「全部展开 / 全部收起」一键开关，编辑时自动全展开。",
  "userGuide.setupProfile.step2.point20.lead": "职业场景",
  "userGuide.setupProfile.step2.point20.text":
    "页头的「职业场景」是可选的本窗口建议（转行、科研申请、职业回归、资深管理等）。切换或编辑场景只改引导与建议，不改资料、岗位、已有简历、投递设置或后台任务；生成简历时要在生成弹窗里显式开启「用于本次生成」，生成记录会保存本次采用的场景。",
  "userGuide.setupProfile.step2.point21.lead": "默认顺序",
  "userGuide.setupProfile.step2.point21.text":
    "13 个板块的全局顺序是：基本信息、教育经历、实习/工作经历、项目经历、专业技能、校园经历、荣誉奖项、个人总结、学术成果、科研项目、知识产权、证书资质、语言能力；自建板块排在最后。拖动排序手柄可调整，保存后长期生效，生成简历也按这里排。",
  "userGuide.setupProfile.step2.actionLabel": "前往我的资料",
  // ── 第 1 步 · 导入岗位与投递（workflowSteps.ts） ──
  "userGuide.workflow.step1.title": "导入岗位与投递",
  "userGuide.workflow.step1.heading": "手动录入、自动采集，再到投递台投出去",
  "userGuide.workflow.step1.description":
    "岗位可以手动录入或自动采集；投递前你会看到匹配结论，并由你显式确认。",
  "userGuide.workflow.step1.point1.lead": "怎么录",
  "userGuide.workflow.step1.point1.text":
    "可以逐项手动填写，也可以粘贴整段招聘信息识别；还能贴截图或上传 **pdf/docx 招聘文档都能识别**（一次最多 4 个）。",
  "userGuide.workflow.step1.point2.lead": "批量导入CSV",
  "userGuide.workflow.step1.point2.text":
    "「导入 CSV」可一次选或拖入最多 10 个文件（合计 2000 行），也能直接在导入区按 Ctrl+V 粘贴表格内容；坏文件只标它自己、好文件照样能导入，提交按 500 行一批自动拆分。",
  "userGuide.workflow.step1.point3.lead": "识别不会自动保存",
  "userGuide.workflow.step1.point3.text":
    "**识别结果不会自动保存**，核对字段后再点保存；保存时备注里会自动补一行来源（粘贴文本识别 / 图片识别 / 文档识别）。",
  "userGuide.workflow.step1.point4.lead": "AI 还是本地",
  "userGuide.workflow.step1.point4.text":
    "结果下方常驻标明是 AI 识别还是本地规则，AI 不可用时会自动回退并说明原因。",
  "userGuide.workflow.step1.point5.lead": "备选岗位",
  "userGuide.workflow.step1.point5.text":
    "还没核对完的先点「备选岗位」存起来（支持粘贴文本和截图），之后一键「导入到岗位」，或让求职助手代你导入。",
  "userGuide.workflow.step1.point6.lead": "自动采集",
  "userGuide.workflow.step1.point6.text":
    "「投递台 → 自动采集」设好关键词与城市，点「开始采集」；多个关键词会逐个搜索并跨关键词去重，保存过的条件进「历史条件」可一键回填。采集在后台跑：切到别的页面不会打断它，回到投递台照样看得到进度，跑完还会弹通知。",
  "userGuide.workflow.step1.point7.lead": "城市怎么算",
  "userGuide.workflow.step1.point7.text":
    "城市名会转换成该站点自己的城市编码，无法识别时明确报错，不会悄悄换一个城市搜。",
  "userGuide.workflow.step1.point8.lead": "站点筛选",
  "userGuide.workflow.step1.point8.text":
    "采集条件里有「按招聘网站的条件筛」：求职类型 / 薪资待遇 / 工作经验 / 学历要求 / 公司行业 / 公司规模 / 融资阶段——网站搜索时就替你筛掉了，比采回来再筛更准。选项读自网站本身，并标明来源：浏览器在跑时是**你这个账号可见**的清单。",
  "userGuide.workflow.step1.point9.lead": "先进暂存区",
  "userGuide.workflow.step1.point9.text":
    "采到的**不会直接进岗位广场**：由你勾选要留下的、点「导入选中的岗位」才收进去（来源标注「岗位采集」），没勾的留在备选岗位。",
  "userGuide.workflow.step1.point10.lead": "采集记录",
  "userGuide.workflow.step1.point10.text":
    "每次采集都会在「采集记录」里留一条，可展开回看那一次是按什么条件采的、采到了哪些。",
  "userGuide.workflow.step1.point11.lead": "采不到会说实话",
  "userGuide.workflow.step1.point11.text":
    "真的没搜到（关键词太窄）会如实说明；参数错误、页面结构变化、未登录或验证码会明确失败并给出诊断，不会把「没抓到」当成「采到 0 个」。",
  "userGuide.workflow.step1.point12.lead": "站点可能已改版",
  "userGuide.workflow.step1.point12.text":
    "反复读不出岗位页面、或普遍读不出岗位描述时，顶部会提示并写清发生了什么、这是推测、你该怎么做；需要登录、验证码、网络超时、真没搜到都**不算**改版。",
  "userGuide.workflow.step1.point13.lead": "匹配度分析",
  "userGuide.workflow.step1.point13.text":
    "岗位详情里的「匹配度分析」读取你的资料与简历，给出「已匹配 / 表达缺口 / 证据不足 / 真实缺口 / 待确认」五类结论与 0–100 的参考分（详见下一条）；与只读招聘原文的「岗位需求解读」不同。",
  "userGuide.workflow.step1.point14.lead": "AI 对比选岗",
  "userGuide.workflow.step1.point14.text":
    "岗位广场点「选择」勾选 2–12 个岗位，再点「AI 对比选岗」：先逐个核对匹配情况，再横向排出适合程度并解释原因；后台运行，结果保存到「分析记录」中回看。多选态的「批量操作」下拉还能逐个生成简历、解读岗位、做匹配度分析、入队、导出或删除。",
  "userGuide.workflow.step1.point15.lead": "匹配参考分",
  "userGuide.workflow.step1.point15.text":
    "另有 0–100 的参考分与五个分项，只帮你感知差多少，**不参与投递准入**，并带免责说明。",
  "userGuide.workflow.step1.point16.lead": "加入投递队列",
  "userGuide.workflow.step1.point16.text":
    "岗位详情点「加入投递台」排队；**只有来源在招聘网站内的岗位能自动投递**——手动录入且没填招聘网站投递链接的岗位，按钮是灰的并在详情里说明原因（补上该岗位在招聘网站上的链接即可）。队列页顶部写了完整流程（岗位从哪来、要核对什么、什么时候才真的投出去），点岗位名可以看详情，也能调顺序、改招呼语并选择要用的资料。",
  "userGuide.workflow.step1.point17.lead": "准入怎么判",
  "userGuide.workflow.step1.point17.text":
    "「证据不足 / 待确认」的岗位需要你逐条确认才能进队，「真实缺口」的岗位显示为「不投」并说明原因。",
  "userGuide.workflow.step1.point18.lead": "投递专用浏览器",
  "userGuide.workflow.step1.point18.text":
    "投递前先在投递台启动它——独立窗口，会直接打开招聘网站首页，你扫码登录一次（登录由你完成，应用不保存密码或 Cookie）。页面会首屏读取并实时轮询浏览器状态，窗口被直接关掉后会自动更新为未启动，也可以点「刷新状态」立即检查；「关闭浏览器」只关得掉本次启动的那个窗口。",
  "userGuide.workflow.step1.point19.lead": "换浏览器",
  "userGuide.workflow.step1.point19.text":
    "「投递设置 → 投递台使用的浏览器」可选自动优先 Chrome / 只用 Chrome / 只用 Edge / 自定义路径；指定了某一个就只找那一个，没装会直接提示。",
  "userGuide.workflow.step1.point20.lead": "谁发的招呼语",
  "userGuide.workflow.step1.point20.text":
    "对**从未沟通过**的岗位，招聘网站会先自己发一条**你在站点里配置的默认招呼语**，应用写的招呼语紧跟着作为第二条发出。所以 HR 会收到两条，第一条是站点发的、不受本应用控制——想改它得去招聘网站自己的设置里改。",
  "userGuide.workflow.step1.point21.lead": "投递进度",
  "userGuide.workflow.step1.point21.text":
    "按「已处理 N/M」与逐岗位状态显示，暂停 / 继续 / 停止按钮常驻；连续失败会自动熔断并醒目提示，进度与记录时间按你的本地时区显示。投递由后台执行，切到其他页面不会打断它。",
  "userGuide.workflow.step1.point22.lead": "投递设置",
  "userGuide.workflow.step1.point22.text":
    "「投递台 → 投递设置」里每一项都真的生效：**单批上限**决定一批最多投几条（其余留在队列）、**每日上限**只计成功、**同公司只投一个岗位**在本批内只投该公司的第一个岗位（跳过的那条会写明原因）、**岗位间隔 + 抖动**决定两条之间的等待。",
  "userGuide.workflow.step1.point23.lead": "投递失败在哪看",
  "userGuide.workflow.step1.point23.text":
    "投递台 →「投递记录」：一次投出的多个岗位按批次分成一组，点组头展开明细；按失败分类（需要登录 / 验证码 / 选择器失效 / 网络超时等）筛选，点「详情」在右侧抽屉看完整信息，单条可重投。批次结束时无论你在哪个页面都会收到通知。",
  "userGuide.workflow.step1.point24.lead": "记录可以删",
  "userGuide.workflow.step1.point24.text":
    "投递记录单条可删，组头还有「删除本批」。删掉先进回收站、可恢复；**删了就不再计入统计与每日上限**——回收站里的内容不出现在任何统计里。",
  "userGuide.workflow.step1.point25.lead": "网申填表",
  "userGuide.workflow.step1.point25.text":
    "公司官网网申按“启动浏览器 → 打开网申页 → 读取表单 → 核对 → 填充”操作；有目标网址时直接打开，不会加载 blank 或重复弹窗。",
  "userGuide.workflow.step1.point26.lead": "悬浮球",
  "userGuide.workflow.step1.point26.text":
    "专用浏览器里的「历历」支持单击开关、双击菜单和按住拖动。关闭实时填表后球会变灰，输入框聚焦不再弹卡；菜单里的「自动填写当前页面」是主界面填充流程的快捷键，会复用同一套日期转换、冲突保护和字段匹配，也会显示结果与成功率，还能直接「问历历」。",
  "userGuide.workflow.step1.point27.lead": "记住字段",
  "userGuide.workflow.step1.point27.text":
    "「记住这条」可改字段名，默认只写入网申资料；已有字段更新，没有就新增自定义字段。普通模式只按唯一精确标签复用；开启放宽模式后，自定义字段也参与受约束的文本匹配。",
  "userGuide.workflow.step1.point28.lead": "重复经历",
  "userGuide.workflow.step1.point28.text":
    "实习经历-2、项目经历-3 等重复区块按页面序号匹配对应资料；认不出的框可换资料或交给 AI（只发送页面文字）。",
  "userGuide.workflow.step1.point29.lead": "换浏览器来填",
  "userGuide.workflow.step1.point29.text":
    "网申浏览器与投递台共用浏览器型号配置，**窗口互不覆盖**。启动时可输入网址新开页面，历史记录可删；**打开浏览器或页面就自动开启「智能逐项填表」**（历历球随页面出现，不用手动开），多页各有默认开启的悬浮开关，可分别关掉。更改浏览器设置后需重启生效。",
  "userGuide.workflow.step1.point30.lead": "它只填文本、不交",
  "userGuide.workflow.step1.point30.text":
    "填完回浏览器核对，**提交由你点**；密码、验证码不填，已有值默认不覆盖。**只往文本类控件里写值**：下拉、单选、复选、日期控件，以及学校/专业这类「看着像输入框、其实要点开选」的可搜索下拉一律不自动填，会如实列成「需要你自己点选」；日期只在文本框里按页面写法转换（缺的部分不编）。AI 建议默认不勾选。",
  "userGuide.workflow.step1.point31.lead": "放宽模式",
  "userGuide.workflow.step1.point31.text":
    "在网申填表页或设置里**显式开启**后，程序会代点下拉/弹层选项，并用字段标签与上下文匹配未识别的文本框（含自定义字段）；低置信度候选标「需确认」、默认不勾。同意/声明项仍需逐条确认；日期选择器与文件上传不代做。放宽匹配可能选错，填完请核对。",
  "userGuide.workflow.step1.point32.lead": "成功率与排障",
  "userGuide.workflow.step1.point32.text":
    "批量填充和悬浮球自动填写会显示「成功填写数 / 页面表单框总数」的成功率，并同时告诉你实际识别并尝试了多少个。遇到问题可点「导出诊断」，它只导出版本、请求编号、控件数量、耗时和错误类型等脱敏信息，不包含简历值、表单值、密码或 API Key；连同截图发来更容易定位。",
  "userGuide.workflow.step1.point33.lead": "填过什么可以回看",
  "userGuide.workflow.step1.point33.text":
    "底部「填充记录」会保存每次填充的时间、页面、字段、值、结果和快照，**只存本机**。普通切页或关掉受控浏览器不会丢当前草稿；回到网申页可继续，点「结束本次填写」才清理。",
  "userGuide.workflow.step1.actionLabel": "前往岗位广场",
  // ── 第 2 步 · 跟进求职进度（workflowSteps.ts） ──
  "userGuide.workflow.step2.title": "跟进求职进度",
  "userGuide.workflow.step2.heading": "投出去之后，对方走到哪一步了",
  "userGuide.workflow.step2.description":
    "一家公司一个岗位一条记录，走「已投递 → 筛选中 → 测评/笔试 → 面试 → Offer」。",
  "userGuide.workflow.step2.point1.lead": "自动记录",
  "userGuide.workflow.step2.point1.text": "投递台投成功的岗位会自动出现在这里，不必手工再录一遍。",
  "userGuide.workflow.step2.point2.lead": "从通知导入",
  "userGuide.workflow.step2.point2.text":
    "把招聘邮件、短信或站内通知粘进来就能识别进展，也支持贴截图或上传 pdf/docx。",
  "userGuide.workflow.step2.point3.lead": "先预览再写入",
  "userGuide.workflow.step2.point3.text":
    "识别结果会**先给你看会发生什么**：每条写明「新增记录 / 更新进度 / 已是最新，未改动」以及原因，你勾选确认后才写入。",
  "userGuide.workflow.step2.point4.lead": "渠道与关联",
  "userGuide.workflow.step2.point4.text":
    "编辑表单里可以选**投递渠道**（内推 / 官网 / 招聘平台等，不确定就留「未知」）和**关联岗位**，都是选填。",
  "userGuide.workflow.step2.point5.lead": "状态只会前进",
  "userGuide.workflow.step2.point5.text":
    "同一条记录按「公司 + 岗位」合并，后来的通知覆盖早期的「已投递」；乱序粘贴一封三个月前的「申请已收到」，不会把已在面试的进度打回去。",
  "userGuide.workflow.step2.point6.lead": "自动回执",
  "userGuide.workflow.step2.point6.text":
    "**普通自动回执不会被读成面试或 Offer**：「感谢投递」只会记成「已投递」，判断不了的一律标成「待确认」等你自己确认。",
  "userGuide.workflow.step2.point7.lead": "漏斗可点",
  "userGuide.workflow.step2.point7.text": "漏斗图每一级都能点，点一下就是按那一级筛选。",
  "userGuide.workflow.step2.point8.lead": "别漏截止",
  "userGuide.workflow.step2.point8.text": "「下一步」和截止日期显示在每条记录上，过期的会标红。",
  "userGuide.workflow.step2.point9.lead": "导出留档",
  "userGuide.workflow.step2.point9.text": "可以按当前筛选导出 CSV（可直接用 Excel 打开）或 JSON。",
  "userGuide.workflow.step2.point10.lead": "提醒与内推",
  "userGuide.workflow.step2.point10.text":
    "「提醒」给投递、面试、内推设到点提醒，可切**列表 / 月历**（月历里点某一天能看到当天的全部安排，首页的月历同理），首页也会按紧急度分色展示；「内推」记录人脉带来的推荐机会并统计转化率，点卡片可看联系方式、内推码与备注图。",
  "userGuide.workflow.step2.point11.lead": "面试准备",
  "userGuide.workflow.step2.point11.text":
    "用「个性化题库」（基础 / 项目深挖 / 反问 HR）刷题，或走「面试复盘」把真实被问的问题录进来做分析；面完可沉淀进「面经」。",
  "userGuide.workflow.step2.point12.lead": "题库会存历史",
  "userGuide.workflow.step2.point12.text":
    "题库生成、面试复盘完成后会自动存进历史，点开历史记录，原界面与按钮都还在，新结果会回写到那一条。",
  "userGuide.workflow.step2.actionLabel": "前往求职进度",
} as const;

export default userGuide;
