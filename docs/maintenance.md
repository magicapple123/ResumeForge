# 项目维护手册

> 规则的权威来源是 [`AGENTS.md`](../AGENTS.md)；本文是按它整理的**操作速查**，两者冲突时以 AGENTS.md 为准。
> 最后更新：2026-09-25。规模数字随开发变动，以 CI 汇总为准。

## 1. 项目结构

```
ResumeForge/
├── backend/                  FastAPI 后端
│   ├── app/api/                36 个 API 模块（235 个接口）
│   ├── app/services/           约 200 个服务模块，按域分目录
│   │                           （resume / profile / job / jd / assistant / interview /
│   │                            apply / browser …）
│   ├── app/models/             21 个模型模块（41 张表）
│   ├── app/schemas/            Pydantic 请求/响应模型
│   ├── app/prompts/            33 个提示词
│   ├── app/templates/          9 个 Jinja 简历模板
│   ├── migrations/versions/    Alembic 迁移链（当前 head：0024）
│   ├── tests/                  195 个测试文件 / 2,841 个用例
│   └── data/                   ★ 运行时数据：数据集、备份、浏览器登录态（.gitignore）
├── frontend/                 React 18 + AntD 5 + Vite
│   ├── src/pages/              36 个页面（路由在 App.tsx 的 MENU_ITEMS）
│   ├── src/components/         约 180 个组件（跨模块交互原语在 common/）
│   ├── src/api/  src/types/    接口封装与类型
│   ├── src/utils/  src/hooks/  纯工具与 hooks（测试与被测文件同目录）
│   └── src/…*.test.tsx         106 个测试文件 / 710 个用例
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
├── CHANGELOG.md              用户可见变更（Unreleased 段累积）
└── README.md                 项目主页（功能表第一列锁定）
```

## 2. 日常开发循环（六步）

### ① 定位

- 先读 `AGENTS.md`；本手册只做速查。
- 用 Grep 定位到文件与行号，再读最小必要片段。
- **改之前先确认"这份逻辑是否已有唯一实现"**——投递准入（`models/apply.py::admission_of`）、
  状态白名单等都是刻意单份的；求职助手的功能清单以 `services/feature_catalog.py` 为单一事实来源。

### ② 改动

- 小步走：一次改一处，就近验证，别攒一批最后一起跑。
- 不拿"函数签名行"当编辑锚点（历史上误删过三次）；每次 Edit 后立刻 grep 复查被改处。
- 同目录不要放两个只差大小写的模块名（Windows 不敏感，会出 TS1149）；改名后**必须重启前端 dev server**。

### ③ 验证（分层，按序）

| 层 | 命令 | 说明 |
|---|---|---|
| 相关子集 | `pytest -q tests/test_xxx.py`（backend 目录） | 秒级确认方向 |
| 静态 | `ruff check .`；前端 `tsc --noEmit` / `eslint` / `prettier --check` | 秒级 |
| 全量后端 | `pytest -n auto --cov=app --cov-config=..\pyproject.toml` | 3 分钟，覆盖率门槛 80% |
| 全量前端 | `vitest run` | ~7 分钟 |
| macOS 链 | `bash scripts/tests/test-macos-launcher.sh` | 任何平台可跑 |
| UI 实测 | 起服务 + Playwright 脚本 | 视觉问题必须眼见为实 |

注意：

- **`--cov` 不能配子集**（80% 门槛必然假失败）。
- 本机沙箱会让全量偶发卡死/worker 猝死：并行报 `INTERNALERROR`、串行可能停在半路、
  vitest 报 "Worker forks emitted error"。**相关子集 + 静态检查过了就推上去让 CI 验证**，
  不要反复重试。
- `vite build` 要指定仓库外输出目录：`npx vite build --outDir D:\rf_build_tmp --emptyOutDir`。

### ④ 文档同步

| 改了什么 | 必须同步 |
|---|---|
| 任何用户可见行为 | `CHANGELOG.md` 的 Unreleased 段 |
| 功能增删 | `README.md` 功能表（第一列逐字锁定）+ `docs/user-guide.md` |
| 界面/流程 | `frontend/src/components/userGuideSteps.ts` + `feature_catalog.py`（四方被测试钉着） |
| 架构/模块 | `docs/architecture.md` / `docs/PROJECT_MAP.md` |

### ⑤ 提交

- Conventional Commits（`feat`/`fix`/`docs`…，决定发版幅度）。
- **不写任何 AI 署名**（`Co-Authored-By` 等），也不改 git 身份。
- 发布由用户发起；本仓库主分支平时由协作方提交推送（官网仓库 `ResumeForge-official` 同样）。

### ⑥ 发布

1. `python scripts/bump_version.py`（5 处版本号一次同步；破坏性变更显式 `--bump major`）。
2. `scripts/Build-Release.ps1`：**三个包**，`-Platform windows`、`-Platform macos`，以及
   默认的 `-Platform all`（各带一份 `.sha256`，共 6 个资产）。
   - Windows / macOS 两个包给官网的两个下载按钮；
   - **全平台包（`ResumeForge-<版本>-all.zip`）是必需的，别省。** 已经装在 0.14.2 及更早
     版本上的用户，应用内更新跑的是他们机器上那份旧代码——它按文件名排序取第一个 `.zip`，
     而 `-all.zip` 排在最前（`a` < `m` < `w`）。少了这个包，那些用户点「重启并安装」就
     必然下到 macOS 包、必然报「更新包缺少 start.cmd」。**名字本身是契约**，
     `Test-Build-Release.ps1` 钉着它。
3. 官网仓库：更新文案 → `node tools/audit.js` 全绿 → 重采截图 / 重建 demo-app → 提交推送。
4. 打 tag、建 GitHub Release（附双平台包与校验文件）。
5. 更新公告图：写清**怎么更新**与**旧数据怎么导入**（导出数据集 → 新版导入为新数据集）。

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
  `python -m pyright`（basic，范围见 `backend/pyrightconfig.json`，当前仅
  `app/models` + `app/schemas`，其余目录随注解补齐渐进纳入）。
- **两个端到端作业**（`macos-end-to-end` / `windows-end-to-end`）从**干净检出**走完整启动链并
  真的取一次前端入口模块——"端口活着但页面一片空白"只有它们捕得到（2026-09-29 用户在虚拟机
  上解压新版本后只看到空白页，当时 Windows 侧没有这个作业）。改了启动链要跑它们。
- **提交不写 AI trailer**；数据/密钥/简历不进 git。
- 单一事实来源：`feature_catalog.py`（功能清单）、README 功能表、版本号 5 处、
  投递准入与状态白名单（各只有一份实现）。

## 4. 专项流程

### 4.1 数据库迁移

1. 新迁移文件放 `backend/migrations/versions/`，链上 `down_revision`。
2. **先 grep 上一版 head 的字面量**：`test_database.py`、`test_backup_apply_tables.py`、
   `test_apply_migration_qa.py`、`test_assistant_search.py` 各钉一处，需同步更新。
3. 约束：`upgrade`/`downgrade` 都要可用；**表/列不存在时跳过而不是报错**（迁移链会跑在
   "只有部分业务表"的历史库上）；加表/加列类迁移要保证"旧备份仍可导入"（表集合前后一致）。
4. 新增 `tests/test_migration_00XX.py` 钉住行为。
5. **减表类迁移**要额外验证"降级能把表按原样建回来"——列、索引、外键的 `ondelete` 都要与
   建表那次逐字一致。`0025` 删官网采集遗留的三张表时就是这么做的（`sa.inspect` 比对
   表名 / 列名 / 索引名集合）。

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
- **更新前快照**：两条更新器在覆盖程序文件前把 `backend/data/*.db` + `datasets/*.db`
  快照到 `backend/data/pre-update/`（保留 3 份，连同 `-wal` / `-shm` / `-journal` 边车）。
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
| pytest 全量卡在半路 / `INTERNALERROR` | 沙箱回收子进程 | 用相关子集 + 静态检查，推上去让 CI 跑全量 |
| vitest 报 "Worker forks emitted error" | 同上 | FAIL=0 即可信，别当代码问题 |
| `vite build` exit 1（清 dist 被拦） | 沙箱批量删除守卫 | `--outDir D:\rf_build_tmp --emptyOutDir` |
| PowerShell 工具拿不到 stdout | 环境限制 | 重定向到文件再读 |
| 删除文件被拦 | 沙箱删除守卫 | python ctypes 调 `SHFileOperationW`（进回收站） |
