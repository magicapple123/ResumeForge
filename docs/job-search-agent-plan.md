# 求职 Agent 化三步：跟进巡检 · 投递交付单 · 求职偏好档

> **状态**：**已实施并提交**（`65760524`，2026-11-09）；本文保留为设计、判据与验收记录
> **初稿 2026-11-08 · 复核 2026-11-09 · 实施 2026-11-09**
> **基线**：开工时是 HEAD `e5ac0e3c` + 300+ 项未提交改动（助手层重构）；实施结果已合入 `65760524`，之后仓库转入 Linux 发行版分支（当前 HEAD 另算）。**§15 的"脏工作树"描述的是开工时状态，不再代表当前仓库**；设计、判据与风险清单仍然有效。
> **素材**：《2026年了，好的Agent形态该长什么样子？》（小红书 @不转到大模型不改名，2026-10-14）
> **外部信息核实日期**：2026-11-08
> **团队**：产品经理 许清楚 / 架构师 高见远 / 交付总监 齐活林
> **遵循**：`AGENTS.md`（渐进式改造、测试优先、500 行预算、不主动 commit）

---

## 0. 一句话

把「投出去之后」这一段接上：用**已有的事件调度骨架**加一个事件源（跟进巡检），用**已有的投递快照**做一张可验收的单据（交付单），用一份**可见、可删、字段化**的偏好消灭「每个新会话重说一遍」。

三件都不碰「只填不交」，都不需要云，都不新增账号体系。

**判断依据**：笔记总结的五条趋势里，只有「主动跟进」和「完整任务交付」真正落得进一个本地单机求职工具；「持续云端环境」会拆掉这个产品唯一的护城河；「跨任务记忆」要借，但必须借成可见的文件而不是黑箱。

---

## 1. 背景与事实校准

### 1.1 笔记提到的产品，2026-11-08 核实结果

| 产品 | 发布 | 关键机制 | 对本文的用处 |
| --- | --- | --- | --- |
| Meta **Muse** | 2026-09-08 | MuseSecureVM 独立云虚拟机；Checkout 卡片 + Deny/Allow；10-23 进日本、随后进墨西哥；11-06 上线实时语音与虚拟形象 | 「长流程收敛成一张待批卡」的样本 |
| Manus **Cue** | 2026-09-28 | 每 Agent 独立邮箱/电话/钱包/云电脑；群聊接力；routines | **仍是邀请制免费早测**（截至 11-09 未 GA），不能当成熟能力引用 |
| OpenAI **dots** | 2026-09-29 | GPT-6 Astra（11-03 起增加 GPT-6.1 Terra）；独立云电脑 + 4000+ 应用；主动调研（只读）、Custom Rules、自动审核 | 「Custom Rules」是偏好档的直接原型 |
| xAI **Grok Bot** | 2026-08-11 (beta) | 命名 Bot + 预设岗位 + 群聊交接；**一个用户所有 Bot 共享一台云电脑**；routines 按计划/事件触发；Enterprise/Teams 已 GA，10-09 起每个 Bot 有独立邮箱 | 只有「routine 可见化」值得借 |
| Anthropic **Claude Duet** | 2026-10-21 | 每天早晨推「今日要事简报」，白天巡检，发现遗漏主动备料；6000+ 连接器；发送/付款/签署/删除必须批准；**截至 11-06 仍限美国 waitlist**，随 Pro/Max/Ultra 提供 | **笔记漏了这一家**，它才是「主动跟进」最成熟的样本 |

**赛道已经不止五家**：11 月上半月又进了微软 Copilot（新一代，主打"你不上班它还在干活"）、腾讯 WorkBuddy「Buddy One」（10 月底，打通文档/会议/网盘）、Perplexity「Teammates」（11-06，$200/月 Max 起）、蚂蚁「灵光 2.0」（11-02，独立云主机 + 跨会话记忆 + APASS 授权基础设施）。方向没变，反而把「授权可见、可撤销」推得更前——正好支持本文第 5 条决策。

> 这些产品的可用性和定价仍在快速变化（Dots 的 Enterprise 免费管理预览到 11-18、首个 dot 的免计量窗口已在 10-29 前后结束）。本文只把它们的**机制**当参考，不把"能不能用、多少钱"当结论。

**四处需要修正的引用**：

1. 笔记写「四个巨头」，实际是五家（Duet 发布于笔记之后）；到 11 月上半月，这条赛道又进了微软 Copilot、腾讯 Buddy One、Perplexity Teammates、蚂蚁灵光 2.0。
2. Cue 的能力描述来自官方演示，但产品处于邀请制早期访问（截至 11-09 仍未 GA），**不能当作已验证的产品形态**。
3. Dots 只对 Pro（约 $100/月）、Business Premium、Enterprise 开放，EEA/瑞士/英国首发缺席——引用时不能写成"所有人可用"。
4. Duet 截至 11-06 仍限美国 waitlist（随 Pro/Max/Ultra 提供），不是全球可用产品。

### 1.2 更重要的外部事实：AI 求职 Agent 已经是一个成熟品类

2026-10 的横向评测（myjobb.ai / JobCopilot / AIApply / LoopCV / Simplify / Jobright / JobsAICopilot / Careerflow / Teal）里，被反复强调的四条共识：

1. **Review Mode**：每份申请发送前可逐条批准，是几乎所有产品的标配卖点。
2. **提交后必须跟进**，否则前面全白做（myjobb.ai 每份申请推一条跟进消息）。
3. **LinkedIn 用户协议禁止自动化**，自动投递类工具会给用户账号带来风险。
4. **没有一家能做到"完全不用人"**：OTP、在线测评、不确定的筛选题仍然回到人。

→ 推论：**求职场景里「更完整」不等于「更自动」**。交付终点应该是"停在手交线前，只剩人按一下"，而不是"全自动投完"。

国内对照：支付宝就业助手「晓叶」2.0（2026-09）已把 AI投递 / AI面试 / AI跟进 / AI核验 做成开放能力，15 万岗位支持"报名即面试"。但那建立**企业侧回执**之上；简历通没有平台数据，所以跟进只能建立在"用户可确认的事实 + 时间推演"上——这决定了本文所有文案的措辞纪律（见 §6.1.5）。

> **时效声明**：本文引用 2026-08 至 **2026-11-09** 的官方发布与 2026-10 的横向评测。下载量、星标、定价、可用地区这类易变信息只在 §1.1 标注"截至日期"，**不进入任何产品结论**。

---

## 2. 五条趋势的判定

| 趋势 | 判定 | 理由 | 在本文的落点 |
| --- | --- | --- | --- |
| 持续云端环境 | **不可借鉴** | 撞「数据不出本机」红线；用户真实痛点是"别白干"，不是"要 7×24"。已有 `resume_cursor`（重启 running→paused 可续跑）+ 启动补扫，能做到"关掉不丢进度" | 无（仅作为"可恢复执行"的对照） |
| 主动跟进 | **高** | 求职最大的漏点是"投完就忘"；"7 天没动静"在本机完全算得出来 | §6.1 跟进巡检 |
| 完整任务交付 | **最高** | 笔记判据"交给用户的是一段回答还是可验收成果"正好命中空白；且仓里已有投递快照，只差一个读视图 | §6.2 投递交付单 |
| 跨任务记忆 | **中** | 不抄黑箱记忆，抄 dots 的 Custom Rules：做成可见、可改、可撤销的字段化偏好 | §6.3 求职偏好档 |
| 开箱即用 | **半借** | 能借的只有"一页式配置"；云托管那部分是别人的生意 | 不进本期（期二之后再议） |

---

## 3. 已拍板的决策（8 条）

| # | 决策点 | 选择 | 影响 |
| --- | --- | --- | --- |
| 1 | 点「对方已回」是否推进漏斗状态 | **只记录，不改状态** | `application_follow_up` 只写决策；`status` / `updated_at` 不碰。原因：`resolve_status()` 只能前进，若把「已回」映射成「筛选中」，在已手工推到「面试」的记录上会被原样返回——按钮点了没反应，比改错更难查 |
| 2 | 交付单靠什么关联填充记录 | **先按 URL 精确匹配，匹配不上如实标「未知」** | 不改网申写入路径。原因：`web_form_fill_record` 只有 `url` 没有 `job_id`，且 live 模式填表时系统本来就没有岗位上下文，加列也填不上 |
| 3 | 跟进巡检挂哪个开关 | **复用「任务卡」总开关 + 一次性引导** | 复用 `get_agent_task_events_enabled()`（默认关）。新增一次性提示 `followup_sweep_hint_shown`，只在投递成功后出现一次。原因：一个开关对应一个心智，避免"关了一个还在冒" |
| 4 | 首版范围 | **三个都做：两期实施 + 观察期** | 期一：巡检 +「我已提交」+ 交付单读视图（`0006` + `0007` 同批）；期二：偏好档（`0008`）；之后观察。**交付单不单独占一期**——它只加一列 + 一个读视图，单独发版的固定成本（回归、文档、发行）远大于开发量。迁移链线性仍是硬约束 |
| 5 | 偏好行的删除方式 | **软删 + 进回收站** | `deleted_at` 只表达"用户删了"，版本状态另用 `state`（`active`/`superseded`/`undone`）。理由：`test_every_deleted_at_table_is_registered` 强制登记 `TRASH_SPECS`（计数 22→23），而回收站判据就是 `deleted_at IS NOT NULL`——若版本状态也写 `deleted_at`，每改一次偏好就往回收站扔一条 |
| 6 | 投出后简历又改过 | **不算疑点，仅作展示** | 三态只由缺件/待人工与台账疑点决定。投完再改是常态，算疑点会让单子常年黄灯，颜色一旦可忽略三态就废了 |
| 7 | 「只在这次对话」 | **本期就做** | `session_note` 不是可选项：它是唯一管住"模型把临时意愿记成永久"的约束 |
| 8 | 偏好页位置 / 深链 | **设置页；不加深链** | 偏好与四档权限同页（都是"助手行为"），不做一级页；「对方已回」后不改阶段，等数据 |

---

## 4. 红线与不做清单

**功能红线（任何实现都不得突破）**

1. 不引入云账户、云执行、云记忆。
2. 不自动提交申请、不自动发送邮件或消息。
3. 不保存招聘网站密码 / Cookie / 令牌 / 验证码，不读用户邮箱。
4. 不为了"看起来像 Agent"堆功能。

**明确不做**

| 不做 | 原因 |
| --- | --- |
| 云端常驻 VM | 见 §2 |
| 自动投递 / 自动发跟进信 | 红线 2 + LinkedIn 协议禁止自动化 |
| 命名 Bot + 预设岗位 + 群聊交接 | 伪需求：单机单用户没有第二个执行者，用户要多管一层"角色"才回到同一件事 |
| Grok Bot 式「总是允许」白名单 | 与四档权限 + 请求级 `allow_write` 直接冲突，一旦放开，proposal 机制被绕过 |
| 平台侧双边闭环（报名即面试） | 单边工具照搬只能得到**假回执**：看起来投了，没人知道投没投 |
| 修改 `STALLED_DAYS` | 它被 `/api/stats` 与求职看板共用，且有守卫测试钉住 |

**不要做的操作**

- **不要重跑** `backend/scripts/dump_baseline_ddl.py`（不带 `--check`）：它会把 0002–0005 建的表塞进基线，与后续迁移重复建表，直接炸库。详见 §12.2。

---

## 5. 核心概念：手交线（handoff line）

| 环节 | 简历通能推进到 | 必须停在这里 |
| --- | --- | --- |
| 网申填表 | 字段填完 + 回读验证 | 提交按钮 / OTP / 下拉单选复选日期 |
| 投递台 | 打开岗位、核对来源在站内、进入表单 | 提交 / 筛选题 / 测评入口 |
| 跟进 | 起草、把上下文备齐、写出可编辑草稿 | 发送 |
| 面试 | 备料、模拟追问、评估报告 | 对外确认时间 |

**产品口径**：*"我最后交给你的，是一张停在手交线前、你一眼能验收的单据。"*

这与 dots 的 PR 同构——PR 也是等人 review 的成果，不是自动 merge。

---

## 6. 三个模块

### 6.1 跟进巡检（期一）

#### 6.1.1 放在哪

- **领域逻辑**：新建 `backend/app/services/followup_sweep.py`。
- **调度不新建**：在 `services/agent_task_events.py` 的 `run_for_current_dataset()` 里加 3 行 hook，与提醒扫描共用同一守护线程、同一 `dataset_scope` 租约、同一 Session。

理由：`agent_task_events.py` 现 319 行、余量 181，塞进"查询 + 建卡 + 文案守卫 + 上限"必贴 500 线；另起一条线程会出现两线程争同一租约、两处启停、两套窗口语义；抽通用调度器是纯搬动、零行为收益，**出现第三个事件源时再抽**。

#### 6.1.2 两个阈值、三类卡

| 卡类型 | 判据 | 动作按钮 |
| --- | --- | --- |
| 跟进清单 | 进行中且 **>7 天没有任何更新**（复用 `is_stalled`） | 已联系 / 对方已回 / 不跟了 |
| 确认状态 | 进行中且 **>21 天没有任何更新** | 同上（含"不跟了"） |
| （既有）准备卡 | 提醒到期 | 无（沿用 T26） |

- 两类卡**互斥**：>21 天只出确认卡，不出跟进卡。
- 阈值定义放 `models/tracker.py`，紧邻 `STALLED_DAYS`：
  - `FOLLOWUP_SILENCE_DAYS = STALLED_DAYS`（**别名引用，不是复制字面量**）
  - `CONFIRM_SILENCE_DAYS = 21`
- **21 天分支的意义**：状态长期不更新时，用户八成已经"忘了维护"，这时催跟进等于拿旧数据制造噪音；正确的是先请他确认状态。

#### 6.1.3 去重键

`agent_task` 现有唯一约束只覆盖 `(reminder_id, occurrence_due_at)`，跟进卡的 `reminder_id` 为 NULL，SQLite 视 NULL 互不相同 → **不受约束**，会重复生成。因此新增：

- `source_ref VARCHAR(64) NULL`：`stalled_followup` / `stalled_confirm`（**两类卡各一个桶**，同周可并存且各自唯一）
- `occurrence_key VARCHAR(32) NULL`：本地日期所在 ISO 周，如 `2026-W33`
- 唯一索引 `uq_agent_task_source_occurrence (source, source_ref, occurrence_key)`

旧数据零破坏：既有行两列为 NULL，不参与唯一约束；`uq_agent_task_reminder_occurrence` 原样保留，提醒卡一张不丢、不重。

否决"扫描水位表"：它只能回答"上次扫到哪"，回答不了"这张卡属于哪个桶"，并发挡不住第二张卡，还要跨两表保一致。

#### 6.1.4 让位规则（防双响）

「我已提交」会挂一条 7 天后到期的 `hr_reply` 提醒 → 到期时提醒通道出一张「准备：跟进 X」卡。若巡检同日也出卡，就是同一家公司两张卡。

**规则**：该 track 的 `hr_reply` 提醒最近 7 天内已出过卡（`agent_task` 中 `source=reminder` 且有该 `reminder_id` 的行）→ **巡检让位**。

#### 6.1.5 文案纪律（可测试）

`is_stalled` 的语义是「超过 N 天**没有任何更新**」，注释明确警告调用方不得讲成"面试卡住"。因此：

- **允许**：「投出 8 天，期间没有记录到任何状态变化，要不要发一条跟进？」
- **禁止**：「对方还没回复你」「HR 没回」「已读不回」「面试卡住」

**双向守卫**（缺一不可）：

1. 禁词断言：`FORBIDDEN_PHRASES` 逐条扫。
2. **必备要素正向断言**：每条文案必须含天数、必须含"没有记录到任何状态变化"口径、必须含"要不要…？"式提问。

只做禁词挡不住"换个说法照样断言"的手滑；正向断言把"允许的句式"钉死。建卡时再跑一次运行时自检，命中则用兜底文案并告警。

文案只由 `followup_sweep` 内的模板常量产出，**不调模型**——保证离线可用、可断言、不外发。

#### 6.1.6 扫描与上限

1. 60 秒线程醒 → 取租约（失败整轮跳过）→ `scan_due_reminders` 照旧 → `scan_stalled_tracks(db, now)`。
2. 开关 `get_agent_task_events_enabled()` 关 → 直接 return（已建卡保留，不追删）。
3. 算桶键 → 命中则跳过。
4. 候选过滤：`deleted_at IS NULL`、`status ∈ ACTIVE_STATUSES`、`is_stalled` 复用、**让位规则**、近期已决策排除（`contacted`/`replied` 7 天内、`stopped` 永久）。
5. 按 `updated_at ASC`（最久没动优先）取 **LIMIT 5**，合成**一张**卡；每个岗位一个 `AgentTaskStep(kind=followup|confirm, output_ref={"track_id": n})`。
6. `begin_nested()` 兜 `IntegrityError`（并发只丢这一轮）。

20 家沉默时，其余等下周——不刷屏。

#### 6.1.7 决策落库

`POST /api/followups/decisions`（整卡一次提交、一个事务）：

- 每家写 `application_follow_up` 一行（`decision` = `contacted` / `replied` / `stopped`）+ 该 step 条件写 `status != done → done`。
- **不走 `advance_step`**：它的"不能跳步"是给有依赖的连续步骤设计的；5 家彼此独立，强制顺序只会逼用户按顺序点。
- 全部 step done → 卡转 `done`；重复点击幂等（step 已 done 直接回快照，不新增行）。
- **绝不写 `application_track`**（`status` / `updated_at` / `next_action_date` 一律不碰）。

### 6.2 投递交付单（期一，与巡检同批发布）

#### 6.2.1 它不是新概念

仓库里已经有：

- `models/resume_delivery.py` / `services/resume/resume_delivery.py`（`freeze_delivery` / `list_track_deliveries`）
- `docs/adr/ADR-0002-trust-delivery-ledger.md`：revision（源版本）/ artifact（导出产物）/ attempt（真实投递动作）三组列
- 字段：`resume_title` / `job_title` / `company` / `pages` / `content_sha256` / `artifact_sha256` / `request_params` / `render_context` / `idempotency_key` / `track_id`
- **三条外键全部 `SET NULL`**：简历或岗位被删之后，这张单子依然完整可读

而且 `record_applied()` 内部已经调用 `freeze_delivery`（`services/tracker.py:98 / 258 / 285`）——**「我已提交」只要复用这条写路径，投递快照是自动留下的**。

→ 所以 D2 不是"跨四表新聚合"，而是**给已有快照做一个可验收的读视图**，把 track 状态、填充记录、事实台账疑点旁挂上去。

#### 6.2.2 单据内容

| 区块 | 数据来源 |
| --- | --- |
| 投的是哪一版 | `resume_delivery_record.resume_title` + `content_sha256`；若与当前简历指纹不同，标"投出后简历又改过" |
| 投给谁 | `company` / `job_title` 快照（不反推原简历） |
| 导出产物 | `artifact_sha256` / `pages` / `export_format` / `request_params` |
| 填了哪些字段 | `web_form_fill_record`（按 `url` 匹配；匹配不上标「未知（可能是一键投递）」） |
| 事实台账疑点 | 复用 `resume_risk*` 的疑点数 |
| 距提交还差几步 | `human_steps(...)`，稳定码 → 语言包 |
| 跟进计划 | 该 track 的 `hr_reply` 提醒到期时间 |

#### 6.2.3 三态（建议口径，实施时以表驱动单测确认）

| 状态 | 判据 | 含义 |
| --- | --- | --- |
| **卡在人手上** | 无 `artifact_sha256`；或有未填/失败的必填字段；或还在等 OTP/筛选题 | 正常终态，不是失败 |
| **有疑点** | 事实台账疑点 > 0；或 `pages` 超目标页数 | 能验收，但请先看疑点 |
| **可验收** | 以上都不成立 | 一页看完就能确认 |

**优先级 `卡在人手上 > 有疑点 > 可验收`**：还有人工步骤没做完时，用户的下一步动作是去把它做完，不该被"有疑点"盖住。

**指纹不同只作展示，不参与三态**：快照的 `content_sha256` 与当前简历不一致时，在「投的是哪一版」旁标一行「投出后简历改过」。投完再改简历是常态（为下一家改、补一条经历），把它算疑点会让绝大多数单子常年亮黄灯——颜色一旦可以忽略，三态就废了。

「距提交还差」用稳定码（`captcha_required` / `login_required` / `reupload_resume` / `answer_screening_questions` / `fill_required_field` / `confirm_in_browser`），展示名走语言包——可测、不猜。

#### 6.2.4 验收（ack）

`POST /api/apply/records/{id}/receipt/ack` 写 `apply_task_item.receipt_acked_at`（已有值不覆盖，幂等）。

**不碰漏斗状态**：验收单据不等于推进流程。

#### 6.2.5 五条硬约束（防重复建设）

| 约束 | 原因 |
| --- | --- |
| **不新增指纹列** | `source_content_sha256` + `content_sha256` 已在，ADR-0002 已定义"快照 ≠ 今天"的比对含义 |
| **不重算历史、不在详情页 live 导出 PDF** | `pages` 用产物 `artifact_sha256` 的既有值。为"看单子"跑一次导出，是把只读视图变成有副作用的操作 |
| **不回填、不新写快照** | `record_applied` 已调 `freeze_delivery`，幂等键 `apply_task_item:{id}`（ADR-0002 §3）。历史记录没有快照是事实，不补造 |
| **不提供删除 / 归档** | `resume_delivery_record` 刻意不设 `deleted_at`——"证据不可删、不进回收站、不参与任何删除链路"，`test_trash.py::test_every_deleted_at_table_is_registered` 钉住这一点。验收只写 `receipt_acked_at` |
| **不另起列表** | `GET /api/tracker/{track_id}/deliveries` 已经是"从进度进交付"的入口；交付单是它的**展开视图**，不是第二套列表 |

### 6.3 求职偏好档（期二）

#### 6.3.1 为什么不做成资料板块

资料库是规范化结构（13 个内置大字段与 106 个默认小字段是**代码里的定义**，用户自建部分在 `profile_custom_section` / `profile_custom_field`，值在 `profile_entry`）。偏好**不能**塞进去：

1. **读取者会串**：`profile_entry` 的下游是纸面渲染、生成取数、网申取数（`paper_policy` / `only_material`）。偏好一旦进这张表，会被这三条管线自动当"素材/事实"取用，要逐一加排除，漏一处就违背"偏好不得被当发生过的事"。
2. **定义/值分离是为用户自建字段付的成本**，偏好是封闭 13 类，不需要两张定义表。
3. **语义错位**：`section_key` 的分区是"简历板块"，偏好根本不上纸面。
4. **防编造链路**：`claims*` / `resume_risk*` 按条目做事实校验，偏好混进去会让"杭州上海"这种**意图**变成可对外表述的**事实**证据。

#### 6.3.2 表：`job_preference`（一行一条偏好）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER | PK |
| `pref_id` | VARCHAR(32) | UNIQUE，`uuid4().hex[:24]`，外部稳定 id |
| `dataset_key` | VARCHAR(32) | NOT NULL，index |
| `kind` | VARCHAR(48) | **闭集目录 key**（13 类，见下），定义在代码里不落库 |
| `value_kind` | VARCHAR(8) | CHECK IN ('list','scalar') |
| `value` | JSON | list 存数组，scalar 存小对象 |
| `value_digest` | VARCHAR(64) | canonical sha256，**幂等键**（复用 `proposal_store.fingerprint_payload`） |
| `value_schema` | INTEGER | DEFAULT 1，值形态代 |
| `source` | VARCHAR(16) | CHECK IN ('user_stated','user_edited','imported')——**不含 assistant** |
| `source_proposal_id` | VARCHAR(32) | `user_stated` 时服务层强制非空 |
| `source_message_id` | INTEGER | NULL |
| `note` | VARCHAR(200) | 用户原话摘录 |
| `state` | VARCHAR(16) | CHECK IN ('active','superseded','undone')——**三档，没有 `deleted`** |
| `deleted_at` | DATETIME | **只表示"用户删除了"**，不兼作版本状态 |
| `created_at` / `updated_at` | DATETIME | 后者带 `onupdate` |

**13 类闭集**：`target_role_family`、`target_city`、`exclude_company`、`exclude_industry`、`salary_floor`、`work_mode`、`employment_type`（用工形式：正职/实习/外包/兼职/劳务派遣）、`overtime`、`redline_banned_word`、`redline_length`、`redline_tone`、`available_from`、`session_note`（**不进注入块**）。

**一行 = 一次确认写入的完整取值**：一次"记住：杭州上海、别写赋能"落成 2 行（城市 + 禁用词），不是 5 行 5 个 `updated_at`——否则"一键撤销"只能撤一个词。将来若要项级来源，把 `value` 升成 `[{item, added_at, source}]` 并升 `value_schema`，**列不动、不迁移**。

索引：

```sql
CREATE UNIQUE INDEX ux_job_preference_active_kind
  ON job_preference (dataset_key, kind)
  WHERE state = 'active' AND deleted_at IS NULL;
CREATE INDEX ix_job_preference_kind_state ON job_preference (dataset_key, kind, state);
```

**为什么 `deleted_at` 不承担"非当前版本"的含义**：全库 22 张软删表里，`deleted_at` 只有一个含义——"用户删了它"。一旦它兼作 `superseded` / `undone`，`live_only` / `is_deleted` / `get_live` / `trash_only` / `restore` / `empty` 对本表全部变可疑，而回收站是全库最不能出错的一层。所以：

| 动作 | 写入 |
| --- | --- |
| 编辑（新值替换） | 旧 active → `superseded`，插新行 `active`；**不碰 `deleted_at`** |
| 撤销 | 当前 active → `undone`，最近一条 `superseded` → `active`；**不碰 `deleted_at`** |
| 删除 | active 行 `deleted_at=utcnow()`，`state` 保持 `active`（休眠） |
| 回收站恢复 | `trash.restore` 清 `deleted_at` → 自然复活，**零钩子** |
| 裁剪 | 硬删最旧的 `superseded` 行（机器动作，从不进回收站） |

**删除原因不再是列**：`trimmed` 不该是状态（裁剪就是硬删），`user_delete` 由 `deleted_at` 本身表达，`superseded` / `undone` 由 `state` 表达。原方案的 `deleted_reason` 四档因此净少一列，也避免了"`state='deleted'` 与 `deleted_at` 谁说了算"的分叉。

**读取必须走统一入口**：`live_only` 对本表不够（`superseded` 行的 `deleted_at` 也是 NULL），服务层统一用 `active_pref(db, dataset_key, kind)` = `live_only & state='active'`，禁止裸查。

**恢复撞同 kind 活动行 → 409**，不静默降级：`kind` 是单选轴，"恢复"意味着这条要重新生效，而"把旧那条让位"是另一个动词（版本回退走 `undone`/`superseded` 那条路）。实现上给 `_restore_conflict_detail` 加一个鸭子类型分支（有 `dataset_key` 且有 `kind` 列，约 6 行）+ 一条"造两条同 kind → 409"的单测。这是本模块唯一需要动 `trash.py` 的地方。

#### 6.3.3 写入：复用 proposal，不新增类型

新增两个工具 `create_job_preference` / `update_job_preference`，登记进 `policy.ALWAYS_PROPOSAL_TOOLS`（现为 `{"create_skill", "update_skill"}`）。理由与 `create_skill` 同类：偏好直接进下一轮系统提示，`write_full` 下若允许模型直写，等于让模型改自己的输入指令。

时序：

1. 模型调工具，`writes=True` 必带 `preview`。
2. `proposal_store.create()` 落 pending：arguments + preview（目标 kind、当前活动行 `pref_id` 与 digest、"将记住：…"）+ `target_fingerprint`。
3. 用户确认 → `approve`（条件 UPDATE `pending→approved`，rowcount=1 防双批准）→ `consume` 核销 → `ensure_target_unchanged`（漂移则 expired 409）。
4. `upsert_preference()`：同 kind 同 `value_digest` → **no-op**（summary"已存在，未改动"）；否则旧行 `state='superseded'` → 插新行 `active`。
5. `mark_executed(summary)` → 幂等回写消息。
6. 下一轮：注入块出现新值。

**撤销**：`POST /api/job-preferences/{pref_id}/undo`，点按钮本身就是确认，**不进 proposal**（助手侧不提供撤销工具，与"没有删除类工具"的既有口径一致）。

- 校验 `pref_id` 是当前活动行，否则 409 `not_current`（不静默 200）。
- 同一事务内**先让位后复原**：当前行 `state='undone'`，同 kind 最近一条 `superseded` → `state='active'`。两处都不写 `deleted_at`，所以**不会与 partial unique index 打架**（索引条件是 `state='active' AND deleted_at IS NULL`，同一时刻只允许一行满足）。
- 无上一版 → 空态。

**删除与恢复**：删除只写 `deleted_at`（`state` 保持 `active`）；恢复清 `deleted_at`。若同 kind 已有活动行，恢复返回 409 `trash_restore_conflict`，由用户先撤掉当前那条——不替用户猜"该让谁让位"。

#### 6.3.4 注入

**位置**：`assistant_system_prompt._system_prompt` 的 `parts` 里，`_proposal_status_block(...)` **之后**、`_local_time_note()` / `build_skill_prompt` **之前**。

- 必须在基础提示之后：偏好效力来自"用户在环确认"，不是系统规则升级。
- 必须在技能块之前：技能是更具体、更晚的写作规范，应压过泛化偏好。
- **不写进 `app/prompts/assistant_system.md`**：那是随代码分发的静态正文，偏好是数据。

**格式**（三个结构特征缺一不可）：

```
【求职偏好（用户设定，不是发生过的事实）】
以下条目是用户为"你该怎么做"设定的约束，来自用户确认，不是他的经历；
不得作为事实引用，不得写进简历正文/事实台账/对外表述。
- 城市：杭州、上海（用户陈述，10-03 更新）
- 排除：外包（公司/行业）
- 写作红线：禁用「赋能」「抓手」；正文 1 页
【求职偏好结束】
```

标题写"不是发生过的事实"、块尾有结束标记、每条带目录中文标签（不是模型自由文本）。

**预算**：目录仅 13 类 → 天然 ≤13 行；硬上限 24 条，超出写"另有 N 条未列出"；单条值截断 120 字符、列表最多 8 项；整块上限 900 字符。超限两段降级：先省"来源/更新时间"后缀，再按 `inject_priority` 裁尾——**不先丢条目**（丢条目会让助手忘掉用户明确设过的约束，丢时间戳只是少一句废话）。0 条返回空串，不注入空块。

改装配后必须同时跑 `tests/test_assistant_prompt_budget.py`（`MAX_PROMPT_TOKENS_ESTIMATE = 60_000`）与 `tests/test_assistant_prompt_surface.py`（钉着"系统提示不得否认工具已有能力"一类守卫）。

**权限：四档全注入，含 `read_only`。** `read_only` 锁的是"服务端替用户读出的敏感资料"；偏好是用户主动设定并期待被遵守的指令，不是替他读出的隐私。不注入的话，`read_only`（新用户默认档）下偏好档等于不存在——功能上线、默认配置下静默失效，是最坏的失败方式。

#### 6.3.5 三条防污染的结构性约束

| # | 约束 | 只靠提示词会怎么失效 |
| --- | --- | --- |
| 1 | **闭集 kind + 逐 kind 值校验器**：`target_city` 拒绝含数字/履历名词的值；`salary_floor` 必须解析成 `{amount, unit, currency}` | 系统提示已写"不得虚构事实"，模型照样会把"我带过 5 人团队"写成偏好——提示词只给语义边界，遵守是概率性的。有了白名单 + 校验器，这条路径在**参数校验阶段（422）**就不存在 |
| 2 | **来源是闭集且不含 assistant**；`user_stated` 必须有已 executed 的 proposal | 模型只要在文本里说"已记住"而库里没变，用户就以为生效了；反向也成立——直接调 service 凭参数落库就绕过确认 |
| 3 | **"长期"与"这次"由界面决定**：确认卡两个按钮「以后都这样」/「只在这次对话」；且偏好永不进 `profile_entry` / `claim` / 生成取数 | 偏好块和"安全与事实规则"在同一份提示里，模型可以在写简历时把"期望城市：杭州"写进正文——真正的挡法在渲染侧：简历正文只从 `resume`/`claim` 取数，偏好**没有进入那条 DTO 的通道** |

---

## 7. 数据模型与迁移

| 迁移 | 内容 | 升降级 / 旧数据 |
| --- | --- | --- |
| `0006_followup_sweep.py` | ① `agent_task` +`source_ref` / +`occurrence_key` / +唯一索引；② 新表 `application_follow_up`(id, track_id FK CASCADE, decided_at, decision, draft_text, note, task_id, created_at) + 索引 `(track_id, decided_at)` | upgrade 逐项"不存在才做"（沿用 0005 写法）；downgrade 严格反序。既有 `agent_task` 行两列 NULL，不受新约束；提醒卡去重语义不变；新表空起步不回填（历史"催过没"无据，不编造） |
| `0007_delivery_receipt.py` | `apply_task_item` +`receipt_acked_at DateTime NULL` | 只加列；旧行 NULL = 未验收，如实呈现 |
| `0008_job_preference.py` | 新表 `job_preference`（`state` 三档 + `deleted_at`）+ 1 个 CHECK + 2 个索引（唯一索引条件 `state='active' AND deleted_at IS NULL`）；`TRASH_SPECS` 登记、计数 22→23 | 不改任何既有表列，downgrade 无损；恢复撞同 kind → 409 |

`0006` 与 `0007` 同属期一、同一批发布；`0008` 属期二。

**迁移纪律**：

- `down_revision` 必须串成一条线（0006 → 0007 → 0008）。双 head 会让 `tests/migration_refs.head_revision()` 拿不到唯一 head，`test_baseline_schema` 往返集体红。
- 测试**禁止写死 revision 字面量**，只用 `BASELINE_REVISION` / `head_revision()`。守卫：`grep -rnE '"[0-9]{4}_[a-z0-9_]+"' backend/tests --include=*.py`（只应命中 `migration_refs.py`）。
- 建表前 `inspect().get_table_names()` 判存在，因为迁移会跑在只有部分业务表的库上。
- 表内 CHECK 用 `sa.CheckConstraint`，不靠服务层。

---

## 8. 接口清单

| 方法 | 路径 | 用途 | 备注 |
| --- | --- | --- | --- |
| POST | `/api/apply/records/{id}/submitted` | 「我已提交」 | 复用 `record_applied` + 挂/更新 `hr_reply` 提醒；幂等 |
| POST | `/api/followups/decisions` | 整卡提交跟进决策 | 一个事务，幂等 |
| GET | `/api/apply/records/{id}/receipt` | 交付单读视图 | 失败记录也可读（给"卡在人手上"） |
| POST | `/api/apply/records/{id}/receipt/ack` | 验收 | 写 `receipt_acked_at`，不碰 track |
| GET | `/api/job-preferences` | 列出偏好 | 只读工具同源 |
| POST / PATCH / DELETE | `/api/job-preferences[/{pref_id}]` | 直接编辑 / 删除 | `user_edited` / `user_delete` |
| POST | `/api/job-preferences/{pref_id}/undo` | 撤销到上一版 | 先删后恢复 |

助手工具：`get_job_preferences`（只读）、`create_job_preference` / `update_job_preference`（写，必走提案）。

路由注册：新文件在 `api/` 下 `add_action_route(...)`，并登记进 `application_routers.ROUTERS`（顺序是行为契约）。

---

## 9. 前端落点

| 文件 | 改动 | 余量 |
| --- | --- | --- |
| `frontend/src/features/followup/{FollowupCard.tsx,useFollowupDecisions.ts}` | 新建：三类卡 + 三按钮 | 新 |
| `frontend/src/features/assistant/tasks/{AgentTaskRow.tsx,agentTaskView.ts}` | 按 `source` + `kind` 分支渲染 | 134 / 122，够 |
| `frontend/src/features/apply/ApplyRecordDetailDrawer.tsx` | 加「我已提交」按钮（期一上半）；加交付单段（期一下半） | 191 → 约 230 |
| `frontend/src/features/apply/receipt/{DeliveryReceipt.tsx,receiptContract.test.ts}` | 新建：渲染 + 契约测试 | 新 |
| `frontend/src/features/job-preference/*` | 新建：列表、行、确认卡、hook、api | 新 |
| `frontend/src/i18n/messages/{zh-CN,en-US}.{followupSweep,deliveryReceipt,jobPreference}.ts` | 新 key；命名空间只改 `namespaces.ts` | 新 |
| `frontend/src/styles/{followup,apply,job-preference}.css` | 新类名必须真的存在 | — |

约束：新中文文案一律走 `t()`（`cjkRatchet` 逐文件比较）；`tsx` 内不做聚合与阈值计算。

---

## 10. 任务分解

### 期一（上半）：跟进巡检 + 「我已提交」（迁移 0006）

| ID | 任务 | 依赖 | 完成判据 |
| --- | --- | --- | --- |
| T01 | 数据层：`0006` 迁移 + `agent_task` 两列与唯一索引 + `application_follow_up` 模型 + `models/__init__` 注册 | — | 空库 `upgrade head` 建全表；`downgrade -1` 干净、`upgrade head` 复原；迁移后重复插 `(reminder_id, occurrence_due_at)` 仍报 `IntegrityError`；行数守卫绿 |
| T02 | `followup_sweep.py`：两桶扫描、让位、上限 5、模板文案 + 双向自检 | T01 | 7d/21d 分流互斥；同周各桶仅 1 卡；开关关零写入；近 7 天已决策不入选、`stopped` 永久排除；提醒卡 7 天内让位；文案双向断言通过 |
| T03 | `agent_task_events` hook + 开关复用 + 一次性引导键 | T02 | 关闭总开关后不发卡（旧卡保留）；hook 不改提醒扫描既有行为 |
| T04 | `POST /api/followups/decisions` + 幂等 | T01 | 三家乱序提交均落库；重复提交不新增行；决策不写 `application_track` |
| T05 | 「我已提交」写侧：`submit_confirmation.py` + 端点 + `record_applied` 的 `user_confirmed` 透传 + 提醒 upsert | T01 | 点击后 1 条 track（合并键去重）+ 1 条 `hr_reply` 提醒（+7d）+ 1 条投递快照；连点 3 次行数不变；已在「面试」的 track 不被降级 |
| T06 | 前端跟进卡 + 任务卡分支 + i18n / 样式 | T02,T04 | 三家可乱序决策；「确认状态」卡无跟进按钮；文案全走 `t()` |
| T07 | 前端「我已提交」按钮 + 一次性引导 | T05 | 点击后显示提醒日期；引导只出现一次；关掉总开关后引导不再弹 |

### 期一（下半）：投递交付单（迁移 0007，与上半同批发布）

| ID | 任务 | 依赖 | 完成判据 |
| --- | --- | --- | --- |
| T08 | `0007` 迁移 + `delivery_receipt.py`（`human_steps` + `judge_receipt`）+ 两个端点 | T01 | 三态矩阵全绿；`卡在人手上` 优先于 `有疑点`；快照缺失判 `卡在人手上`；填充记录无匹配标「未知」而非缺件；ack 幂等且不改 track |
| T09 | 前端交付单段 + 契约测试 | T08 | 三份 fixture（仅 state 不同）渲染三种徽标；tsx 内无聚合/阈值计算 |

### 期二：求职偏好档（迁移 0008）

| ID | 任务 | 依赖 | 完成判据 |
| --- | --- | --- | --- |
| T10 | `0008` 迁移 + `job_preference` 模型 + 13 类目录与校验器 + `TRASH_SPECS` 登记 | T08 | 迁移往返绿；非法 kind / 非法值形状 422；`salary_floor` 解析成结构化对象；`test_every_deleted_at_table_is_registered` 绿（22→23，展示名紧挨 `claim`，`TRASH_LABELS_EN` 补英文，不得插进 `job` 与 `candidate_job` 之间） |
| T11 | `job_preference_service`：upsert / undo / 删除恢复 / 裁剪 / 查询 | T10 | 同值 no-op（`updated_at` 不变）；undo 两次第二次 409；无上一版给空态；`superseded` 行不出现在列表与详情；删除→恢复闭环；恢复撞同 kind → 409 `trash_restore_conflict` |
| T12 | 两个写工具 + `ALWAYS_PROPOSAL_TOOLS` 登记 + 读工具 | T11 | 绕过提案直写抛错；提案 `rejected` 后执行抛错；`write_full` 下仍走提案 |
| T13 | 注入块：渲染 + 预算 + 两段降级 + `parts` 顺序 | T11 | 0 条为空串；12 条 ≤900 字符；`read_only` 下仍在；偏好块在 status 块后、技能块前 |
| T14 | 前端偏好页（设置 → 助手与 AI 行为）+ 确认卡两按钮 + 撤销 | T12,T13 | 「以后都这样」/「这次」分别落不同 kind；撤销回到上一版；zh/en 语言包对等 |

> 代码可并行，**迁移头是唯一串行点**。T05 供数据给 T02 消费；T09 消费 T05 的投递记录与 T02 的跟进计划。期一上下两半**同批发布**——交付单只多一列 + 一个读视图，单独发版不划算。期一结束再进期二，避免同时开两个写入面。

---

## 11. 测试与守卫

| 守卫 | 断言 |
| --- | --- |
| 阈值同源 | `test_followup_thresholds_single_source`：`FOLLOWUP_SILENCE_DAYS == STALLED_DAYS`、`CONFIRM_SILENCE_DAYS == 21` 且两者不等；把 `STALLED_DAYS` 改 6，`/api/stats` 与巡检候选**同步**变化 |
| 文案 | 禁词 + 必备要素两条互不掩盖：改成"对方还没回复你"→ 前者红；改成"该岗位已 8 天无进展"→ 后者红（缺提问） |
| 去重 | 删唯一索引 → `test_one_card_per_bucket_per_week` 红（并发两次扫描出 2 张卡） |
| 让位 | 删让位规则 → `test_reminder_channel_wins_for_7_days` 红并报"同周两张卡" |
| 交付单 | `test_state_matrix`（表驱动）+ `test_waiting_human_beats_doubts`；优先级改反 → 仅该行红 |
| 偏好隔离（最重要） | 只设偏好、不设资料的库里，取 `build_llm_profile_prompt_data` / 简历生成 payload / `list_claims`，`assert "杭州" not in ...` |
| 偏好来源 | 绕过提案直调 `upsert_preference(source='user_stated', source_proposal_id=None)` → 抛错 |
| 偏好状态机 | 编辑只置 `superseded`、撤销只置 `undone`、删除只写 `deleted_at`；服务层无裸查（`active_pref` 之外查本表要 grep 断言）；删 → 恢复闭环；恢复撞同 kind → 409 |
| 迁移 | `test_migration_0006_0007_0008_round_trip`（`upgrade head → downgrade -1 ×3 → upgrade head`），只用 `head_revision()` |
| 预算与 i18n | `test_file_size_budget`（含测试文件）；`cjkRatchet`；`messagePacks` zh/en 对等；类名存在性 |

**反证纪律**：每条守卫都要做一次"临时改坏 → 目标用例精确变红（失败信息指向目标断言，不是导入错误）→ 逐字节复原 → 复跑仍绿"。没有反证的守卫只能证明"当前产物长这样"。

---

## 12. 风险

| 风险 | 具体表现 | 防法 |
| --- | --- | --- |
| 编造放大 | 跟进草稿写出"上次通话中您提到…"、薪资、入职时间 | 草稿只引用事实台账已登记事实与岗位原文，未登记留 `[待填]`；生成后过一遍台账比对 |
| 自报状态腐烂 | 用户从不回填，三周后巡检拿旧状态乱催 | 21 天转「确认状态」卡；卡上标注"基于你 8 月 12 日的记录"；给「我不记得了」清除记录，不替用户猜 |
| 越权 | 巡检为了判断"有没有回复"去读邮箱/爬网站 | 只读本地 track；状态只能由用户或填表记录驱动；写入走提案且请求级 `allow_write` 保持 false |
| 账号被封 | 任何"自动刷新/自动点击投递" | 维持红线 2/3 |
| 记忆污染 | 模型把"这次不想去上海"记成"永不去上海" | 只接受显式确认的 proposal 写入；带来源与 `updated_at`；引用时显示出处；可一键撤销 |
| 伪主动变骚扰 | 一天生成 20 张跟进卡 | 单次上限 5 + 桶键去重 + 合并成一张 + 总开关默认关 |
| 开关失效 | 关了总开关，巡检仍在后台跑 | 保持 T26 语义：关闭时扫描 return；D1 必须走同一个开关 |

### 12.1 止损线

- **期一上线 4 周**：待办打开率 < 20% **且** 处理率 < 10% → 机制有效但产出不对味，停止扩巡检类型。
- **交付单不设止损**：成本约 1.5 天、三态纯读、不产生写入面；周投递量低时它退化成"偶发可查"，但不增加维护负担——所以它跟着期一走，不单独判断。
- **偏好档是观察项**：期一之后看用户是否反复交代同一条约束。几乎没人重复交代，说明这个摩擦不成立，期二可以不做。
- 若必须砍一项：**先砍偏好档，保留巡检 + 交付单**——前两项读的是已有数据，偏好档要新增写入面与提案类型。

### 12.2 已知的既有红灯（不属于本计划）

`backend/scripts/dump_baseline_ddl.py --check` 当前**退出码 1**：

```
- migrations/baseline_v2/core.py：第 391 行不一致：期望 "kind VARCHAR(16) DEFAULT 'normal' NOT NULL,"，实际 "PRIMARY KEY (id),"
- migrations/baseline_v2/other.py：第 11 行不一致：期望 "CREATE TABLE agent_task ("，实际 "CREATE TABLE app_schema_epoch ("
```

原因：0002–0005 建的 `assistant_write_proposal` / `agent_task` / `assistant_conversation_skill` 从未折进基线。

2026-11-09 复查：输出与上文逐字一致，仍为红（不是本轮改动引入的）。

处理原则：

1. **不要重跑生成器**（不带 `--check`）——会把这几张表塞进基线，与后续迁移重复建表，直接炸库。
2. 本计划只加迁移，不修这条红灯；是否单独立项把这四张表折进基线，另行决定。

---

## 13. 剩余待观察（不是待决策）

以下几条不需要现在拍板，按实施与上线后的数据决定：

1. **「对方已回」之后的改阶段摩擦**：首版不做深链（已定）。若回填率尚可但用户普遍在点完「对方已回」后立刻去漏斗改状态，再补一个"顺手改阶段"的深链。
2. **交付单 URL 匹配的命中率**：上线后统计"未知（可能是一键投递）"的比例；超过一半再考虑在"从投递记录进入填表"这一条路径落 `job_id`（只做有上下文的那条，不追求全覆盖）。
3. **偏好档是否真的被用**：期一上线后看用户是否反复交代同一条约束。几乎没人重复交代，说明这个摩擦不成立，期二可以不做。
4. **基线漂移红灯是否立项**：见 §12.2，属于既有技术债，与本计划解耦。
5. **裁剪上限**：同一 kind 历史超过 20 条时硬删最旧 `superseded`。数字未经实测，先按 20，观察真实使用后调整。

---

## 14. 实机验证环境（已按当前工作树核实）

| 需要什么 | 怎么做 |
| --- | --- |
| 建库 + 真实数据 | 在**仓库根目录**跑 `backend\.venv\Scripts\python.exe scripts\seed_demo_data.py --out <临时目录>/verify.db --check`：它先 `drop_all` 再跑**真实的 `alembic upgrade head`**，造完数后用应用自己的只读接口逐个自检。**不要用 `create_all`**——`app_schema_epoch` 由基线迁移播种，`create_all` 建出来的库会被启动闸门判 `REFUSE_UNKNOWN`（`TestClient` 不跑 lifespan，所以相关测试仍可能是绿的） |
| 起后端 | `DATABASE_URL=sqlite:///<临时目录>/verify.db`（`scripts/seed_demo_data.py` 用的就是这条；`RF_DATA_DIR` 只控制附件/备份目录，**不是**数据库位置）。**绝不**动 `backend/data/resume_forge.db` |
| 模型配置 | `PUT /api/settings/llm`（该端点有 loopback 守卫，只能在跑后端的本机改）：`{"provider":"deepseek","base_url":"https://api.deepseek.com","api_key":"<DEEPSEEK_API_KEY>","model":"deepseek-flash","api_style":"openai"}`。`deepseek-v4-flash` 是兼容别名；DeepSeek 的 thinking **默认开**（`services/llm/thinking.py`），验证时可关省 token |
| 起后端 | `backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005`。系统 Python 缺依赖会在 import 阶段静默退出；用 `Start-Process` 必须带 `-RedirectStandardError` |
| 前端 e2e | `frontend/playwright.config.ts` + `npm run smoke`；改动相关 `.test.tsx` 先跑 |
| 截图 | 等 `.ant-skeleton` 隐藏再拍，否则只拍到灰条 |

**判绿三件套，缺一不可**：后端汇总行 `failed = 0`；前端同时看 `Errors` 行（未开 `globals` 时 RTL 自动 cleanup 不注册，单文件跑永不复现）；覆盖率报告真的打印出来且 ≥ 80（串行 `coverage run`，不能与 `-n` 并行写进同一条命令）。

---

## 15. 执行边界（给接手实施的代理）

1. **工作树是脏的**：300+ 项改动 + 大量未跟踪新文件（助手层重构）。禁止 `git checkout --` / `git stash` / `git restore` 做回滚或"回红实验"——会连带回滚别人的未提交改动。返工用仓库外快照。
2. **同一文件只能有一个写入者**。`application_routers.py`、i18n 命名空间、`schemas/*`、`CHANGELOG.md` 这类共享文件由一个人统一落，其他人只提"需要什么"。
3. **不 commit、不 push**，除非用户明确要求。
4. **不改 `STALLED_DAYS`**（`/api/stats` 与看板共用，有守卫钉住）；**不重跑** `backend/scripts/dump_baseline_ddl.py`（只允许 `--check`）。
5. 预期**零新增依赖**；确有需要必须说明理由并检查许可证与体积。
6. 每个任务的"完成"都要留证据：命令 + 原始输出 + 真实数据（DB 行、API 响应、截图），不接受"测试通过"四个字。
7. 本轮改动不进入**基线冻结**范围：只加迁移 `0006`/`0007`/`0008`，不改 `0001_baseline_v2`。
8. **本计划依赖工作树里未提交的改动**：`policy.ALWAYS_PROPOSAL_TOOLS`（`policy.py` 新增 18 行，HEAD 里没有）、`services/assistant/*` 拆分、`api/assistant_permission.py` 等。若这些改动被回退或没有提交，偏好档的"强制走提案"与注入点都会落空——**先停下确认，不要自己重建一套**。

---

## 16. 附录

### A. 外部信息来源（2026-11-08 核实）

| 内容 | 来源 |
| --- | --- |
| Dots 发布、GPT-6 Astra、Pro 门槛、4000+ 应用 | OpenAI DevDay 报道（2026-09-29）；techworld.news（2026-10-27） |
| Dots 11-03 增加 GPT-6.1 Terra、Enterprise 11-18 起默认开启并计费 | ToolColumn 计划说明（2026-11）；Web AI News（2026-11-07） |
| Cue 四件套、邀请制、routines（截至 11-09 仍未 GA） | Manus 2.0 发布报道（2026-09-28）；tooldirectory.ai（2026-10-31 复核） |
| Muse 与 MuseSecureVM、Checkout 卡；日本 10-23、墨西哥；11-06 实时语音与形象 | 2026-09-08 发布；银河证券月报（2026-10-12）；AI 日报（2026-11-06） |
| Grok Bot 共享云电脑、routine、Enterprise/Teams GA、10-09 起独立邮箱、Shop Pay | grokmag.com 指南（8-11 至 10-17 时间线）；x.ai 定价页（2026-10-22）；crosswalk 对比（2026-11）；Shopify Fall '26（2026-11-04） |
| Claude Duet 简报/巡检/6000 连接器/审批红线；截至 11-06 仍为美国 waitlist | claude.com 官方文章；21 世纪经济报道（2026-10-22）；aiagent.nl（2026-11-06） |
| 11 月新入场的 Copilot / Buddy One / Teammates / 灵光 2.0 | 中国新闻周刊（2026-11-08）；AI 日报（2026-11-06）；新浪科技（2026-11-02） |
| AI 求职 Agent 四共识、LinkedIn 禁自动化 | myjobb.ai 与 jobsaicopilot 横向评测（2026-10 口径） |
| 晓叶 2.0 六大能力 | 中国劳动保障新闻网（2026-09-12） |

### B. 与既有文档的关系

| 文档 | 关系 |
| --- | --- |
| `AGENTS.md` | 上位规则：渐进式改造、测试优先、500 行预算、不主动 commit |
| `docs/agent-native-roadmap.md` | 本文是其中"领域工作流编排"的最小落地：复用现有调度、提案、权限原语，不引入 Agent 框架 |
| `docs/adr/ADR-0002-trust-delivery-ledger.md` | 交付单直接建立在它定义的 revision / artifact / attempt 三组列上 |
| `docs/verification-playbook.md` | 反证方法与守卫模板 |

### C. 验证命令

```powershell
# 后端：相关用例先行，再全量 + 覆盖率
$env:PYTHONUTF8 = "1"
cd backend
.venv\Scripts\python.exe -m pytest -q tests/test_followup_sweep.py tests/test_delivery_receipt.py tests/test_job_preference.py
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m pytest -n 4

# 迁移往返
.venv\Scripts\python.exe -m pytest -q tests/test_baseline_schema.py tests/test_migration_0006_0007_0008.py

# 基线漂移（预期红，见 §12.2；不要重跑生成器）
.venv\Scripts\python.exe scripts/dump_baseline_ddl.py --check
```

```powershell
# 前端
cd frontend
npm test
npm run format:check
npm run lint
npm run typecheck
npm run build
```
