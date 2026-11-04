# legacy-1x 测试夹具（冻结的 1.x 备份包）

本目录冻结一份**真实 1.x 形态**的备份包，供 2.0 改造后的测试当"旧库样本"用：

- 旧库的 schema 只有 46 张应用表（1.0.2 已发行版本的最终结构）；
- 备份包本身由 **v1.0.2 的旧代码**导出，清单与包内库自洽。

**这不是用户数据**：隔离数据目录是从空库迁出来的，所有业务表都是 0 行。

## 文件

| 文件 | 说明 |
| --- | --- |
| `backup-1.0.2.zip` | 真实 1.0.2 导出的备份包（14 KB） |

## 包内验收事实

- 成员：`resume_forge.db`、`manifest.json`（无其它成员）。
- `manifest.json`：`format` 是 **int 1**、`api_key_included` 是 **bool false**、
  `app_version` 为 `"1.0.2"`、`alembic_revision` 为 `"0046_search_fts"`、
  `tables` 段是 46 个键（全部 0）。
- `resume_forge.db`：`alembic_version` 恰为 `0046_search_fts`；
  `sqlite_master` 里共 87 张表 = 46 张应用表 + `alembic_version` + 40 张 FTS5
  虚拟/影子表（`knowledge_fts` 系 5 张、`search_fts_*` 系 35 张）；
  `PRAGMA quick_check` 为 `ok`。
- zip 的 SHA-256：`279389efd2f7aaeed540212b3a5b8c034f3f6a33bf6d91ff6c8aeb8a459ed2b5`。

自检命令（在 `backend` 目录下执行）：

```powershell
.venv\Scripts\python.exe -c "import json, pathlib, sqlite3, tempfile, zipfile; z=zipfile.ZipFile('tests/fixtures/legacy-1x/backup-1.0.2.zip'); m=json.loads(z.read('manifest.json')); print(type(m['format']).__name__, m['format'], m['api_key_included'], m['alembic_revision']); d=pathlib.Path(tempfile.mkdtemp()); p=d/'resume_forge.db'; p.write_bytes(z.read('resume_forge.db')); c=sqlite3.connect(p); print(c.execute('SELECT version_num FROM alembic_version').fetchall(), c.execute('PRAGMA quick_check').fetchall())"
```

## 冻结的内容与用途

- 46 表旧库：`alembic_version=0046_search_fts`、46 张应用表全部为空。
  T04 `startup_gate` / T05 备份拒收 / T11 场景矩阵把它们从 zip 里解出来当
  "1.x 用户数据目录"的库样本（备份包负责携带旧库，仓库里不另存裸 `.db`）。
- 1.x 备份包：T05 用整包断言 `inspect_archive` 明确拒收，并提示用 1.0.2 打开。
- 解出来的库只读使用；除非用例本身在验证迁移/归档，否则不要对它跑 2.0 的迁移链。

## 再生成步骤

依赖：Windows + Git Bash；使用仓库已有的 `backend/.venv`（旧 tag 与当前依赖兼容）。
整个流程在隔离目录里跑，**不碰** `D:/ResumeForge/backend/data`。

1. 检出 v1.0.2 的临时 worktree：

   ```bash
   cd D:/ResumeForge
   git worktree add --detach D:/rf_pre20_tmp v1.0.2
   mkdir -p D:/rf_pre20_artifacts/data
   ```

2. 用旧代码把**空库**迁到 1.0.2 的 head。v1.0.2 的迁移链 head 就是
   `0046_search_fts`，所以 `upgrade head` 直接得到 46 表旧库：

   ```bash
   cd D:/rf_pre20_tmp/backend
   PYTHONUTF8=1 \
     DATABASE_URL='sqlite:///D:/rf_pre20_artifacts/data/resume_forge.db' \
     RF_DATA_DIR='D:/rf_pre20_artifacts/data' \
     LOG_FILE_ENABLED=false \
     D:/ResumeForge/backend/.venv/Scripts/python.exe -m alembic -c alembic.ini upgrade head
   ```

3. 用 **v1.0.2 的**导出代码在隔离数据目录上生成备份包（`include_api_keys=False`）：

   ```python
   # 在 D:/rf_pre20_tmp/backend 下执行，PYTHONPATH 指向该 worktree 的 backend
   from pathlib import Path
   from app.database import build_engine
   from app.services.data_backup.export import create_backup_archive

   engine = build_engine("sqlite:///D:/rf_pre20_artifacts/data/resume_forge.db")
   try:
       archive = create_backup_archive(
           engine, Path("D:/rf_pre20_artifacts/staging"), include_api_keys=False
       )
   finally:
       engine.dispose()
   print(archive)
   ```

4. 把产物改名复制到本目录，并复核上面"包内验收事实"：

   ```bash
   cp D:/rf_pre20_artifacts/staging/resumeforge-backup-*.zip \
     D:/ResumeForge/backend/tests/fixtures/legacy-1x/backup-1.0.2.zip
   ```

5. 清理临时 worktree，确认主工作树不受影响：

   ```bash
   cd D:/ResumeForge
   git worktree remove --force D:/rf_pre20_tmp
   git worktree list
   ```

## 为什么包里没有全局模型配置 / 字体

任务书最初提到导出时 `include_global_llm=True`、`include_global_assets=True`，但
这两个开关与备份格式 5/6 是 **v1.0.2 之后、2.0 之前未发布代码**才引入的；v1.0.2 的
`create_backup_archive` 没有这两个参数，1.0.2 导出里也不存在这两类成员。

隔离数据目录里没有 `global_llm.json` 与 `fonts/`，即使拿带这两个开关的代码去导出，
产物也不会多出成员、`format` 仍为 1（格式号按内容分级，不虚升）。所以这份夹具保持
1.0.2 的真实形态：`format=1`、只有 `resume_forge.db` 与 `manifest.json`。

同理，**不要用当前（2.0）代码重新导出这个夹具**：当前代码的 `current_head_revision`
会写 2.0 的 head，而包内库仍是 0046，清单与实际库不自洽，导入校验会先报"清单与实际
数据库内容不一致"，而不是测试想验证的 1.x 拒收。
