// SPDX-License-Identifier: Apache-2.0
/**
 * 进度表单「使用的简历」选择器（T6 / T29）：**薄封装**，实现全在 `hooks/useResumeRefSelect`。
 *
 * 这个文件原先自带一份约 400 行的完整实现（并行查两张表、防抖、钉住已选值、分组、404 降级），
 * 与 `useResumeRefSelect` 逐段重复——两份代码的分歧不会报错，只会表现为"提醒表单能选到、
 * 进度表单选不到"这类没有报错信息的 bug。T29 把它们收成一份：
 *
 * - 复合值的解析 / 拼装 / 两字段拆分统一走 `types/resumeRef`（本文件只做旧名字的再导出，
 *   `TrackFormModal` 的调用点不用改）；
 * - 候选与已选值保显示、防抖、竞态序号、分组都由共享 hook 提供。
 *
 * 与共享 hook 的两处**口径差异**（都在这里配，不在共享 hook 里写死）：
 *
 * 1. `includeGeneral`：未选岗位时也带 `include_general: true`（进度表单的"全库 = 本岗位 +
 *    通用"语义）；
 * 2. `itemSuffix`：已选值换了岗位后不是候选集里的，**保留**并标「（不属于当前岗位）」——
 *    静默清空等于让用户重选，静默改选会把错误版本写进投递记录。
 */
import { useResumeRefSelect } from "../../hooks/useResumeRefSelect";
import { t } from "../../i18n";
import { decodeResumeRef, resumeRefValue } from "../../types/resumeRef";

/**
 * 复合值 → `{kind, id}`；非法串一律 `null`。
 *
 * 旧名字保留给 `TrackFormModal`（它要按来源拆 `resume_id` / `external_resume_id` 两个字段）。
 * 直接复用 `types/resumeRef.decodeResumeRef`，不再养第二份解析器。
 */
export const parseResumeRef = decodeResumeRef;

/**
 * 一条进度记录的复合值：外部优先（两字段互斥，后端 422 守着），都没有则 `null`。
 *
 * 「都没有」是合法状态：表单里清空下拉 = 两个关联字段都置 null，后端保留标题快照。
 */
export function trackResumeRef(track: {
  resume_id: number | null;
  external_resume_id: number | null;
}): string | null {
  return resumeRefValue(track) ?? null;
}

/**
 * 进度表单的简历选择器。
 *
 * @param jobId 当前表单里选中的岗位；`null` = 未选岗位，候选退回**全库**。
 */
export function useTrackResumeSelect(jobId: number | null) {
  return useResumeRefSelect({
    jobId,
    includeGeneral: true,
    itemSuffix: (item) =>
      jobId != null && item.jobId != null && item.jobId !== jobId
        ? t("trackerForm.resume.notInJob")
        : null,
  });
}
