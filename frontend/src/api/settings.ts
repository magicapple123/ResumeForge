// SPDX-License-Identifier: Apache-2.0
/** 设置相关接口。 */
import type {
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
import { getFilenameFromDisposition, request, requestRaw } from "./client";
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

/** 导出指定数据集（默认**包含**大模型 API Key；显式取消后剥离）。 */
export async function exportDataset(
  id: string,
  includeApiKeys = true,
  includeGlobalLLM = true,
  /** 下载名（可含中文）；省略时后端用「<数据集名>-<时间戳>.zip」。 */
  filename?: string,
): Promise<ArchiveDownload> {
  return downloadArchive(
    exportUrl(`/settings/datasets/${id}/export`, includeApiKeys, includeGlobalLLM, filename),
  );
}

/**
 * 导出**全部数据集**：当前活动的那份 + 列表里其余每一份。
 *
 * 与 `exportDataset` 的区别是"包里有没有其余数据集"。默认的导出只带当前这一份——多份
 * 数据集的用户如果按默认方式备份，其余几份不会进包，而这种事通常要到需要恢复时才发现。
 */
export async function exportAllDatasets(
  includeApiKeys = true,
  includeGlobalLLM = true,
  filename?: string,
): Promise<ArchiveDownload> {
  return downloadArchive(
    exportUrl("/settings/datasets/export-all", includeApiKeys, includeGlobalLLM, filename),
  );
}

/**
 * 拼导出 URL：始终显式带两个开关（后端默认 true），否则"取消勾选"会被当成缺省值
 * 重新包含。`include_global_llm` 控制整个 `global_llm.json` 段，不是只控密钥。
 */
function exportUrl(
  base: string,
  includeApiKeys: boolean,
  includeGlobalLLM: boolean,
  filename?: string,
): string {
  const params = [
    `include_api_keys=${includeApiKeys ? "true" : "false"}`,
    `include_global_llm=${includeGlobalLLM ? "true" : "false"}`,
  ];
  const name = (filename || "").trim();
  if (name) params.push(`filename=${encodeURIComponent(name)}`);
  return `${base}?${params.join("&")}`;
}

/** 附件告警计数（H2）：三类分开报，界面按类型写文案。 */
export interface BackupAssetIssues {
  /** 这次导出时磁盘上找不到（新缺失）→ 包里不包含。 */
  missing: number;
  /** 文件在，但字节与数据库登记的 SHA-256 不符 → 包里是当前磁盘上的那一份。 */
  mismatched: number;
  /** 数据集导入时就已缺失 → 只做说明，不算"不完整"。 */
  missingAtImport: number;
  /** 仅新缺失或哈希不符时为 true（后端 X-Backup-Incomplete）。 */
  incomplete: boolean;
}

export interface ArchiveDownload {
  blob: Blob;
  filename: string;
  /** 兼容既有调用点：等价于 assetIssues.incomplete。 */
  incompleteBackup: boolean;
  assetIssues: BackupAssetIssues;
}

function headerCount(headers: Headers, name: string): number {
  const raw = Number(headers.get(name) ?? "0");
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
}

async function downloadArchive(url: string): Promise<ArchiveDownload> {
  // 响应是二进制压缩包，不是 JSON：走 requestRaw（错误分类/诊断与 request() 一致），
  // 导出大包走 export 预算（10 分钟），不吃 15s 的默认超时。
  const resp = await requestRaw(url, { budget: "export" });
  // RR-03 / H2：包里有附件缺失/与登记哈希不符时后端会在响应头标出来——不读它就会把
  // 一份不完整的备份播报成"完整备份成功"。三类计数分开读，文案才能说清是哪一种。
  const assetIssues: BackupAssetIssues = {
    missing: headerCount(resp.headers, "X-Backup-Asset-Missing"),
    mismatched: headerCount(resp.headers, "X-Backup-Asset-Mismatched"),
    missingAtImport: headerCount(resp.headers, "X-Backup-Asset-Missing-At-Import"),
    incomplete: resp.headers.get("X-Backup-Incomplete") === "1",
  };
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
      "resumeforge-backup.zip",
    incompleteBackup: assetIssues.incomplete,
    assetIssues,
  };
}

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
}

export interface ResumeFonts {
  items: ResumeFont[];
  active: string | null;
  max_bytes: number;
}

export function listResumeFonts(): Promise<ResumeFonts> {
  return request("/settings/fonts");
}

/** 改字体的展示名（文件名不变，已引用它的简历不受影响）。 */
export function renameResumeFont(name: string, displayName: string): Promise<ResumeFont> {
  return request(`/settings/fonts/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}

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
