// SPDX-License-Identifier: Apache-2.0
/** 全局 AI 润色接口（R17）：只发送用户选中的那一段文字。 */
import { request } from "./client";

export interface PolishSelectionResult {
  result: string;
}

/**
 * 润色一段选中的文字。
 *
 * 请求体只有 `text` 与 `instruction` 两个字段（后端 `extra="forbid"`）：这里没有
 * 简历 id，也不带任何"上下文"，从协议层就杜绝把整份简历发出去。
 * 预算走 `recognition`（90s）：润色与识别一样是非流式等待完整 JSON 的调用。
 */
export function polishSelection(
  text: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<PolishSelectionResult> {
  return request("/writing/polish-selection", {
    method: "POST",
    body: JSON.stringify({ text, instruction }),
    signal,
    budget: "recognition",
  });
}
