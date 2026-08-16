/** SSE 流式响应读取：用于简历生成等长任务，逐事件回调。 */

import { ApiError, extractError } from "./client";

export async function consumeSSE<T>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    throw new ApiError(await extractError(resp), resp.status);
  }
  if (!resp.body) {
    throw new ApiError("浏览器不支持流式响应，请更换现代浏览器");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE 事件之间以空行分隔，逐个解析 "data: {...}" 行
    let separatorIndex;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as T);
        } catch {
          // 忽略脏数据行，不中断流
        }
      }
    }
  }
}
