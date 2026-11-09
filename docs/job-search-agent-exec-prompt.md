# 执行提示词：落实《求职 Agent 化三步》计划

> 用法：把本文件从「=== 提示词开始 ===」到「=== 提示词结束 ===」整段复制给执行代理。尖括号 `<...>` 内是你要替换或从环境变量读取的值。

---

=== 提示词开始 ===

你是这个仓库的执行代理。任务：**把 `docs/job-search-agent-plan.md` 里定义的全部工作一次性实现、验证并交付**。这份计划已经过产品与架构评审、用户逐条拍板，**不要重新设计、不要改范围、不要"顺手优化"计划之外的代码**。

## 0. 先做这三件事（不做完不许写代码）

1. 读 `AGENTS.md`（项目规则，优先级最高）、`docs/job-search-agent-plan.md`（本次规格）、`docs/verification-playbook.md` §3（反证方法）。
2. 记录基线三件套：`git rev-parse --short HEAD`、`git status --porcelain | wc -l`、以及下面这条命令的结果（预期**是红的**，属既有债）：
   ```
   cd backend && PYTHONUTF8=1 .venv/Scripts/python.exe scripts/dump_baseline_ddl.py --check
   ```
3. 如果计划的某个"现状"与磁盘不符（文件搬了、行数变了、符号改名了），**以磁盘为准**，并在最终报告里列出偏差；不要为了对上文档去改代码。

## 1. 绝对红线（违反任何一条即为任务失败）

- **不改产品定位**：本地优先、无账号、数据不出本机。
- **不自动提交申请、不自动发邮件/消息**；不保存招聘网站密码 / Cookie / 验证码；不读用户邮箱。
- **不动 `backend/data/resume_forge.db`**（真实用户数据）。所有实验用 `DATABASE_URL`（库位置）与 `RF_DATA_DIR`（附件/备份目录）指向临时目录。
- **禁止** `git checkout --` / `git stash` / `git restore`：工作树有 300+ 项他人未提交改动（含助手层重构与大量未跟踪新文件），这些命令会连带回滚别人的工作。返工用仓库外快照。
- **不 commit、不 push**，除非用户另行要求。
- **不改 `STALLED_DAYS`**（`/api/stats` 与求职看板共用，有守卫钉住）。
- **不重跑** `backend/scripts/dump_baseline_ddl.py`（不带 `--check` 会重复建表炸库）。
- 单文件 **500 行**硬闸门（`backend/app`、`frontend/src`，含 `.css` 与**测试文件**）；贴线先拆。
- 预期**零新增依赖**。

## 2. 编排：先串行落库，再三路并行

迁移链是唯一串行点（双 head 会让 `tests/migration_refs.head_revision()` 失效，迁移测试集体红）。按下面两阶段做，**用你的子代理/并行任务能力把阶段 2 的三条轨道同时推进**。

### 阶段 1（串行，1 个子代理，先做完）

**Agent `schema`** —— 独占以下文件，其他人不许碰：
`backend/migrations/versions/0006_*.py`、`0007_*.py`、`0008_*.py`、`backend/app/models/agent_task.py`、`models/followup.py`(新)、`models/job_preference.py`(新)、`models/apply.py`、`models/tracker.py`（仅新增两个阈值常量）、`models/__init__.py`、`services/trash.py`（仅 `_restore_conflict_detail` 分支）、`tests/test_trash.py`（计数 22→23）、`tests/test_migration_*.py`。

要求：
- 三个迁移一次落齐（0006 → 0007 → 0008 线性），这样后面三条轨道不用等。
- 建表前 `inspect()` 判存在；`downgrade` 严格反序；表内 CHECK 用 `sa.CheckConstraint`。
- `job_preference` 的 `state ∈ ('active','superseded','undone')`，`deleted_at` **只表示"用户删了"**；唯一索引 `WHERE state='active' AND deleted_at IS NULL`。
- 验证：空库 `upgrade head` → `downgrade -1` ×3 → `upgrade head` 全绿；`pytest -q tests/test_baseline_schema.py tests/test_trash.py` 绿。
- 完成后向主代理报告：迁移文件名、三个 revision、`test_baseline_schema` 结果。

### 阶段 2（并行，三轨 + 一个验证者）

**Agent `backend-core`**（跟进巡检 +「我已提交」）
独占：`services/followup_sweep.py`(新)、`services/agent_task_events.py`(仅加 hook)、`services/submit_confirmation.py`(新)、`services/tracker.py`(仅 `record_applied` 的 `user_confirmed` 透传)、`api/followups.py`(新)、`api/apply_record_items.py`、`schemas/followup.py`(新)、`application_routers.py`（只加一行注册）、对应测试。

**Agent `backend-receipt`**（交付单读视图）
独占：`services/delivery_receipt.py`(新)、`schemas/delivery_receipt.py`(新)、`tests/test_delivery_receipt.py`(新)。
注意：`api/apply_record_items.py` 归 `backend-core`，你**只提交需要什么**，由它合并；如需新增端点，把函数签名与返回模型写进交接说明。

**Agent `backend-preference`**（偏好档）
独占：`services/job_preference_catalog.py`、`job_preference_service.py`、`job_preference_prompt.py`（均新）、`services/actions/domains/job_preferences*.py`(新)、`api/job_preferences.py`(新)、`schemas/job_preference.py`(新)、`services/assistant/assistant_system_prompt.py`（加注入块）、`services/assistant_tools/policy.py`（登记两个工具名）、`_tools_specs_data.py`（追加）、对应测试。

**Agent `frontend`**（全部前端）
独占 `frontend/src/**`。i18n 命名空间文件由**你一个人**统一落（两个人改同一个 `namespaces.ts` 必冲突）。按 API 就绪顺序做：跟进卡 → 我已提交按钮 + 引导 → 交付单段 → 偏好页。

**Agent `verifier`**（独立验收，不写业务代码）
在每个 API 就绪后按 §4 的验收脚本跑真实数据；发现失败只出报告，不自己改业务代码。

### 任务索引（判据见计划 §10，一条都不许省）

| ID | 任务 | 归属 |
| --- | --- | --- |
| T01 | `0006` 迁移：`agent_task` 两列 + 唯一索引 + `application_follow_up` | `schema` |
| T02 | `followup_sweep.py`：两桶扫描、让位、上限 5、模板文案 + 双向自检 | `backend-core` |
| T03 | `agent_task_events` hook + 复用总开关 + 一次性引导键 | `backend-core` |
| T04 | `POST /api/followups/decisions` + 幂等 | `backend-core` |
| T05 | 「我已提交」：`submit_confirmation` + 端点 + `user_confirmed` 透传 + 提醒 upsert | `backend-core` |
| T06 | 前端跟进卡 + 任务卡分支 + i18n / 样式 | `frontend` |
| T07 | 前端「我已提交」按钮 + 一次性引导 | `frontend` |
| T08 | `0007` + `delivery_receipt`（`human_steps` / `judge_receipt`）+ 两接口 | `schema` + `backend-receipt` |
| T09 | 前端交付单段 + 契约测试 | `frontend` |
| T10 | `0008` + `job_preference` 模型 + 13 类目录 + 回收站登记（22→23） | `schema` + `backend-preference` |
| T11 | `job_preference_service`：upsert / undo / 删除恢复 / 裁剪 / 查询 | `backend-preference` |
| T12 | 两个写工具 + `ALWAYS_PROPOSAL_TOOLS` 登记 + 读工具 | `backend-preference` |
| T13 | 注入块：渲染 + 预算 + 两段降级 + `parts` 顺序 | `backend-preference` |
| T14 | 前端偏好页 + 确认卡两按钮 + 撤销 | `frontend` |

### 文件冲突纪律

- 同一文件只能有一个写入者；跨轨道需要的改动，写"交接说明"由所有者合并。
- 共享文件（`application_routers.py`、`i18n/messages/*.namespaces.ts`、`schemas/*`、`CHANGELOG.md`）由主代理指定唯一写入者。

## 3. 模型与外部服务

需要真实模型时用：

- 密钥：环境变量 `DEEPSEEK_API_KEY`（**不得**写进代码、测试夹具、日志、数据库导出或任何提交物）。
- 配置入口：`PUT /api/settings/llm`（有 loopback 守卫，只能在本机调用），body：
  ```json
  {"provider":"deepseek","base_url":"https://api.deepseek.com","api_key":"<从环境变量读>","model":"deepseek-flash","api_style":"openai","temperature":0.1}
  ```
- `deepseek-v4-flash` 是 `deepseek-flash` 的兼容别名；DeepSeek 的 thinking **默认开**，批量验证时可在设置里关掉以省 token。
- 只有"必须模型生成"的路径才调模型（助手对话、跟进草稿若走生成）；巡检文案、三态判定、偏好注入都是**确定性代码**，不许调模型。

## 4. 实机验证协议（每个任务都要做，不接受"测试通过"四个字）

### 4.1 环境

```powershell
# 1) 建库 + 造真实数据 + 自检（在仓库根目录跑；内部会 drop 重建并走真实 alembic upgrade head）
$env:PYTHONUTF8 = "1"
backend\.venv\Scripts\python.exe scripts\seed_demo_data.py --out D:/rf_verify/verify.db --check

# 2) 用这份库起后端
$env:DATABASE_URL = "sqlite:///D:/rf_verify/verify.db"   # 别指向 backend/data
$env:RF_DATA_DIR  = "D:/rf_verify/data"                   # 附件/备份等数据目录
cd backend
```

禁用 `create_all`：`app_schema_epoch` 由基线迁移播种，`create_all` 建出来的库会被启动闸门判 `REFUSE_UNKNOWN`（`TestClient` 不跑 lifespan，所以相关测试仍可能是绿的）。迁移往返测试另用一份空库直接跑 `alembic upgrade head → downgrade -1 ×3 → upgrade head`。

起后端（必须用 venv 的 python，系统 Python 缺依赖会静默退出）：

```powershell
Start-Process -FilePath "backend\.venv\Scripts\python.exe" `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8005" `
  -RedirectStandardError "D:/rf_verify/uvicorn.err" -RedirectStandardOutput "D:/rf_verify/uvicorn.out"
```

### 4.2 每个功能的验收脚本（必须产出真实数据证据）

**D1 跟进巡检**
1. 用 API 或直接 SQL 造 12 条 `application_track`（`status=applied`，`updated_at` 分别设在 8/10/15/22/25 天前），另造 3 条已终止状态作对照。
2. 触发一次扫描（开开关后调内部入口或等线程节拍；时钟可注入——测试里用注入，实机用改数据时间）。
3. 断言：只生成 **1 张**卡、卡内最多 **5** 个 step、全部来自 `>7d` 且 `<21d`；`>21d` 的进「确认状态」桶而不是跟进桶。
4. 再扫一次：新增 **0** 张（桶键幂等）。
5. 提交决策（3 家乱序）→ 断言 `application_follow_up` 行数正确、step 转 done、**`application_track.updated_at` 与 `status` 未被修改**（用前后快照比对）。
6. 断言卡面文案不含禁词（"HR 没回""对方还没回复你""已读不回""面试卡住"），且含天数与"没有记录到任何状态变化"。

**D2 交付单**
1. 取一条 `status=success` 的 `apply_task_item`，点「我已提交」→ 断言：新增/命中 1 条 track、1 条 `hr_reply` 提醒（+7 天）、1 条 `resume_delivery_record`（幂等键 `apply_task_item:{id}`）；连点 3 次行数不变。
2. 打开交付单 → 断言能看到简历标题、目的地、页数、`content_sha256`/`artifact_sha256`、填充字段统计（或"未知"）、台账疑点数、待人工步骤。
3. 造三种数据分别命中「卡在人手上 / 有疑点 / 可验收」，断言优先级正确（卡在人手上优先）。
4. 断言"投出后改了简历"只显示提示、**不改变三态**。
5. `ack` 两次 → 幂等，且 track 未被修改。

**D3 偏好档**
1. 配好 DeepSeek（§3），新开会话发"记住：我不投外包"。
2. 断言：生成 proposal 而不是直接落库；确认后 `job_preference` 出现 1 行（`source=user_stated`，`source_proposal_id` 非空）。
3. **新开一个会话**问"我的求职偏好是什么" → 断言助手能答出（证明注入生效，不是会话记忆）；并抓取实际 system prompt 片段作为证据。
4. 再说"这次不想去上海" → 断言落到 `session_note`（不写 `target_city`）。
5. 改城市 → 旧行 `state=superseded`、新行 `active`；撤销 → 回到上一版且两行 `deleted_at` 都是 NULL。
6. 删除 → 回收站可见；恢复 → 复活；再删除后先建一条同 kind 活动行再恢复 → **409 `trash_restore_conflict`**。
7. 隔离反证：只设偏好、不设资料的库里，`build_llm_profile_prompt_data` / 简历生成 payload / `list_claims` 的输出里 `assert "杭州" not in ...`。

**前端**
- 改动相关的 `.test.tsx` 先跑；`npm run format:check` / `lint` / `typecheck` / `build` 全过。
- Playwright：`npm run smoke` 通过；对三个新界面各截一张图（等 `.ant-skeleton` 消失再拍，否则只有灰条）。

### 4.3 自动返工

- 任何断言失败 → 定位根因 → 修 → **重跑同一条验收脚本**。同一任务最多 3 轮。
- 3 轮仍红：**停止该任务**，保留其余轨道继续；在报告里贴完整失败输出与已尝试的修复。
- **不许**通过放松断言、删用例、跳过验收来变绿。验收脚本失败即视为功能未完成。

## 5. 每项任务的完成判据

直接采用 `docs/job-search-agent-plan.md` §10 的 T01–T14 判据，一条不许少。额外要求：

- 每条判据都要在报告里对应一条**可复核的证据**（命令 + 输出片段 / DB 查询结果 / 截图路径）。
- 数据层任务必须附 `upgrade → downgrade → upgrade` 的输出。
- 涉及提示词装配的任务必须附 `tests/test_assistant_prompt_budget.py` 与 `tests/test_assistant_prompt_surface.py` 的结果。

## 6. 交付前总闸门

```powershell
cd backend
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m pytest -n auto        # 内存受限（2C4G/沙箱）改 -n 4，否则 worker 易 OOM
# 覆盖率串行（不能与 -n 写同一条命令）
.venv\Scripts\python.exe -m coverage run --rcfile=..\pyproject.toml -m pytest -q
.venv\Scripts\python.exe -m coverage combine --keep
.venv\Scripts\python.exe -m coverage report --rcfile=..\pyproject.toml --fail-under=80
```

```powershell
cd frontend
npm test
npm run format:check
npm run lint
npm run typecheck
npm run build
```

判绿三件套：**汇总 `failed = 0`** + 前端 **`Errors` 行**（只看 `Tests passed` 会漏掉未 unmount 导致的 passive effect 报错）+ **覆盖率报告真的打印且 ≥ 80**。

## 7. 最终报告格式

```
## 总览
- 任务：T01–T14，完成 X / 未完成 Y / 回退 Z
- 后端全量：X passed / Y failed；覆盖率 Z%
- 前端：test / format / lint / typecheck / build 各自结果；smoke 结果
- 真实数据证据目录：[路径]

## 逐项
| 任务 | 状态 | 改动文件 | 证据（命令或路径） | 返工次数 |

## 偏差与风险
- 计划与磁盘不一致处
- 未达预期的项与原因（不许含糊）
- 需要用户拍板的事

## 我自己改了哪些文件
（git status 里只列本次涉及的文件）
```

## 8. 停止条件

遇到以下情况立即停下并报告，不要自行决定：

- 需要改产品红线（自动提交、读邮箱、云依赖）。
- 需要改 `STALLED_DAYS` 或重跑基线生成器。
- 迁移链出现分叉（两个 head），且无法在不改他人文件的前提下合并。
- 同一文件被两个轨道同时要求修改，且交接说明无法解决。
- **工作树里 `policy.ALWAYS_PROPOSAL_TOOLS`（`backend/app/services/assistant_tools/policy.py`）或 `backend/app/services/assistant/` 下的文件不存在**：它们只存在于未提交的工作树，HEAD 里没有。缺失意味着偏好档的"强制走提案"与提示词注入点都落空——停下确认，不要自己重建一套。

=== 提示词结束 ===
