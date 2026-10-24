// SPDX-License-Identifier: Apache-2.0
/**
 * 保存失败的**唯一**分类口径：把"保存时抛出来的东西"翻译成状态机认识的终态。
 *
 * 为什么单独成文件：制作台里有两条保存链路（正文走编辑器表单提交、版式走宿主 PATCH），
 * 它们都会把错误抛到同一个状态机。如果一处按 `status === 409` 判断、另一处按文案判断，
 * 两个窗口就会对"这算不算冲突"给出不同答案——冲突 UI 时有时无正是这种分叉的典型症状。
 *
 * **只认业务码**：顶层 `code=resume_revision_conflict` 是后端的契约
 * （`backend/app/services/resume/document_save.py` 的 `CONFLICT_CODE`）。只按 409 判断会把
 * 数据集切换（`dataset_scope_changed`）等其它 409 也当成版本冲突，点开"比较差异"却读不出
 * 任何差异——用户只会觉得这个提示在骗人。
 */
import { ApiError } from "../../api/client";
import type { SaveOutcome } from "./types";

/** 与后端 `document_save.CONFLICT_CODE` 逐字一致（改名必须两边同改）。 */
export const REVISION_CONFLICT_CODE = "resume_revision_conflict";

/**
 * 这次错误是不是"版本冲突"。
 *
 * 拿到 409 但不带业务码时**不算**冲突：可能是旧后端（0052 之前根本不返回 revision），
 * 那时没有条件写可言，把它当冲突会让每一个普通失败都弹三选一。
 */
export function isRevisionConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.businessCode === REVISION_CONFLICT_CODE
  );
}

/**
 * 读持久版本号。
 *
 * 后端 0052 起 `ResumeBrief/ResumeOut` 必返回 `revision`；前端类型标成可选是为了兼容
 * "新前端 + 旧后端"（以及大量只填必要字段的历史测试夹具）——缺字段时按 0 兜底。旧记录
 * 与旧后端都等价于"第 0 版"，这正是迁移 0052 对所有历史行的取值。
 */
export function revisionOf(detail: { revision?: number } | null | undefined): number {
  return detail?.revision ?? 0;
}

/** 把异常翻译成保存终态：非冲突一律是"失败"（不清草稿、不进冲突态）。 */
export function outcomeFromError(error: unknown): SaveOutcome {
  if (isRevisionConflict(error)) {
    // 409 的响应体里带 revision，但 `api/client` 的错误契约只上交 detail/code（不解析业务
    // 字段）。前端不需要它就能做三选一（"用最新的/比较"本来就要 GET 最新），需要时用
    // `fetchLatest` 拿真实版本，绝不在这里编一个数。
    return { status: "conflict", currentRevision: null };
  }
  return { status: "failed", error };
}
