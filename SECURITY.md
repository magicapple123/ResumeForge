<p align="center"><a href="#简体中文">简体中文</a> · <b>English</b></p>

# Security Policy

ResumeForge is a single-user tool that runs locally for individuals. It handles sensitive material — resumes, contact details, photos, experience summaries and LLM API keys — so read the boundaries below before you rely on it.

## Supported versions

| Version | Security updates |
| ------- | ---------------- |
| `2.x` (current line: `main` plus the latest release `2.0.0`, 2026-11-04) | Supported |
| `1.0.x` (`1.0.2` is the final release) | No longer updated; see the note on opening 1.0.x data below |
| Earlier commits or locally modified builds | Not guaranteed |

Note on 1.0.x data: on first start, 2.0 archives the whole 1.0.x database into a local `legacy-archive/<timestamp>/` directory and then creates an empty database. When you need the old content, open that archive with 1.0.2. 2.0 does **not** import 1.0.x backup packages — the database inside such a package carries no `app_schema_epoch`, so it is rejected with a hint to open it with 1.0.2.

## Reporting a vulnerability

Prefer the private security advisory feature of the code hosting platform (**Security → Advisories → Report a vulnerability** in the GitHub repository). If that entry point is unavailable, report through the private contact details published in the maintainer's profile.

Do not include any of the following in public issues, screenshots or logs:

- API keys, access tokens or complete request headers;
- real resumes, photos, contact details or the body of experience summaries;
- local databases, `.env` files or exports that can reconstruct personal information.

Please include the affected version, reproduction conditions, blast radius and the minimal verification you performed. Maintainers will acknowledge receipt as soon as possible; avoid disclosing directly exploitable details until a fix is public.

## Local security boundaries

- **API keys at rest on Windows** are encrypted with the system DPAPI and stored in the local SQLite database (the ciphertext is bound to the current user and machine). Non-Windows platforms keep them in plaintext, in exchange for a zero-dependency, single-user, zero-configuration experience. Ordinary settings reads and the settings-record endpoints always return a redacted reference. `POST /api/settings/llm/api-key/reveal` exists for clients that call the API from the same machine and is open only to a direct loopback connection; its response is marked no-cache. **The shipped interface does not expose that entry point** — no production frontend code calls it, and the settings page only shows a redacted value — so in practice it serves local clients that talk to the API directly. This restriction is no substitute for authentication: do not share `backend/data/resume_forge.db`, and protect the operating-system account and the disk.
- **Dataset backups include LLM API keys by default** (corrected against the actual implementation on 2026-10-24): the `include_api_keys` parameter of `GET /api/settings/datasets/export` / `export-all` defaults to `true`, and the frontend export call is checked by default too — the point is that "move to another machine and import the whole package" should not require re-entering keys. Keys are written in their **on-disk form** (DPAPI ciphertext on Windows, bound to the current user and machine, so undecryptable elsewhere; plaintext on non-Windows); they are never decrypted into the package. **Packages that contain keys use higher backup format numbers**: `format 3` = a single dataset with keys, `format 5` = a collection package that additionally carries the global model configuration in `global_llm.json`, `format 6` = 5 plus font files (currently `BACKUP_FORMAT_VERSION = 6`). Older versions explicitly reject a higher-format package, and the importer requires the manifest to declare the key state. **Keys are stripped only when the user explicitly unchecks "include API key"** (the table is cleared and the file rebuilt with `VACUUM`, so no free pages retain data). **Treat any backup package as a file as sensitive as the database itself**, and confirm whether it contains keys before handing it to anyone.
- When generating a resume or job-specific suggestions, the relevant job information, experience/project/skill entries and the selected summary-file excerpts are sent to the model provider the user configured; identity fields such as photo, name and contact details never enter the model context. Interpreting a job posting sends only the posting, never personal data. Check the provider's data policy before use.
- Resume photos stay local and never enter the model context; exported HTML or print files may still contain the photo and other personal information.
- The AI job assistant sends only the current question and a limited history of completed sessions by default. Related content joins the context only when the user explicitly links a job, links a resume or chooses "use my data". "Use my data" strips photo, name and contact details; a linked resume only strips the photo, so a name and contact details inside the body may still be sent. The assistant can read and write local data through tool calls. Writes (adding/editing a job, updating basic profile fields) happen only on explicit user request, and there are **no delete tools at all**; model configuration and dataset management under settings keep their loopback enforcement and are deliberately not exposed as tools, so the model cannot indirectly bypass that boundary.
- Assistant sessions, messages, attachments and web-source summaries are stored in the local SQLite database. Deleting a session deletes its message history; database backups may still hold older copies. Images a user uploads to the assistant differ from profile photos: images in the current message are sent to the selected model, and only multimodal models compatible with OpenAI's `image_url` input handle them correctly.
- **PDF/DOCX attachments are never sent out as original files**: the backend extracts text locally (pypdf for PDF, a whitelisted member read for DOCX) and only the extracted text enters the model context (same for job and material recognition documents), so document recognition needs no multimodal model and the file itself never reaches the provider. BMP/TIFF images are likewise converted to PNG/JPEG locally before sending. When a scan yields no text, the app says so and suggests taking a screenshot instead of silently leaving it blank.
- Assistant attachments accept only UTF-8 TXT/Markdown/JSON/CSV, PDF/DOCX and PNG/JPEG/WebP/GIF/BMP/TIFF images, at most 4 files, each up to 2 MB and 5 MB in total; the server validates the file name, MIME type, header signature and base64. Parsing these untrusted files has further caps: at most 30 PDF pages, a ceiling on total extracted text, a pixel cap when decoding images, and DOCX reads only `word/document.xml` instead of unzipping the package. Format and size limits do not replace content hygiene — remove unrelated personal data and keys before uploading.
- The HTTP client's default INFO request summary is disabled, so assistant search queries never land in logs as full URLs; business logs keep only the host, status code, counts and request ID needed for troubleshooting.
- **Web search** gets the assistant a search tool once enabled: it decides what to look up and may retry with different keywords (at most 3 searches per answer, including the automatic pre-search that happens when web access is on). There are **four optional sources**: `bing`, `duckduckgo`, `searxng` and `deepseek`. **Only `bing` and `duckduckgo` are enabled by default** (Bing goes to `https://cn.bing.com/search`, falling back to `https://www.bing.com/search` when that domain is unavailable); `searxng` requires the user to supply an instance URL. **`deepseek` is disabled by default: it needs a separately configured DeepSeek API key and an explicit opt-in.** Once DeepSeek is enabled, the query string goes to `https://api.deepseek.com/v1/tools/search`, and when "pages to fetch" is greater than 0 the **target page URL is sent to `api.deepseek.com/v1/tools/fetch` and fetched by that service's own servers** (locally only the scheme/credential check runs first; the local hop-by-hop SSRF validation no longer applies on that path). On account-level unavailability (401/402/403/429) the whole fetch step falls back to local fetching. The remaining boundaries are unchanged: at most 3 web searches per answer, `fetch_pages` defaults to 0 with a maximum of 3, only http/https is allowed, non-standard ports and private/loopback/link-local addresses are rejected (IPv4/IPv6 and every resolved address), redirects are validated hop by hop, and response body size and timeouts are capped. **This defends against "the result points at the intranet" style direct SSRF, but it cannot claim complete protection against DNS rebinding** — a time window remains between the resolution check and the actual connection, which is why page fetching is off by default; enable it only on networks you trust. Results are deduplicated by host and path, and employer sites and job pages rank ahead of third-party boards; snippets may be stale or third-party and are not proof of official status or that a job is still open. Turning the switch off removes the tool entirely.
- **Auto-collect, auto-apply and web-form filling actively visit job sites** (the only two **job-site** outbound paths in the project; assistant web search is a separate pipeline), but only for the single run the user explicitly triggers — nothing runs in the background. Each pipeline goes through its own dedicated browser launched by the app, with a separate `user-data-dir`, isolated from your everyday browser. **The app does not collect, type or store job-site account credentials, and does not read or save login cookies**: the first login is a QR scan you perform yourself in that dedicated browser window, and the credentials exist only inside that browser's data directory. The web-form side **fills but never submits** (no submit click, no form-submit script). Apply and collect logs redact credentials such as passwords, cookies and request headers, keeping only the steps, states and error categories needed for troubleshooting; verification codes and security challenges are never bypassed — they are recorded as failures and handed back to the user. Still review logs and exports yourself before sharing them.
- Default deployments must listen on the loopback address only. CORS is not authentication; never expose the backend port to a LAN or the internet.
- "Generation output location" is a local directory the user explicitly picks, not a server-side upload directory; only the backend's native folder picker can set it: the directory probe and the persistence both happen on the picker's return value, and the HTTP settings endpoint only accepts a clear marker, never a client-supplied path. Selecting and clearing are allowed only for loopback clients; the Origin / Fetch Metadata defenses reject cross-site write requests. Both GET and POST of resume export require a direct loopback connection and a non-cross-site request; otherwise the request returns 403 before the resume is queried, the directory probe runs or any artifact is written. Local frontends and browser-less local CLIs can still save according to settings.
- **Pre-send preview and usage ledger**: before calling a model capability such as generation or suggestions, the app previews the target service, the categories of data being sent, the attachment types, the excluded fields and whether page bodies will be fetched; the preview body is rendered in memory only and is **never written to localStorage, logs or the database**. The usage ledger aggregates tokens, latency, finish reason and retry count per task/model/dataset, marks missing token counts as "unknown" and estimates cost only when the user configured unit prices; **the ledger never stores prompt bodies, API keys, passwords, complete personal profiles or raw attachments**. Diagnostic events follow the same privacy rules (categories, counts, latency and error categories only).
- Install dependencies from the lockfiles/version manifests in the repository, and review Dependabot and CI dependency-audit results.

## Windows desktop build (since 1.0.0)

- **Data lives in the user directory**: `%APPDATA%\ResumeForge\data` holds the main database, attachment copies, backups and the login-state directories of the dedicated apply and web-form browsers (the `RF_DATA_DIR` environment variable overrides it; console and portable behavior is unchanged). Upgrades, uninstalls and reinstalls never touch that directory; do not put it on a cloud-sync drive or share it with anyone.
- **The in-app updater verifies before installing**: after the download it checks the SHA-256 the publisher ships with the asset (malformed values — e.g. legacy sidecars with a coreutils `*` prefix — are rejected outright), together with the stable version number, the target platform and the origin of the release asset; failing any of them stops the install, download I/O errors never hang, and a failed child-process launch reaches an explicit terminal state.
- **Every release asset can be verified individually**: each one ships with a matching `.sha256` file. When the project has no code-signing certificate configured, the installers are **unsigned**, so Windows SmartScreen shows an "unknown publisher" prompt — judge by the download source and the `.sha256`, and do not read the prompt itself as evidence that the file was tampered with.
- **User data gets a full snapshot before program files are overwritten**: `update.cmd` (which calls `scripts/Update-ResumeForge.ps1`) runs `backend/scripts/create_user_data_snapshot.py` before the overwrite. The script reuses the "export all datasets" pipeline and verifies that the archive is readable; if the script is missing, the updater falls back to copying `*.db` plus a few JSON pointer files. Snapshots land in `backend/data/pre-update/<timestamp>/`; ordinary snapshots keep only the latest 3, while names containing `pre-major` (cross-major upgrades) are **never** cleaned up automatically. **Snapshot packages include LLM API keys by default** — the same rule as the backup packages above — so treat them as equally sensitive as the data directory. Installer-based upgrades leave the data directory alone, because it sits outside the install path.
- **Data rescue when upgrading from the 0.18.0 installer**: the old installer wrote data inside the install directory, and an NSIS in-place upgrade runs the old uninstaller first. Since 1.0.0 the installer copies old data file by file into a temporary directory and verifies byte counts **before** touching the old version — detecting that the app is still running, or a failed verification, **aborts the install** and leaves the original data in place; after installation the app's data-migration flow takes over (back up, ask for confirmation, then move into `%APPDATA%\ResumeForge\data`). An existing database at the target location is never overwritten.
- **Delivery archive fingerprints**: every application record keeps a delivery snapshot, so a resume can be re-exported even after the original was deleted; the replayed artifact may differ byte-wise from the original (HTML re-renders get a fresh CSP nonce), which the UI states plainly alongside the original artifact's SHA-256 fingerprint. Confirm an archive contains no personal information you do not want to disclose before handing it out.
- **The print bridge only accepts in-app requests**: the desktop shell's print IPC accepts only the main window's top-level frame and validates the channel and the payload shape (≤5 MB of UTF-8 bytes); loading fonts/images, readiness and printing each have budgets, and both errors and timeouts destroy the hidden window. `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` are unchanged, the print window refuses navigation and new windows, and print input comes only from app-generated HTML — arbitrary URLs are not accepted, so resume web content cannot reach system capabilities through the print bridge. The CI `desktop-shell` job runs a real Electron smoke test: real IPC channel + hidden window + Chromium `printToPDF` producing a PDF, plus checks that non-main-window senders, invalid or oversized payloads and over-budget paths are all rejected and shut down quickly; environments that need a graphical session are not claimed as verified locally.

## Recommendations for users

- Use least-privilege, individually revocable API keys and rotate them regularly.
- Back up the database regularly; `backend/scripts/backup_database.py` creates a consistent SQLite backup. Keep backup files encrypted and in a controlled location.
- Remove personal information before sharing logs or exported files.
- Delete assistant sessions you no longer need, and check the configured model provider and its retention policy before sending attachments, jobs, resumes or profile material.
- Before using auto-collect or auto-apply, confirm the target job site allows automation; the login credentials stay in your own apply browser, so log out there and clear its data directory when you stop using it.
- Get the project from a trusted source, and check dependency updates and release notes.

---

## 简体中文

<a href="#security-policy">English</a>

ResumeForge 是面向个人、本地运行的单用户工具。它会处理简历、联系方式、照片、经历总结和大模型 API Key 等敏感信息，因此请先理解下述安全边界。

### 支持范围

| 版本 | 安全更新 |
| ---- | -------- |
| `2.x`（当前主线，含 `main` 与最新发布版 `2.0.0`，2026-11-04） | 支持 |
| `1.0.x`（`1.0.2` 为最后发行版） | 不再更新；旧数据的打开方式见下 |
| 更早的提交或自行修改版本 | 不保证 |

关于 1.0.x 旧数据：2.0 首次启动会把 1.0.x 旧库**整包归档**到本地 `legacy-archive/<时间戳>/`，然后建一个空库。需要旧内容时，用 1.0.2 打开该归档。**2.0 不导入 1.0.x 备份包**——包内的库没有 `app_schema_epoch`，会被拒收并提示改用 1.0.2 打开。

### 报告漏洞

请优先使用代码托管平台的私密安全公告功能（GitHub 仓库中的 **Security → Advisories → Report a vulnerability**）。如果该入口不可用，请通过仓库维护者公开资料中的私密联系方式报告。

不要在公开 Issue、截图或日志中包含：

- API Key、访问令牌或完整请求头；
- 真实简历、照片、联系方式或经历总结正文；
- 本地数据库、`.env` 文件或可还原个人信息的导出文件。

报告中请提供受影响版本、复现条件、影响范围和已做的最小化验证。维护者会尽快确认收到报告；修复公开前请避免披露可直接利用的细节。

### 本地安全边界

- API Key 在 Windows 上用系统 DPAPI 加密后保存在本地 SQLite 数据库中（密文绑定当前用户与机器），非 Windows 平台保持明文，以换取零依赖的单用户零配置体验。普通配置读取和配置记录接口始终返回脱敏引用。`POST /api/settings/llm/api-key/reveal` 面向在本机直接调用接口的客户端，仅对直连回环的客户端开放，响应禁止缓存。**当前界面不提供该入口**——没有任何生产前端代码调用它，设置页只显示脱敏值——因此它实际服务于本机直接调 API 的客户端。此限制不能替代身份认证，不要共享 `backend/data/resume_forge.db`，并保护操作系统账户和磁盘。
- 数据集备份**默认包含大模型 API Key**（2026-10-24 按实际实现校正）：后端 `GET /api/settings/datasets/export` / `export-all` 的 `include_api_keys` 默认值为 `true`，前端导出调用同样默认勾选——目的是让"换台电脑导入整包"不用再重填密钥。密钥按**本机存储形态**写入备份包（Windows 上是 DPAPI 密文，绑定当前用户与机器，换机后无法解密；非 Windows 为明文），不会被解密成明文；**含密钥的包使用更高的备份格式号**：`format 3` = 单数据集包含密钥，`format 5` = 整包（collection）额外带 `global_llm.json` 全局模型配置，`format 6` = 在 5 之上再加字体文件（当前 `BACKUP_FORMAT_VERSION = 6`）。旧版本导入高格式包时会明确拒收，导入端要求清单显式声明密钥状态。**只有用户显式取消「包含 API Key」时才会剥离**（清空配合 `VACUUM` 重建文件，避免空闲页残留）。因此**任何备份包都应视为与数据库同级的敏感文件**，对外提供前先确认是否含密钥。
- 生成简历和岗位化建议时，相关岗位信息、经历/项目/技能及被选中的总结文件片段会发送给用户配置的大模型服务商；照片、姓名、联系方式等身份字段不会进入模型上下文。岗位需求解读只发送招聘信息，不读取个人资料。使用前请确认服务商的数据政策。
- 简历照片保存在本地，不进入大模型上下文；导出的 HTML 或打印文件可能包含照片和其他个人信息。
- AI 求职助手默认只发送当前问题和受限的已完成会话历史。只有用户明确选择关联岗位、关联简历或“使用我的资料”时，相关内容才加入本次上下文。“使用我的资料”会移除照片、姓名和联系方式；关联简历只移除照片，正文中的姓名和联系方式仍可能发送。助手可以通过工具调用读写本地数据。写入（新增/修改岗位、更新个人资料基础字段）只在用户明确要求时触发，且**没有任何删除类工具**；设置里的模型配置与数据集管理有回环强制校验，不做成工具，以免模型间接绕过该边界。
- 助手会话、消息、附件和联网来源摘要保存在本地 SQLite。删除会话会删除其消息历史；数据库备份仍可能保留旧副本。用户主动上传到助手的图片与资料照片不同：当前消息的图片会发送给所选模型，且只有兼容 OpenAI `image_url` 输入的多模态模型才能正确处理。
- **PDF/DOCX 附件的原始文件不外发**：后端在本机提取文字（pypdf 读 PDF、白名单成员读 DOCX），只把提取结果作为文本送入模型上下文（岗位与资料识别的文档同理），因此文档识别不需要多模态模型，也不会把文件本身交给服务商。BMP/TIFF 图片同样在本机转成 PNG/JPEG 后再发送。扫描件提取不到文字时会明确提示改用截图，而不是静默留空。
- 助手附件仅接受 UTF-8 TXT/Markdown/JSON/CSV、PDF/DOCX，以及 PNG/JPEG/WebP/GIF/BMP/TIFF 图片，最多 4 个，单个不超过 2 MB、合计不超过 5 MB；服务端会校验文件名、MIME、文件头签名与 base64。解析这些不可信文件时另设上限：PDF 最多读 30 页、提取文字总量封顶、图片解码像素封顶、DOCX 只读 `word/document.xml` 而不解压整包。格式与大小限制不能替代内容脱敏，上传前仍应删除无关个人信息和密钥。
- HTTP 客户端的默认 INFO 请求摘要已关闭，避免把助手联网搜索词作为完整 URL 写入日志；业务日志只记录排障所需的主机、状态码、计数和请求 ID。
- 开启联网搜索后，助手会获得一个搜索工具：它自己决定查什么、可以换关键词多搜几次（一次回答最多 3 次，含开启联网时那次自动预搜）。**可选来源共四个**：`bing`、`duckduckgo`、`searxng`、`deepseek`。**默认只启用 `bing` 与 `duckduckgo` 两个**（Bing 走 `https://cn.bing.com/search`，该域不可用时回退 `https://www.bing.com/search`）；`searxng` 需用户自填实例地址。**`deepseek` 默认关闭，需单独配置 DeepSeek API Key 并显式勾选**。启用 DeepSeek 后：查询串会发往 `https://api.deepseek.com/v1/tools/search`；当「抓取正文条数」大于 0 时，**目标页面 URL 会发给 `api.deepseek.com/v1/tools/fetch`，由对方服务端抓取**（本地只先做 scheme/凭据校验，不再走本地 SSRF 逐跳校验）。账号级不可用（401/402/403/429）时整段回落到本地抓取。其它边界不变：一次回答最多 3 次联网搜索，`fetch_pages` 默认 0、上限 3，只允许 http/https、拒绝非标准端口与私网/回环/链路本地地址（含 IPv4/IPv6 与解析后的全部地址）、逐跳校验重定向、限制响应体大小与超时。**该防护能挡住"结果指向内网"这类直接 SSRF，但不能宣称完全防御 DNS rebinding**——解析检查与实际连接之间仍存在时间窗，因此正文抓取默认关闭，请只在信任当前网络环境时开启。搜索结果按主机名与路径去重，用人单位官网与招聘页排在第三方平台之前；摘要可能过期或来自第三方，不能视为官方性或招聘有效性的验证。关闭开关时不会下发该工具。
- **自动采集 / 自动投递与网申填表会主动访问招聘网站**（这是项目里仅有的两条**招聘网站**外链，助手联网搜索是另一条独立链路），但仅限用户显式触发的那一次，不会在后台自动运行。两条链路各自通过一个由应用自己拉起的专用浏览器完成，它使用独立的 `user-data-dir`，与你日常使用的浏览器相互隔离。**应用不收集、不输入、不保存招聘网站的账号密码，也不读取或保存登录 Cookie**：首次登录由你在该专用浏览器窗口里自己扫码完成，凭据只存在于该浏览器的数据目录内。网申侧**只填不提交**（不点提交按钮、不执行表单提交脚本）。投递与采集日志对账号密码、Cookie、请求头等凭据脱敏，只记录排障所需的步骤、状态与错误类别；遇到验证码或安全验证时不尝试绕过，如实记为失败并提示手动处理。对外分享日志或导出文件前仍应自行核对。
- 默认部署只应监听本机回环地址。CORS 不是身份认证，不要将后端端口直接暴露到局域网或互联网。
- 「生成内容保存位置」是用户明确选择的本地目录，不是服务端上传目录；只有后端本机原生文件夹选择器能设置它：目录探针和持久化均发生在选择器返回值上，HTTP 设置接口仅接受清除标记、不接受客户端路径。选择与清除仅允许回环客户端；Origin / Fetch Metadata 防线拒绝跨站写请求。简历导出的 GET / POST 均要求回环直连且非跨站；不满足时在查询简历、执行目录探针和写出产物之前返回 403。本机前端与无浏览器来源的本机 CLI 仍可按设置保存。
- **AI 外发前预览与用量账本**：调用生成/建议等模型能力前，应用会给出本次外发的目标服务、资料类别、附件类型、已排除字段与是否抓取网页正文的预览；预览正文只在内存中展示，**不写 localStorage、不写日志、不落库**。用量账本按任务/模型/数据集汇总 token、耗时、结束原因与重试次数，缺失 token 标「未知」，费用只在用户配置了单价时估算；**账本不保存提示词正文、API Key、密码、完整个人资料或原始附件**。诊断事件沿用同一隐私口径（只记类别、计数、耗时与错误类别）。
- 安装依赖时使用仓库中的锁文件/版本清单，并审查 Dependabot 和 CI 依赖审计结果。

### Windows 桌面安装版（1.0.0 起）

- **数据统一存放在用户目录**：`%APPDATA%\ResumeForge\data` 收纳主数据库、附件副本、备份，以及投递专用浏览器与网申浏览器的登录态目录（`RF_DATA_DIR` 环境变量可覆盖，控制台 / 便携形态行为与从前一致）。升级、卸载、重装程序都不触碰该目录；不要把它加进云盘同步或共享给他人。
- **应用内更新器先校验再安装**：下载完成后核对发布方随包提供的 SHA-256（格式不符——例如带 coreutils `*` 前缀的旧式 sidecar——会被直接拒收），并校验稳定版本号、目标平台与发布资产来源；任一不满足都不会进入安装，下载 IO 异常不会挂起、子进程启动失败有明确终态。
- **每个发布资产都可逐个校验**：每个发布资产随包提供对应的 `.sha256` 校验文件。项目未配置代码签名证书时，安装包是**未签名**的，Windows SmartScreen 会提示「未知发布者」——请以下载来源与 `.sha256` 为准，不要因此认定文件被篡改。
- **覆盖程序文件之前先给用户数据拍整包快照**：`update.cmd`（实际调用 `scripts/Update-ResumeForge.ps1`）在覆盖程序文件**之前**运行 `backend/scripts/create_user_data_snapshot.py`。该脚本复用「导出全部数据集」链路并校验归档可读性；脚本缺失时回落到只拷 `*.db` 与几个 json 指针文件。快照写在 `backend/data/pre-update/<时间戳>/`，普通快照只保留最近 3 份，名字带 `pre-major` 的跨大版本快照**永不自动清理**。快照包**默认包含大模型 API Key**（与上文备份包口径一致），所以它和数据目录同级敏感。走安装器升级时，数据目录在安装路径之外，安装器不会触碰它。
- **从 0.18.0 安装版升级时的数据抢救**：旧安装版把数据写在安装目录内，而 NSIS 原地升级会先执行旧卸载器。1.0.0 起安装器在触碰旧版本**之前**先把旧数据逐文件复制到临时目录并校验字节数——检测到应用仍在运行或校验失败都会**中止安装**并保留原数据；安装完成后再交给应用的数据迁移流程（先备份、弹窗确认、才搬进 `%APPDATA%\ResumeForge\data`）。目标位置已有数据库时绝不覆盖。
- **交付存档指纹**：每条投递记录保存交付快照，原简历删除后仍可按存档重放导出；重放产物与原件字节可能不同（HTML 每次渲染更换 CSP nonce），界面会如实标注并给出原始产物的 SHA-256 指纹。对外提供存档文件前，仍应自行确认其中不含不想披露的个人信息。
- **打印桥只接受应用内请求**：桌面壳的打印 IPC 只接受主窗口顶层 frame，并校验通道与 payload 形状（≤5MB UTF-8 字节）；加载字体/图片、就绪与打印各设预算，异常与超时都会销毁隐藏窗口。`nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` 不变，打印窗口拒绝导航与开新窗口，打印输入只来自应用生成的 HTML——不接受任意 URL，简历网页内容无法通过打印桥获得系统能力。CI 的 desktop-shell 作业里有真实 Electron 冒烟：真实 IPC 通道 + 隐藏窗口 + Chromium `printToPDF` 产出 PDF，并验证非主窗口 sender、非法/超大 payload 与超预算路径都会被拒绝且快速收尾；需要图形会话的环境不在本地冒充已验证。

### 用户侧建议

- 使用权限范围最小、可单独吊销的 API Key，并定期轮换。
- 定期备份数据库；可运行 `backend/scripts/backup_database.py` 创建一致性 SQLite 备份，备份文件仍应加密并放在受控位置。
- 对外分享日志或导出文件前先移除个人信息。
- 删除不再需要的助手会话，并在发送附件、岗位、简历或资料前检查当前配置的模型服务商和其数据保留政策。
- 使用自动采集或自动投递前，先确认目标招聘网站允许自动化操作；登录凭据由你在投递专用浏览器里自持，不再使用时可在该浏览器中登出并清理其数据目录。
- 从可信来源获取项目，并核对依赖更新和发布说明。
