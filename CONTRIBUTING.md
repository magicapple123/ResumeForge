<p align="center"><a href="#简体中文">简体中文</a> · <b>English</b></p>

# Contributing

Thanks for helping improve ResumeForge. The project is maintained incrementally: preserve existing behavior first, and solve one clearly defined problem with a small, verifiable change.

Before you send a change, read [AGENTS.md](AGENTS.md) in the repository root. It covers the long-term maintenance principles, Windows environment conventions, verification commands and security boundaries.

## Before you start

- Python 3.11–3.13 (CI covers 3.11, 3.12 and 3.13; `pyproject.toml` targets `py311`).
- Node.js `>= 20.19.0`, using the npm that ships with Node.
- On a Chinese-locale Windows environment, set `PYTHONUTF8=1` before running Python commands.
- Do not commit `.env` files, databases, real resumes, API keys, build artifacts, virtual environments or any other personal data.

## Local development

Backend (PowerShell):

```powershell
cd backend
$env:PYTHONUTF8 = "1"
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm ci
npm run dev
```

In development Vite proxies `/api` to `http://127.0.0.1:8000`.

Those are the default ports of the manual workflow. The one-click `start.cmd` in the repository root uses backend port 8005 by default and sets `$env:VITE_BACKEND_URL` for the dev server.

## Change principles

- API routes handle parameter validation and orchestration; core logic belongs in `backend/app/services/`.
- Keep Pydantic schemas and frontend TypeScript types in sync.
- New configuration must ship with safe defaults, and must update `backend/.env.example` and the related docs.
- SQLite schema changes require a new Alembic revision under `backend/migrations/versions/`, plus tests for old-data retention, repeated startup and backup. Never modify a revision that has already been released.
- Do not hard-code revision literals in tests: use `BASELINE_REVISION` / `head_revision()` from `backend/tests/migration_refs.py`.
- Do not leak API keys or personal data into logs, exception messages, test fixtures or screenshots.
- Skip wholesale refactors or reformatting unrelated to the problem at hand; they hide behavior changes.
- Do not add AI or tool co-author trailers (`Co-Authored-By:` and friends) to commit messages: GitHub resolves them to accounts and counts them in the contributor list. Rationale and cleanup steps are in "Commit attribution" in [AGENTS.md](AGENTS.md).
- Every new 2.x migration must ship with a "data unchanged across the upgrade" test: build a database with the previous schema, load fixed samples, run the upgrade, then assert row counts and content fingerprints table by table.
- The single baseline (`0001_baseline_v2`) must not be rewritten once 2.0 has shipped; structural changes may only arrive as new migrations.
- Gates are decided by `app_schema_epoch`; never switch them to "compare revision strings" or "equals head".

## File size budget

`backend/tests/test_file_size_budget.py` is a hard CI gate and the failure contributors hit most often:

- `backend/app` and `frontend/src`: 500 lines per file, `.css` included.
- Test files count too, under the same 500-line budget.
- `scripts/` has its own 800-line budget; `desktop/` stays at 500.

If a file genuinely cannot be split, register it in the exemption list for its tree — `_EXEMPTIONS` (production code), `_TEST_EXEMPTIONS` (tests), `_SCRIPTS_EXEMPTIONS` (`scripts/`) or `_DESKTOP_EXEMPTIONS` (`desktop/`) in `backend/tests/test_file_size_budget.py` — with a written justification and an expiry date. An entry missing either one fails the gate.

## Checks before committing

The one-click script `scripts/Check-All.ps1` runs six steps:

1. `ruff check backend/app backend/tests`, then `ruff format --check` over the **Python files this checkout touches** (changes against `HEAD` plus untracked files) under those same two directories.
2. The backend suite as `pytest tests -q -n 2`, without `--cov`; the canary tests that need a live app on port 9333 are skipped.
3. `npm run typecheck`.
4. `npm run lint`.
5. `npm run test`, then `npm audit --registry=https://registry.npmjs.org` (high severity and above).
6. `npm run build`.

```powershell
.\scripts\Check-All.ps1
```

It does **not** cover four things, so run those from the manual list below: prettier's `format:check`, `pyright`, the 80% coverage floor (the script's pytest run passes no `--cov`) and `pip check`.

One step there has a known state you should not misread. The `ruff format --check` step covers only the `.py` files this checkout touches (changes against `HEAD` plus untracked files), so a clean checkout skips it. A directory-wide check is skipped on purpose: a large share of the existing files does not satisfy `ruff format` (measured on 2026-11-06 over `backend/app` + `backend/tests`: **501 files would be reformatted, 979 are already formatted**), which makes such a step red on an untouched checkout and says nothing about your change. CI runs no repository-wide format check either. `pip check` is likewise a local-only check; CI runs `pip-audit` instead.

The repository also ships a pre-commit hook (fast gate: ruff, eslint, structural guard tests and the frontend i18n guards — cjkRatchet, locale subscription, key contract). Run this once after the first clone:

```powershell
git config core.hooksPath scripts/hooks
```

The manual commands follow.

Backend:

```powershell
cd backend
$env:PYTHONUTF8 = "1"
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m pyright --pythonpath .venv\Scripts\python.exe
.venv\Scripts\python.exe -m pytest -n auto --cov=app --cov-config=..\pyproject.toml
.venv\Scripts\python.exe -m pip check
```

For the files you added, run `ruff format --check <those files>` separately; the pre-commit hook does it for you automatically, and CI runs no repository-wide format check.

Notes:

- Pass `--cov` **only on a full run**. When you run a handful of files, the subset coverage is necessarily below the floor and the "failure" is an artifact. The floor is 80% (`fail_under = 80` in `pyproject.toml`).
- `-n auto` parallelises the run via pytest-xdist; use `-n 4` on memory-constrained machines.

Frontend:

```powershell
cd frontend
npm test
npm run format:check
npm run lint
npm run typecheck
npm run build
npm audit --registry=https://registry.npmjs.org
```

When you touch UI interaction, also verify the affected flow by hand, including the usual empty states, error states and narrow-viewport layouts. Changes to user-visible behavior, dependencies, configuration or database compatibility must also update `README.md`, the related `docs/` pages and `CHANGELOG.md`.

When you change anything under `docs/**`, `README*.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md` or `.github/`, run the documentation sweep again:

```powershell
python scripts/check_docs_pii.py
```

It blocks keys, private-key blocks, tokens, phone numbers, email addresses and home-directory paths accidentally copied into documentation; placeholders (`example.com`, `138-0000-0000` and similar) and lines carrying a `pii-ok` comment are let through. When writing docs, see the [verification playbook](docs/verification-playbook.md) (how to write an acceptance check that can actually fail) and the [collaboration SOP](docs/ai-collaboration-sop.md) (structure of task briefs and delivery reports).

## Demo data and screenshots

Screenshots in `README.md` and `docs/` must come from a **really running** app, and the data in them must be **entirely fictional**. One entry point generates the data and self-checks the API; the other is the screenshot procedure described below.

```powershell
backend\.venv\Scripts\python.exe scripts\seed_demo_data.py --check
```

`--check` generates the fictional demo data and runs the 58 read-only endpoints as a self-check; the run writes to `runtime/demo/demo.db`.

Demo persons, companies and schools all carry the fictional "示例" ("sample") prefix; phone numbers are fixed to `0000` and email addresses use the reserved `example.com` domain. `backend/tests/test_seed_demo_data.py` guards this rule, so run it after changing demo data. The screenshot procedure (start the backend with an isolated `DATABASE_URL`, point the frontend at it, then compress to 1440px wide) is documented in "README (project home) and screenshots" in [AGENTS.md](AGENTS.md).

**Do not** put your own real details, real resume or real job links into demo data, and do not screenshot `backend/data/resume_forge.db` directly — that publishes personal information onto the public repository home page.

## Security-sensitive changes

The following paths carry the safety boundaries of web-form filling, the boundaries of outbound requests and the semantics of data backup. A wrong change there can mean the user's resume is submitted to the wrong place, filled in wrongly, or leaked — not an ordinary feature regression. PRs touching these paths **must get one manual security review** on top of the automated checks:

- `backend/app/services/webform/**` (web-form filling engine)
- `backend/app/services/apply/**` (application pipeline and collection)
- `backend/app/services/update_sources.py` (external update sources)
- `backend/app/middleware/**` (inbound request boundaries)
- `backend/app/services/data_backup/**` (backup and restore)

Review checklist (walk it against the boundary map in `deliverables/webform-safety-boundaries-2026-10-06.md`):

- The guard semantics of web-form filling are not relaxed: consent/declaration fields are not auto-filled, passwords/verification codes/bank cards are blocked, fields are filled but never clicked, over-long values are skipped, existing page values are never overwritten, and high-risk ambiguities are left alone — these are one-way boundaries that are never relaxed ("rather miss a field than fill it wrong"), and changing any of them requires a prominently flagged rationale in the PR.
- All new external input (page controls, job descriptions, pasted user content, response fields) is treated as untrusted: validate, cap the length, encode safely, and keep it out of `eval`/templates/concatenated SQL.
- Logs, exception messages and diagnostics exports gain no new sensitive fields (cookies, raw prompts, complete personal profiles).
- Backup/restore paths introduce no new deletion semantics or path concatenation.
- The set of inbound sources the middleware lets through does not grow (Host/Origin/CORS allowlists).

For boundary questions you cannot answer yourself, start with the channel in [SECURITY.md](SECURITY.md) instead of describing exploitable details in a public issue.

## Platform-specific changes

When you change anything under `scripts/macos/**` or `start.command`, run `bash scripts/tests/test-macos-launcher.sh`. The launcher and release-package layer is additionally verified by the CI jobs `macos-launcher-guards`, `macos-runtimes`, `macos-end-to-end` and `windows-end-to-end`; the maintainers have no Mac, so those jobs are the only real-machine verification available. **A live port is not the same as a usable page** — probe the actual page, not just the listening socket.

## Pull requests

- One topic per PR: explain the reason, the blast radius and the verification results.
- Flag breaking changes, data migrations, security-boundary changes and new outbound network requests prominently.
- Provide before/after screenshots for UI changes.
- New features and bug fixes need automated tests proportional to the risk.
- Keep the lockfile consistent with the dependency list, but never commit a local virtual environment or `node_modules`.

Do not open a public issue for security problems; report them the way [SECURITY.md](SECURITY.md) describes.

---

## 简体中文

<a href="#contributing">English</a>

感谢你帮助改进 ResumeForge。项目采用渐进式维护方式：优先保留现有行为，用小而可验证的改动解决一个明确问题。

提交修改前请先阅读项目根目录的 [AGENTS.md](AGENTS.md)，其中包含长期维护原则、Windows 环境约定、验证命令和安全边界。

### 开始之前

- Python 3.11–3.13（CI 覆盖 3.11 / 3.12 / 3.13；`pyproject.toml` 的 `target-version = "py311"`）。
- Node.js `>= 20.19.0`，并使用随 Node 提供的 npm。
- Windows 中文环境运行 Python 命令前建议设置 `PYTHONUTF8=1`。
- 不要提交 `.env`、数据库、真实简历、API Key、构建产物、虚拟环境或其他个人数据。

### 本地开发

后端（PowerShell）：

```powershell
cd backend
$env:PYTHONUTF8 = "1"
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

前端：

```powershell
cd frontend
npm ci
npm run dev
```

开发环境由 Vite 将 `/api` 转发到 `http://127.0.0.1:8000`。

以上是手动开发流程的默认端口；根目录 `start.cmd` 一键启动时默认使用后端 8005，并为开发服务器设置 `$env:VITE_BACKEND_URL`。

### 修改原则

- API 路由负责参数校验和业务编排，核心逻辑优先放在 `backend/app/services/`。
- Pydantic Schema 与前端 TypeScript 类型需要同步维护。
- 新增配置必须提供安全默认值，并同步更新 `backend/.env.example` 和相关文档。
- SQLite 表结构变更必须新增 `backend/migrations/versions/` 下的 Alembic revision，并有旧数据保留、重复启动和备份测试；不要修改已经发布的 revision。
- 测试里**不要写死 revision 字面量**，用 `backend/tests/migration_refs.py` 的 `BASELINE_REVISION` / `head_revision()`。
- 不要在日志、异常消息、测试夹具或截图中泄露 API Key 和个人资料。
- 不做与当前问题无关的全量重构或格式化，避免掩盖行为变化。
- 提交信息里不要添加 AI 或工具的联合署名（`Co-Authored-By:` 等）：GitHub 会把它解析成账号并计入贡献者列表。原因与清理方式见 [AGENTS.md](AGENTS.md) 的「提交署名」。
- 2.x 每次新增迁移，必须同时附一条"升级前后数据不变"的测试：用上一版 schema 建库并灌固定样本，跑 upgrade 后断言逐表行数与内容指纹相同。
- 单基线（`0001_baseline_v2`）一旦随 2.0 发布，**不许再改写**；结构变化只能通过新增迁移。
- 闸门按 `app_schema_epoch` 判定，不许改成"revision 字符串比较"或"等不等于 head"。

### 单文件行数预算

`backend/tests/test_file_size_budget.py` 是 CI 的硬闸门，也是贡献者最容易踩到的失败：

- `backend/app` 与 `frontend/src`：单文件 500 行（含 `.css`）。
- 测试文件同样计入这 500 行预算。
- `scripts/` 用独立的 800 行预算；`desktop/` 维持 500 行。

确实拆不动的文件，要在所属目录树的豁免册登记**书面理由 + 到期日**：`_EXEMPTIONS`（生产代码）、`_TEST_EXEMPTIONS`（测试）、`_SCRIPTS_EXEMPTIONS`（`scripts/`）或 `_DESKTOP_EXEMPTIONS`（`desktop/`），都在 `backend/tests/test_file_size_budget.py` 里。缺任一项都会被判失败。

### 提交前检查

一键脚本 `scripts/Check-All.ps1` 跑六步：

1. `ruff check backend/app backend/tests`，再对这两个目录下**本次改动涉及的** `.py` 文件跑 `ruff format --check`（对 HEAD 的改动 + 未跟踪文件）。
2. 后端全量测试 `pytest tests -q -n 2`，**不带 `--cov`**；需要 9333 端口上有活应用的 canary 测试被跳过。
3. `npm run typecheck`。
4. `npm run lint`。
5. `npm run test`，再跑 `npm audit --registry=https://registry.npmjs.org`（high 及以上）。
6. `npm run build`。

```powershell
.\scripts\Check-All.ps1
```

它**不覆盖**四件事，需要照下面的手动清单单独跑：prettier 的 `format:check`、`pyright`、80% 覆盖率门槛（脚本里的 pytest 没传 `--cov`）、`pip check`。

其中一步的已知状态不要误读：`ruff format --check` 只覆盖**本次改动涉及的** `.py` 文件（对 HEAD 的改动 + 未跟踪文件），因此在没有改动的干净检出上会直接跳过这一步。不做整目录检查是刻意的：仓库存量文件中有相当一部分不符合 `ruff format`（2026-11-06 在 `backend/app` + `backend/tests` 上实测：**501 个文件待重排，979 个已符合格式**），那种检查在未改动的干净检出上就是红的，却说不了这次改动任何事。CI 同样不做覆盖整个仓库的 format 检查。`pip check` 也只是本地口径，CI 用的是 `pip-audit`。

此外，仓库启用了 pre-commit 钩子（快闸门：ruff、eslint、结构守卫测试，以及前端 i18n 守卫——cjkRatchet、locale 订阅、key 契约）。首次克隆后执行一次：

```powershell
git config core.hooksPath scripts/hooks
```

手动检查命令如下。

后端：

```powershell
cd backend
$env:PYTHONUTF8 = "1"
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m pyright --pythonpath .venv\Scripts\python.exe
.venv\Scripts\python.exe -m pytest -n auto --cov=app --cov-config=..\pyproject.toml
.venv\Scripts\python.exe -m pip check
```

本次新增的文件另外跑 `ruff format --check <这些文件>`；pre-commit 钩子会自动执行，CI 不做覆盖整个仓库的 format 检查。

几点提示：

- **覆盖率只在全量运行时开 `--cov`**；只跑几个文件时不要加（子集覆盖率必然低于门槛，那是假失败）。覆盖率门槛为 80%（`pyproject.toml` 的 `fail_under = 80`）。
- `-n auto` 通过 pytest-xdist 并行；内存受限时用 `-n 4`。

前端：

```powershell
cd frontend
npm test
npm run format:check
npm run lint
npm run typecheck
npm run build
npm audit --registry=https://registry.npmjs.org
```

涉及界面交互时，还应手动验证对应流程及常见空状态、错误状态和窄屏布局。涉及用户可见行为、依赖、配置或数据库兼容性的改动，请同步更新 `README.md`、相关 `docs/` 文档及 `CHANGELOG.md`。

改动 `docs/**`、`README*.md`、`CONTRIBUTING.md`、`SECURITY.md`、`AGENTS.md`、`CLAUDE.md` 或 `.github/` 下的文件时，再跑一次文档巡检：

```powershell
python scripts/check_docs_pii.py
```

它会拦下误带进文档的密钥、私钥块、令牌、手机号、邮箱与家目录路径；占位符（`example.com`、`138-0000-0000` 等）和带 `pii-ok` 注释的行会自动放过。写文档时可参考[验证手册](docs/verification-playbook.md)（怎样写可判真假的验收）与[协作规程](docs/ai-collaboration-sop.md)（任务书与交付报告的结构）。

### 演示数据与截图

`README.md` 与 `docs/` 里的截图必须来自**真实运行**的应用，而截图里的数据必须**全是虚构的**。一个入口负责生成数据并自检接口，另一个是下面描述的截图流程。

```powershell
backend\.venv\Scripts\python.exe scripts\seed_demo_data.py --check
```

`--check` 会生成虚构演示数据，并把 58 个只读接口跑一遍自检；本次运行写到 `runtime/demo/demo.db`。

演示数据的人物、公司、学校统一用「示例」前缀，手机号固定 `0000`、邮箱走 `example.com` 保留域；这条由
`backend/tests/test_seed_demo_data.py` 守着。改演示数据后请跑它。截图流程（用隔离的 `DATABASE_URL` 启
后端、前端指向它、截完压到 1440 宽）写在 [AGENTS.md](AGENTS.md) 的「README（项目主页）与截图」里。

**不要**把自己的真实资料、真实简历或真实岗位链接填进演示数据，也不要直接拿 `backend/data/resume_forge.db`
截图——那等于把个人信息发到公开仓库首页上。

### 安全敏感改动的审查要求

以下路径承载网申填表安全界限、外部请求边界与数据备份语义，错误改动的代价是"把用户的简历投错、填错或泄露"，而不是普通的功能回归。触及这些路径的 PR，除自动化检查外**必须做一次人工安全审查**：

- `backend/app/services/webform/**`（网申填表引擎）
- `backend/app/services/apply/**`（投递链路与采集）
- `backend/app/services/update_sources.py`（外部更新源）
- `backend/app/middleware/**`（入站请求边界）
- `backend/app/services/data_backup/**`（备份与恢复）

审查清单（对照 `deliverables/webform-safety-boundaries-2026-10-06.md` 的界限全景图逐条核对）：

- 网申填表的守卫语义没有被放松：同意/声明类不代填、密码/验证码/银行卡拦截、只填不点、超长值不填、页面已有值不覆盖、高风险歧义宁可不猜——这些是"宁可漏填不可错填"的单向界限，调整任何一条都要在 PR 里醒目标注理由；
- 新增外部输入（页面控件、岗位描述、用户粘贴内容、响应字段）全部按不可信输入处理：验证、限长、安全编码，不进入 `eval`/模板/SQL 拼接；
- 日志、异常消息与诊断导出不新增敏感字段（Cookie、prompt 原文、完整个人资料）；
- 备份/恢复路径不引入新的删除语义或路径拼接；
- 中间件放行的入站来源没有扩大（Host/Origin/CORS 白名单）。

改动者无法自查的边界问题，请按 [SECURITY.md](SECURITY.md) 的渠道先沟通，不要在公开 Issue 里描述可利用细节。

### 平台相关改动

改 `scripts/macos/**` 或 `start.command` 时要跑 `bash scripts/tests/test-macos-launcher.sh`。启动链与发布包的另一层验证是 CI 的 `macos-launcher-guards`、`macos-runtimes`、`macos-end-to-end`、`windows-end-to-end` 作业；维护者没有 Mac，这几个作业是真机验证的唯一途径。**端口活着不等于页面能用**——要探实际页面，不能只看监听套接字。

### Pull Request

- 一个 PR 聚焦一个主题，并说明原因、影响范围和验证结果。
- 对破坏性变更、数据迁移、安全边界变化或新的外部网络请求作醒目标注。
- 界面变化提供修改前后截图。
- 新功能和缺陷修复应提供与风险相称的自动化测试。
- 保持 lockfile 与依赖清单一致，但不要提交本地虚拟环境或 `node_modules`。

安全问题请不要提交公开 Issue，按 [SECURITY.md](SECURITY.md) 的方式报告。
