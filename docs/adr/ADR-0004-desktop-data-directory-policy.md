# ADR-0004: 桌面端五类路径的固定策略（程序目录 / 用户数据 / 日志 / 运行时 / 缓存）

- 状态：Accepted（2026-10-13，2026-10-13 生产审计 PR-05）
- 关联：`desktop/backend-manager.js`、`desktop/main.js`、`backend/app/config.py`（`RF_DATA_DIR`）、`docs/desktop-supply-chain-audit.md`（PR-06 供应链基线）

## 背景

2026-10-13 生产审计（PR-05，问题 C/V-2）指出：桌面打包形态下，backend 的数据目录默认解析自
`backend/app/config.py` 的 `DATA_DIR = BACKEND_DIR / "data"`，而 `BACKEND_DIR` 位于安装目录内的
`resources/payload/backend`。也就是说**用户的数据库、附件、导出和备份默认写在安装目录里**，带来两类风险：

1. **更新丢数据**：更新安装器替换安装目录时，payload（含旧数据库）会被整体覆盖/删除；
2. **只读不可写**：安装到受保护目录（或企业策略下的 Program Files）时，SQLite 建库/写 WAL 直接失败。

同时审计要求把桌面端涉及的全部落盘路径一次性定清楚，避免"runtimeDir 在 LOCALAPPDATA 不代表数据库也在那里"
这类隐式假设继续存在。

## 决策：五类路径的固定策略

| 类别 | 固定位置（Windows） | 依据 / 说明 |
| --- | --- | --- |
| 程序目录（app） | 安装目录（NSIS 默认 `%LOCALAPPDATA%\Programs\ResumeForge`，assisted 安装器允许用户自选） | electron-builder `perMachine: false`，每用户安装；目录随更新被整体替换，**绝不放任何用户产物** |
| 用户数据（数据库 / 附件 / 导出 / 备份 / 提示词产物） | `%APPDATA%\ResumeForge\data\`（即 Electron `app.getPath("userData")` 下的 `data/` 子目录） | 跟随用户漫游配置、安装目录替换不影响、普通用户必然可写。实现见下文"落地方式" |
| 运行时（解包的 Python + site-packages） | `%LOCALAPPDATA%\ResumeForge\runtime\`（现状保留） | 与安装目录解耦，安装器 / 便携版可共享；由 `.runtime-complete` 版本化 marker 管理（审计 PR-05-5 的修复，同轮落地） |
| 日志 | `resources/payload/runtime/logs/`（现状保留，计划项见"遗留"） | 每用户安装下 payload 可写，因此现状可用；后端自身另有 5MB×5 滚动文件日志，`desktop-backend.log` 由 BackendManager 轮转（>5MB 移入 `.old`） |
| 缓存（Electron 渲染缓存等） | `%APPDATA%\ResumeForge\Cache` 等（Electron `userData` 默认行为，现状保留） | Electron 默认即落在用户目录，无需改动 |

**核心不变量：用户数据永远不落 `resources/payload`。**

## 落地方式（最小改动）

1. **`backend/app/config.py`**：`DATA_DIR` 支持 `RF_DATA_DIR` 环境变量覆盖——
   设置了 `RF_DATA_DIR` 时数据目录取该值，`DEFAULT_DATABASE_URL` 随之推导；未设置时行为与从前逐字节一致
   （`backend/data`），控制台流程、开发流程、既有测试全部不受影响。
2. **`desktop/backend-manager.js`**：新增 `buildBackendEnv(userDataDir)`——构造后端子进程环境时注入
   `RF_DATA_DIR=<用户数据目录>`（连同父环境一起传给 bundled / launcher / venv 三个分支）。config 层的
   解析顺序（环境变量 > 默认值）不变，我们只是把值送进去。
3. **`desktop/main.js`**：打包模式（`app.isPackaged`）下创建 BackendManager 时传
   `userDataDir = <userData>/data`；**开发树不传**，保持"开发数据在仓库 `backend/data`"的既有约定。

## 旧数据迁移策略（本轮不做，显式留给后续版本）

已按旧默认把数据库写进 payload 的安装（2026-10-12 分发的构建）里存在历史用户数据。**本轮不做自动搬迁**，
理由：数据迁移引入的"搬迁中途失败 / 部分搬迁 / 双库并存"风险大于收益，且需要用户可见的确认流程。
后续版本实现时必须遵循：

1. **显式确认**：启动时检测到 payload 下存在旧库且用户数据目录为空，弹窗说明将迁移什么、迁到哪里，
   经用户同意后才执行；用户拒绝则继续用旧库并再次提示（不静默）。
2. **先备份**：迁移前把 payload 下的整个 `backend/data`（数据库 + 附件目录）原样复制到
   `%APPDATA%\ResumeForge\migration-backup-<时间戳>\`，校验文件数与字节数一致后才动手。
3. **迁移后校验**：数据库行数（关键表）、附件文件数、总字节数三重比对；任何不符都保留备份并把差异
   呈现给用户，绝不删除旧目录里的任何东西——旧 payload 目录只是被标记"已迁移"，等下一个大版本再清理。
4. **幂等**：迁移入口以"用户数据目录是否已有库"为判断依据，重跑不得产生第二次复制或覆盖。

## 后果

- 打包安装的数据库/附件/导出/备份全部落 `%APPDATA%\ResumeForge\data`，更新、重装、换安装目录都不再触碰用户数据。
- `desktop-shell-smoke` CI 作业的日志断言路径（payload 下 `runtime/logs/desktop-backend.log`）不受影响——
  日志本轮刻意保留原位，避免为文档性改动扩大爆炸半径；其搬迁作为遗留项登记。
- 后端配置层只多接受一个环境变量，既有环境变量/默认值顺序未变，向后兼容。
- 旧数据（payload 下的库）在新版本下**不会**被自动读取或搬迁；受影响用户需等迁移版本（或手动复制）。
  这是有意的保守选择，已在上方写明后续方案的硬性要求。
