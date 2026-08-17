# 简历通 ResumeForge

> 基于大模型的个性化简历生成工具：录入岗位 → 维护个人资料 → 一键生成定制简历 → 导出多格式文件。
> 单用户本地运行，数据完全私有；LLM API Key 由你自己配置，代码中不内置任何密钥。

一个岗位对应一份简历。你只需要维护一份完整的个人资料库，ResumeForge 会针对每个岗位的 JD 生成侧重点不同的定制简历，并保留全部生成历史。

## ✨ 功能特性

| 模块 | 说明 |
| --- | --- |
| 📋 岗位管理 | 手动填写或粘贴招聘信息生成草稿；支持备注与备注搜索、多选批量更新状态或删除，保存时自动提取技能标签 |
| 👤 个人资料库 | 基本信息、简历照片、教育/工作/校园/项目经历、技能、获奖；每条经历可附加 Markdown/TXT 总结文件 |
| 🤖 AI 定制简历 | 按 JD 筛选事实并流式生成，可选择是否进行岗位导向美化拓展及轻度、适中、深度三级强度 |
| 📚 生成历史 | 每次生成自动留存记录，可随时查看、重新导出，不会丢失 |
| 📄 多格式导出 | HTML 在线预览（含简历照片）→ 浏览器打印为 PDF；JSON、Markdown 直接下载 |
| 🔍 全局搜索 | 岗位与简历历史一键检索，快速定位需要的信息 |
| 🛡 防虚构校验 | 生成结果中的学校/公司/项目名自动与资料库比对，不一致时给出警告 |
| 🔑 你的 Key 你做主 | 兼容任意 OpenAI 协议接口：DeepSeek、豆包、Kimi、OpenAI、Ollama 内置预设，也支持自定义 |

## 🧰 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript（strict）+ Ant Design 5 + Vite 6 + React Router |
| 后端 | Python 3 + FastAPI + SQLAlchemy 2.0 + Pydantic v2 + httpx + Jinja2 |
| 存储 | SQLite（本地单文件，零部署成本） |
| 测试 | pytest + pytest-asyncio（后端）、tsc + ESLint + Prettier（前端） |

## 🏗 架构

前后端分离：前端通过 `/api` 代理访问后端（开发环境由 Vite 自动代理，生产环境由任意静态服务器托管 `frontend/dist` 即可）。

```
┌──────────────┐   /api (REST + SSE)   ┌───────────────────────────────┐
│  React 前端   │ ───────────────────▶ │        FastAPI 后端            │
│  岗位/资料/   │                      │  API 路由 → 服务层 → 数据层     │
│  生成/历史    │ ◀─────────────────── │  ├─ 简历生成（LLM 流式）        │
└──────────────┘                       │  ├─ 岗位文本解析（规则，无 LLM）  │
                                       │  ├─ JD 标签解析（规则，无 LLM）   │
                                       │  ├─ 导出（HTML/JSON/Markdown）  │
                                       │  └─ SQLite（单文件数据库）       │
                                       └───────────────────────────────┘
```

详细设计（含决策记录与扩展点）见 [docs/architecture.md](docs/architecture.md)。

## 🚀 快速开始

### 环境要求

- Python ≥ 3.10
- Node.js ≥ 18（含 npm）

### 1. 启动后端

```bash
cd backend

# 创建虚拟环境并安装依赖
python -m venv .venv
.venv/Scripts/activate        # Windows；macOS/Linux 用 source .venv/bin/activate
pip install -r requirements.txt

# 启动服务（默认 http://127.0.0.1:8000，接口文档见 /docs）
uvicorn app.main:app --reload --port 8000
```

> **Windows 中文系统提示**：若 `pip install` 报 `UnicodeDecodeError`（GBK 编码错误），先执行
> PowerShell：`$env:PYTHONUTF8=1`；Git Bash：`export PYTHONUTF8=1`，再运行 pip。

数据库文件首次启动时自动创建于 `backend/data/resume_forge.db`。升级已有项目时，后端启动会自动补齐岗位备注、个人照片、经历参考文件和简历生成选项等新增列，现有岗位、资料与生成记录不会被重建或删除。可选环境变量见 [backend/.env.example](backend/.env.example)（全部有默认值，不配置也能运行）。

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，已配置 /api 代理到 8000 端口
```

### 3. 配置大模型

打开页面左侧 **设置**，选择内置预设（自动填充接口地址与模型名），填入你的 API Key 后点击「测试连接」。内置预设：

| 预设 | 说明 |
| --- | --- |
| DeepSeek | 便宜好用的国产模型，`deepseek-chat` |
| 豆包（火山方舟） | `doubao-seed-1-6-250615` 等 |
| Kimi（月之暗面） | `kimi-k2-0711-preview` 等 |
| OpenAI | 官方接口，`gpt-4o-mini` 等 |
| Ollama | 本地模型，`http://localhost:11434/v1` |

也支持任意 OpenAI 兼容接口：填 `Base URL` + `API Key` + `模型名` 即可。配置保存在本地数据库中，**不会**上传到任何第三方（只有生成简历时才会发送给你配置的服务商）。

### 4. 使用流程

1. **岗位** 页 → 点「手动添加」，直接填写岗位，或粘贴官网招聘信息后点「识别并填充」，核对草稿并保存；可用备注记录跟进信息，并批量调整状态或删除岗位；
2. **个人资料** 页 → 填写教育、工作、校园、项目和技能等信息；可上传简历照片，并为每条经历附加 UTF-8 编码的 Markdown/TXT 总结文件（不超过 200 KB）；
3. **岗位** 页 → 对目标岗位点「生成简历」，选择是否启用岗位导向美化拓展及拓展程度，然后等待流式生成；
4. 预览确认 → 保存入库 → 在 **简历** 页导出为 PDF / JSON / Markdown。

### 运行测试

```bash
cd backend
.venv/Scripts/activate
pytest           # 岗位文本与 JD 解析 / 生成器（含 JSON 容错与防虚构校验）/ 导出 / 接口
```

```bash
cd frontend
npm run build    # tsc 类型检查 + 生产构建
npm run lint     # ESLint 检查
```

## ❓ FAQ

**API Key 存在哪里？安全吗？**
保存在本地 SQLite 数据库的 `app_setting` 表中，不出本机。这是单用户本地工具的取舍：换取零配置体验。仓库代码与 `.env.example` 中不含任何真实密钥（`gitignore` 已忽略 `.env`）。若对明文存储不放心，可自行改造 `backend/app/services/settings_service.py` 增加加密（如系统钥匙串）。

**PDF 如何导出？**
预览页右上角「打印 / 保存 PDF」调用浏览器打印（A4 版式已内置在模板中）。相比服务端 PDF 库，浏览器打印免去中文字体跨平台兼容问题，且所见即所得。

**粘贴招聘信息后会自动创建岗位吗？**
不会直接入库。「识别并填充」使用本地规则拆分职位名称、公司、地点、职责和要求等字段，不访问网络，也不会把招聘文本发送给大模型。请先核对可编辑草稿，再点击「保存」创建岗位；无法准确映射的部门、职位 ID 等前言信息会保留在职位描述中。

**个人照片会发送给大模型吗？**
不会。照片经格式、文件签名和 2 MB 大小校验后保存在本地 SQLite 中；生成简历时不进入模型上下文，而是在模型内容解析完成后注入简历，并用于 HTML 预览、打印和导出。

**经历总结文件保存在哪里，会发送给大模型吗？**
浏览器会读取 Markdown/TXT 正文并保存到本地 SQLite，不保存或依赖原始文件路径。启用美化拓展时，系统会从正文中选取与当前 JD 相关的片段，连同候选资料发送给你配置的模型服务商；照片仍不会发送。总结文件可能包含个人或项目敏感信息，使用第三方模型前请确认其数据政策。

**升级后旧数据库需要手动迁移吗？**
当前新增的岗位备注、个人照片、经历参考文件和美化拓展记录列会在后端启动时自动检查并补齐，升级过程保留原有数据，重复启动也不会重复修改。仍建议像对待其他个人资料一样定期备份 `backend/data/resume_forge.db`。

**AI 会不会编造经历？**
美化拓展不等于虚构。生成链路会固定姓名、公司/组织/项目、角色、时间和技能等结构事实；模型只能使用资料字段与参考文件中的事实重组表达，未被资料支持的量化结果会被拦截并提示。关闭美化拓展后，经历要点还会严格回填为资料原文。见 [docs/prompt-tuning.md](docs/prompt-tuning.md)。

## 📖 文档

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 系统架构、关键设计决策、扩展点 |
| [docs/prompt-tuning.md](docs/prompt-tuning.md) | 提示词调优指南与防虚构校验说明 |

## 🤝 参与贡献

欢迎提 Issue 与 PR（模板见 `.github/ISSUE_TEMPLATE/`）。提交前请：

1. 后端改动跑通 `pytest`，前端改动跑通 `npm run build && npm run lint`；
2. 遵循现有代码风格：清晰的命名、短函数、分层清晰、注释解释「为什么」；
3. 新配置项给出默认值并同步更新 `.env.example` 与文档。

## 📁 目录结构

```
ResumeForge/
├── backend/
│   ├── app/
│   │   ├── api/            # FastAPI 路由层（薄，只做参数校验与调用服务）
│   │   ├── services/       # 业务逻辑：简历生成、岗位文本/JD 解析、导出
│   │   ├── models/         # SQLAlchemy ORM 模型
│   │   ├── schemas/        # Pydantic 请求/响应模型
│   │   ├── prompts/        # 提示词模板（与代码分离，改 prompt 不动代码）
│   │   ├── templates/      # 简历 HTML 导出模板
│   │   └── data/           # 技能词典
│   ├── tests/              # pytest 单元测试
│   ├── requirements.txt    # 锁定版本依赖
│   └── .env.example        # 环境变量示例
├── frontend/
│   └── src/
│       ├── api/            # 请求封装与 SSE 流解析
│       ├── components/     # 业务组件（生成弹窗、预览、表单等）
│       ├── pages/          # 六个页面
│       ├── hooks/          # useApi 等通用 Hook
│       └── types/          # 与后端 schema 镜像的 TS 类型
├── docs/                   # 架构 / Prompt 调参文档
└── .github/ISSUE_TEMPLATE/ # Bug 与功能建议模板
```

## 📄 许可证

[MIT](LICENSE) © ResumeForge 贡献者
