/** 网申填表接口。 */
import type {
  BrowserStatus,
  WebFormExtraEntry,
  WebFormExtraProfile,
  WebFormFields,
  WebFormFillItem,
  WebFormFillRecord,
  WebFormFillResult,
  WebFormLive,
  WebFormMemoryTargets,
  WebFormPreview,
  WebFormRememberInput,
  WebFormRepeatedRecord,
  WebFormSnapshot,
  WebFormUrlHistoryList,
  WebFormBrowserTargetList,
} from "../types";
import { request } from "./client";

export function listWebFormFields(): Promise<WebFormFields> {
  return request("/webform/fields");
}

/**
 * 「网申资料」：用户专门为网申表单录的补充资料，与简历资料**分开存**。
 *
 * 界面只读写这两个接口——**不要**顺手把它并进 `profile.ts`：那会让"生成简历不读这些"
 * 从结构保证退化成一个需要靠人记住的约定。
 */
export function getWebFormExtraProfile(): Promise<WebFormExtraProfile> {
  return request("/webform/extra-profile");
}

/** 「记住这条」的完整可编辑资料目录。 */
export function getWebFormMemoryTargets(): Promise<WebFormMemoryTargets> {
  return request("/webform/memory-targets");
}

/** 整份覆盖写入：没提到的 key 会被删除（这一屏就是「网申资料」的全部）。
 *
 * `details` 只用于给**学到的**那几条指定来源与档位；没提到的按"自己录的、默认档位"。 */
export function updateWebFormExtraProfile(
  values: Record<string, string>,
  details?: Record<string, WebFormExtraEntry>,
  repeated?: Record<string, WebFormRepeatedRecord[]>,
): Promise<WebFormExtraProfile> {
  const body: {
    values: Record<string, string>;
    details: Record<string, WebFormExtraEntry>;
    repeated?: Record<string, WebFormRepeatedRecord[]>;
  } = { values, details: details ?? {} };
  if (repeated !== undefined) body.repeated = repeated;
  return request("/webform/extra-profile", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** 网申专用浏览器状态；它与投递台使用不同窗口、端口和登录态。 */
export function getWebFormBrowserStatus(): Promise<BrowserStatus> {
  return request("/webform/browser/status");
}

export function startWebFormBrowser(): Promise<BrowserStatus> {
  return request("/webform/browser/start", { method: "POST" });
}

export function openWebFormUrl(url: string): Promise<{ target_id: string; url: string }> {
  return request("/webform/browser/open-url", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function listWebFormUrlHistory(): Promise<WebFormUrlHistoryList> {
  return request("/webform/url-history");
}

export function deleteWebFormUrlHistory(id: number): Promise<void> {
  return request(`/webform/url-history/${id}`, { method: "DELETE" });
}

export function listWebFormBrowserTargets(): Promise<WebFormBrowserTargetList> {
  return request("/webform/browser/targets");
}

export function setWebFormBrowserTargetLive(
  targetId: string,
  enabled: boolean,
): Promise<{ target_id: string; live_enabled: boolean }> {
  return request(`/webform/browser/targets/${encodeURIComponent(targetId)}/live`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export function stopWebFormBrowser(): Promise<void> {
  return request("/webform/browser/stop", { method: "POST" });
}

/** 读取**当前标签页**上的表单控件。只读，不写页面。 */
export function takeWebFormSnapshot(): Promise<WebFormSnapshot> {
  return request("/webform/snapshot", { method: "POST" });
}

/**
 * 把资料与页面对成一份可核对的预览。
 *
 * `ai` 为真时，规则认不出的控件会交给模型识别（**只有配了模型才会真的调用**），
 * 命中的行会带上 `source: "ai"` 并且默认不勾选。
 */
export function previewWebForm(snapshotId: string, ai = true): Promise<WebFormPreview> {
  return request("/webform/preview", {
    method: "POST",
    body: JSON.stringify({ snapshot_id: snapshotId, ai }),
  });
}

/** 智能逐项填表：聚焦页面字段时，在字段旁给出对应资料建议。 */
export function startWebFormLive(ai = true): Promise<WebFormLive> {
  return request("/webform/live/start", {
    method: "POST",
    body: JSON.stringify({ ai }),
  });
}

export function stopWebFormLive(): Promise<WebFormLive> {
  return request("/webform/live/stop", { method: "POST" });
}

export function getWebFormLiveStatus(): Promise<WebFormLive> {
  return request("/webform/live/status");
}

/** 提交用户明确选择的「记住这条」目标；后端只更新这一条资料。 */
export function rememberWebFormLive(
  input: WebFormRememberInput,
): Promise<{ saved: boolean; live: WebFormLive }> {
  return request("/webform/live/remember", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 按确认过的选择写入页面。**不提交**——提交由用户在浏览器窗口里自己做。 */
export function fillWebForm(
  snapshotId: string,
  items: WebFormFillItem[],
): Promise<WebFormFillResult> {
  return request("/webform/fill", {
    method: "POST",
    body: JSON.stringify({ snapshot_id: snapshotId, items }),
  });
}

// ===== 填充记录（回看用）=====

/** 填充记录列表（只含未删除的，最近的在最前）。 */
export function listWebFormRecords(limit = 20): Promise<WebFormFillRecord[]> {
  return request(`/webform/records?limit=${limit}`);
}

export function getWebFormRecord(recordId: number): Promise<WebFormFillRecord> {
  return request(`/webform/records/${recordId}`);
}

/** 移入回收站（软删，可在回收站恢复）。 */
export function deleteWebFormRecord(recordId: number): Promise<void> {
  return request(`/webform/records/${recordId}`, { method: "DELETE" });
}
