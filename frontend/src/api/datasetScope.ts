/** Per-document scope: do not silently adopt a different dataset into an existing editor. */
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
    if (!response.ok) throw new Error("无法确认当前数据集，请检查本地服务后刷新页面");
    const data = (await response.json()) as { scope?: unknown };
    if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const value = response.headers.get("X-Dataset-Scope") ?? data.scope;
    if (typeof value !== "string" || !value)
      throw new Error("本地服务未返回数据集身份，请刷新页面");
    scopeToken = value;
  } finally {
    window.clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}
