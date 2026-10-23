// SPDX-License-Identifier: Apache-2.0
/** 设置相关接口。 */
import type {
  AppForm,
  BackupStatus,
  AutoBackupIntervalSetting,
  DatasetImportResult,
  DatasetInfo,
  AssistantOrbSetting,
  AssistantRelaxedModeSetting,
  ExportSaveLocation,
  LLMApiKeyRevealResult,
  LLMConfig,
  LLMConfigRecord,
  LLMModelsResult,
  LLMTestResult,
  LLMThinkingResult,
  NavigationVisibility,
  ReminderPopupSetting,
  SearchConfig,
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateStatus,
  WebFormRelaxedModeSetting,
} from "../types";
import { request } from "./client";
import type { RequestBudgetKind } from "./client";

export function getLLMConfig(): Promise<LLMConfig> {
  return request("/settings/llm");
}

export function saveLLMConfig(config: LLMConfig): Promise<LLMConfig> {
  return request("/settings/llm", { method: "PUT", body: JSON.stringify(config) });
}

/**
 * 拉取服务商当前可用的模型列表。
 *
 * `api_key` 传空（或脱敏占位符）时后端会回退到已保存的密钥，所以用户不必先保存
 * 一遍配置才能看到模型列表。
 */
export function listLLMModels(
  config: Pick<LLMConfig, "base_url" | "api_key">,
): Promise<LLMModelsResult> {
  return request("/settings/llm/models", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

/**
 * 查这个模型支持哪种思考形态、有哪些强度档位。
 *
 * `probe=false` 只读后端的内置能力表（零上游调用，用来出选项）；`probe=true` 会**真的
 * 发一次最小请求**——上游没有"查询思考能力"的接口，而且很多服务商对不认识的参数是
 * 静默忽略的，只有实发一次看响应里有没有思考内容才能分辨。界面上因此必须写明这一点。
 */
export function checkLLMThinking(config: LLMConfig, probe = false): Promise<LLMThinkingResult> {
  return request("/settings/llm/thinking/check", {
    method: "POST",
    body: JSON.stringify({ ...config, probe }),
  });
}

/** 检查是否有新版本（只对比版本号，不下载、不自动更新）。 */
export function checkForUpdate(refresh = false): Promise<UpdateCheckResult> {
  return request(`/update/check${refresh ? "?refresh=true" : ""}`);
}

/**
 * 当前的运行形态：桌面安装壳，还是控制台/开发态。
 *
 * 桌面形态不能走页面内的"下载 zip 并覆盖安装"——桌面 payload 是源码形态整包，
 * 更新包里没有 python-runtime.zip、也没有 desktop/，那条路补不齐依赖。前端拿它
 * 来隐藏下载/安装入口并改引到 Setup.exe。只读接口，无副作用。
 */
export function getAppForm(): Promise<AppForm> {
  return request("/system/form");
}

export function getUpdateDownloadStatus(signal?: AbortSignal): Promise<UpdateStatus> {
  return request("/update/download-status", { signal });
}

export function startUpdateDownload(background = false): Promise<UpdateStatus> {
  return request("/update/download", {
    method: "POST",
    body: JSON.stringify({ background }),
  });
}

export function installDownloadedUpdate(restart = true): Promise<UpdateStatus> {
  return request("/update/install", {
    method: "POST",
    body: JSON.stringify({ restart }),
  });
}

/** 上一次应用内更新的结果；没有需要汇报的返回 null。 */
export function getUpdateInstallResult(): Promise<UpdateInstallResult | null> {
  return request("/update/install-result");
}

/** 用户看过结果之后清掉标记，避免每次打开设置都弹一遍。 */
export function acknowledgeUpdateInstallResult(): Promise<void> {
  return request("/update/install-result", { method: "DELETE" });
}

export function revealLLMApiKey(): Promise<LLMApiKeyRevealResult> {
  return request("/settings/llm/api-key/reveal", { method: "POST" });
}

/**
 * 「仅本会话使用」的临时密钥通道（RF-24）：密钥只进后端进程内存，
 * 进程重启即失，不写数据库、不进日志与备份。状态接口只回是否已设置，
 * 密钥本体永不回传。
 */
export function getLLMSessionKeyStatus(): Promise<{ configured: boolean }> {
  return request("/settings/llm/session-key");
}

export function setLLMSessionKey(apiKey: string): Promise<{ configured: boolean }> {
  return request("/settings/llm/session-key", {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export function clearLLMSessionKey(): Promise<void> {
  return request("/settings/llm/session-key", { method: "DELETE" });
}

/**
 * 测一次连接（T8）。
 *
 * 预算默认 `task`（30s）：真实模型的首字延迟经常超过 15s，用 default 会把它误判成"连不上"。
 * 调用方（页头下拉双击）显式要求"只测连接、不切换"，所以这里只发一次探测请求。
 */
export function testLLM(
  config: LLMConfig,
  budget: RequestBudgetKind = "task",
): Promise<LLMTestResult> {
  return request("/settings/llm/test", { method: "POST", body: JSON.stringify(config), budget });
}

export function listLLMConfigRecords(): Promise<LLMConfigRecord[]> {
  return request("/settings/llm/records");
}

export function saveLLMConfigRecord(
  record: Pick<LLMConfigRecord, "name"> & LLMConfig,
): Promise<LLMConfigRecord> {
  return request("/settings/llm/records", { method: "POST", body: JSON.stringify(record) });
}

export function deleteLLMConfigRecord(id: string): Promise<void> {
  return request(`/settings/llm/records/${id}`, { method: "DELETE" });
}

export function getSearchConfig(): Promise<SearchConfig> {
  return request("/settings/search");
}

export function saveSearchConfig(config: SearchConfig): Promise<SearchConfig> {
  return request("/settings/search", { method: "PUT", body: JSON.stringify(config) });
}

export function getReminderPopupSetting(): Promise<ReminderPopupSetting> {
  return request("/settings/reminder-popup");
}

export function saveReminderPopupSetting(enabled: boolean): Promise<ReminderPopupSetting> {
  return request("/settings/reminder-popup", { method: "PUT", body: JSON.stringify({ enabled }) });
}

/** 网申填表「放宽模式」：代点下拉/弹层与逐条确认过的声明勾选（默认关）。 */
export function getWebFormRelaxedMode(): Promise<WebFormRelaxedModeSetting> {
  return request("/settings/webform-relaxed-mode");
}

export function saveWebFormRelaxedMode(enabled: boolean): Promise<WebFormRelaxedModeSetting> {
  return request("/settings/webform-relaxed-mode", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function getAssistantOrbSetting(): Promise<AssistantOrbSetting> {
  return request("/settings/assistant-orb");
}

/**
 * 保存「投投」悬浮球设置。**整对象 PUT**：两个开关保存时都带全量当前值，
 * 只带一个的话后端整份落库会把另一个静默打回默认。
 */
export function saveAssistantOrbSetting(
  setting: AssistantOrbSetting,
): Promise<AssistantOrbSetting> {
  return request("/settings/assistant-orb", {
    method: "PUT",
    body: JSON.stringify(setting),
  });
}

/** 求职助手「放宽模式」：开启后助手可读取完整资料（含敏感信息），默认关。 */
export function getAssistantRelaxedMode(): Promise<AssistantRelaxedModeSetting> {
  return request("/settings/assistant-relaxed-mode");
}

export function saveAssistantRelaxedMode(
  setting: AssistantRelaxedModeSetting,
): Promise<AssistantRelaxedModeSetting> {
  return request("/settings/assistant-relaxed-mode", {
    method: "PUT",
    body: JSON.stringify(setting),
  });
}

/** 生成内容保存位置：空串 = 仅浏览器下载（默认行为）。 */
export function getExportSaveLocation(): Promise<ExportSaveLocation> {
  return request("/settings/export-save-location");
}

/** 恢复默认：目录选择由本机原生选择器完成，客户端不能提交任意路径。 */
export function clearExportSaveLocation(): Promise<ExportSaveLocation> {
  return request("/settings/export-save-location", {
    method: "PUT",
    body: JSON.stringify({ clear: true }),
  });
}

/**
 * 弹出本机原生「选择文件夹」对话框。后端就跑在用户机器上，只有它能弹原生
 * 对话框并拿到**真实绝对路径**（浏览器的 File System Access API 拿不到完整
 * 路径）。选择成功后后端直接持久化；取消返回 { path: null }；本机环境不支持时抛出带中文原因的错误。
 */
export function pickExportSaveFolder(): Promise<{ path: string | null }> {
  return request("/settings/export-save-location/pick", { method: "POST" });
}

export function getNavigationVisibility(): Promise<NavigationVisibility> {
  return request("/settings/navigation");
}

export function saveNavigationVisibility(hidden: string[]): Promise<NavigationVisibility> {
  return request("/settings/navigation", {
    method: "PUT",
    body: JSON.stringify({ hidden }),
  });
}

export function listDatasets(): Promise<DatasetInfo[]> {
  return request("/settings/datasets");
}

/** 新建一份空数据集（自定义名称，≤64 字），返回描述；创建后可激活。 */
export function createDataset(name: string): Promise<DatasetInfo> {
  return request("/settings/datasets", { method: "POST", body: JSON.stringify({ name }) });
}

/**
 * 一键载入体验示例：新建「体验示例」数据集、写入纯虚构数据并切换过去。
 * 主数据不受影响；写完由调用方刷新页面让全部视图落到新数据集上。
 *
 * 后端在已存在「体验示例」数据集时会**复用**而不是再建一份，并返回
 * `reused: true`（旧后端没有这个字段，可选以容忍）——调用方据此把提示
 * 从"已创建/已就绪"改成分流的措辞，避免重复点击时谎报又建了一份。
 */
export function loadSampleDataset(): Promise<DatasetInfo & { reused?: boolean }> {
  return request("/settings/datasets/sample/load", { method: "POST" });
}

/** 把备份包导入为一份**新数据集**；不触碰当前正在使用的数据。 */
export async function importDataset(
  file: File,
  name: string,
  /** 显式选择"跳过有问题的附件继续导入"（默认 false：附件有问题时整次导入被拒绝）。 */
  allowPartialAssets = false,
): Promise<DatasetImportResult> {
  const partial = allowPartialAssets ? "&allow_partial_assets=true" : "";
  return request(`/settings/datasets/import?name=${encodeURIComponent(name)}${partial}`, {
    method: "POST",
    // 必须写死 application/zip：浏览器按系统映射给出的 File.type 不可靠，而这个
    // 类型不在 CORS 简单请求允许的范围内，跨站页面无法直接触发导入流程。
    headers: { "Content-Type": "application/zip" },
    body: file,
    // 备份包可能几十 MB，走 upload 预算（10 分钟），不吃 15s 的默认超时。
    budget: "upload",
  });
}

export function activateDataset(id: string): Promise<DatasetInfo> {
  // 切换要等后端排空（上限 10s）再跑两次元数据迁移：default 的 15s 会把"快成功"的
  // 切换掐成客户端超时，而服务端此时已经切完了——下次写请求就拿着旧 token 吃 409。
  return request(`/settings/datasets/${id}/activate`, { method: "POST", budget: "task" });
}

export function renameDataset(id: string, name: string): Promise<DatasetInfo> {
  return request(`/settings/datasets/${id}?name=${encodeURIComponent(name)}`, { method: "PATCH" });
}

export function deleteDataset(id: string): Promise<void> {
  return request(`/settings/datasets/${id}`, { method: "DELETE" });
}

// 备份包导出与包内范围解析单独成模块（拆分理由见 datasetArchive.ts 的文件头）：
// 这里只做转发，保持既有 `import ... from "../api/settings"` 的调用点不变。
export { exportAllDatasets, exportDataset } from "./datasetArchive";
export type { ArchiveDownload, BackupAssetIssues, BackupCoverage } from "./datasetArchive";

/** 当前数据集的自动备份保护摘要（RF-05）。 */
export function getBackupStatus(signal?: AbortSignal): Promise<BackupStatus> {
  return request<BackupStatus>("/settings/backup-status", { signal });
}

/** 自动备份间隔（天）：用户保存的运行时值，缺失时后端回退环境配置默认。 */
export function getAutoBackupInterval(): Promise<AutoBackupIntervalSetting> {
  return request("/settings/auto-backup-interval");
}

/** 保存自动备份间隔（1..365 天）；调度线程下次到期检查时读取，无需重启。 */
export function saveAutoBackupInterval(intervalDays: number): Promise<AutoBackupIntervalSetting> {
  return request("/settings/auto-backup-interval", {
    method: "PUT",
    body: JSON.stringify({ interval_days: intervalDays }),
  });
}

/**
 * 切换「使用中」的全局配置记录（C）。
 *
 * 排序语义：记录与生效配置是**同一份**，所以切换就是 activate，不再像旧版那样
 * 把记录内容复制进当前配置（那样会产生"记录改了、生效的没改"的第二份真相）。
 */
export function activateLLMRecord(id: string): Promise<LLMConfigRecord> {
  return request(`/settings/llm/records/${encodeURIComponent(id)}/activate`, { method: "POST" });
}

/** 跨数据集/浏览器的主题偏好（R18）：顶层 `theme`，与 llm 并列。 */
export type GlobalThemeMode = "light" | "dark" | "system";

export interface GlobalTheme {
  /** null = 从未保存过（前端保留本地值）。 */
  theme: GlobalThemeMode | null;
}

export function getGlobalTheme(): Promise<GlobalTheme> {
  return request("/settings/global-theme");
}

export function saveGlobalTheme(mode: GlobalThemeMode): Promise<GlobalTheme> {
  return request("/settings/global-theme", {
    method: "PUT",
    body: JSON.stringify({ theme: mode }),
  });
}

/** 自定义简历字体（R10）：只影响 PDF 导出用的字体。 */
export interface ResumeFont {
  /** 磁盘上的真实文件名；`format_config.font` 存的就是它。 */
  name: string;
  /** 用户可改的展示名，没改过时等于文件名去扩展名。 */
  display_name: string;
  size: number;
  uploaded_at: string;
  active: boolean;
  /**
   * 应用**自带清单**里的条目（当前只有思源黑体）。它固定排在第 1 位，用户删不掉。
   * 老后端没有这个字段，所以是可选的：`undefined` 与 `false` 都按"用户导入的字体"处理。
   */
  builtin?: boolean;
  /**
   * 内置条目是否**已经下载到本机**。`false` 时磁盘上还没有这个文件，选中它没有意义
   * （预览/导出的 `@font-face` 会 404），界面必须把它标成「未下载」并禁用。
   */
  downloaded?: boolean;
}

export interface ResumeFonts {
  items: ResumeFont[];
  active: string | null;
  max_bytes: number;
}

export function listResumeFonts(): Promise<ResumeFonts> {
  return request("/settings/fonts");
}

/**
 * 内置字体的下载状态（`state` 是唯一的状态源，`downloaded` 只是它的派生快照）。
 *
 * `POST .../builtin/download` 是**异步启动**（202 立即返回 `state="downloading"`），
 * 进度靠轮询 `GET .../builtin` 读 `downloaded_bytes / total_bytes`。两次请求返回同一结构，
 * 所以前端只需要一个类型。
 */
export interface BuiltinFontStatus {
  /** 稳定标识（`source-han-sans-sc`）；文件名用 `BUILTIN_FONT_FILE`，不要拿它当文件名。 */
  id: string;
  /** 界面上显示的名字（「思源黑体」）。 */
  label: string;
  /** 字体总字节数（未下载时也拿得到，用来显示"约 32 MB"）。 */
  size_total: number;
  downloaded: boolean;
  /** 已下载字节数（轮询进度用，`state="downloading"` 时才有意义）。 */
  downloaded_bytes: number;
  /** 进度分母；后端拿不到时会是 0，此时界面只显示已下载量。 */
  total_bytes: number;
  state: "idle" | "downloading" | "failed" | "done";
  /** 失败原因（`state="failed"` 时给中文人话），其它状态为空串。 */
  error: string;
}

/**
 * 内置字体当前状态。轮询也用它——**只读**，不会重试或触发下载。
 *
 * 与 `listResumeFonts` 分开是刻意的：字体清单是"有哪些字体可用"，状态是"那个大文件下到哪了"。
 * 把它塞进清单会让每次轮询都重读一遍字体目录。
 */
export function getBuiltinFont(): Promise<BuiltinFontStatus> {
  return request("/settings/fonts/builtin");
}

/**
 * 启动下载（202）。重复调用在 `state="downloading"` 时后端回 409「字体正在下载中」，
 * 磁盘写不进去回 507「磁盘空间不足，无法保存字体」——两条错误都要原样透传给用户。
 */
export function startBuiltinFontDownload(): Promise<BuiltinFontStatus> {
  return request("/settings/fonts/builtin/download", { method: "POST" });
}

/**
 * 删除已下载的内置字体文件（204）。
 *
 * 当前界面**没有入口**（本批只做下载与设为当前）：这个函数留给"将来要腾空间"的需求，
 * 以及一键重置/诊断脚本。直删、没有回收站——真要接到界面上，确认正文必须写明这一点。
 */
export function deleteBuiltinFont(): Promise<void> {
  return request("/settings/fonts/builtin", { method: "DELETE" });
}

/** 改字体的展示名（文件名不变，已引用它的简历不受影响）。 */
export function renameResumeFont(name: string, displayName: string): Promise<ResumeFont> {
  return request(`/settings/fonts/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}

/**
 * **已下线：`POST /settings/fonts` 现在返回 405。**
 *
 * 字体上传入口在 2026-11 一并撤掉（体积与授权责任改由应用统一承担，用户侧只剩"内置思源
 * 黑体按需下载"与"历史导入字体"两条路）。这个函数**没有任何调用点**，留着只是为了不
 * 打断既有的 import 与测试夹具；**不要把它接回界面**——真接回去只会得到 405。
 * 要恢复上传能力，得先在后端把端点加回来，再删掉这段注释。
 */
export function uploadResumeFont(file: File): Promise<ResumeFont> {
  const form = new FormData();
  form.append("file", file);
  // 字体最大 30MB：走上传预算，不吃 15s 的默认超时。
  return request("/settings/fonts", { method: "POST", body: form, budget: "upload" });
}

/** 设为当前字体；`null` = 回到系统字体。 */
/** 任意已上传字体的原始文件 URL（设置页点击预览用；同源相对路径，开发态走 Vite 代理）。 */
export function resumeFontPreviewUrl(name: string): string {
  return `/api/settings/fonts/${encodeURIComponent(name)}/file`;
}

export function activateResumeFont(name: string | null): Promise<{ active: string | null }> {
  return request("/settings/fonts/active", {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function deleteResumeFont(name: string): Promise<void> {
  return request(`/settings/fonts/${encodeURIComponent(name)}`, { method: "DELETE" });
}
