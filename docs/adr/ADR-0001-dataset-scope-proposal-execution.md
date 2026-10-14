# ADR-0001: 写入提案的数据集身份贯穿与数据集切换的 prepare/commit/compensate

日期：2026-10-13（2026-10-13 生产审计 PR-02 / PR-03）
状态：已采纳
关联：`docs/architecture.md` §2.1（数据集身份契约）、RF-01（写入授权）、RF-03（切换作用域）

## 背景

2026-10-13 生产审计发现两类真实故障：

1. **PR-02（批准端点接线错误，已复现）**：`POST /assistant/write-proposals/{id}/approve`
   存在两处接线错误——路由前缀少了 `/api`（前端统一按 `/api${path}` 发请求，端点
   从未接到过流量）；拿到 `frozen_session_factory()` 返回的 sessionmaker 后未实例化
   直接 `with`，抛 `TypeError: 'sessionmaker' object does not support the context
   manager protocol`。异常发生在 handler 的 try 之外，没有 `mark_failed`；用户再次
   点击批准时提案已 `approved` + token 已核销，不可重放。
2. **PR-03（数据集身份在"请求 → 执行 → 提交"之间有缝）**：`activate_dataset` 先写
   持久指针再 rebind/迁移/清理，中途失败时指针已是目标库而内存身份仍是旧库；
   提案授权只比 `dataset_id` 不比 generation（A→B→A 后旧提案仍可批准）；批准执行
   没有租约；简历生成 SSE 先做业务快照再在建流时取租约（两时刻之间可切换）。

## 决策

### 0. 普通 HTTP 请求也绑定浏览器意图（2026-10-14 FV-03 修订）

页面挂载编辑器前读取 `GET /api/dataset-scope`，冻结 `进程实例:dataset_id:generation`。
统一 fetch、XHR、SSE 与队列请求带 `X-Dataset-Scope`；`X-ResumeForge-Client: browser` 的
写请求缺身份或失配即 409，保留页面草稿。普通 API 请求也持租约到流完成，切换不能跨过其会话。
激活/示例切换请求不持 HTTP 租约以避免自锁，期望身份在切换互斥锁内再次校验。
后端重启或 A→B→A 后旧页面依然过期；收到普通响应不能悄悄采纳新身份。未带浏览器标记的
既有本地脚本兼容，但建议显式带作用域；该标记是意图防串写措施，不是认证或多用户隔离。

### 1. 批准端点的执行段（PR-02）

```
acquire_lease("assistant-proposal")          # 切换持锁期间 409，提案保持 pending 可重试
approve_proposal → get_tool → consume        # 校验、核销与作用域校验同锁完成
factory = frozen_session_factory(lease.identity)   # 工厂从租约身份派生，sessionmaker 先实例化
db = factory()
  handler(db, stored_arguments)   → 失败: rollback + mark_failed + 422
  db.commit()                     → 失败: rollback + mark_unknown + 409
会话打开失败                     → mark_failed + 503
finally: db.close(); lease.release()
```

- 各失败路径都把提案置为**可解释终态**（`failed` / `unknown`），绝不停留在
  "已核销但业务未执行"的不可知状态；终态不可重放（approve 只认 pending）。
- `unknown` 是比 `failed` 更诚实的新终态：提交阶段失败时无法断言写入是否生效，
  如实报告"结果未知"并阻断一切再执行——绝不自动二次写入。
- 错误响应保持 string detail（前端 `client.ts` 的错误提取依赖它），"结构化"体现
  为可区分的 HTTP 状态码（503/422/409）+ 可查询的提案终态与 `result_summary`。

### 2. 提案作用域绑定 id + generation（PR-03）

提案创建时从 `ToolExecutionContext` 同时绑定 `dataset_id` 与 `dataset_generation`
（`build_context` 已有该概念，直接复用）。approve / consume / GET 全部校验二元组：
A→B→A 之后 id 相同但代次已前进，旧提案照样 409——"同 ID 不同库"不能串写。
GET 对作用域外提案返回 409 而不是详情（不暴露其他作用域的内容）。

### 3. 数据集切换改为 prepare / commit / compensate（PR-03）

```
prepare:  排空（租约+连接池）→ 临时引擎预检目标库（含迁移），失败保持原状
commit:   建目标引擎 → 迁移/清理（失败: dispose 新引擎，原状）
          → 写持久指针（失败: dispose 新引擎，原状）
          → adopt_engine 接管新引擎 → dispose 旧引擎 → publish_switch（纯内存）
recover:  启动时校验指针与可用库一致性（lifespan 调 recover_startup_pointer）
```

- **旧引擎不过早销毁**：旧实现 `rebind` 先 dispose 再建新引擎，建失败时旧引擎已
  被拆掉；新实现新引擎完全可用后才释放旧引擎。新增 `database.adopt_engine`
  （只接管、不建不销毁）承担"接"的动作，`rebind` 保留给 conftest 等既有调用方。
- 指针写入成功后的 `adopt/publish` 是纯内存赋值，不引入新的失败模式；进程恰在
  "指针已写、引擎未换"的窗口崩溃时，重启由 `recover_startup_pointer` 做确定性
  恢复：指针指向的库存在且打得开 → 尊重用户切换意图；否则记录日志并回退主数据。

### 4. SSE 生成的租约时序（PR-03）

`POST /api/resumes/generate` 把 `acquire_lease` 提前到端点体最前（任何业务快照
之前），冻结工厂从 `lease.identity` 派生。切换持锁期间仍以 SSE error 事件报错
（保持既有测试钉住的 200 + error 事件行为）；快照阶段失败先还租约再抛。

## 后果

- 批准端点真正可用（此前因路由 404 + TypeError 双重故障从未生效）。
- 提案状态机新增 `unknown` 终态（前端把它当"执行失败"类展示即可，语义见上）。
- `frozen_session_factory` 新增可选 `identity` 参数（缺省行为不变）。
- `database` 新增 `adopt_engine`；`activate_dataset` 不再调用 `rebind`。
- 无数据库迁移（generation 只存进程内存，与 RF-03 "重启归 1 是安全的"一致）。

## 测试

- `tests/test_assistant_proposals_endpoint.py`：真实 POST 批准路径（先失败后修复：
  修复前端点 404/TypeError，写入不发生）、二次点击不重复、会话打开失败/提交失败
  结构化终态、A→B→A 旧提案被拒、GET 作用域隔离、租约工厂在切换尝试下写原库。
- `tests/test_dataset_activation_compensation.py`：对提交段每一步（建引擎/迁移/
  清理/写指针）做屏障注入，断言内存身份、磁盘指针、重启选库三者一致且旧库可写；
  启动恢复（指针缺失/损坏/合法/主数据）各一例；`adopt_engine` 行为。
- `tests/test_dataset_scope_stream.py`：SSE 租约先于快照（注入调用顺序探针）、
  快照失败先还租约。
