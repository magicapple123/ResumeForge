# ADR-0003：备份包资产清单（per-dataset asset manifest）与存储统计作用域

日期：2026-10-13（生产审计 PR-15 / PR-16）
状态：已实施

## 背景

2026-10-13 生产审计发现两类问题：

**备份侧（PR-15）**：`create_backup_archive` 把"数据库同目录的 `user_files/`、
`referral_images/` **整目录**"装进包。这带来三个后果：

1. 多份导入数据集共用 `data/datasets/user_files/`——导出数据集 A 会把同目录里
   **数据集 B** 的附件一起带走（跨数据集隐私泄漏）；
2. "导出全部数据集"时，随包数据集只有 `.db` + `.json` 成员，**导入库位置的附件
   整体缺失**（换机器恢复后丢附件）；
3. 装包内容与数据库内容没有对应关系，恢复后无从校验"附件是否真的齐了"。

同时，自动备份轮转对淘汰快照直接 `unlink`，而手动备份的删除走可恢复的
`.trash`——同类操作两套语义；备份调度线程只抓 identity、不取租约，与数据集
切换/删除/恢复的并发互斥全靠巧合；前端"受保护"标签未注明其范围仅是数据库快照。

**统计侧（PR-16）**：`storage_overview` 在 `base == DATA_DIR` 时硬编码
`resume_forge.db`（自定义库名被统计成默认库）；`datasets/` 分项来自配置主库而
其余分项来自当前活动库父目录，激活导入库时口径漂移且**双重计数**（总计数 !=
分项之和）；应用级目录（browser-profile/captures/logs）被错误假设为随数据集
移动；每次统计全目录走两遍，无预算、无缓存。

## 决策

### 1. 资产清单：按数据库内容收集引用，不整目录拷贝

新增 `data_backup/asset_manifest.py`：

- **引用收集**：只读连接读两处权威来源——`user_file.disk_name`（"我的文件"
  落盘副本的登记表）与 `referral.note_images`（`referral_images/<文件名>` 相对
  路径）。表/列不存在按"没有引用"处理。
- **清单格式**（`manifest.json` 的 `asset_manifest` 段；随包数据集在其条目内
  同名字段）：

  ```json
  {
    "manifest_version": 1,
    "user_files": [{"name": "...", "size_bytes": 123, "sha256": "..."}],
    "referral_images": [...],
    "user_files_missing": ["磁盘上已找不到的被引用文件"]
  }
  ```

- **包内布局**：活动数据集沿用扁平前缀（`user_files/`、`referral_images/`，
  老版本可读）；随包数据集用 `datasets/<id>/<category>/<name>`——命名空间隔离，
  A 的附件进不了 B 的包。
- **恢复与验证**：导入按清单逐成员恢复（zip-slip 成员形状照旧拒收），**写完
  实际读回来**复核大小与 SHA-256；另按清单 `tables` 段复核恢复库的关键行数。
  任何缺失/不符都进导入结果的 `asset_issues` 列表，**绝不静默成功**。

### 2. 包格式号不升级，靠段内 `manifest_version`

决定**不**把 `BACKUP_FORMAT_VERSION` 从 3 升到 4。理由：老版本导入新包时，
DB 恢复完全正常，只是附件缺失——这与老版本本来就没有"随包数据集附件"能力的
基线一致，不会更差；升格式号会让所有老版本对一份本可（部分）安全恢复的包整体
拒收，收益不成比例。作为补偿，`asset_manifest` 段自带 `manifest_version`，
**当前版本**的导入侧对版本号不认识的包 fail-closed 拒收——将来清单结构再变时，
不会静默按旧形状误读。

### 3. 旧格式向后兼容

旧备份包（无 `asset_manifest` 段）走原有的"遍历扁平成员"恢复路径
（`restore_user_files` / `restore_referral_images`），行为不变。

### 4. 轮转走可恢复途径，无效候选例外

- 被轮转淘汰的快照（**曾经验证过的有效备份**）移入
  `auto-backups/<数据集>/.trash/`，与手动备份"删除 = 移入 `.trash`"统一；
  trash 只保留最近 5 份，防止无限膨胀——这是唯一允许对"曾经有效"的快照做
  永久删除的地方，且上限写进文档。
- **校验失败的候选快照**直接删除：它刚生成、从未有效，没有任何用户此前的状态
  可恢复；放进"可恢复 trash"只会让人误以为那是一份能用的备份。

### 5. 调度持真正的租约

`run_for_current_dataset` 改为 `dataset_scope.acquire_lease("auto-backup")`：
切换持锁期间取不到租约 → 整轮跳过；备份进行中持租约 → 切换的排空阶段会等到
归还。两个方向互斥，不再依赖巧合。备份引擎取**租约发布时刻**的身份，消除
"取身份与取引擎之间发生切换"的窗口。

### 6. 存储统计：单遍扫描 + 作用域标注 + 预算与缓存

- 统计根固定为**配置的数据目录**（`DATABASE_URL` 所在目录），不再随激活库漂移；
  每个分项标注 `dataset` / `shared` / `backup` / `application` 作用域，
  `uncategorized` 兜底项收集不属于任何已知分项的文件；
- 整棵目录**单遍扫描、按路径首段归类**：总计恒等于分项之和；数据库文件与边车
  单独 stat（不进目录扫描），自定义库名不再被硬编码顶掉；
- 应用级目录（browser-profile / captures / logs / pre-update / share_packages）
  锚定应用数据根，与各服务模块的真实落盘位置一致；
- 扫描预算（20 万文件 / 24 层深度）、权限失败计入 `warnings`、目录符号链接不
  深入、文件按 lstat 计（不跟随逃逸）；**继续只 stat 不读内容**；
- 60 秒短 TTL 缓存（键 = 统计根 + 当前库文件），`reset_storage_cache()` 可立即
  失效（测试夹具与"刚做完大动作"的场景用）。

## 后果

- 单数据集导出体积变小且不再携带其他数据集的附件；"导出全部数据集"的包
  变大（覆盖全部附件），但恢复后附件完整。
- 导入结果新增 `restored_assets` / `asset_issues` 字段（加法变更，前端兼容）。
- `/api/stats/storage` 的 items 新增 `scope` 字段与 `uncategorized`、
  `warnings`、口径修正后的 `total_*`（加法变更；分项 key 不变）。
- 轮转淘汰的快照会在 `.trash` 里多占最多 5 份的磁盘。
- 备份调度与用户切换数据集不再并发：切换会等最多一个快照周期（SQLite backup
  API 通常亚秒级），快照期间的切换请求按既有 409 语义提示稍候。

## 相关文件

`app/services/data_backup/{asset_manifest,export,manifest,paths,import_archive,
auto_backup,scheduler}.py`、`app/services/datasets.py`、
`app/services/storage_stats.py`、
`frontend/src/components/settings/BackupStatusCard.tsx`、
`backend/tests/test_backup_asset_manifest.py`、`backend/tests/test_storage_stats.py`。
