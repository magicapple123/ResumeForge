// SPDX-License-Identifier: Apache-2.0
/**
 * 组 API（F6）：唯一的组读写入口。
 *
 * 全部经 api/client.request（预算/错误/取消统一）；错误响应体 {detail, code, ...extra}
 * 由 ApiError.businessCode / payload 暴露，页面据此给具体修复动作。
 */
import { request } from "../../api/client";
import type { GroupDeleteResult, GroupListOut, GroupOut, WorkspaceStateOut } from "./types";

const BASE = "/profile";

export function listGroups(): Promise<GroupListOut> {
  return request(BASE + "/groups");
}

export function createGroup(name: string): Promise<GroupOut> {
  return request(BASE + "/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renameGroup(
  groupId: string,
  name: string,
  expectedRevision: number,
): Promise<GroupOut> {
  return request(BASE + "/groups/" + encodeURIComponent(groupId), {
    method: "PATCH",
    body: JSON.stringify({ name, expected_revision: expectedRevision }),
  });
}

export function deleteGroup(groupId: string, expectedRevision: number): Promise<GroupDeleteResult> {
  return request(BASE + "/groups/" + encodeURIComponent(groupId), {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}

export function setGroupMembers(
  groupId: string,
  sectionKeys: string[],
  expectedRevision: number,
): Promise<GroupOut> {
  return request(BASE + "/groups/" + encodeURIComponent(groupId) + "/members", {
    method: "PUT",
    body: JSON.stringify({ section_keys: sectionKeys, expected_revision: expectedRevision }),
  });
}

export function switchCurrentGroup(
  groupId: string,
  expectedRevision: number,
): Promise<WorkspaceStateOut> {
  return request(BASE + "/current-group", {
    method: "PUT",
    body: JSON.stringify({ group_id: groupId, expected_revision: expectedRevision }),
  });
}

export function acknowledgeNotice(noticeId: string): Promise<{ acknowledged: boolean }> {
  return request(BASE + "/notices/" + encodeURIComponent(noticeId) + "/ack", {
    method: "POST",
  });
}
