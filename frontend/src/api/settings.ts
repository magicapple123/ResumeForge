/** 设置相关接口。 */
import type {
  DatasetImportResult,
  DatasetInfo,
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
} from "../types";
import { ApiError, extractError, getFilenameFromDisposition, request } from "./client";

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

export function getUpdateDownloadStatus(): Promise<UpdateStatus> {
  return request("/update/download-status");
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

export function testLLM(config: LLMConfig): Promise<LLMTestResult> {
  return request("/settings/llm/test", { method: "POST", body: JSON.stringify(config) });
}

export function listLLMConfigRecords(): Promise<LLMConfigRecord[]> {
  return request("/settings/llm/records");
}

export function saveLLMConfigRecord(
  record: Pick<LLMConfigRecord, "name"> & LLMConfig,
): Promise<LLMConfigRecord> {
  return request("/settings/llm/records", { method: "POST", body: JSON.stringify(record) });
}

export function deleteLLMConfigRecord(id: number): Promise<void> {
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

/** 把备份包导入为一份**新数据集**；不触碰当前正在使用的数据。 */
export async function importDataset(file: File, name: string): Promise<DatasetImportResult> {
  const resp = await fetch(`/api/settings/datasets/import?name=${encodeURIComponent(name)}`, {
    method: "POST",
    // 必须写死 application/zip：浏览器按系统映射给出的 File.type 不可靠，而这个
    // 类型不在 CORS 简单请求允许的范围内，跨站页面无法直接触发导入流程。
    headers: { "Content-Type": "application/zip" },
    body: file,
  });
  if (!resp.ok) throw new ApiError(await extractError(resp), resp.status);
  return (await resp.json()) as DatasetImportResult;
}

export function activateDataset(id: string): Promise<DatasetInfo> {
  return request(`/settings/datasets/${id}/activate`, { method: "POST" });
}

export function renameDataset(id: string, name: string): Promise<DatasetInfo> {
  return request(`/settings/datasets/${id}?name=${encodeURIComponent(name)}`, { method: "PATCH" });
}

export function deleteDataset(id: string): Promise<void> {
  return request(`/settings/datasets/${id}`, { method: "DELETE" });
}

/** 导出指定数据集（不含大模型 API Key）。 */
export async function exportDataset(id: string): Promise<{ blob: Blob; filename: string }> {
  return downloadArchive(`/api/settings/datasets/${id}/export`);
}

/**
 * 导出**全部数据集**：当前活动的那份 + 列表里其余每一份。
 *
 * 与 `exportDataset` 的区别是"包里有没有其余数据集"。默认的导出只带当前这一份——多份
 * 数据集的用户如果按默认方式备份，其余几份不会进包，而这种事通常要到需要恢复时才发现。
 */
export async function exportAllDatasets(): Promise<{ blob: Blob; filename: string }> {
  return downloadArchive("/api/settings/datasets/export-all");
}

async function downloadArchive(url: string): Promise<{ blob: Blob; filename: string }> {
  // 走裸 fetch 而不是 request()：这个响应是二进制压缩包，不是 JSON。
  const resp = await fetch(url);
  if (!resp.ok) throw new ApiError(await extractError(resp), resp.status);
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
      "resumeforge-backup.zip",
  };
}
