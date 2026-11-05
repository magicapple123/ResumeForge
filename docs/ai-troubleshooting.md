# 排障规则：把问题抛给任意 AI 时

这份文件是给「AI 排障助手」看的规则，也适用于用户把某个报错 / 疑问直接丢给任意 AI 的场景。
目标是让 AI 在**不靠记忆硬答**的前提下，先弄清"这个功能在不在、怎么用、错在哪"，再给出可执行的结论。

> 适用前提：回答对象是 **ResumeForge（简历通）**。本文件随仓库一起更新，规则优先于任何 AI 的既有记忆。

## 1. 项目是什么

- **定位**：面向求职场景的**本地单用户**简历工具。录入岗位 → 维护个人资料 → AI 生成或自行编写简历 → 导出多格式文件。
- **形态**：前后端分离的本地应用，没有云端数据库、没有多用户概念。
  - 前端：React 19.3 + TypeScript 6 + Ant Design 6（Vite 8 构建）。
  - 后端：Python 3 + FastAPI + SQLAlchemy 2.0（Pydantic v2）。
  - 存储：SQLite 单文件数据库，默认位于 `backend/data/resume_forge.db`。
- **隐私底线**：业务数据默认只在本机。AI 功能只把生成所需内容发送给用户**主动配置**的模型服务商；代码中不内置任何密钥。

## 2. 目录结构与关键文件

```
ResumeForge/
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI 路由层（薄，只做参数校验与调用服务）
│   │   ├── services/     # 业务逻辑（简历、解析、助手、导出、采集投递等）
│   │   ├── models/       # SQLAlchemy ORM 模型
│   │   ├── schemas/      # Pydantic 请求/响应模型
│   │   ├── prompts/      # 提示词模板（与代码分离）
│   │   └── templates/    # 简历 HTML 导出模板
│   ├── migrations/       # Alembic 数据库迁移 revision
│   ├── scripts/          # 数据库备份等维护脚本
│   └── data/             # 运行时数据：resume_forge.db、datasets/、backups/、captures/、browser-profile/
├── frontend/
│   └── src/
│       ├── components/navigation/navigationConfig.ts  # 侧栏菜单 MENU_ITEMS（功能入口的权威来源）
│       ├── appRoutes.tsx # 路由表（页面路径的唯一来源）
│       ├── App.tsx       # 仅 re-export MENU_ITEMS 并组装壳层
│       ├── pages/        # 各页面
│       ├── components/   # 业务组件（含 userGuideSteps.ts 应用内使用指南）
│       ├── features/     # 求职助手领域组件
│       ├── api/          # 请求封装
│       └── types/        # 与后端 schema 镜像的 TS 类型
├── scripts/              # 启动器（PowerShell）与发版脚本
├── runtime/              # 运行日志（backend.stderr.log / frontend.stderr.log），不提交 Git
├── docs/                 # 使用、架构、升级、排障文档
└── CHANGELOG.md          # 版本变化与兼容性说明
```

排查时最常用的几个**落点**：

- 后端报错 / 启动失败 → `runtime/backend.stderr.log`（一键启动器会把尾部几行打到控制台）。
- 前端构建 / 白屏 → `runtime/frontend.stderr.log`、`frontend/dist`。
- 数据库位置与迁移 → `backend/data/`、`backend/migrations/`。
- 用户数据备份 → `backend/data/backups/`（迁移前自动备份）、`scripts/backup_database.py`。

## 3. 如何「动态发现功能」（核心）

程序会持续更新，**任何 AI 都不许凭记忆回答"某功能是否存在 / 怎么用"**。回答这类问题前，先按下面的顺序读真实文件，让答案由仓库现状决定：

1. **功能目录（能力地图的单一事实来源）**：`backend/app/services/feature_catalog.py` —— 机器可读的功能域 `FUNCTIONAL_DOMAINS` 与界面功能 `FEATURES`。功能数据按拆分前顺序放在三个数据段里（`feature_catalog_profile.py` / `feature_catalog_resume.py` / `feature_catalog_workflow.py`），门面按原顺序拼回并 re-export；每条写明"在哪个界面、怎么用"；能力地图在运行时由它渲染进系统提示。
2. **助手系统提示**：`backend/app/prompts/assistant_system.md` —— 只保留角色定位 / 行为准则 / 安全规则 / 各模块用法（工具语义），**不含手写功能清单**（避免与功能目录漂移）。
3. **功能入口（以它为准）**：`frontend/src/components/navigation/navigationConfig.ts` 的 `MENU_ITEMS` —— 侧栏菜单的真实入口与顺序（`App.tsx` 只 re-export 它）。**判断"有没有这个菜单 / 叫什么名"一律以此为准**；页面路径看 `frontend/src/appRoutes.tsx`（路由表）。
4. **操作细节（以它们为准）**：`frontend/src/components/userGuideSteps.ts`（应用内使用指南）与 `docs/user-guide.md`（完整使用说明）—— 判断"某功能具体怎么操作"时以这两处为准。
5. **版本变化**：`CHANGELOG.md` —— 判断"某能力是哪个版本加的、行为是否变更过"。
6. 需要更细的架构/接口判断时再读 `docs/architecture.md`。

**优先级**：功能入口以 `components/navigation/navigationConfig.ts` 的 `MENU_ITEMS`（`App.tsx` 仅 re-export）为准，页面路径以 `appRoutes.tsx` 为准；操作细节以 `userGuideSteps` / `user-guide.md` 为准；`feature_catalog.py` 门面（及其三个数据段）是功能目录的单一事实来源（能力地图由它动态渲染）。四者应当一致；若发现不一致，按「入口看菜单、细节看指南」处理，并在结论里注明你依据的是哪一份文件。

## 4. 常见问题排查路径

- **启动失败 / 端口占用**：看 `runtime/backend.stderr.log`（后端）或 `runtime/frontend.stderr.log`（前端）的最后几行。端口被占用时，用 `start.cmd -BackendPort <端口>`（或 `-FrontendPort`）换端口；启动器只结束自己记录并校验过的进程，不会误杀其他程序。
- **依赖缺失 / venv**：后端依赖在 `backend/requirements.txt`（开发依赖 `requirements-dev.txt`），前端在 `frontend/package.json`（`npm ci` 安装）。虚拟环境在 `backend/.venv`。缺包先确认 venv 已激活 / 已用对 Python（3.11–3.13）。
- **数据库结构与启动闸门**：2.0 的迁移链只有一条基线 `0001_baseline_v2`，闸门看单行表 `app_schema_epoch`（`epoch=2`）。启动时先读 epoch：**缺 epoch 表且库里有业务表 → 判为 pre-2.0 库**，整包归档到 `backend/data/legacy-archive/<时间戳>/` 后建空库（1.x 的数据**不会**搬进新库）；`epoch > 2` 拒绝启动；`epoch == 2` 才用 revision 判断是否在链上，有用户数据且有待应用 revision 时先在 `backend/data/backups/` 建一致性备份。不要在外部手工改库结构。
- **导出失败**：2.0 支持 7 种导出格式 —— PDF / Word / HTML / Markdown / 纯文本 / JSON / PNG。PDF 直出依赖系统中文字体（`RESUMEFORGE_PDF_FONT` 可覆盖），找不到字体会明确报错并保留浏览器打印作为替代；Word / HTML / Markdown / 纯文本 / JSON 为本地生成；**PNG 是前端做的补充格式**——把精确 PDF 的同一份字节逐页光栅化（`frontend/src/utils/pdfToPng.ts` + `pngExport.ts`，pdfjs + jszip 动态加载），单页出 `.png`、多页打成 zip，所以它继承 PDF 的篇幅截断（PDF 被裁到几页，图片就是几页）。篇幅上限对**除 JSON 外**的 6 种格式生效（JSON 是数据交付物，始终完整）。脱敏与分享包始终基于脱敏内容。
- **前端白屏 / 构建**：`cd frontend && npm ci && npm run build`；生产部署需要 SPA history fallback 并把 `/api` 反代到后端，不能只复制 `dist` 后直接双击打开。
- **更新升级**：Windows 用 `update.cmd`（只替换程序文件，不动 `data/`、`.env`）；完整升级、备份与回滚步骤见 `docs/upgrading.md`。**别对 1.x → 2.0 说"升级不会丢数据"**：2.0 不搬数据，首次启动会把旧库**整包归档**到 `legacy-archive/<时间戳>/` 后建空库，新库里从空白开始（归档保留全部旧数据，可用 1.0.2 打开）。**只有同 major 内的更新**才是"下次启动自动迁移、数据保留"。

## 5. 硬性约束（AI 回答时必须遵守）

1. **匹配度分析禁止输出百分比 / 分数**。「岗位匹配度分析」只给「已匹配 / 表达缺口 / 证据不足 / 真实缺口 / 待确认」五类结论与投递建议，**不显示任何百分比评分**。另有一个「匹配参考分」（0–100 分、本地规则估算）**仅作展示辅助、不参与投递准入**，且始终带免责说明。回答时不得把参考分说成"匹配度评分"，也不得声称匹配度分析会给出百分比。
2. **投递台与网申填表是仅有的两条会主动访问外部站点的链路，且都须用户显式操作**。只有用户在投递台显式发起「自动采集」或「开始投递」、或在网申页显式点「填充」时，应用才通过**应用自己拉起的专用浏览器**（CDP 桥接）访问招聘网站；**不会后台自动运行**，网申侧**只填不提交**（界面上没有任何「提交」按钮）。应用**不保存招聘网站的账号密码 / Cookie / 验证码**，登录由用户自己扫码完成。
3. **隐私字段本地处理**。个人照片不发送给模型（生成后本地注入）；文档（PDF/DOCX）文字在本机提取、原始文件不外发；导出可一键脱敏（姓名/电话/邮箱/公司/学校等）。回答隐私相关问题时不要暗示这些字段会无条件外发。

## 6. 回答功能问题前的检查清单

- [ ] 有没有先读 `MENU_ITEMS` 确认"这个入口存在、叫什么名"？
- [ ] 有没有先读 `feature_catalog*.py`（门面与三个数据段）/ `assistant_system.md` 确认"这个能力有没有、在哪个界面"？
- [ ] 有没有先读 `userGuideSteps.ts` / `docs/user-guide.md` 确认"具体怎么操作"？
- [ ] 涉及版本差异，有没有看 `CHANGELOG.md`？
- [ ] 结论是否违反了第 5 节的硬性约束（不编百分比、不暗示自动投递 / 保存凭据、不暗示隐私外发）？
- [ ] 拿不准时，是否明确说"依据的是哪份文件"、并建议用户回到对应页面核验，而不是给出一个看起来笃定的猜测？
