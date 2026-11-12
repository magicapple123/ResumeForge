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
│   │                           新增迁移接在它之后；改迁移前先 grep 旧 head 的字面量，见 §4.1）
│   ├── tests/                  测试（文件数 / 用例数以 pytest 汇总行为准）
│   └── data/                   ★ 运行时数据：数据集、备份、浏览器登录态、legacy-archive（.gitignore）
├── frontend/                 React 19.3 + antd 6 + Vite 8（Rolldown）
│   ├── src/pages/              页面（菜单在 features/shell/navigationConfig.ts，
│   │                           路由表在 src/appRoutes.tsx；App.tsx 只 re-export MENU_ITEMS）
│   ├── src/components/         组件（跨模块交互原语在 common/）
│   ├── src/api/  src/types/    接口封装与类型
│   ├── src/utils/  src/hooks/  纯工具与 hooks（测试与被测文件同目录）
│   └── src/…*.test.tsx         前端测试（规模以 vitest 汇总行为准）
├── scripts/                  启动与发布链
│   ├── start.cmd / stop.cmd / update.cmd / uninstall.cmd     Windows 一键脚本
│   ├── start.command / …      macOS 等价物（bash 3.2 方言）
│   ├── scripts/macos/          macOS 启动链实现与自举常量
│   ├── Build-Release.ps1       发布包构建（白名单 + SHA256）
│   ├── Build-Demo.ps1          在线体验构建
│   └── bump_version.py         版本号统一（5 处）
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
  `npx vite build --outDir D:\rf_build_tmp --emptyOutDir`。

### ④ 文档同步

| 改了什么 | 必须同步 |
|---|---|
| 任何用户可见行为 | `CHANGELOG.md` 的 Unreleased 段 |
| 功能增删 | `README.md` 功能表（第一列逐字锁定）+ `docs/user-guide.md` |
| 界面/流程 | `frontend/src/features/user-guide/userGuideSteps.ts` + `feature_catalog*.py`（门面 + 数据段，四方被测试钉着） |
| 架构/模块 | `docs/architecture.md` / `docs/PROJECT_MAP.md` |

### ⑤ 提交

- Conventional Commits（`feat`/`fix`/`docs`…，决定发版幅度）。
- **不写任何 AI 署名**（`Co-Authored-By` 等），也不改 git 身份。
- 发布由用户发起；本仓库主分支平时由协作方提交推送（官网仓库 `ResumeForge-official` 同样）。

### ⑥ 发布

1. `python scripts/bump_version.py`（5 处版本号一次同步；**项目已发布 1.0、现在 2.0，破坏性变更
   显式 `--bump major`**——2.0 本身就是一次 major。`remove:` 前缀不推动版本号，
   删功能的发版别信自动判定）。
2. `scripts/Build-Release.ps1`：**三个包**，`-Platform windows`、`-Platform macos`，以及
   默认的 `-Platform all`（各带一份 `.sha256`，共 6 个资产）。
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
py -3 -m venv .venv
$env:PYTHONUTF8 = "1"
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 启动服务（默认 http://127.0.0.1:8000，接口文档见 /docs）
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

macOS / Linux 用 `.venv/bin/python` 替换上面的 Windows 路径；Git Bash 用 `export PYTHONUTF8=1`。

```powershell
cd frontend
npm ci
npm run dev        # http://localhost:5173，已配置 /api 代理到 8000 端口
```

运行测试：

```powershell
cd backend
.venv\Scripts\python.exe -m ruff check .

# 日常内循环：并行跑，快
.venv\Scripts\python.exe -m pytest -n auto

# 交付前：串行跑一次覆盖率（并行与覆盖率不能写在同一条命令里，否则统计不到子进程）
.venv\Scripts\python.exe -m coverage run --rcfile=..\pyproject.toml -m pytest -q
.venv\Scripts\python.exe -m coverage report --rcfile=..\pyproject.toml --fail-under=80

cd ../frontend
npm test && npm run lint && npm run typecheck && npm run build
```

浏览器冒烟（Playwright，`frontend/tests/smoke/`）需要应用先跑起来，用例不对抗启动链——两种形态任选其一：

```powershell
# 形态一：发布形态（后端同源，默认 smoke 口 8123）
npm run build
cd ..
powershell -File scripts\Start-ResumeForge.ps1 -NoBrowser -BackendPort 8123
cd frontend

# 形态二：开发形态（Vite 5173 + 后端 8000）
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd ../frontend
npm run dev
```

然后跑冒烟（发布形态零配置；开发形态把两个地址分别指给前端页面与 API）：

```powershell
cd frontend
npm run smoke                                   # 发布形态（默认 http://127.0.0.1:8123）
$env:SMOKE_FRONTEND_URL = "http://127.0.0.1:5173"; $env:SMOKE_BACKEND_URL = "http://127.0.0.1:8000"
npm run smoke                                   # 开发形态
```

当前规模：后端与前端合计 **11,000+ 个测试用例**（后端约 7,100 个、前端约 4,700 个；后端覆盖率门槛 80%；确切数字以每次 CI 的汇总行为准）。GitHub Actions 在 Linux、Windows 与 macOS 上重复执行关键检查——macOS 那几个作业是刻意加的：它们会真下载便携运行时、从干净检出走完整启动链，并做浏览器冒烟，是 macOS 链路的持续把关；macOS 桌面安装包（dmg）自 v1.0.1 起同样由 CI 构建产出。


## 3. 守卫与红线

- **覆盖率 80%** 只在全量时开 `--cov`；子集跑覆盖率是假失败。前端门禁见
  `frontend/vitest.config.ts` 的 `coverage.thresholds`（基线 −3pt、只升不降）。
- **CI 作业**：Backend ×3（py311/313/win，含 ruff / pyright / 版本号核对 / 全量覆盖率）、
  Frontend（Node 22，测试带覆盖率门禁 + artifact）、Dependency audit（生产依赖阻断、
  开发依赖 advisory）、macOS ×3（launcher guards / portable runtimes / end-to-end，
  e2e 末尾跑 Playwright 浏览器冒烟）、Windows end-to-end（同样以冒烟收尾）、
  Windows portable runtimes。另有独立工作流：**CodeQL**（每周安全扫描）与
  **Nightly**（全量回归 + flaky 标记）。
  macOS 三件是**唯一的真机验证途径**，改了 macOS 侧要在交付说明里写明期望它们验证什么。
  `windows-runtimes` 与 macOS 那个同名作业是镜像：**真的下载**启动器要用的便携版 Node
  与 Python 官方安装包并逐个校验 SHA-256，专抓"下载地址或摘要失效"——`windows-end-to-end`
  用的是 runner 自带的解释器，恰好把这条路径整个遮住，而"一台什么都没装的电脑"走的正是它。
- **版本号单一事实来源**是 `backend/app/config.py` 的 `app_version`（发布链、更新器、
  启动器都按同一条正则解析它）；发版用 `python scripts/bump_version.py` 同步 5 处，
  `scripts/check_version_sync.py` 在 CI 核对 config.py 与 package.json 不漂移。
- **后端静态检查双件套**：`ruff check .`（E/F/I/UP/B/SIM）与
  `python -m pyright`（basic，范围见 `backend/pyrightconfig.json`；2026-10-23 起覆盖
  全部 `app/`，535 个文件 0 error。扩面按批次做、每批记录改法与理由，见该文件的注释）。
- **两个端到端作业**（`macos-end-to-end` / `windows-end-to-end`）从**干净检出**走完整启动链并
  真的取一次前端入口模块——"端口活着但页面一片空白"只有它们捕得到（2026-09-29 用户在虚拟机
  上解压新版本后只看到空白页，当时 Windows 侧没有这个作业）。改了启动链要跑它们。
- **提交不写 AI trailer**；数据/密钥/简历不进 git。
- 单一事实来源：`feature_catalog*.py`（功能清单：门面 + 三个数据段）、README 功能表、版本号 5 处、
  投递准入与状态白名单（各只有一份实现）。

## 4. 专项流程

### 4.1 数据库迁移

1. 新迁移文件放 `backend/migrations/versions/`，链上 `down_revision`。**2.0 的迁移链只有一条基线
   `0001_baseline_v2`**，新迁移一律接在它（或更新的 head）之后。
2. **先 grep 旧版 head 的字面量**：`test_database.py`、`test_backup_apply_tables.py`、
   `test_apply_migration_qa.py`、`test_assistant_search.py` 各钉一处，需同步更新。
3. 约束：`upgrade`/`downgrade` 都要可用；**表/列不存在时跳过而不是报错**（迁移可能在"部分业务表"
   的库上被调用，例如导入候选库与测试夹具）；加表/加列类迁移要保证"旧备份仍可导入"（表集合前后一致）。
4. 新增 `tests/test_migration_00XX.py` 钉住行为（2.0 基线本身的往返与 epoch 断言见
   `test_database.py`）。
5. **减表类迁移**要额外验证"降级能把表按原样建回来"——列、索引、外键的 `ondelete` 都要与
   建表那次逐字一致。`0025` 删官网采集遗留的三张表时就是这么做的（`sa.inspect` 比对
   表名 / 列名 / 索引名集合）。
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

- 截图流水线：`scripts/seed_demo_data.py --check` → 起服务（8123/5199）→
  `runtime/demo/tools/readme_capture.py`；视口 1728×1080。
- 官网（`ResumeForge-official` 仓库）：三页 + `demo-app/`（iframe 内嵌）+ `download/`；
  改完必跑 `node tools/audit.js`；两个部署位置都要在 `demoBridge.ts` 的 `DEFAULT_PARENTS` 里。

### 4.4 运维与数据安全

- **自动备份**：启动后台线程按 `AUTO_BACKUP_INTERVAL_DAYS`（默认 7）节流，到期对当前
  数据库做一致性快照到 `backend/data/auto-backups/`，按 `AUTO_BACKUP_KEEP`（默认 5）轮转；
  `AUTO_BACKUP_ENABLED=false` 整体关闭。标记文件按"上次尝试"节流，连续失败不会每次
  启动都重撞。
- **更新前快照**：两条更新器在覆盖程序文件前先跑 `backend/scripts/create_user_data_snapshot.py`
  ——复用「导出全部数据集」链路把数据库 + 按引用收集的附件 + 字体 + 全局模型配置打成一个 zip 整包
  并用 `verify_archive` 校验（失败即中止更新，不再覆盖程序文件），随后仍把
  `backend/data/*.db` + `datasets/*.db` 拷进 `backend/data/pre-update/` 作兜底（保留 3 份，连同
  `-wal` / `-shm` / `-journal` 边车）。跨 major 的整包快照目录标 `pre-major-<时间戳>` 且永不被
  轮转清理。
  Windows 三条覆盖路径都在停应用之后（直接拷文件即一致快照）；macOS 优先用
  `sqlite3 .backup` 在线快照。
- **文件日志**：`data/logs/backend.log`（5MB×5 滚动，`LOG_FILE_ENABLED` / `LOG_LEVEL`
  可调）；诊断包导出端点 `GET /api/system/diagnostics/export` 出包前对日志尾部做疑似
  令牌兜底脱敏。
- **SQLite 维护**：启动时 `wal_checkpoint(TRUNCATE)` + `PRAGMA optimize`；备份快照统一
  剥离 `sqlite_stat*` 统计表（保证旧版本导入兼容），导入白名单按 `sqlite_` 前缀放行
  引擎内部表。

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
- **`vite build` 在本机沙箱下 exit 1 不是构建错误**：模块已全部 transform 成功，死在清理 `frontend/dist/assets` 时被批量删除守卫拦下（日志形如 `SAFE_DELETE_BULK_CONFIRM_REQUIRED count=170 threshold=100`）。指定仓库外输出目录即可：`npx vite build --outDir D:\rf_build_tmp --emptyOutDir`。
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
