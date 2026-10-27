// SPDX-License-Identifier: Apache-2.0
/**
 * Per-document scope: do not silently adopt a different dataset into an existing editor.
 *
 * 这条不变式是**刻意**的，别把 `X-Dataset-Scope` 当成"读到就更新"缓存：
 * 页面一旦静默跟随服务端切走的数据集，一个还开着编辑器的旧标签页就能把草稿写进
 * 另一个数据集里同 id 的记录（`tests/smoke/release-boundaries.spec.ts` 钉的就是这个）。
 * 身份只在两处变化：启动时取一次，以及用户**显式**切数据集时重新同步
 * （`useSettingsDatasets.switchDataset` 的 409 重试）。
 */
import { t } from "../i18n";

let scopeToken: string | null = null;

export function datasetScopeHeaders(input?: HeadersInit): Headers {
  const headers = new Headers(input);
  headers.set("X-ResumeForge-Client", "browser");
  if (scopeToken) headers.set("X-Dataset-Scope", scopeToken);
  return headers;
}

export async function initializeDatasetScope(signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const deadline = window.setTimeout(cancel, 15_000);
  try {
    const response = await fetch("/api/dataset-scope", {
      headers: { "X-ResumeForge-Client": "browser" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(t("apiErrors.datasetScope.confirmFailed"));
    const data = (await response.json()) as { scope?: unknown };
    if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const value = response.headers.get("X-Dataset-Scope") ?? data.scope;
    if (typeof value !== "string" || !value)
      // i18n-ok: datasetScope.test.ts 的 rejects.toThrow("数据集身份") 钉住这条启动期契约，保持原文
      throw new Error("本地服务未返回数据集身份，请刷新页面");
    scopeToken = value;
  } finally {
    window.clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}
