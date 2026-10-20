/** Per-document scope: do not silently adopt a different dataset into an existing editor. */
let scopeToken: string | null = null;

/**
 * 采纳后端响应头里的 scope token。
 *
 * 后端每个响应都会回写 `X-Dataset-Scope`（含 409），而本模块此前只在启动时取一次——
 * 后端重启（instance id 变）、另一标签页切过（generation 前进）、或上次切换"服务端成功
 * 但页面没重载"之后，这个 token 就永久过期了，此后第一个写请求必吃 409。
 * 只接受非空字符串：`null`（响应没带头）不能把已知身份清空。
 */
export function adoptDatasetScope(value: string | null): void {
  if (typeof value === "string" && value !== "") scopeToken = value;
}

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
