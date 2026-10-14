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

## 修订（2026-10-14，RR-02 / RR-06 复验修复）

迁移已实现（见 CHANGELOG「桌面端 payload 旧数据迁移」），本次复验又修掉四处会真正伤到用户的地方：

1. **备份位置**：原实现的备份落在旧数据目录旁（`<old>/data.pre-migration-<ts>`），也就是**安装目录内**——而"旧位置只读"恰恰是需要迁移的典型场景，备份先失败再继续启动。现在备份固定在用户数据树下的 `<用户数据目录>/../backups/pre-migration-<ts>/`（名字冲突自动加序号，绝不覆盖旧备份）。ADR 原文 §2 写的 `%APPDATA%\ResumeForge\migration-backup-<ts>` 就是这一处，落地名字按新位置统一。
2. **一致的数据库快照**：原先整份复制活目录（含 `-wal`/`-shm`），在"另一个实例正在写"时是撕裂拷贝。现在库文件走 SQLite 一致快照（`node:sqlite` 的 `VACUUM INTO`，已提交但未 checkpoint 的 WAL 帧一并进入快照），边车**不再拷贝**（把陈旧 `-wal` 回放到新快照正是数据库损坏的成因），快照以 `PRAGMA quick_check` 复核；非 SQLite 文件仍逐字节复制并按 SHA-256 复核。
3. **标记与库不一致时 fail-closed**：`migrated.json` 还在但数据库不见时不再"skip"（那会让应用在曾经有数据的目录里静默新建空库）。旧位置仍有数据 → 重新弹窗询问；两处都没有 → 弹恢复对话框（先去恢复备份 / 显式选择创建全新数据库），选项前不启动后端。
4. **清理与停机**：临时目录只凭时间戳不再可删——必须带本次迁移写入的来源标记（`.rf-migrating.json`），否则拒绝并保留；桌面壳停止后端改为**先核验进程身份**（`desktop/lib/process-identity.js`：PID + 命令行 + 启动时刻签名，与启动器同一套证据），未确证就不停进程、并**阻止更新安装**（详见 CHANGELOG 的 RR-02 条目）。原策略里"等下一个大版本再清理旧目录"不变。

## 修订（2026-10-14 晚，1.0.0 发布前的安装升级演练）

对**已发布的 0.18.0 安装包**做隔离升级演练（虚构数据）暴露了一个"迁移流程够不到"的缺口：
本 ADR 的迁移只在新壳首次启动时运行，而 NSIS 原地升级会**先执行旧版卸载器**
（`/S /KEEP_APP_DATA --updated`）——它把整个安装目录搬进 `$PLUGINSDIR\old-install` 再删除，
装在 payload 里的用户数据在迁移代码有机会运行之前就已消失。演练实测：升级安装完成、
首次启动之前 `resources\payload\backend\data\resume_forge.db` 已不存在；首启在用户目录
静默新建一份空库（无弹窗、无标记），岗位/资料/附件/备份全部丢失。这正是 §背景 风险 1
（"更新丢数据"）的实态，只是它发生在迁移链的**上游**。

两处修复：

1. **安装器侧抢救（`desktop/nsis/legacy-data-rescue.nsh`，`nsis.include` 接入）**：
   `customInit`（`.onInit`，早于对旧卸载器的调用）把 `<旧安装目录>\resources\payload\backend\data`
   递归复制到 `$PLUGINSDIR\payload-legacy-rescue\data` 并**逐文件比对字节数**；
   `customInstall`（安装段末尾、新 payload 已就位）再复制回**新** payload 的同名路径，
   交给上面这套既有迁移流程。判据只用**安装目录内的文件**：旧位置没有 `resume_forge.db`、
   或旧位置带应用写入的 `migrated-away.json`（迁移成功后由 `lib/data-migration.js` 写入，
   见下）→ 整体空转。安装器不去猜应用的 userData 路径——`%APPDATA%` 下的库可能属于同机
   另一套安装（2026-10-14 演练就这样误跳过一次抢救），桌面壳还支持 `--user-data-dir`。
   其余规则：应用仍在运行 → 最多等 60 秒，超时**中止安装**（复制运行中的 SQLite 库是撕裂
   拷贝）；复制校验失败 → 中止安装并保留旧数据原样；放回失败 → 副本保留到
   `%APPDATA%\ResumeForge\payload-legacy-rescue\` 并弹窗告知；目标已有库时绝不覆盖。
   安装器**不替用户做迁移决定**——确认弹窗、备份、快照、校验、标记仍全部由应用的迁移流程
   执行。守卫测试：`desktop/scripts/test-nsis-rescue.js`。
2. **浏览器登录态目录跟随 `DATA_DIR`**：`services/browser/browser_manager.py` 与
   `services/webform/browser.py` 原先把 `BACKEND_DIR/"data"/...` 硬编码为 profile 目录——
   打包形态下就是安装目录内，既违反本节"用户数据永远不落 payload"的核心不变量，又会在
   每次 NSIS 升级时被删。改为 `DATA_DIR/<profile>`（未设 `RF_DATA_DIR` 时与从前逐字节一致；
   迁移时随整份数据目录一起搬进用户目录并被继续使用）。测试：`backend/tests/test_data_dir_env.py`、
   `test_apply_browser_manager.py`。

演练证据：按 `docs/upgrading.md` 的"保留哪些文件"整目录口径比对升级前后（逐文件 SHA-256 +
逐表逐列摘要 + 迁移标记/迁移前备份断言），见 `deliverables/` 的 1.0 升级验证报告；
未含本修复的对照构建走同一流程时**数据全失**（首启空库、无弹窗）。
