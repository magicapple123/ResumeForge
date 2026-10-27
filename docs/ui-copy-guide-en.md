# 英文界面文案口径（English UI copy guide）

> **状态**：v1.0 · 2026-10-28（i18n 收尾批次 S3 产出）
> **上游口径**：[docs/ui-copy-guide.md](ui-copy-guide.md)（中文界面文案口径）。那份文件是**判定基准的唯一真相**：它回答"这个实体叫什么、这个动作叫什么、这个位置该写什么句式"。本文件是它的**英文对照层**，只回答"同一个概念在英文界面里怎么拼、怎么大小写"。
> **适用**：`frontend/src/i18n/messages/en-US.*.ts`（本批 7,757 条 key，2026-10-28 统计）。
> **不覆盖**：简历**纸面**英文（唯一来源是 `backend/app/services/resume/resume_labels.py` 的 `SECTION_TITLES["en-US"]` / `FIELD_LABELS["en-US"]`）、README / docs 行文、代码注释、CHANGELOG 语气。
> **纸面与界面刻意不同**：纸面是文档标题（Title Case），界面是控件标签（见 §1.2）。两者各自内部必须一致，跨面不要求逐字相同。

## 0. 怎么用

修改任何英文文案前，按顺序回答三问：

1. **指哪个实体？** → §1 的正名表。
2. **在哪个位置？** 按钮 / 列名 / Toast / 空态 / 正文 / `aria-label` → §4 的语境差异表。
3. **该怎么拼、怎么大小写？** → §2、§3。

三问落不到表里，说明规范有缺口：**先补表，再写文案**，不要各自发挥。

三条硬规则（与中文规范一致）：

| # | 规则 | 说明 |
|---|---|---|
| 1 | **一词一义** | 同一中文含义只允许一个英文写法；例外只有 §4 登记过的语境差异。出现第二种写法即算缺陷 |
| 2 | **拿不准就不动** | 对齐中文规范 R7：宁可保留一处旧写法，也不要发明第三种 |
| 3 | **改值不改 key** | 英文统一只改 `en-US.*.ts` 的值：不增删 key、不改 key 名、不动 zh 包。改 key 会同时打挂 zh 侧与 `en-US.ts` 的 `satisfies Record<keyof ZhCNMessages, string>` |

## 1. 核心术语正名对照

### 1.1 实体与页面

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 岗位 | **Job** | Position / Vacancy / Posting | 产品实体名，句中同样首字母大写（"Add a Job"、"a Resume for the Job"） |
| 岗位（职务 / 角色） | **Role**（编辑器）/ **Title**（资料页） | Job | 这里是经历里的"担任岗位"，不是 Job 实体；两处写法尚未统一，见 §6 #9 |
| 岗位描述（JD） | **Job description (JD)** | JD text / Job requirement text | 首次给全称，之后可只用 JD |
| 简历 | **Resume** | CV / résumé / document | "CV" 只出现在 **Long CV** |
| 通用简历 | **General Resume** | Generic Resume / Blank Resume | 对应 `job_id IS NULL` |
| 长 CV | **Long CV** | Long resume / Extended CV | 文档模式名，不是"更长的简历" |
| 我的资料（页面） | **My Profile** | Profile page（作页面名时）/ Personal data | 导航与页头用名 |
| 个人资料（正文指代） | **Profile** | profile（句中）/ personal info | 正文里同样大写：它是定义术语 |
| 个人资料库 | **Profile library** | Material library / Data library | 与**资料箱**严格区分 |
| 资料箱 | **Material library** | Resource box / Material box | 现存 8 处 Resource box 待收口（§6） |
| 工作台 | **Workbench** | Skills page / Workspace | `/skills` 容器页 |
| 我的空间 | **My space** | Workspace / My area | 页头菜单 |
| 数据集 | **Dataset** | Data source / Workspace | 切换后全站数据整体变化 |

### 1.2 简历小节名（13 个板块）

**界面名以本表为准**；纸面名来自后端表，两者刻意不同（文档标题 vs 控件标签）。

| 中文 | 界面英文 | 纸面英文（`SECTION_TITLES["en-US"]`） |
|---|---|---|
| 基本信息 | Basic information | （页眉块，无独立标题） |
| 教育经历 | Education | Education |
| 实习/工作经历 | Experience | Experience |
| 项目经历 | Projects | Projects |
| 专业技能 | Skills | Skills |
| 校园经历 | Campus activities | Campus Activities |
| 荣誉奖项 | Honors & awards | Honors & Awards |
| 个人总结 | Summary | Summary |
| 学术成果 | Academic achievements | Academic Achievements |
| 科研项目 | Research Projects | Research Projects |
| 知识产权 | Intellectual Property | Intellectual Property |
| 证书资质 | Certifications & Qualifications | Certifications & Qualifications |
| 语言能力 | Language proficiency（资料板块）/ Languages（简历小节） | Languages |

编辑器页签有自己的短名（`editor.tab.*`）：Education / Experience / Projects / Skills / **Honors**（中文是「荣誉」，比小节名短）/ **Certifications & Qualifications** / **Basic information**。短名允许比小节名短，但**同一个页签不得出现第二种写法**。

### 1.3 排版四层

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 模板 | **Template** | Style / Theme / Skin | L1：视觉骨架 |
| 模板预览 | **Template preview** | Preview template | |
| 版式 | **Layout preset** | Format preset / Layout / Style preset | L2：参数预设；key 前缀 `resume.format.*` |
| 排版参数 / 排版设置 | **Typography settings** | Layout settings / Format settings | L3：逐项数值 |
| 排版（本版面内的局部调整） | **Local typography** | Local layout / Font settings | 面板标题 |
| 版面诊断 | **Layout diagnosis** | Layout check / Print check | L4：排出来的效果 |
| 独立排版 | **Independent layout** | Variant layout | 岗位变体自己的排版覆盖 |

**版面（效果）不叫 Layout preset，排版参数不叫 Layout。** 这是中文规范 §2 #9–#13 的四层，英文同样必须分层。

### 1.4 投递与网申

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 投递（动作） | **apply** / **applying** | submit / deliver | |
| 投递（一次记录、计数） | **application** / **applications** | apply record | 统计与转化率用复数 |
| 投递台 | **apply desk** | Apply Desk / Apply station | 句中全小写；按钮 "Add to apply desk" |
| 投递队列 | **apply queue** | Apply list / Pending applies | |
| 投递记录 | **Apply records** | Application records | 页面 / 区块名 |
| 投递批次 | **Apply run** | Apply batch | |
| 网申填表 | **Web form** | Online form / Application form | 页面名 |
| 后台任务 | **Background tasks** | Jobs / Processes | **任务 ≠ Job**：Job 只指岗位 |

### 1.5 资料、知识与收藏

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 知识库 | **Knowledge base** | Knowledge library / Notes library | |
| 知识文件 | **knowledge files** | attachments / reference docs | 列名首字母大写，正文句中全小写 |
| 资料（资料箱里的一条） | **material** | asset / attachment | |
| 收藏夹 | **Favorites** | Bookmarks / Stars | 集合 |
| 收藏 / 取消收藏 | **Favorite** / **Remove from favorites** | Star / Unstar | 单条动作 |
| 事实台账 | **Fact ledger** | Claims ledger / Fact base | |
| 主张 | **claim** / **claims** | Claim（作名词标题）/ assertion | 句中全小写 |
| 条目 | **Entry** | Record / Item | 首字母大写（`Entry`） |
| 板块 | **Section** | Block / Module / Group | |
| 字段 | **Field** | Attribute / Column | |
| 方案 / 当前方案 | **Plan** / **Current Plan** | Group / Scheme / Profile | 数据集级的板块清单 |
| 自建板块 | **Custom Sections** | Custom blocks | |
| 默认字段 | **Default Fields** | Built-in fields | |

### 1.6 面试与复盘

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 面经 | **Interview notes** | Interview experience(s)（现存 1 处） | |
| 面试深挖 | **Interview deep dive** / **deep dive** | Interrogation / Stress test | 不评总分 |
| 模拟面试 | **Mock interview** | Mock / Practice interview | |
| 题库 | **Question bank** | Question set / Question library | |
| 复盘 | **Retrospective** | Review / Summary | 必须带来源前缀（中文规范 #28） |

### 1.7 分析与评分

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 匹配度分析 | **Match analysis** | Match score | 动作 |
| 匹配度参考分 | **Reference score** | Match percentage | 数值；不出现百分比 |
| ATS 参考分 | **ATS reference score** | ATS score | 与上一条是两个来源 |

### 1.8 导出与版本

| 中文正名 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| 导出前核对 | **Pre-export review** | Preflight / Final check | 清单式核对 |
| 导出配置 | **Export configuration** | Export preset | |
| 交付原件 | **Delivery originals** | Original export files | 与"交付记录（快照重排）"区分 |
| 页缩略图 | **Page thumbnails** | Page previews | |
| 内容精简候选 | **Content reduction candidates** | Trim suggestions | |
| 试用与对比 | **Try and compare** | Trial / Compare templates | 用我的内容试排 |
| 导出诊断包 | **Export diagnostics** | Diagnostic package | 只指设置页那颗 |

### 1.9 品牌与专名

| 中文 / 概念 | 英文正名 | 不要写成 | 说明 |
|---|---|---|---|
| ResumeForge | **ResumeForge** | Resume Forge / Resumeforge / RF | 产品名，永不翻译、永不加空格 |
| 投投 | **Toutou** | Tou Tou / TouTou / 投投 | 助手角色名，首字母大写 |
| 岗位广场 | **Job Square** | Job square / Job board | 功能区名 |
| 求职进度 | **Job tracker** | Tracker / Application tracker | 功能区名 |
| 求职助手 | **Job assistant** | job assistant（句中）/ Assistant | 功能区名 |

## 2. 大小写规则（E1–E8）

| # | 规则 | 正例 | 反例 |
|---|---|---|---|
| E1 | 实体名 **Job / Resume / Profile** 指"那条记录"时，句中同样首字母大写 | `Add a Job`、`a Resume for the Job`、`the Job column` | `add a job`、`the resume` |
| E2 | 指"某一类"的通用复合词全小写 | `job board`、`job description`、`job search`、`Target job`、`Linked job` | `Job board`、`Target Job` |
| E3 | 功能区名按既有整体写法，**不逐词拆改** | `Job Square`、`Job tracker`、`Job assistant`、`apply desk`、`Web form` | `Job square`、`Apply Desk` |
| E4 | 标签一律 sentence case（句首大写、其余小写），不用 Title Case；例外只有 §1.2 已定名的多词小节名（`Certifications & Qualifications`、`Research Projects`）与品牌名 | `Campus activities`、`Honors & awards`、`Basic information` | `Campus Activities`、`Basic Information` |
| E5 | 缩写全大写、原样保留 | `ATS`、`JD`、`PDF`、`Word`、`Markdown`、`HTML`、`AI`、`GPA`、`CET-6`、`A4` | `Pdf`、`ats`、`Word 文档` |
| E6 | 品牌与文件名保留官方拼写 | `ResumeForge`、`GitHub`、`Setup.exe`、`Windows`、`Excel` | `Github`、`setup.exe` |
| E7 | "复制片段"整组小写（它们被拼进 `Copied {field}` 这样的句子） | `title`、`target job`、`company name`、`note`、`entire row` | `Title`、`Target Job` |
| E8 | 引号引用的界面名必须与真实标签**逐字一致**（含大小写） | 指南写 `“Add to apply desk”`，按钮就叫 `Add to apply desk` | `“Add to Apply desk”` |

E1 / E2 的分界：**说的是"那条岗位记录"还是"某一类岗位"**。前者大写，后者小写；同一位置（列名、排序标签、按钮）必须一致。

## 3. 拼写与标点（S1–S8）

| # | 规则 | 现状 / 正例 | 反例 |
|---|---|---|---|
| S1 | 美式拼写 | favor、honor、color、organize、recognize、summarize、analyze、defense、practice（动词）、gray | favour、honour、colour、organise、recognise、summarise、analyse、defence、practise、grey |
| S1a | **例外**：`cancelled` 保留 | 全库 15 处一致；两种拼写美式词典都收 | 不要为"统一"改成 canceled |
| S2 | `&` 只用于小节名与并列专名 | `Honors & awards`、`Certifications & Qualifications`、`Interview Q&A` | 正文里的并列写 `and` |
| S3 | 省略号用单字符 `…` | `Preparing…`、`Parsing…` | `Preparing...` |
| S4 | 破折号用 ` — `（em dash，两侧各一个空格） | `Could not read the image — try again` | ` - `（现存 92 处旧写法待收口，新增不得再用） |
| S5 | 撇号用直撇号 `'`；引号用弯引号 `“ ”` | `Master's degree`、`“Add to apply desk”` | `Master’s`、`"Add to apply desk"` |
| S6 | 不得出现 CJK 与全角标点 | 现状 0 处（en 包契约测试在守） | `，` `。` `：` `（` |
| S7 | 数字与单位之间一个半角空格 | `3 pages`、`2 MB`、`15 minutes` | `3pages`、`2MB` |
| S8 | 句末标点：按钮 / 列名 / Toast / 标签不加句号，正文整句才加 | `Saved`、`Target job` | `Saved.` |

## 4. 语境差异（同中文、不同英文，刻意保留）

同一中文含义在不同**位置**可以有不同英文——判据只有一条：**用户会不会把两处读成两个东西**。下列差异**不是缺陷**，不要"顺手统一"：

| 中文 | 语境 A | 语境 B | 判据 |
|---|---|---|---|
| 删除 | **Delete**（按钮 / 菜单项） | **Removed**（Toast / 状态） | 动作 vs 结果 |
| 刷新 | **Refresh**（重新取数） | **Reload**（整页重载 / 重读文件） | 中文规范 §1.3：刷新只指重新取数 |
| 关闭 | **Close**（按钮 / 弹窗） | **Off**（开关态） | 动作 vs 状态 |
| 开启 | **On** | **Turn on**（开关动作） | 状态 vs 动作 |
| 收藏 | **Favorite**（列名 / 单条动作） | **Favorites**（收藏夹 / 集合） | 单条 vs 集合 |
| 备注 | **Note**（字段 / 列名） | **Notes**（详情小节） | 输入 vs 展示 |
| 标题 | **Title**（字段标签） | **title**（复制片段，E7） | 标签 vs 句子片段 |
| 公司名 | **Company name**（标签） | **company name**（复制片段，E7） | 同上 |
| 技能 | **Skills**（板块 / 页签） | **skills**（正文句中的普通名词）/ **Skill**（单个字段） | 位置 |
| 提示词 | **Prompt**（列名） | **prompt**（正文句中） | 位置 |
| 知识文件 | **Knowledge files**（列名） | **knowledge files**（正文句中） | 位置 |
| 荣誉奖项 | **Honors & awards**（小节名） | **Honors**（编辑器页签，中文是「荣誉」）/ **Awards**（主张分类的短类别名） | 长短名 |
| 语言能力 | **Language proficiency**（资料板块） | **Languages**（简历小节 / 纸面） | 板块名 vs 小节名 |
| 重试 | **Retry**（按钮） | **Retries**（计数名） | 动作 vs 名词 |
| 共 N 条 | `{count} items`（列表） | `{count} in total`（合计） | 位置 |

开工时扫描：同一中文值对应 ≥2 个英文写法的组共 **259 组**（822 个 key），收口后 **242 组**（771 个 key）。剩下的绝大多数属于本表；不属于本表的列在 §6。

## 5. 本批统一记录（2026-10-28）

| 规则 | 内容 | key 数 |
|---|---|---|
| A | 同一中文含义的**大小写 / 符号 / 引号**写法统一（如 `Target Job`→`Target job`、`(none)`→`(None)`、`Preparing...`→`Preparing…`、`Master’s`→`Master's`） | 30 |
| B | **英式 → 美式拼写**（favourite / organise / recognised / summarise / analyse / defence / practise / grey / colour / behaviour / optimisation / personalised 等） | 36（含 1 个与 A 重叠） |
| C | **小节名跨页补齐**：编辑器页签的 `Certifications & Qualifications`，以及 5 条指南行里嵌的板块名（Campus activities / Honors & awards / Academic achievements / Language proficiency）；其余板块名的大小写统一已计入 A | 6 |
| D | **引号引用逐字一致**：指南里的 `“Add to Apply desk”` 改回按钮真名 `“Add to apply desk”` | 1（已在 B 内） |

- 合计 **71 个 key、31 个 `en-US.*.ts` 文件**；**没有**新增 / 删除 key，**没有**改 zh 包、组件、测试、`i18nBaseline.json`、命名空间注册表。
- 改过的 en 包全部跑过 `npx prettier --write`（结果均为 `unchanged`）。
- 未跑 git / tsc / vitest（按本批任务约定）。

## 6. 已知未收口（下一轮候选，本轮刻意不动）

| # | 现象 | 位置 | 建议 |
|---|---|---|---|
| 1 | 资料箱有两种叫法：**Material library**（主流）与 **Resource box**（8 处） | `profileFacts.material.*`、`provenance.source.kind.material` | 统一为 Material library（属术语改名，非拼写，需单独一轮） |
| 2 | 面经：**Interview notes**（主流）与 **Interview experiences**（1 处） | `interviewExperience` 包 | 同上 |
| 3 | 复盘：**Retrospective** 与 **Review** 各 1 处 | `drill` / 面试包 | 同上 |
| 4 | 关联岗位：**Linked job**（字段）与 **Related job**（深挖起始面板） | `interviewExperience` / `trackerForm` / `referralDetail` vs `drill` | 若两者确是同一关系，统一为 Linked job |
| 5 | 证书资质：页面小节名 **Certifications & Qualifications**，编辑器页签已对齐；但主张分类仍用短名 | `enumsClaims` 等 | 短名可保留，需在 §1.2 登记 |
| 6 | 空格破折号 ` - ` 仍有 92 处（多为错误提示尾巴） | 全库 | 新增文案一律用 ` — ` |
| 7 | 英文指南 `userGuide*` 的引号引用**没有守卫**（中文侧有 `userGuideCopyRef.test.ts`） | `en-US.userGuide*.ts` | 建议补一条 en 侧引用比对，或至少在改标签时人工 grep |
| 8 | 编辑器页签短名与小节名并存的几处（Honors / Internships / Work） | `editor.tab.*` | 短名合法，但需在 §1.2 保持登记 |
| 9 | 经历字段「岗位」两种写法：**Role**（编辑器 `editor.field.expRole`）与 **Title**（资料页 `profileUi.experience.field.role`），项目里还有 **Your role** | `resumeEditor` / `profileUi` | 建议统一为 Role；属术语决策，本轮未动 |
| 10 | 实习/工作经历三种写法：**Experience**（编辑器小节）/ **Internship / Work Experience**（资料板块）/ **Internships / work experience**（对比分组）；个人总结、科研项目还有单复数差异 | `profileLibrary` / `bilingual` / `research` | 资料板块建议也用 **Experience**；单复数按位置定 |

## 7. 改动流程（英文文案专用）

1. **只在 `en-US.*.ts` 里改值**，先按 §1 找到正名；找不到就补 §1 的表。
2. 若这条文案有 zh 对应物，**zh 值不动**（英文统一不改变中文口径）；若改的是术语本身（如 Resource box → Material library），必须同时评估 zh 侧与组件内硬编码，走单独一轮。
3. 改完自查三项：**没有 CJK / 全角标点**、**占位符 `{name}` 与 zh 侧一致**、**同一位置没有第二种写法**。
4. 只对改过的文件跑 `npx prettier --write`；`npx prettier --check src/i18n/messages/en-US.*.ts` 应为全绿。
5. 涉及界面标签的改动，同步检查指南（`userGuide*`）里是否有引号引用该标签（§E8）。

## 8. 修订记录

| 日期 | 版本 | 改了什么 | 为什么 |
|---|---|---|---|
| 2026-10-28 | v1.0 | 首版：核心术语表、大小写 / 拼写 / 标点规则、语境差异表、本批统一记录 | i18n 收尾批次 S3：英文包同一中文含义多写法收口，并把"为什么这样写"沉淀成可判定的文档 |
