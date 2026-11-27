# HTTP API 参考（外部简历与简历引用）

这篇只写**本轮新增或改过语义**的那几条协议：收藏页的简历读模型、投递台的
`external_resume_id`、岗位匹配的文本级比对、助手与进度页的 `resume_ref`。
完整端点清单以运行中的应用为准：`GET /openapi.json`（界面在 `/docs`）由 FastAPI 从代码生成，
比手写文档更不容易过期。

读这篇之前先记住一条：**内部简历与外部简历是两张表，id 各自从 1 开始，会撞号**。
所以凡是"指一份简历"的地方，协议里都只出现两种写法之一——两个互斥字段，或复合引用 `ref`；
**不存在"裸数字同时指两边"的写法**。

## 通用约定

### 分页

- 收藏页：`GET /api/favorites` 返回 `{ "items": [...], "total": 12 }`（`Page[T]`）。
- 外部简历列表：`GET /api/external-resumes` 额外回显 `page` / `page_size`。
- `page` 从 1 开始；`page_size` 默认 20、上限 100（各端点在自己的 schema 里声明）。

### 简历复合引用（`ResumeRef`）

| 写法 | 含义 | 说明 |
| --- | --- | --- |
| `internal:12` | 内部简历（`resume_record.id = 12`） | 当前写法 |
| `external:7` | 外部简历（`external_resume.id = 7`） | 当前写法 |
| `r:12` / `e:7` | 2026-11 之前的旧写法 | 服务端仍能解析（旧提示 / 旧表单会带），但界面与新写路径只产出上面两种 |

约定：

- 引用是字符串，落到请求体时**再拆回两个独立字段**（`resume_id` / `external_resume_id`），
  不让复合串流进存储层。
- 前端解析函数是 `frontend/src/types/resumeRef.ts` 的 `decodeResumeRef` / `resumeRefIds`；
  后端是 `backend/app/services/resume_ref.py` 的 `resolve_resume_ref`。
- 两端对"非法串"的处理一致：解析不出就当作**没有选择**，不猜、不抛白屏。
- 两个字段**互斥**：同时给非空值返回 422；PATCH 里改选一侧时，服务端负责把另一侧清空。

### 错误

- 422：字段校验失败；简历引用互斥、指向已删除的简历、外部简历没有正文等业务前置条件不满足。
- 404：简历 / 岗位 / 历史版本不存在，或不属于这份简历。
- 外部简历编辑相关的 422 会带**原因码**（如 `pdf_no_text_layer`、`docx_text_in_table`），
  界面按语言包翻译，不直接展示后端中文原句。

## 收藏页：`GET /api/favorites`

一次返回**内部 + 外部**两种收藏行，按收藏时间倒序（时间不详的排最后，再以 `(kind, id)` 定序防抖）。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `kind` | `all` | `all` / `internal` / `external` |
| `keyword` | 空 | 匹配简历标题或文件名、关联岗位、公司 |
| `page` | 1 | 页码 |
| `page_size` | 20 | 每页条数（1–100） |

每行字段（两张表的并集，另一侧独有的列留空）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | `"internal"` \| `"external"` | **永远显式给出**，不能靠 id 区间猜 |
| `id` | int | 在**自己那张表**里的 id |
| `ref` | string | `internal:12` / `external:7`，前端用它做 rowKey 与跳转 |
| `title` | string | 内部 = 简历标题；外部 = 文件名（用户可改名） |
| `job_title` / `company` | string | 关联岗位；空串 = 通用 / 未关联 / 岗位已彻底删除 |
| `source` | string | 仅内部简历有（`ai` / `manual`） |
| `mime` / `file_id` | string / int? | 仅外部简历有，用于原件预览与类型徽标 |
| `note` | string | 收藏备注，空串 = 没写 |
| `text_chars` / `has_text` | int? / bool? | 仅外部简历有；`has_text=false` 时界面禁用"用于面试" |
| `favorited_at` / `favorited_at_estimated` | datetime? / bool | 老数据的收藏时间可能是回填的近似值，界面显示「时间不详」 |
| `created_at` / `updated_at` | datetime | 记录时间 |

岗位收藏仍走 `GET /api/jobs/favorites`，两条路径没有交集。

## 外部简历：`/api/external-resumes`

| 方法与路径 | 说明 |
| --- | --- |
| `POST /api/external-resumes` | multipart 上传：`file` 必填，`name`、`job_id` 选填；本地提取正文后建行，扫描件也建行但正文为空 |
| `GET /api/external-resumes` | 列表：`keyword` / `job_id` / `include_general` / `page` / `page_size` / `sort` / `order` |
| `GET /api/external-resumes/{id}` | 详情（含上传时提取的正文） |
| `PATCH /api/external-resumes/{id}` | 改名 / 关联岗位（改名只存文件名词干，≤256 字，不带扩展名） |
| `PATCH /api/external-resumes/{id}/favorite` | 收藏 / 取消收藏 |
| `PATCH /api/external-resumes/{id}/note` | 收藏备注 |
| `DELETE /api/external-resumes/{id}` | 软删（进回收站；物理文件不动） |
| `GET /api/external-resumes/{id}/file` | 原件；`download=true` 变成附件下载，`revision_id=` 取历史版本 |
| `GET /api/external-resumes/{id}/blocks` | 可编辑单元（PDF 按块 / DOCX 按段 / TXT/MD 整篇） |
| `POST /api/external-resumes/{id}/edit` | 改一段文字，**另存为新版本** |
| `GET /api/external-resumes/{id}/revisions` | 历史版本（时间倒序） |
| `GET /api/external-resumes/{id}/revisions/{revision_id}/text` | 某一版正文（对比用） |
| `POST /api/external-resumes/{id}/revisions/{revision_id}/restore` | 恢复：**再写一条**新版本，不改写历史 |

`include_general=true` 是给"求职进度选简历"用的：给了 `job_id` 时把范围扩成
「本岗位 **或** 通用」，与 `GET /api/resumes` 的内部简历口径逐字一致。

`sort` 取 `name` / `job_title` / `created_at` / `text_chars`，`order` 取 `asc` / `desc`，
默认 `created_at desc`。

## 投递台：队列项的 `external_resume_id`

`POST /api/apply/queue` 的 `items[]` 与 `PATCH /api/apply/queue/{item_id}` 都接受：

| 字段 | 说明 |
| --- | --- |
| `resume_id` | 内部简历 id |
| `external_resume_id` | 外部简历 id，**与 `resume_id` 互斥** |
| `image_ids` | 招呼语配图（`user_file.id`），空列表 = 这条明确不发图 |

- 同时给两个 id → 422；PATCH 合并后的状态由服务层兜住（改选一侧就清另一侧）。
- 指向回收站或已删除的外部简历 → 422，不会留到投递时变成 500。
- 运行时按 `external_resume.file_id` 定位原件（**不复制字节**）；队列与记录里只留 `resume_title`
  快照（纯文件名，「外部 · 」前缀由界面加），历史记录读得懂当时用的是哪一份。

## 岗位匹配：文本级

`POST /api/jobs/{job_id}/match-analysis-text-level`

请求体只有一个字段：`{ "external_resume_id": 7 }`。

响应带 `method: "text_level"` 与两组词（核心 / 补充）的 `target_words` / `matched_words` /
`missing_words`，以及正文摘录 `highlights`。**没有评分字段，也没有准入结论**——它回答的是
"JD 里的词在这份正文里出现了没有"，与结构化匹配的分母不同，界面必须分开显示并标「文本级」。

## 求职进度与提醒

- `POST /api/tracker`、`PATCH /api/tracker/{id}`：`resume_id` 与 `external_resume_id` 互斥，
  同时给 422；`resume_title` 是**标题快照**，外部关联写入 `external_resume.name`，清空关联不清标题。
- `POST /api/reminders`、`PATCH /api/reminders/{id}`：同样两个互斥字段；响应额外回显
  `external_resume_name`（提醒表没有标题快照列）。

## 助手：`resume_ref`

`POST /api/assistant/conversations/{conversation_id}/messages` 的请求体新增：

| 字段 | 说明 |
| --- | --- |
| `resume_ref` | `internal:12` / `external:7`；与 `resume_id` 同时给时**以本字段为准** |
| `resume_id` | 保留给旧客户端与旧会话重放 |

- 外部简历按**正文**喂给模型；没有文字层时把原因原样交给模型转述，不编内容。
- 响应与消息快照回显实际解析到的 `resume_ref`（可能是旧写法），前端据此显示或校正 chip。
- 助手只读工具 `run_resume_quality_check` 同样接受 `resume_ref`，`resume_id` 不再是必填。

## 模拟面试：外部简历怎么进请求

`POST /api/interview` **没有** `external_resume_id` 字段。选外部简历时，界面把它的正文投影成
`resume_material: { name, text }` 提交（内部简历仍走 `resume_id`）。这条边界由
`frontend/src/features/interview/materialPayload.ts` 收口，避免把 `external:7` 当数字发出去。

## 深链（前端路由，不是 API）

`/resumes/external?resume=<id>`：接受 `7`、`external:7`、`e:7` 三种写法；打开详情后把参数从地址栏
清掉（`replace`，不写历史）。id 不存在或已被删除时给一条**可关闭**的提示，不静默失败。
`internal:8` 在这个页面判为非法——内部简历的深链是 `/resumes?resume_id=`。

## 相关文档

- 外部简历能用在哪些页面、有哪些限制：[外部简历](external-resume.md)
- 设置页的 Key、连接矩阵与更新提醒：[使用指南 · 设置页](user-guide.md#设置页十一个分组与搜索)
- 代码分层与这些端点落在哪：[架构设计](architecture.md)
