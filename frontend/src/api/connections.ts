// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页（T11 / T12）与识别引擎（T01）的接口。
 *
 * ## 写侧为什么散在这里
 *
 * A/B 组的密钥**不新造写语义**：联网搜索的 Key 走 `PUT /settings/search`、大模型走
 * `PUT /settings/llm`、语音走 `/settings/asr/profiles*`、会话密钥走
 * `/settings/llm/session-key`。五套语义（掩码=不改、空串=清除、`__clear__`=清除、
 * 按条判断、纯内存）都是既有的，页面只负责"改完刷新状态"。
 *
 * 会话密钥这两个函数放在本文件而不是 `api/settings.ts`：那边只剩二十余行预算，
 * 而它们的使用者只有本页。
 */

import { request } from "./client";
import type { ConnectionsPayload, OcrEngine, OcrSettings } from "../types";

/** 整页快照：三组外部连接 + 本机存储方式。 */
export function getConnections(): Promise<ConnectionsPayload> {
  return request("/connections");
}

/**
 * 改一项系统来源（更新源 / 字体源 / RAG 资产源 / 浏览器端口）。
 *
 * 返回整页快照而不是单项：调用方直接替换本地副本，"改完刷新状态"不会出现
 * 列表里一条新、一条旧。
 */
export function saveSystemSource(itemId: string, value: string): Promise<ConnectionsPayload> {
  return request(`/connections/system/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

/** 恢复某一项系统来源的出厂默认（后端删掉覆盖值，不是写一个"默认值"进去）。 */
export function resetSystemSource(itemId: string): Promise<ConnectionsPayload> {
  return request(`/connections/system/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

/** 记录"仅本次会话"的大模型密钥（只进后端内存，不落盘、不进备份）。 */
export function setLLMSessionKey(apiKey: string): Promise<{ configured: boolean }> {
  return request("/settings/llm/session-key", {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

/** 清掉会话密钥：清除后生效值回到已保存的那一把。 */
export function clearLLMSessionKey(): Promise<void> {
  return request("/settings/llm/session-key", { method: "DELETE" });
}

/** 识别引擎档位、Key 是否已配置，以及三档的可读说明（说明由后端给）。 */
export function getOcrSettings(): Promise<OcrSettings> {
  return request("/ocr/settings");
}

/** 切换识别引擎。Key 不在这里写——它复用联网搜索的 DeepSeek Key。 */
export function saveOcrEngine(engine: OcrEngine): Promise<OcrSettings> {
  return request("/ocr/settings", { method: "PUT", body: JSON.stringify({ engine }) });
}
