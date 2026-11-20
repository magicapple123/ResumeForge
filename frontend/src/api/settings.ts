// SPDX-License-Identifier: Apache-2.0
/** 设置相关接口。 */
import type {
  AppForm,
  BackupStatus,
  AutoBackupIntervalSetting,
  AssistantCompactionSetting,
  AssistantLimitSetting,
  AssistantOrbSetting,
  AssistantRelaxedModeSetting,
  ExportSaveLocation,
  LLMConfig,
  LLMConfigRecord,
  LLMModelsResult,
  LLMTestResult,
  LLMThinkingResult,
  ModelWindowReference,
  InlineFormatPreviewSetting,
  TrayIconFollowSystemSetting,
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

/**
 * 「模型窗口参考」：内置窗口表 + 当前模型命中的是哪一条。
 *
 * 纯只读：表是代码里的常量，改表要发版；用户手填的窗口仍在模型配置里。
 *
 * `model` 可选：传了它就只问「参考表说这个型号是多少」（设置弹窗里型号可能还没保存，
 * 「填入参考值」要的是表对这个型号的判断，不掺当前配置里的手填值）。不传时按当前
 * 生效配置解析，与加这个参数之前逐字一致。
 */
export function getModelWindowReference(model?: string): Promise<ModelWindowReference> {
  const target = (model ?? "").trim();
  const query = target === "" ? "" : `?model=${encodeURIComponent(target)}`;
  return request(`/settings/model-windows${query}`);
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

/**
 * 测一次连接（T8）。
 *
 * 预算默认 `task`（30s）：真实模型的首字延迟经常超过 15s，用 default 会把它误判成"连不上"。
 * 调用方（页头下拉双击）显式要求"只测连接、不切换"，所以这里只发一次探测请求。
 */
export function testLLM(
  config: LLMConfig,
  budget: RequestBudgetKind = "task",
  direct = false,
): Promise<LLMTestResult> {
  // T02「用直连重试」：只在这一次请求上带覆盖头，不写任何全局状态。
  const headers = direct ? { "X-RF-Net-Direct": "1" } : undefined;
  return request("/settings/llm/test", {
    method: "POST",
    body: JSON.stringify(config),
    budget,
    headers,
  });
}

export function listLLMConfigRecords(): Promise<LLMConfigRecord[]> {
  return request("/settings/llm/records");
}

/**
 * 保存为**当前生效**的模型配置（`PUT /settings/llm`：全局记录 + 数据集快照双写）。
 *
 * 与 `saveLLMConfigRecord`（按名称 upsert 一条记录，不切换生效项）不同：这里改的就是
 * 「现在正在用的这份」。用户没填过窗口的旧配置保存一次即升级为全局记录——这是后端
 * 既定语义，不是本函数引入的。助手「上下文用量」弹层改窗口走这里。
 */
export function saveLLMConfig(config: LLMConfig): Promise<LLMConfig> {
  return request("/settings/llm", { method: "PUT", body: JSON.stringify(config) });
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

/** 求职助手的两条运行上限（轮次上限 / 整链时间预算）；缺省时后端给默认值。 */
export function getAssistantLimitSetting(): Promise<AssistantLimitSetting> {
  return request("/settings/assistant-limits");
}

/**
 * 保存运行上限。**整对象 PUT**：两项一起提交，只带一项会把另一项打回默认。
 * 越界值由后端直接拒绝（422），前端不做静默夹取。
 */
export function saveAssistantLimitSetting(
  setting: AssistantLimitSetting,
): Promise<AssistantLimitSetting> {
  return request("/settings/assistant-limits", {
    method: "PUT",
    body: JSON.stringify(setting),
  });
}

/*
 * 上下文自动压缩（需求 #10）的三个设置项。
 *
 * 只有 `GET/PUT /settings/assistant-compaction` 一对接口：读到的就是整份当前值，保存也
 * 整份提交。默认值（空模型 / 60 / 75）由后端给，前端不重复硬编码一份"真相"——读失败时
 * 才用同值占位，避免输入框空着。
 */

/** 读上下文压缩设置：摘要模型（空串 = 跟随当前对话模型）+ 两个百分比阈值。 */
export function getAssistantCompactionSetting(): Promise<AssistantCompactionSetting> {
  return request("/settings/assistant-compaction");
}

/**
 * 保存上下文压缩设置。**整对象 PUT**：三项一起提交，只带一项会把另两项打回默认。
 *
 * 阈值越界、或 `summary_percent <= mask_percent` 时后端返回 422——前端已有同口径的
 * 禁用 + inline 提示，这里不做静默夹取（夹取会悄悄改掉用户填的数字）。
 */
export function saveAssistantCompactionSetting(
  setting: AssistantCompactionSetting,
): Promise<AssistantCompactionSetting> {
  return request("/settings/assistant-compaction", {
    method: "PUT",
    body: JSON.stringify(setting),
  });
}

/**
 * 提醒到期时自动生成任务卡的开关（T26）。
 *
 * 默认关。开启后后台扫描会为 24 小时内到期的提醒生成一张「准备：<提醒标题>」任务卡；
 * 只建卡、不执行任何写操作，也不发消息或弹窗。关闭后不再生成，已生成的卡保留。
 */
export interface AgentTaskEventsSetting {
  enabled: boolean;
}

export function getAgentTaskEvents(): Promise<AgentTaskEventsSetting> {
  return request("/settings/agent-task-events");
}

export function setAgentTaskEvents(
  setting: AgentTaskEventsSetting,
): Promise<AgentTaskEventsSetting> {
  return request("/settings/agent-task-events", {
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

export function getInlineFormatPreview(): Promise<InlineFormatPreviewSetting> {
  return request("/settings/inline-format-preview");
}

export function saveInlineFormatPreview(enabled: boolean): Promise<InlineFormatPreviewSetting> {
  return request("/settings/inline-format-preview", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

/** 桌面版：托盘图标是否跟随系统主题（WF-20 兜底开关，默认关）。 */
export function getTrayIconFollowSystem(): Promise<TrayIconFollowSystemSetting> {
  return request("/settings/tray-icon-follow-system");
}

export function saveTrayIconFollowSystem(enabled: boolean): Promise<TrayIconFollowSystemSetting> {
  return request("/settings/tray-icon-follow-system", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
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

// 数据集的增删改查单独成模块（拆分理由见 datasets.ts 的文件头）：这里只做转发，
// 保持既有 `import { listDatasets } from "../api/settings"` 的调用点不变。
export {
  activateDataset,
  createDataset,
  deleteDataset,
  importDataset,
  listDatasets,
  loadSampleDataset,
  renameDataset,
} from "./datasets";

// 备份包导出与包内范围解析单独成模块（拆分理由见 datasetArchive.ts 的文件头）：
// 这里只做转发，保持既有 `import ... from "../api/settings"` 的调用点不变。
export { exportAllDatasets, exportDataset } from "./datasetArchive";
export type { ArchiveDownload, BackupAssetIssues, BackupCoverage } from "./datasetArchive";

/** 当前数据集的自动备份保护摘要（RF-05）。 */
export function getBackupStatus(signal?: AbortSignal): Promise<BackupStatus> {
  return request<BackupStatus>("/settings/backup-status", { signal });
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

// 简历字体（内置思源黑体的下载/取消/删除、历史导入字体）单独成模块：字体这一组在依赖上
// 是自洽的最小闭包，而本文件已到 480 行（单文件 500 行零豁免）。拆分理由见 fonts.ts 的文件头。
// 这里只做转发，保持既有 `import { ... } from "../api/settings"` 的调用点一处都不用改。
export {
  BUILTIN_FONT_FILE,
  BUILTIN_FONT_SIZE,
  activateResumeFont,
  cancelBuiltinFontDownload,
  deleteBuiltinFont,
  deleteResumeFont,
  getBuiltinFont,
  getResumeFonts,
  listResumeFonts,
  renameResumeFont,
  resumeFontPreviewUrl,
  startBuiltinFontDownload,
  uploadResumeFont,
} from "./fonts";
export type { BuiltinFontStatus, ResumeFont, ResumeFonts } from "./fonts";

// 语义检索（RAG v3）的请求层单独成模块：本文件已 360+ 行，整组接口加进来会顶到 500 行
// 零豁免预算。按上面 fonts.ts 的既有做法只做转发，调用点仍从 "../api/settings" 取。
export {
  activateEmbeddingProfile,
  cancelEmbeddingLocalDownload,
  clearEmbedding,
  clearEmbeddingProfileKey,
  deleteEmbeddingProfile,
  confirmEmbeddingHost,
  disableEmbedding,
  embeddingProgressPercent,
  enableEmbeddingLocal,
  enableEmbeddingRemote,
  fetchEmbeddingModels,
  getEmbeddingStatus,
  removeEmbeddingLocalAssets,
  revokeEmbeddingHost,
  saveEmbeddingProfile,
  startEmbeddingLocalDownload,
  testEmbeddingProfile,
  testEmbeddingRemote,
} from "./embeddingSettings";
export type {
  EmbeddingEndpointMode,
  EmbeddingHeaderRow,
  EmbeddingMaskedConfig,
  EmbeddingLocalState,
  EmbeddingLocalStatus,
  EmbeddingModelsResult,
  EmbeddingProfile,
  EmbeddingProfilePayload,
  EmbeddingProbeResult,
  EmbeddingProviderId,
  EmbeddingRemoteConfig,
  EmbeddingRemoteStatus,
  EmbeddingState,
  EmbeddingStatus,
} from "./embeddingSettings";

export { getNetworkSettings, saveNetworkSettings } from "./settingsNetwork";
export type {
  NetworkSettings,
  NetworkSettingsPayload,
  ProxyMode,
  ProxyView,
} from "./settingsNetwork";
