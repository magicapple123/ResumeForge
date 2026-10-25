// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实的错误分类：把传输层的 `ApiError` 翻译成"是不是版本冲突"与"原因一句话"。
 *
 * 错误文案由 `api/client` 的 `extractError` 统一解析（`request()` 内部走它），这里只消费
 * 它的 `message` 与 `businessCode`，不重新解析响应体、也不把裸状态码展示给用户。
 */
import { ApiError } from "../../api/client";

/** 后端条件更新冲突的业务码（契约 §3.2：409 时响应体顶层 code 取这个值）。 */
export const PROFILE_FACT_REVISION_CONFLICT = "profile_fact_revision_conflict";

/** 是否为"这条内容已在别处被改过"的 409：提示刷新，不静默覆盖。 */
export function isRevisionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.businessCode === PROFILE_FACT_REVISION_CONFLICT
  );
}

/** 字段设置条件写的冲突业务码（契约 §4：PUT/reset 的 409 取这个值）。 */
export const PROFILE_FACT_SCHEMA_CONFLICT_CODE = "profile_fact_schema_revision_conflict";

/** 是否为字段设置的 409：提示刷新 schema 后再保存，不静默覆盖别人的改动。 */
export function isSchemaRevisionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.businessCode === PROFILE_FACT_SCHEMA_CONFLICT_CODE
  );
}

/** 失败原因（后端 detail 或本地异常信息）；没有可读原因时返回空串，由调用方兜底。 */
export function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "";
}
