// SPDX-License-Identifier: Apache-2.0
/** 关键按钮失败时的「原因 + 可做什么 + 编号」指引（RF-20）。

不做全局错误组件改造：各失败面用 formatErrorGuidance 把 ApiError 映射成一句
「原因：… · 建议：… · 编号：requestId 前 8 位」。编号来自后端回写的
x-request-id，用户反馈时带上它就能在后端日志里定位那一次请求。 */

import { t } from "../i18n";
import { ApiError } from "./client";

export interface ErrorGuidance {
  /** 失败原因（用户能看懂的一句话）。 */
  reason: string;
  /** 建议做法（用户下一步可以做什么）。 */
  action: string;
  /** 请求编号（requestId 前 8 位；无 requestId 时为 "-"）。 */
  ref: string;
}

/** 数据集作用域过期（后端 code=dataset_scope_changed）。
 *
 * 这类 409 的成因不是「有任务在跑」，而是页面手里的 scope token 旧了：只有它能在
 * 重新同步身份后自动重试一次，其余 409 必须保持原行为（提示用户先停下任务）。
 */
export function isDatasetScopeExpired(err: unknown): boolean {
  return (
    err instanceof ApiError && err.status === 409 && err.businessCode === "dataset_scope_changed"
  );
}

/** 从 ApiError 提取映射表；非 ApiError（本地异常/未知）给通用指引。 */
export function errorGuidance(err: unknown): ErrorGuidance {
  const ref = err instanceof ApiError && err.requestId ? err.requestId.slice(0, 8) : "-";
  if (!(err instanceof ApiError)) {
    return {
      reason: err instanceof Error ? err.message : t("apiErrors.guidance.unknownReason"),
      action: t("apiErrors.guidance.retryDiagnostics"),
      ref,
    };
  }
  switch (err.code) {
    case "timeout":
      return {
        reason: t("apiErrors.guidance.timeoutReason"),
        action: t("apiErrors.guidance.timeoutAction"),
        ref,
      };
    case "network":
      return {
        reason: t("apiErrors.guidance.networkReason"),
        action: t("apiErrors.guidance.networkAction"),
        ref,
      };
    case "cancelled":
      return {
        reason: t("apiErrors.guidance.cancelledReason"),
        action: t("apiErrors.guidance.cancelledAction"),
        ref,
      };
    default:
      break;
  }
  const status = err.status ?? 0;
  if (status === 409) {
    // 「页面与本地数据集的连接过期」不是冲突：调用方已经自动重同步并重试过一次，
    // 还走到这里说明重试也失败了——让用户直接再点一次，而不是去停任务。
    if (isDatasetScopeExpired(err)) {
      return {
        reason: t("apiErrors.guidance.scopeExpiredReason"),
        action: t("apiErrors.guidance.scopeExpiredAction"),
        ref,
      };
    }
    return {
      reason: err.message || t("apiErrors.guidance.conflictReason"),
      action: t("apiErrors.guidance.conflictAction"),
      ref,
    };
  }
  if (status === 401 || status === 403) {
    return {
      reason: err.message || t("apiErrors.guidance.forbiddenReason"),
      action: t("apiErrors.guidance.forbiddenAction"),
      ref,
    };
  }
  if (status === 413) {
    return {
      reason: err.message || t("apiErrors.guidance.tooLargeReason"),
      action: t("apiErrors.guidance.tooLargeAction"),
      ref,
    };
  }
  if (status >= 500) {
    return {
      reason: err.message || t("apiErrors.guidance.serverReason"),
      action: t("apiErrors.guidance.retryWithRef"),
      ref,
    };
  }
  return {
    reason: err.message,
    action: t("apiErrors.guidance.retryWithRef"),
    ref,
  };
}

/** 组装成展示文案；fallback 用于 err 不是 Error 时的兜底主因。 */
export function formatErrorGuidance(err: unknown, fallback: string): string {
  const guidance = errorGuidance(err);
  const reason = guidance.reason || fallback;
  return t("apiErrors.guidance.format", {
    reason,
    action: guidance.action,
    ref: guidance.ref,
  });
}
