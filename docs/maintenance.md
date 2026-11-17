# 项目维护手册

> 分工：**红线与禁止事项以 [`AGENTS.md`](../AGENTS.md) 为准；命令细节、环境坑与操作步骤以本文为准。**
> 两者冲突时按这个分工判定——规则看 AGENTS.md，执行看这里。
> 最后更新：2026-11-05。规模数字随开发变动，以 CI 汇总为准（本文件刻意不写精确规模，防止漂移）。

## 1. 项目结构

```
ResumeForge/
├── backend/                  FastAPI 后端
│   ├── app/api/                API 模块（接口数以代码为准）
│   ├── app/services/           服务模块，按域分目录
│   │                           （resume / profile / job / jd / assistant / interview /
│   │                            apply / browser …）
│   ├── app/models/             模型模块（表数以 models/ 与迁移链为准）
│   ├── app/schemas/            Pydantic 请求/响应模型
│   ├── app/prompts/            提示词目录
│   ├── app/templates/          Jinja 简历模板
│   ├── migrations/versions/    Alembic 迁移链（2.0 只有单基线 0001_baseline_v2，
│   │                           其后已接 0002–0020；新增迁移接在 head 之后）
│   ├── requirements.txt        顶层钉版来源（唯一手改处；生产链不直接装它）
│   ├── requirements.runtime.lock.txt  ★ 生产安装唯一来源：逐包 SHA-256（§4.5）
│   ├── requirements.lock.txt   开发锁：运行闭包 + 工具链（§4.5）
│   ├── requirements-dev.txt    开发依赖清单（顶层，同样不直接装）
│   ├── tests/                  测试（文件数 / 用例数以 pytest 汇总行为准）
│   └── data/                   ★ 运行时数据：数据集、备份、浏览器登录态、legacy-archive（.gitignore）
├── frontend/                 React 19.3 + antd 6 + Vite 8（Rolldown）
│   ├── src/pages/              页面（菜单在 features/shell/navigationConfig.ts，
│   │                           路由表在 src/appRoutes.tsx；App.tsx 只 re-export MENU_ITEMS）
│   ├── src/components/common/  跨模块交互原语；其余按领域在 src/features/<domain>/
│   ├── src/api/  src/types/    接口封装与类型
│   ├── src/utils/  src/hooks/  纯工具与 hooks（测试与被测文件同目录）
│   └── src/…*.test.tsx         前端测试（规模以 vitest 汇总行为准）
├── start.cmd / stop.cmd / update.cmd / uninstall.cmd       Windows 一键入口（仓库根）
├── start.command / …          macOS 等价物（bash 3.2 方言，仓库根）
├── start.sh / stop.sh / update.sh                          Linux 等价物（仓库根）
├── scripts/                  启动与发布链实现（ps1 / py，无 cmd）
│   ├── Start-ResumeForge.ps1   Windows 启动器（被 start.cmd 调用）
│   ├── macos/ linux/          两平台启动链实现与自举常量
│   ├── Build-Release.ps1       发布包构建（白名单 + SHA256）
│   ├── Build-Demo.ps1          在线体验构建
│   └── bump_version.py         版本号统一（6 处，不改锁文件）
├── docs/                     architecture / user-guide / PROJECT_MAP / 本文
├── runtime/demo/             演示数据与截图工具链
├── AGENTS.md                 ★ 所有协作代理的入口规则
├── CHANGELOG.md              用户可见变更（最新版本段 + Unreleased）
└── README.md                 项目主页（功能表第一列锁定）
```

## 2. 日常开发循环（六步）

### ① 定位

- 先读 `AGENTS.md`；本手册只做速查。
- 用 Grep 定位到文件与行号，再读最小必要片段。
- **改之前先确认"这份逻辑是否已有唯一实现"**——投递准入（`models/apply.py::admission_of`）、
  状态白名单等都是刻意单份的；求职助手的功能清单以 `services/feature_catalog.py` 门面（数据在 `feature_catalog_{profile,resume,workflow}.py`）为单一事实来源。

### ② 改动

- 小步走：一次改一处，就近验证，别攒一批最后一起跑。
- 不拿"函数签名行"当编辑锚点（历史上误删过三次）；每次 Edit 后立刻 grep 复查被改处。
- 同目录不要放两个只差大小写的模块名（Windows 不敏感，会出 TS1149）；改名后**必须重启前端 dev server**。

### ③ 验证（分层，按序）

| 层 | 命令 | 说明 |
|---|---|---|
| 相关子集 | `pytest -q tests/test_xxx.py`（backend 目录） | 秒级确认方向 |
| 静态 | `ruff check .`；前端 `tsc --noEmit` / `eslint` / `prettier --check` | 秒级 |
| 全量后端（日常） | `pytest -n auto` | 3 分钟，只看通过 / 失败，**不带覆盖率** |
| 全量后端（交付前覆盖率） | 见下方三条 `coverage run/combine/report` | 覆盖率门槛 80%，**必须串行** |
| 全量前端 | `vitest run` | ~7 分钟 |
| macOS 链 | `bash scripts/tests/test-macos-launcher.sh` | 任何平台可跑 |
| UI 实测 | 起服务 + Playwright 脚本 | 视觉问题必须眼见为实 |

注意：

- **`--cov` 不能配子集，也不能配 `-n auto`**：配子集 80% 门槛必然假失败；配并行则覆盖率统计不到
  子进程（每个 worker 各写一份，汇总数是错的）。日常用 `pytest -n auto` 跑通过性，交付前用下面
  三条 `coverage` 命令串行取覆盖率。
- 交付判定**必须跑一次全量 + 覆盖率**（AGENTS.md：提速只能来自流程，不能来自跳过全量）；
  相关子集 + 静态检查只是第 1 步，用来快速定位方向。
- 本机沙箱会让 pytest-cov 收尾的 `.coverage` 写盘被批量删除守卫拦下（并行报
  `INTERNALERROR`、串行 exit 3 且覆盖率报告跑不到）。**拿到干净覆盖率的办法是绕开
  pytest-cov**（coverage 只从 cwd 找配置，必须显式 `--rcfile` 指向仓库根，否则会拿到
  连 tests/ 一起统计的假百分比）：

  ```powershell
  .venv\Scripts\python.exe -m coverage run --rcfile=..\pyproject.toml -m pytest -q
  .venv\Scripts\python.exe -m coverage combine --keep
  .venv\Scripts\python.exe -m coverage report --rcfile=..\pyproject.toml --fail-under=80
  ```

  判定以汇总行 + 覆盖率报告为准；`vite build` 被拦时指定仓库外输出目录：
  `pnpm exec vite build --outDir D:\rf_build_tmp --emptyOutDir`。

### ④ 文档同步

| 改了什么 | 必须同步 |
|---|---|
| 任何用户可见行为 | `CHANGELOG.md` 的 Unreleased 段 |
| 功能增删 | `README.md` 功能表（第一列逐字锁定）+ `docs/user-guide.md` |
| 界面/流程 | `frontend/src/features/user-guide/userGuideSteps.ts` + `feature_catalog*.py`（门面 + 数据段，四方被测试钉着） |
| 架构/模块 | `docs/architecture.md` / `docs/PROJECT_MAP.md` |
| 新增 / 删除 / 归档一篇文档 | `docs/doc-registry.json` 加或改一行 → `--write-index`（见 §4.6） |
| **改 `user-guide.md` 的小节标题** | `backend/tests/fixtures/assistant_docs_questions.json` 里该题的 `accepted_headings`（20 问标注集按标题命中）。切片行号不用改——由 `_doc_heading_line()` 按文件现算，不再写死数字 |

### ⑤ 提交

- Conventional Commits（`feat`/`fix`/`docs`…，决定发版幅度）。
- **不写任何 AI 署名**（`Co-Authored-By` 等），也不改 git 身份。
- 发布由用户发起；本仓库主分支平时由协作方提交推送（官网仓库 `ResumeForge-official` 同样）。

### ⑥ 发布

1. `python scripts/bump_version.py`（6 处版本号一次同步；**项目已发布 1.0、现在 2.0，破坏性变更
   显式 `--bump major`**——2.0 本身就是一次 major。`remove:` 前缀不推动版本号，
   删功能的发版别信自动判定）。
2. `scripts/Build-Release.ps1`：**四个包**——`-Platform windows`、`-Platform macos`、`-Platform linux`，
   以及默认的 `-Platform all`（各带一份 `.sha256`，共 8 个资产）。
   - Windows / macOS 两个包给官网的两个下载按钮；
   - **全平台包（`ResumeForge-<版本>-all.zip`）是必需的，别省。** 已经装在 0.14.2 及更早
     版本上的用户，应用内更新跑的是他们机器上那份旧代码——它按文件名排序取第一个 `.zip`，
     而 `-all.zip` 排在最前（`a` < `m` < `w`）。少了这个包，那些用户点「重启并安装」就
     必然下到 macOS 包、必然报「更新包缺少 start.cmd」。**名字本身是契约**，
     `Test-Build-Release.ps1` 钉着它。
   - 想让包里带上桌面安装版：加 `-IncludeDesktop`（只支持 `-Ref HEAD`，`-Platform macos`
     拒绝）——先跑 `Build-Desktop.ps1 -Target win` 再把 NSIS 安装器注入 `desktop/` 条目。
     默认关；macOS 桌面（dmg）仍需真 Mac，未接线。
3. 官网仓库：更新文案 → `node tools/audit.js` 全绿 → 重采截图 / 重建 demo-app → 提交推送。
4. 打 tag、建 GitHub Release（附双平台包与校验文件）。
5. 更新公告图：写清**怎么更新**与**旧数据怎么导入**（1.x → 2.0 不搬数据，旧库整包归档到
   `legacy-archive/<时间戳>/`，需要旧数据时用 1.0.2 打开归档；同 major 内的更新照旧
   导出数据集 → 新版导入为新数据集）。

## 2.5 手动启动与冒烟

不用启动器、自己起服务时（排错、只改后端、跑浏览器冒烟）走这一节；日常开发仍然双击启动器最快。

```powershell
cd backend

# 创建虚拟环境并安装运行依赖
py -3.13 -m venv .venv
$env:PYTHONUTF8 = "1"
# 装的是**生产锁**（逐包 SHA-256），与首次安装、发布包、CI 同一套闭包；别装 requirements.txt
.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.runtime.lock.txt
# 还要跑 pytest / ruff / pyright：补开发锁（已含上面的运行闭包，不用再装一遍）
.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.lock.txt

# 启动服务（默认 http://127.0.0.1:8000，接口文档见 /docs）
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

macOS / Linux 用 `.venv/bin/python` 替换上面的 Windows 路径；Git Bash 用 `export PYTHONUTF8=1`。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm run dev        # http://localhost:5173，已配置 /api 代理到 8000 端口
```

运行测试：

```powershell
cd backend
.venv\Scripts\python.exe -m ruff check .

# 日常内循环：并行跑，快
.venv\Scripts\python.exe -m pytest -n auto

# 交付前：串行跑一次覆盖率（与 §2 ③ 验证同一组命令；run → combine → report 三段缺一不可，
# 少 combine 会拿到空/旧数据）。并行与覆盖率不能写在同一条命令里，否则统计不到子进程。
.venv\Scripts\python.exe -m coverage run --rcfile=..\pyproject.toml -m pytest -q
.venv\Scripts\python.exe -m coverage combine --keep
.venv\Scripts\python.exe -m coverage report --rcfile=..\pyproject.toml --fail-under=80

cd ../frontend
pnpm run test && pnpm run lint && pnpm run typecheck && pnpm run build
```

浏览器冒烟（Playwright，`frontend/tests/smoke/`）需要应用先跑起来，用例不对抗启动链——两种形态任选其一：

```powershell
# 形态一：发布形态（后端同源，默认 smoke 口 8123）
pnpm run build
cd ..
powershell -File scripts\Start-ResumeForge.ps1 -NoBrowser -BackendPort 8123
cd frontend

# 形态二：开发形态（Vite 5173 + 后端 8000）
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd ../frontend
pnpm run dev
```

然后跑冒烟（发布形态零配置；开发形态把两个地址分别指给前端页面与 API）：

```powershell
cd frontend
pnpm run smoke                                   # 发布形态（默认 http://127.0.0.1:8123）
$env:SMOKE_FRONTEND_URL = "http://127.0.0.1:5173"; $env:SMOKE_BACKEND_URL = "http://127.0.0.1:8000"
pnpm run smoke                                   # 开发形态
```

当前规模：后端与前端合计约 **1.6 万个测试用例**（2026-11 口径：后端 828 个测试文件、pytest 全量约 1.0 万条；前端 883 个测试文件、约 6 千条；后端覆盖率门槛 80%；确切数字以每次 CI 的汇总行为准）。GitHub Actions 在 Linux、Windows 与 macOS 上重复执行关键检查——macOS 那几个作业是刻意加的：它们会真下载便携运行时、从干净检出走完整启动链，并做浏览器冒烟，是 macOS 链路的持续把关；macOS 桌面安装包（dmg）自 v1.0.1 起同样由 CI 构建产出。


## 3. 守卫与红线

- **覆盖率 80%** 只在全量时开 `--cov`；子集跑覆盖率是假失败。前端门禁见
  `frontend/vitest.config.ts` 的 `coverage.thresholds`（基线 −3pt、只升不降）。
- **CI 作业**：Backend ×3（py311/313/win，含 ruff / pyright / 版本号核对 / 全量覆盖率）、
  Frontend（Node 22，测试带覆盖率门禁 + artifact）、Dependency audit（生产依赖阻断、
  开发依赖 advisory）、macOS ×3（launcher guards / portable runtimes / end-to-end，
  e2e 末尾跑 Playwright 浏览器冒烟）、Linux ×3（launcher guards / portable runtimes /
  end-to-end）、Windows end-to-end（同样以冒烟收尾）、Windows portable runtimes、
  Desktop shell ×2（`desktop-shell` 构建与打包校验 / `desktop-shell-smoke` 冒烟并断言
  用户目录下的 `desktop-backend.log`）、`repo-hygiene`（仓库卫生）、`docs-guards`
  （文档 PII 与链接）、`rag-runtime-matrix`（RAG 运行时矩阵）。另有独立工作流：
  **CodeQL**（每周安全扫描）与 **Nightly**（全量回归 + flaky 标记）。
  macOS / Linux 各三件是**真机（真 runner）验证途径**，改了任一平台的启动链要在交付说明里
  写明期望它们验证什么。
  `windows-runtimes` 与 macOS 那个同名作业是镜像：**真的下载**启动器要用的便携版 Node
  与 Python 官方安装包并逐个校验 SHA-256，专抓"下载地址或摘要失效"——`windows-end-to-end`
  用的是 runner 自带的解释器，恰好把这条路径整个遮住，而"一台什么都没装的电脑"走的正是它。
- **版本号单一事实来源**是 `backend/app/config.py` 的 `app_version`（发布链、更新器、
  启动器都按同一条正则解析它）；发版用 `python scripts/bump_version.py` 同步 6 处，
  `scripts/check_version_sync.py` 在 CI 核对 config.py 与 package.json 不漂移。
- **后端静态检查双件套**：`ruff check .`（E/F/I/UP/B/SIM）与
  `python -m pyright`（basic，范围见 `backend/pyrightconfig.json`；2026-10-23 起覆盖
  全部 `app/`，535 个文件 0 error。扩面按批次做、每批记录改法与理由，见该文件的注释）。
- **两个端到端作业**（`macos-end-to-end` / `windows-end-to-end`）从**干净检出**走完整启动链并
  真的取一次前端入口模块——"端口活着但页面一片空白"只有它们捕得到（2026-09-29 用户在虚拟机
  上解压新版本后只看到空白页，当时 Windows 侧没有这个作业）。改了启动链要跑它们。
- **提交不写 AI trailer**；数据/密钥/简历不进 git。
- 单一事实来源：`feature_catalog*.py`（功能清单：门面 + 三个数据段）、README 功能表、版本号 6 处、
  投递准入与状态白名单（各只有一份实现）。

## 4. 专项流程

### 4.1 数据库迁移

1. 新迁移文件放 `backend/migrations/versions/`，链上 `down_revision`。**2.0 的迁移链只有一条基线
   `0001_baseline_v2`**（其后已接 0002–0020），新迁移一律接在它（或更新的 head）之后。
2. **revision 字面量只允许出现在 `backend/tests/migration_refs.py`**（`BASELINE_REVISION` /
   `head_revision()`）；测试一律引用它，不要自己写 `"0001_baseline_v2"`。改 head 时只需改这一处，
   另有 `test_epoch_gate_matrix.py` / `test_manifest_revision.py` 从它派生。
3. 约束：`upgrade`/`downgrade` 都要可用；**表/列不存在时跳过而不是报错**（迁移可能在"部分业务表"
   的库上被调用，例如导入候选库与测试夹具）；加表/加列类迁移要保证"旧备份仍可导入"（表集合前后一致）。
4. 新增 `tests/test_migration_00XX.py` 钉住行为（2.0 基线本身的往返与 epoch 断言见
   `test_database.py`）。
5. **减表类迁移**要额外验证"降级能把表按原样建回来"——列、索引、外键的 `ondelete` 都要与
   建表那次逐字一致。（历史先例：2.0 之前的 `0025` 删官网采集遗留的三张表时用 `sa.inspect`
   比对表名 / 列名 / 索引名集合；该迁移已折进 `0001_baseline_v2`，只能当写法参考。）
6. **单基线一旦随 2.0 发布就不得改写**：`0001_baseline_v2` 只代表"2.0 此刻的结构"，任何结构变化
   （加/删列、改类型、约束、数据回填）都只能**新增**迁移，不能编辑已发布的基线。启动闸门按
   `app_schema_epoch`（单行 `epoch=2`）判，不按 revision 判；epoch 升级必须同时新增迁移并把
   闸门逻辑一起改。

### 4.2 macOS 启动链

- 守卫测试 `scripts/tests/test-macos-launcher.sh` 覆盖换行/编码/可执行位/自举常量/URL 口径。
- 脚本用 **bash 3.2 方言**；中文文案里插变量**必须**写成 `${name}`（裸 `$name` 紧跟中文会被
  bash 3.2 读进变量名，实测报 `unbound variable`）——守卫里有按字节的检查，扫描范围含
  `ci.yml` 与守卫脚本自己。
- 新增 shell 脚本要在 git 里显式 `--chmod=+x`（Windows 提交不记录可执行位）。
- 深度验证靠 CI 的三个 macOS 作业，本机没有 Mac。

### 4.3 界面截图与官网

- 截图流水线：**仓库内没有截图脚本**（旧文档提到的 `runtime/demo/tools/readme_capture.py` 从未入库，
  属作者本机工具）。现有图片是 `docs/images/` 下的静态资产；要更新时用示例数据集起服务
  （`scripts/seed_demo_data.py --check` → 8123/5199），人工按 1728×1080 视口截取后覆盖同名文件。
- 官网（`ResumeForge-official` 仓库）：三页 + `demo-app/`（iframe 内嵌）+ `download/`；
  改完必跑 `node tools/audit.js`；两个部署位置都要在 `demoBridge.ts` 的 `DEFAULT_PARENTS` 里。

### 4.4 运维与数据安全

- **自动备份**：启动后台线程按 `AUTO_BACKUP_INTERVAL_DAYS`（默认 7）节流，到期对当前
  数据库做一致性快照到 `backend/data/auto-backups/`，按 `AUTO_BACKUP_KEEP`（默认 5）轮转；
  `AUTO_BACKUP_ENABLED=false` 整体关闭。标记文件按"上次尝试"节流，连续失败不会每次
  启动都重撞。
- **更新前快照**（三个更新器各不相同，别按同一口径描述）：
  - **Windows**（`scripts/Update-ResumeForge.ps1`）：覆盖程序文件前先跑
    `backend/scripts/create_user_data_snapshot.py`——复用「导出全部数据集」链路把数据库 + 按引用
    收集的附件 + 字体 + 全局模型配置打成一个 zip 整包并用 `verify_archive` 校验（失败即中止更新，
    不再覆盖程序文件），随后仍把 `backend/data/*.db` + `datasets/*.db` 拷进 `backend/data/pre-update/`
    作兜底（保留 3 份，连同 `-wal` / `-shm` / `-journal` 边车）。跨 major 的整包快照目录标
    `pre-major-<时间戳>` 且永不被轮转清理。
  - **macOS**（`scripts/macos/update.sh`）：只做库级在线快照——优先 `sqlite3 .backup`（含各数据集
    的 db），没有 `sqlite3` 时退回文件拷贝；不产生 zip 整包，也没有 `pre-major` 标记。
  - **Linux**（`scripts/linux/update.sh`）：没有数据快照，只在覆盖前把**将被替换的程序文件**
    复制到 `runtime/backup-<时间戳>/`（用户数据目录本身不覆盖）。
- **文件日志**：`data/logs/backend.log`（5MB×5 滚动，`LOG_FILE_ENABLED` / `LOG_LEVEL`
  可调）；诊断包导出端点 `GET /api/system/diagnostics/export` 出包前对日志尾部做疑似
  令牌兜底脱敏。
- **SQLite 维护**：启动时 `wal_checkpoint(TRUNCATE)` + `PRAGMA optimize`；备份快照统一
  剥离 `sqlite_stat*` 统计表（保证旧版本导入兼容），导入白名单按 `sqlite_` 前缀放行
  引擎内部表。

### 4.5 依赖锁（生产运行时闭包）

四份文件、四种角色，别混：

| 文件 | 角色 | 谁装它 |
| --- | --- | --- |
| `backend/requirements.txt` | 唯一的**手改**钉版来源（只写直接依赖） | 没人直接装 |
| `backend/requirements.runtime.lock.txt` | 生产闭包，逐包 `--hash=sha256`（当前闭包见文件本身） | **所有**首次安装与更新（Windows/macOS/Linux）、发布运行时、CI |
| `backend/requirements.lock.txt` | 开发锁（运行闭包 + 工具链，当前集合见文件本身） | 本地测试环境、CI 静态检查作业 |
| `backend/requirements-dev.txt` | 开发依赖清单（顶层） | 没人直接装 |

**为什么只有锁能装**：`requirements.txt` 没有哈希，pip 会自己再解析一次传递依赖，于是同一份
代码在不同时间、不同镜像上装出不同的包集合（"某台机器上能跑"）。锁带逐包 SHA-256，
`pip install --require-hashes` 会校验每个下载物；锁还钉住整条闭包，用户机器上装出来的就是
发布包与 CI 审过的那一套。锁缺失或损坏时安装**明确失败**，绝不退回顶层清单重新解析。

**改依赖的流程**（唯一支持的方式；手改锁文件必被守卫打红）：

```powershell
# 1) 只改 requirements.txt / requirements-dev.txt 里的钉版
cd backend
# 2) 重新生成两份锁（需要 uv + 网络；本地没有 uv 就让 CI 生成后贴回）
uv pip compile --universal --python-version 3.11 --generate-hashes -o requirements.runtime.lock.txt requirements.txt
uv pip compile --universal --python-version 3.11 --generate-hashes -o requirements.lock.txt requirements-dev.txt
# 3) 守卫（纯函数，不需要网络/uv）：集合与版本必须零漂移
pwsh -NoProfile -File scripts/tests/Test-PythonRuntimeGuard.ps1
```

`--universal` 与 `--python-version 3.11` 不是可选项：一份锁要覆盖 3.11–3.13 与三个平台，
PEP 508 标记（例如 uvloop 的 `sys_platform != 'win32'`）必须原样保留；删掉标记等于把通用锁
变成平台专用锁，Linux 首次安装会直接失败。

**三条不变量，各有守卫**（全在 `scripts/tests/Test-PythonRuntimeGuard.ps1`，不靠人眼看）：

1. **锁可装**：每个 pin 都有 `--hash=sha256`；没有 `-r` 委托行（委托等于把选版本交回给
   解析器）；没有开发工具（`pytest*` / `ruff` / `pyright` / `playwright` …）。
2. **锁不漂移**：从开发锁的 `# via` 图 + `requirements.txt` 的根做可达闭包，包集合与同名版本
   必须与生产锁完全一致。反证方式：把锁里的某个版本改一位、或删掉一个包 →
   该测试立刻红并报出具体包名（`only in lock: [...] / only in projection: [...]`）→
   `git checkout -- backend/requirements.runtime.lock.txt` 恢复 → 复绿。
3. **首次安装只有一条路**：Part 4 逐个扫 `Build-PythonRuntime.ps1`、`ResumeForge.Process.ps1`、
   `Update-ResumeForge.ps1`、`scripts/{macos,linux}/{start,update}.sh`，要求 `--require-hashes`
   在场、顶层 `-r …requirements.txt` 不在场、且确实引用了生产锁。shell 侧另有
   `scripts/tests/test-{macos,linux}-launcher.sh` 断言锁的可用性判定与路径拼接。

**缓存键是锁的内容哈希**：`python-runtime.zip` 里盖的 manifest（schema 2）存的是
`requirements.runtime.lock.txt` 的 SHA-256——不是文件名，也不是时间戳。因此"锁重新解析、
`requirements.txt` 一个字没动"也会判 Stale 并重建；schema 1 的缺陷正在这里（它哈希
`requirements.txt`，于是换掉整套包仍然算"最新"）。manifest 缺 `runtimeLockSha256` 字段
（手工改过、旧写入器漏写、空串）一律按过期重建，绝不当成"当前运行时"复用。

**发布包与更新器**：`Build-Release.ps1` 的 `$RequiredFiles` 列了它，`scripts/linux/update.sh`
的 `rf_is_program_path` 白名单与更新前备份清单也列了它——缺了它的发布包在解压验证那一步
就红，而不是等用户首次安装时报"找不到锁"。

**路径拼接**：`Get-RuntimeLockPath -BackendDirectory <backend>`（PowerShell）与
`rf_runtime_lock_path <backend>`（bash）都只做"backend 目录 + 文件名"，锁文件名常量本身不含
目录前缀。两侧都有断言守着：这条错过一次（按"项目根"拼接，拼成 `backend/backend/...`），
表现是首次安装直接死在"找不到锁"。

### 4.6 文档生命周期

文档漂移不是写作问题，是**没有生命周期**：没人知道一篇文档上次核实是什么时候、多久该再看、
过期了归谁处置。所以 `docs/` 下每篇 `.md` 都在 [`doc-registry.json`](doc-registry.json) 登记一行，
由 `scripts/check_docs_registry.py` 守着。索引页 [`README.md`](README.md) **由登记表生成，不要手改**。

| 状态 | 含义 | 硬约束 | 到期后 |
|---|---|---|---|
| `current` | 必须与当前代码一致 | 有 `tier`：A=90 天 / B=180 天（按改动频率分档，用户照着操作的进 A，架构规范进 B） | 报错，逼着复核 |
| `historical` | 过程记录，不保证与现状一致 | 开头前 15 行必须有 `> **历史…**` 横幅；有 `retire_by` | 报错，逼着处置 |
| `record` | 不可变记录（ADR、实测快照） | 只增不改；被推翻的决策在原处留「后续修订」 | 不设到期 |

**四条命令**（都只读，除了 `--review` 与 `--write-index`）：

```bash
python scripts/check_docs_registry.py                    # 全量校验：覆盖、时效、路径、索引
python scripts/check_docs_registry.py --review docs/x.md  # 核实完登记「今天看过」
python scripts/check_docs_registry.py --write-index       # 重新生成 docs/README.md
python scripts/check_docs_registry.py --drift origin/main # 改了覆盖的代码但没改文档
```

**新增一篇文档**：写文件 → 登记表加一行（`status` / `tier` / `note`）→ `--write-index`。
`note` 不是摘要，要写「这篇为什么还在、什么时候该回看」——半年后靠它判断该更新还是该归档。

**归档（不是删除）**：移到 `docs-archive/`（**该目录不进 RAG 索引**，`assistant_docs` 只扫 `docs/`）→
开头补 `> **历史…**` 横幅 → 登记表里从 `docs` 挪到 `archived`（写 `reason` 与 `replaced_by`）→
`--write-index`。git 保留历史，读者拿到的是「这里有一条明确的路」而不是「404」。

**漂移提醒怎么读**：`[DRIFT] docs/maintenance.md ← scripts/` 表示这次改动碰了该文档登记的
`pairs`（覆盖路径），但没改文档。两条出口：① 回看并更新；② 在 PR 里写一句「为什么不用改」。
它**只提醒、不阻断**——文档类检查一旦阻断，第一个 deadline 就会被加 `continue-on-error` 或删掉，
那时连提醒都没有了。反过来，时效与索引是**硬失败**：它们不依赖判断，只依赖日期与一致性。

判据取舍：能自动判的（存在性、一致性、日期）一律硬失败；需要人判断的（写得对不对、该不该留）
只做提醒 + 到期强制决策。这也是为什么 `pairs` 只登记**主要落点**，不追求全覆盖——
登记太细会让漂移提醒变成噪声，噪声一定被无视。

## 5. 本机环境已知坑（速查）

| 现象 | 原因 | 处理 |
|---|---|---|
| pytest 全量卡在半路 / `INTERNALERROR` | 沙箱回收子进程 | 用相关子集 + 静态检查定位；交付判定改走 §2③ 的 `coverage run --rcfile` 绕开路径 |
| vitest 报 "Worker forks emitted error" | 同上 | FAIL=0 即可信，别当代码问题 |
| `vite build` exit 1（清 dist 被拦） | 沙箱批量删除守卫 | `--outDir D:\rf_build_tmp --emptyOutDir` |
| PowerShell 工具拿不到 stdout | 环境限制 | 重定向到文件再读 |
| 删除文件被拦 | 沙箱删除守卫 | python ctypes 调 `SHFileOperationW`（进回收站） |

### 5.1 并行、覆盖率与构建的细节（改这块配置前看）

这一节从 `AGENTS.md` 下沉而来：AGENTS 只留判据，现象与命令放这里。

- **`[tool.coverage.run] parallel = true` 是必需的**。否则每个 worker 抢写同一个 `.coverage` 文件，会在**所有用例都通过之后**的收尾阶段抛 `attempt to write a readonly database`——最坏的一类失败位置（看起来像测试挂了，其实是覆盖率写盘冲突）。
- **退出码不能单独作为判据**。本机沙箱的 `sitecustomize.py` 包装了 `shutil.rmtree`，pytest 清理临时目录时触发"批量删除守卫"并 `SystemExit(1)`：worker 猝死、xdist 控制器抛 `INTERNALERROR ... KeyError: <WorkerController>`，而**汇总行仍是 `N passed, 0 failed`**，覆盖率那一步却没跑到。串行也不安全——`pytest-cov` 收尾的 `cov.combine()` 删 `.coverage.*` 时同样会命中守卫，退出码 3、覆盖率报告整段跳过。**判据是"汇总行 + 覆盖率报告都正常打印"**，不是退出码。
- **coverage 只从 cwd 找配置**（`.coveragerc` / `pyproject.toml`），不会向上层目录搜索。在 `backend/` 下裸跑会把 `tests/` 一起统计：2026-10-10 实测假 41% vs 真 86%。必须显式 `--rcfile=..\pyproject.toml`，并走"run → combine → report"三段式。
- **覆盖率与并行不能写进同一条命令**（2026-10-27 实测）：worker 是子进程，plain `coverage run` 追不到，`combine` 出来 28%（真值 88%），`--fail-under=80` 直接红。要覆盖率就串行，要速度就并行但别开 coverage。
- **`vite build` 在本机沙箱下 exit 1 不是构建错误**：模块已全部 transform 成功，死在清理 `frontend/dist/assets` 时被批量删除守卫拦下（日志形如 `SAFE_DELETE_BULK_CONFIRM_REQUIRED count=170 threshold=100`）。指定仓库外输出目录即可：`pnpm exec vite build --outDir D:\rf_build_tmp --emptyOutDir`。
- **webform canary 只在有可控 CDP 浏览器时有意义**：并行跑与 CI 下按契约恒 skip，它不是 CI 门禁；也别指向日常浏览器窗口（会互相抢标签页）。一次性跑法：`python runtime/investigation/phase5/canary-local.py`（默认 9344，`--port` 可改；脚本是本地证据工具，不进源码）。
- **测试的等待预算分两档**：期望**超时**的用例预算越小越快；期望**成功**的用例就绪即返回，预算只是安全网。2026-09-23 修过一处——两类共用 `timeout=0.02`，于是"成功"用例的成败取决于真实墙钟，单跑必过、`-n auto` 下偶发失败。判断标准：**用例的成败是否取决于"等了多久"**，是就不该用个位数毫秒。

## 6. 方法论索引（改代码之前/之后各看哪篇）

| 场景 | 看哪篇 |
|---|---|
| 要证明"真的改好了"、判断测试是否假绿 | [验证手册](verification-playbook.md) |
| 把一批任务交给别人/AI 执行，或需要交接、续跑 | [协作规程](ai-collaboration-sop.md) |
| 提 issue、写验收、code review 时对照缺陷类型 | [缺陷模式](defect-patterns.md) |
| "代码改了但界面/接口没变" | [环境排查](troubleshooting-stale-build.md) |
| 文档里不能出现密钥/手机号/家目录 | `python scripts/check_docs_pii.py`（CI 的 `docs-guards` 作业） |
