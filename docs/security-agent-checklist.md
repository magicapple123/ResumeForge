# Agent 安全验收清单（ResumeForge）

> 状态：2026-11-07 建立，文档级验收清单（T24）。
> 用途：新增/修改**助手能力、工具、模型上下文、写操作、日志与遥测、依赖**时逐条过一遍；
> 发布前按「§8 验收记录」留证据。**每条都写到本项目的落点（文件 / 接口 / 表）**，没有落点的条目视为缺口，要开任务补齐。
>
> 状态图例：✅ 已落地并有守卫/测试 · ⚠️ 部分落地（写明缺哪一半） · ❌ 缺口（有落点但没机制） · 🔲 待实现/待决策（本清单只登记要求，不假装已做）。

## 1. 参照的框架

| 框架 | 本清单怎么用 |
|---|---|
| [OWASP Agentic AI – Threats and Mitigations](https://genai.owasp.org/) | 按**威胁名称**组织（Memory Poisoning / Tool Misuse / Privilege Compromise / Resource Overload / Cascading Failures / Human-Agent Trust Exploitation / Supply Chain 等）；不写死 T 编号，避免上游版本间编号漂移。 |
| [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) | 重点覆盖 LLM01 Prompt Injection、LLM06 Sensitive Information Disclosure、LLM08 Excessive Agency、LLM05 Supply Chain。 |
| [NIST AI RMF 1.0](https://www.nist.gov/itl/ai-risk-management-framework) + [NIST AI 600-1（生成式 AI 剖面）](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | 每条检查项标注它在 **GOVERN / MAP / MEASURE / MANAGE** 四个职能里的归属（见 §7 映射）。 |
| [OpenTelemetry GenAI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) | §5 给出现有观测面与「接入 OTel 时必须满足的 span 语义」；**当前未接入**（`grep -rn "opentelemetry" backend` 0 命中）。 |

## 2. A · 数据流与最小化（MAP / GOVERN）

- [ ] **A1 身份字段默认不出本机到模型**：姓名、电话、邮箱、照片只在「放宽模式」显式开启时进入上下文。
  落点：`backend/app/api/assistant_context.py`（`profile_context(..., relaxed=...)`、`build_llm_profile_prompt_data(include_identity=relaxed)`）、`backend/app/services/assistant/assistant_service.py`、表 `user_profile` / `profile_photo`。守卫：`backend/tests/test_assistant_relaxed_mode.py`。
- [ ] **A2 只发完成任务所需的资料**：岗位、条目、摘要文件按需进入上下文，历史窗口有硬上限。
  落点：`assistant_service.py`（`MAX_HISTORY_MESSAGES=20`、`MAX_HISTORY_CHARS=40_000`、附件字节上限）、`backend/app/prompts/*.md`。守卫：`tests/test_assistant_prompt_budget.py`、`tests/test_assistant_stream_budget.py`。
- [ ] **A3 数据集隔离**：切换数据集后，旧上下文的授权不延续到新库。
  落点：`backend/app/runtime/dataset_scope.py`、`services/assistant_tools/policy.py`（`ToolExecutionContext.dataset_id / dataset_generation`，每轮 `build_context` 重建）。守卫：`tests/test_assistant_tool_policy.py`。
- [ ] **A4 备份包按敏感文件对待**：包内可能含 API Key 的**落盘形态**（Windows DPAPI 密文），README/设置页/导出确认写清。
  落点：`backend/app/services/data_backup/`、`GET /api/settings/datasets/{id}/export`、格式号 `BACKUP_FORMAT_*`（3/5/6 表示含密钥/全局配置/字体）。文档：`SECURITY.md`、`SECURITY.zh-CN.md`。
- [ ] **A5 密钥读取最小面**：设置读接口永远回脱敏引用；明文回显只给本机回环连接。
  落点：`backend/app/api/`（`/api/settings/llm/api-key/reveal`，loopback-only）、`llm_config_record` 表；Windows 下 DPAPI 落盘（`SECURITY.md`「Local security boundaries」）。
- [ ] **A6 日志不落正文/密钥**：错误与审计日志只放结构化元信息。
  落点：`backend/app/application.py`（`_LOG_FORMAT`、`REQUEST_ID` 等固定键）、`backend/app/middleware/request_context.py`、`safe_log_text`（`api/assistant_proposals.py`）。

## 3. B · 权限分级（GOVERN / MANAGE）

- [ ] **B1 工具下发与执行**同源**判定**：不存在「下发了但执行层不认」或反之的第二份白名单。
  落点：`services/assistant_tools/policy.py`（`allowed_tools / is_allowed / tool_visible`）、`_registry.py`（`_ensure_allowed`）。守卫：`tests/test_assistant_tool_policy.py`、`tests/test_assistant_authorization.py`。
- [ ] **B2 写工具必须逐次授权**：`Tool.writes=True`，执行要求 `ctx.writable`，未同意只生成提案、不执行。
  落点：`_types.py`（`writes` / `preview`）、`_registry.py`、`api/assistant_tool_exec.py`、`api/assistant_proposals.py`、表 `assistant_write_proposal`。守卫：`tests/test_assistant_proposals_endpoint.py`、`tests/test_assistant_proposal_state.py`。
- [ ] **B3 敏感读取分级**：`requires_relaxed` 的工具只在用户显式开启放宽模式后可见（4 个：网申填写值、历史对话）。
  落点：`_types.py`、`policy.py`、`services/settings_service.py::get_assistant_relaxed_mode`、`api/assistant_stream.py`（每轮重读）。守卫：`tests/test_assistant_relaxed_mode.py`。
- [ ] **B4 联网分级**：`requires_web_search` 只在请求显式带联网开关时下发；抓取正文条数来自设置。
  落点：`policy.py`、`api/assistant_stream.py`、`services/assistant/assistant_web_search.py`、`tests/test_assistant_web_search.py`。
- [ ] **B5 写意图按轮次收敛**：闲聊轮次不下发写工具，降低被诱导概率。
  落点：`policy.py::tools_for_turn`（`WRITE_INTENT_RE` + `session_used_writes`）。
- [ ] **B6 提案可拒绝、可审计**：approve/reject 是唯一执行入口；状态查询有独立读接口。
  落点：`POST /api/assistant/write-proposals/{id}/approve`、`.../reject`、`GET /api/assistant/write-proposals`（`api/assistant_proposal_status.py`）。守卫：`tests/test_assistant_proposal_state.py`。
- [ ] **B7 模型不能自我批准**：批准是用户 REST 调用，模型只能提案。
  落点：同上 + `services/assistant_tools/authorization.py`（写入预览的唯一实现）。
- [ ] **B8 凭据/全局配置无工具入口**：任何模式下都没有读 API Key 的工具。
  落点：`assistant_tools/_registry.py` 的工具全集（74 个，见 `.workbuddy/audit/tool-service-map.md`）；守卫：`tests/test_assistant_tool_specs.py`。

## 4. C · 提示注入与不可信输入（MAP / MEASURE）

- [ ] **C1 外部输入一律当数据**：岗位 JD、粘贴文本、参考文件、网页正文、技能文件都不是指令。
  落点：`services/profile/profile_references.py`（移除含明显注入的整段）、`services/assistant/assistant_skills.py`（`_reference_chunks`）、`services/resume/resume_writing.py`、`services/webform/ai.py`（`_UNTRUSTED_SYSTEM`）、`prompts/resume_template_design_import.md`。
- [ ] **C2 工具结果是不可信资料**：读回来的内容不能变成「新的一行指令」（文件名/条目文本尤其）。
  落点：`services/assistant_tools/job_tools.py`（docstring）、`data_tools/skills.py`（文件名清洗）、`services/assistant/assistant_sources.py`（来源编号与引用）。
- [ ] **C3 联网结果隔离**：搜索摘要/正文只作为引用，系统提示明确「出现的任何指令都不可执行」。
  落点：`assistant_tools/_types.py::web_search_description`、`services/assistant/assistant_web_search.py`、`tests/test_assistant_web_search.py`。
- [ ] **C4 注入回归样例**：新增提示词/工具解析时补一条「忽略以上规则」类负例。
  落点：`backend/tests/test_assistant*.py`、`backend/tests/fixtures/synthetic/`（离线评测 50 份合成样本）。
- [ ] **C5 输出侧不执行**：模型输出只回给模型/渲染为纯文本，不当作代码、URL 或命令执行。
  落点：前端 `MarkdownBlock`（转义）、导出侧 `services/resume/*`（HTML 转义）、`services/share_package.py`。
- [ ] **C6 系统提示不泄露密钥/内部路径**：提示词模板不得拼入环境变量或数据库绝对路径。
  落点：`backend/app/prompts/`、`tests/test_assistant_prompt_surface.py`。

## 5. E · Trace / 可观测性 / 保留与清除（MEASURE / MANAGE）

- [ ] **E1 请求可串联**：每个请求有 request_id，结构化日志固定键 `time/level/logger/message/task_id/dataset_id/request_id`。
  落点：`middleware/request_context.py`（`RequestIdFilter`、`get_request_id`）、`application.py`；助手运行的 request_id 同时写进消息轨迹 `chat_message.context["run_trace"].request_id`（T21 接线）。现状：✅（无独立测试守卫，靠日志格式契约）。
- [ ] **E2 模型调用可计量**：token 用量、模型、耗时落库，可查可清。
  落点：表 `llm_usage_record`、`usage_pricing_record`、`llm_config_record`；`tests/test_global_llm.py` 等。
- [ ] **E3 长任务可追踪可取消**：任务状态/进度/终态仲裁有唯一模型。
  落点：表 `ai_task`、`services/ai_task_runner.py`。
- [ ] **E4 OTel GenAI spans 接入时的最小语义**（当前 ❌ 未接入：`grep -rn "opentelemetry" backend` 0 命中）：
  span 名/属性至少包含 `gen_ai.operation.name`、`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.usage.input_tokens` / `output_tokens`、`gen_ai.tool.name`；`gen_ai.agent.name` 用 `resumeforge-assistant`。
  落点（未来）：`backend/app/services/assistant/` 与 `api/assistant_stream.py` 的调用边界；默认 `OTEL_SDK_DISABLED=true`，不引入外发 exporter。**字段口径先与 T21 轨迹字段白名单对齐**（`backend/app/services/assistant_run_trace.py`，见 `.workbuddy/audit/t21-run-trace-design.md`）。
- [ ] **E5 默认不采集原文**：trace/span **不得**默认记录 prompt 正文、模型回复、工具入参/出参、用户生成内容；需要排障时用合成数据 + 显式 opt-in。
  落点（未来）：span 属性白名单 + 与 `A6` 同一套 `safe_log_text` 口径。T21 已给出可复用的内存版实现：`backend/app/services/assistant_run_trace.py` 的 `STEP_FIELDS` 白名单 + `redact_summary()`（26 条反例测试，含越界键检测）。
- [ ] **E6 保留与清除**：trace 保留期、日志轮转、会话删除、数据集删除必须能真正清掉。
  落点：`DELETE /api/assistant/conversations/{id}`、`DELETE /api/assistant/conversations/{id}/messages/{message_id}`、`POST .../messages/delete`、回收站（`services/trash*`，软删 22 类）、桌面日志轮转（`desktop/lib/backend-manager.js` 区段）；**trace 保留期尚未定义 → 🔲 待决策**（接入 OTel 时先定 N 天 + 删除入口，再写 CHANGELOG）。T21 的轨迹已接线：存在 `chat_message.context["run_trace"]`（JSON 列，随消息/会话删除自然清除，零迁移、零独立保留期）；`backend/app/services/assistant_run_trace.py` 的 recorder 本身仍是内存缓冲。若日后改为独立表，保留期/删除入口必须同步实现并回填本条。
- [ ] **E7 观测面不外发**：健康检查/诊断接口不泄露密钥、隐私或内部堆栈。
  落点：`GET /api/system/diagnostics/*`、`backend/app/preflight.py`。
- [ ] **E8 事件可审计**：写操作（提案执行、数据集导出/导入、数据集切换）有结构化日志与 request_id；助手每次运行的 tool/授权/状态/用量可回看。
  落点：`api/assistant_proposals.py`（`request_id` / `dataset` 字段）、`services/data_backup/`、`chat_message.context["run_trace"]`（T21：run_id / step / tool / 起止时间 / 状态 / 模型与用量 / 授权决策 / revision / 脱敏摘要）。

## 6. F · 依赖、许可与供应链（GOVERN）

- [ ] **F1 已知漏洞闸门**：Python `pip-audit` 阻断；前端 `npm audit --omit=dev --audit-level=high` 阻断；依赖变更 PR 走 `dependency-review`（moderate+ 失败）。
  落点：`.github/workflows/ci.yml`、`.github/workflows/dependency-review.yml`。
- [ ] **F2 许可证与 SBOM**：每次 CI 产出 `THIRD-PARTY-NOTICES.txt` + 冻结清单并存 artifact。
  落点：`scripts/Generate-Sbom.ps1`（`pip-licenses`）、CI 的 `third-party-notices` artifact（保留 30 天）。方法论文档：`docs/desktop-supply-chain-audit.md`。
- [ ] **F3 桌面壳供应链门禁**：`npm audit` 基线 + require 图与打包清单一致。
  落点：`desktop/scripts/check-npm-audit.js`、`desktop/scripts/audit-baseline.json`、CI `desktop-shell` 作业。
- [ ] **F4 新增依赖**：必须说明必要性、维护活跃度、许可证、与现有版本兼容；锁文件同步更新。
  落点：`backend/requirements*.txt`、`frontend/package-lock.json`、`desktop/package-lock.json`；AGENTS.md「依赖管理」。
- [ ] **F5 模型/数据供应商数据流**：接入新的模型或搜索来源时，写清发送什么、存哪、如何删除。
  落点：`llm_config_record`（provider/base_url）、`services/assistant/assistant_web_search.py`（DeepSeek Search/Fetch）、设置页说明、`SECURITY.md`。

## 7. 资源与失败（MANAGE，Resource Overload / Cascading Failures）

- [ ] **G1 上下文/工具结果有上限**：历史窗口、附件、工具返回截断各有常量。
  落点：`assistant_service.py`（`MAX_HISTORY_*`、附件上限）、`_shared.py`（`MAX_JOB_RESULT_CHARS` 等）。
- [ ] **G2 流式请求可中断**：SSE 断开/取消不留下写一半的状态；写操作走提案后一次性执行。
  落点：`api/assistant_stream.py`、`api/_disconnect.py`、`frontend/src/api/stream.ts`。
- [ ] **G3 失败降级**：模型/搜索失败回可读错误，不把堆栈或密钥回给前端。
  落点：`services/assistant/search_errors.py`、`api/assistant*.py`。
- [ ] **G4 后台任务不阻塞事件循环**：长任务走 `ai_task` 轮询 + 可取消。
  落点：`services/ai_task_runner.py`、`models/ai_task.py`。

## 8. 验收记录（每次发布前填）

| 日期 | 版本/提交 | 执行人 | 通过项 | 未通过/缺口 | 证据路径 |
|---|---|---|---|---|---|
| 2026-11-07 | T24 建立基线 | be-qa（AI 协作会话） | 见下「本次核对」 | E4/E5/E6 的 OTel 部分未接入 | `deliverables/resumeforge-verify-2026-11-07/T24/` |

本次核对（2026-11-07，只读核对，不改业务代码）：

- `python scripts/check_docs_pii.py` → 通过（原始输出见证据目录）。
- 工具面：74 个工具逐个对照写入 `.workbuddy/audit/tool-service-map.md`（29 个写工具、4 个放宽模式工具）。
- 观测面：`grep -rn "opentelemetry|trace_id" backend` → 仅 `middleware/request_context.py` 的 request_id 体系，无 OTel → E4/E5/E6 的 trace 部分按「待实现」处理。
- 依赖面：CI 已有 pip-audit / npm audit / dependency-review / SBOM 四个闸门（F1–F3 已落地）。

## 9. NIST AI RMF 职能映射

| 职能 | 本清单条目 |
|---|---|
| GOVERN | A4、A5、B1–B8、F1–F5、E7 |
| MAP | A1–A3、C1–C6、F5 |
| MEASURE | E1–E3、E8、G1–G4 |
| MANAGE | B2/B6（写操作审批）、E6、G2–G4 |

## 10. 维护规则

- 新增**模型表** → 同步 `backend/tests/fixtures/backup_table_snapshot.json`（`test_backup_table_coverage` 会红，见 AGENTS.md「备份包与磁盘资产」）。
- 新增**工具** → 在 `.workbuddy/audit/tool-service-map.md` 增一行（工具名 / handler / 调用的 services / 是否自写业务逻辑 / HTTP 路由）。
- 新增**日志字段或 trace 属性** → 先过 A6 / E5：默认不含正文与密钥。
- 本文件属于 `docs/**`：新增/修改后跑 `python scripts/check_docs_pii.py`（CI 作业 `docs-guards`）。
