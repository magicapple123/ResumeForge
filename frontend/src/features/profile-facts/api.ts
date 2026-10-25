// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实 API（契约 §3.2）：本地 CRUD，不走模型、不自动外发。
 *
 * 全部请求走 `api/client.request()`——错误正文由它内部调用 `extractError` 解析成
 * 用户可读的 message，业务码投影到 `ApiError.businessCode`；这里不自己 fetch、
 * 不自己解析错误，避免出现第二套错误口径。
 *
 * 删除是**软删**（后端写 deleted_at，进回收站），因此界面不需要前置二次确认。
 *
 * 字段设置（契约 §4）：GET /schema 读九类定义；PUT /schema/{kind} 条件写（expected_revision）；
 * POST /schema/{kind}/reset 恢复默认。PUT/reset 的响应契约写"返回完整 schema"，
 * 为兼容后端"整份 / 单类"两种合理实现，类型上用 `ProfileFactSchemaResponse`，
 * 由 `useFactSchema` 归一化，调用方只消费 `ProfileFactSchema`。
 */
import { buildQuery, request } from "../../api/client";
import type {
  FactKind,
  FactPayload,
  ProfileFact,
  ProfileFactCreate,
  ProfileFactKindSchemaUpdate,
  ProfileFactList,
  ProfileFactSchema,
  ProfileFactSchemaReset,
  ProfileFactSchemaResponse,
  ProfileFactUpdate,
} from "./types";

const BASE = "/profile/facts";
const SCHEMA = `${BASE}/schema`;

/** 列表默认一页 200 条（契约默认值）；只有超过时界面才提示并给「加载更多」。 */
export const PROFILE_FACTS_PAGE_SIZE = 200;

/** 读取未删除的事实；`kind` 留空表示九类都读，服务端顺序原样返回。 */
export function listProfileFacts(
  params: { kind?: FactKind; offset?: number; limit?: number } = {},
): Promise<ProfileFactList> {
  const query = buildQuery({
    kind: params.kind,
    offset: params.offset ?? 0,
    limit: params.limit ?? PROFILE_FACTS_PAGE_SIZE,
  });
  return request(`${BASE}${query}`);
}

/** 新增一条事实；`sort_order` 省略时由后端默认值决定（界面一般显式给追加序号）。 */
export function createProfileFact(input: {
  kind: FactKind;
  payload: FactPayload;
  sort_order?: number;
}): Promise<ProfileFact> {
  const body: ProfileFactCreate = input;
  return request(BASE, { method: "POST", body: JSON.stringify(body) });
}

/** 条件更新：带 `expected_revision`，冲突时后端 409，前端提示刷新而不是覆盖。 */
export function updateProfileFact(
  factId: string,
  input: { payload?: FactPayload; sort_order?: number; expected_revision?: number },
): Promise<ProfileFact> {
  const body: ProfileFactUpdate = input;
  return request(`${BASE}/${factId}`, { method: "PATCH", body: JSON.stringify(body) });
}

/** 软删（移入回收站，恢复/彻底删除走已有回收站入口）。 */
export function deleteProfileFact(factId: string): Promise<{ deleted: boolean }> {
  return request(`${BASE}/${factId}`, { method: "DELETE" });
}

/** 读取九类事实的字段设置（缺失 prefs 行时服务端返回全默认）。 */
export function getProfileFactSchema(): Promise<ProfileFactSchema> {
  return request(SCHEMA);
}

/** 保存某一类的字段设置：隐藏默认字段 + 自定义字段定义；409 表示版本冲突。 */
export function saveProfileFactKindSchema(
  kind: FactKind,
  input: ProfileFactKindSchemaUpdate,
): Promise<ProfileFactSchemaResponse> {
  return request(`${SCHEMA}/${kind}`, { method: "PUT", body: JSON.stringify(input) });
}

/** 恢复某一类的默认字段设置（清空隐藏与自定义字段，revision++）。 */
export function resetProfileFactKindSchema(
  kind: FactKind,
  input: ProfileFactSchemaReset,
): Promise<ProfileFactSchemaResponse> {
  return request(`${SCHEMA}/${kind}/reset`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
