# ADR-0002：可信交付账本——revision / artifact / attempt 三态关联与幂等键

日期：2026-10-13（生产审计 PR-09）
状态：已采纳（最小增量方案）
关联：`backend/app/models/resume_delivery.py`、`backend/app/services/resume/resume_delivery.py`、迁移 `0045_delivery_ledger`

## 背景

审计（deliverables/ResumeForge-production-audit-2026-10-13.md PR-09）发现交付快照
（`resume_delivery_record`，RF-17）在五个口径上不可信：

1. 目的地（company/job_title）从**原简历**反推——通用简历投给 A 公司，快照目的地
   却是"Generic role"；
2. 已有进度后来补上简历关联（补投）不产生快照——真实投递丢了证据；
3. 脱敏导出：存档 content 保留原姓名（与下载产物 `***` 不同源）；请求
   `page_limit=2`、存档 render_context 却是 1；
4. 存档缺 watermark/redact/margin/include_photo 等实际生效参数——hash 正确但
   存档不足以重放导出；
5. 原简历删除后（外键 SET NULL）证据仍在数据库，但唯一入口
   `/resumes/{id}/deliveries` 要求原记录存活——业务上不可达。

同时 PR-20 指出 `GET /export?record_delivery=true` 让"纯下载"端点带状态变更副作用。

## 决策

### 1. 三个概念，一张表（最小方案，不做 event sourcing）

- **revision（源版本）**：`resume_record` 某一时刻的 content——由快照 `content`
  列 + `source_content_sha256` 冻结；
- **artifact（交付产物）**：导出得到的字节——由 `artifact_sha256` +
  `export_format`/`filename`/`pages`/`request_params`/`render_context` 描述；
  仅 `source="export"` 的行有；
- **attempt（真实投递动作）**：一次"把简历投向某目的地"的现实事件——由
  `source` + `idempotency_key` + `created_at` + `track_id` 描述。

一张表三组列，各管一组；不建 attempt/artifact 独立表（本地单用户 SQLite，量级
不需要 event sourcing；需要的是"每列语义不混"）。

### 2. 目的地快照来自实际投递目标

`freeze_delivery` 新增 `company` / `job_title` 覆盖参数：

- apply 路径：取 `record_applied` 的实参（投递台条目的 company/job_title）；
- track 路径：取进度记录本身的 company/title（用户填写的目标）；
- export 路径：无目的地语义，沿用简历记录（存档 = 内容证据，不是投递记录）。

不传时回退简历记录的冗余字段（旧行为，仅为兼容旧调用）。**历史已存数据不改写**
——不倒造证据；旧行 `company`/`job_title` 为空时 UI 标注"目的地未记录"。

### 3. 幂等键代表哪一次真实动作

`idempotency_key`（0045 新列，可空，普通索引）：

| 路径 | 幂等键 | 无键时 |
| --- | --- | --- |
| apply | `apply_task_item:{ApplyTaskItem.id}` —— 投递台条目就是天然的动作 ID，同一任务重放/重试不重复记账 | 不去重（调用方没给动作 ID，如实不假设） |
| export | `export:{resume_id}:{artifact_sha256}` —— 同一份产物（同简历+同字节）只留一份存档；改内容后重导出字节不同，是新的存档 | — |
| track | 无键：去重沿用既有语义（`resume_id` 从无到有的关联才冻结，`update_track` 只在 `resume_id` 变化时冻结） | — |

去重在服务层做（`freeze_delivery` 查键命中即原样返回），**不设唯一约束**：约束化
会让历史脏数据直接炸迁移、也挡不住并发竞态；普通索引足够支撑按键查询。

**真实第二次投递不被合并吞掉**：`ApplicationTrack` 的 company+title 合并键管的是
"进度条目"（一家公司一个岗位一条）；attempt 管的是"投递动作"——投递台两个条目
（或一次补投）对同一家公司的第二次投递，键不同 → 新快照，进度不合并、证据不丢。

### 4. 双指纹与同源存档

- `content_sha256`（旧列，语义不变）：apply/track = 内容规范化哈希；export =
  **产物字节**哈希；
- `source_content_sha256`（新）：导出前（脱敏后）源内容的规范化哈希——"存档里是
  哪份内容"；
- `artifact_sha256`（新）：产物字节哈希（export 路径与 `content_sha256` 同值，
  显式分列是为了让两列各自可解释、apply/track 行为 NULL 而不是含混的复用）；
- 存档 content 与下载产物**同源**：脱敏导出存脱敏后内容（管线同一条
  `privacy.redact` 规则），`render_context`/`request_params` 保存**实际生效**的
  参数（覆盖值按 `build_export` 的生效规则折算），凭二者可重放导出
  （`replay_delivery_export`）。

### 4.1 响应头口径（2026-10-14 RR-04 修订）

**三种哈希不可混用**：源内容哈希（`source_content_sha256`）、历史原始产物哈希
（`artifact_sha256`）、本次重放字节哈希，是三个不同的问题："存档里是哪份内容" /
"当初下载的文件是哪一份" / "你现在拿到的这些字节是什么"。

- `X-Content-Sha256` = **本次响应真实字节**的 sha256（此前放的是存档里的旧哈希：
  HTML 每次渲染换 CSP nonce，用户永远核对不上；apply/track 返回的是带说明的 JSON
  封装，头却按 `content` 字段算）。下载后自己算一遍必然一致；
- `X-Artifact-Sha256` = 当初导出时产物的 sha256（`artifact_sha256` 列，缺则省略）；
- `X-Source-Content-Sha256` = apply/track 冻结**内容**的规范化 sha256；
- `X-Delivery-Replay: true` = 这份字节是按存档**重新生成**的，不保证与当初的源文件
  逐字节相同（HTML nonce、PDF 时间戳）。要判断是否与原件一致，比对
  `X-Content-Sha256` 与 `X-Artifact-Sha256` 即可。

"归档原件字节"这条更强的承诺**没有**做：它要求把每次导出的产物字节也存一份
（体积与保留策略另立），当前产品口径是"用存档内容 + 实际参数重新生成，并如实
标注重放"。ADR 原文中"逐字一致（既有测试钉住）"的表述按此修订。

### 5. 独立访问：证据不依赖原简历存活


- `GET /api/resumes/deliveries/{id}`：详情（含 render_context/request_params/
  双指纹/`replayable`/`destination_recorded`）；
- `GET /api/resumes/deliveries/{id}/download`：export 快照重放导出；apply/track
  快照下载冻结的内容 JSON；旧快照缺参数 → 409「不可还原」，不假装能重放；
- `GET /api/tracker/{track_id}/deliveries`：从进度进入对应 delivery。

### 6. GET /export 的 record_delivery

最小破坏方案：`GET /export?record_delivery=true` 的旧行为**原样保留**（仍落存档），
参数标注 deprecated；**新调用方走 `POST /export`**（body `record_delivery=true`，
语义不变）。GET 默认仍是纯下载。理由：该参数当前没有前端调用方，无破坏面；
直接移除会破坏可能存在的脚本调用。

### 7. 不可变与隐私删除的兼容

- 证据不可删（无 `deleted_at`，`test_trash.py` 钉住）：快照回答"当时真的投出了
  什么"，可删就等于可篡改；
- 用户删除简历/岗位/进度：外键 SET NULL，冗余快照列（含目的地）自持，证据仍可
  经第 5 条的独立入口访问；
- **隐私边界**：本项目是本地单用户应用，"删除"的语义是删除正常业务记录，
  不会静默改写或删除已经形成的不可变交付证据。回收站 purge 只处理对应的源记录；
  交付快照、附件副本、自动备份和用户导出的备份文件仍按各自保留规则存在。
  当前没有批量清除交付快照的应用内入口；需要清除副本时，用户必须按运维手册逐项处理，
  并接受这会失去历史交付证据。

## 后果

- 迁移 0045 只加列（四列全可空），旧备份导入不受影响；旧行新列 NULL → UI 标注
  "不可还原/未记录"，不编造；
- `task_apply.py` 传 `attempt_key`（一行）；`record_applied` 补投路径新增冻结；
  `create_track` 改单事务（PR-10）；
- 导出存档幂等键使重复点击/重试不产生重复存档——重复点击同一份导出只多一次
  网络传输，不多一行证据。
