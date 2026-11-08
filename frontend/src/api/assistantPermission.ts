// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手数据权限（四档）的全局默认接口（T11）。
 *
 * 四档同时决定「读」「写」两轴；设置页保存的是**全局默认**，输入框旁的下拉只覆盖
 * 当前对话（覆盖按会话存本机 localStorage，见 features/assistant/assistantPermission）。
 * 单独成文件而不是塞进 api/settings.ts：那个文件归协议线维护，T11 只加这一个端点。
 */
import { request } from "./client";

/** 四档权限：一档同时决定读、写两轴。 */
export type AssistantPermissionLevel = "read_only" | "read_full" | "write_confirm" | "write_full";

export interface AssistantPermissionSetting {
  permission: AssistantPermissionLevel;
}

export function getAssistantPermission(): Promise<AssistantPermissionSetting> {
  return request("/assistant/permission");
}

export function saveAssistantPermission(
  setting: AssistantPermissionSetting,
): Promise<AssistantPermissionSetting> {
  return request("/assistant/permission", {
    method: "PUT",
    body: JSON.stringify(setting),
  });
}
