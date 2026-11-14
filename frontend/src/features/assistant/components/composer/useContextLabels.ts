// SPDX-License-Identifier: Apache-2.0
/**
 * 已选岗位/简历的展示口径（F36 一处实现）。
 *
 * 输入区 chip 与气泡里的「本轮引用」必须显示同一个名字：两边各算一次，改了口径就会
 * 出现「chip 写 A、气泡写 B」。`ensure` 保留原语义——深链 / 页面侧带入的 id 不在
 * 候选首页里时按 id 回查补进选项，chip 才显示得出标题而不是 `#id`。
 */
import { useEffect, useMemo } from "react";
import type { AssistantMessageReferences } from "../../../../types";
import { t } from "../../../../i18n";
import { useJobSearchSelect, useResumeSearchSelect } from "../../../../hooks/remoteSearchOptions";

export interface ContextLabels {
  jobLabel: string;
  resumeLabel: string;
  /** 发送瞬间的引用快照（乐观气泡用；标题已是完整展示文案）。 */
  refs: AssistantMessageReferences;
}

export function useContextLabels(
  jobId: number | undefined,
  resumeId: number | undefined,
): ContextLabels {
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();

  useEffect(() => {
    void jobSelect.ensure(jobId);
    // hook 的回调引用稳定，只跟随已选值变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  useEffect(() => {
    void resumeSelect.ensure(resumeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  const jobLabel =
    jobId == null
      ? ""
      : (jobSelect.options.find((option) => option.value === jobId)?.label ??
        t("assistantComposer.context.jobFallback", { id: jobId }));
  const resumeLabel =
    resumeId == null
      ? ""
      : (resumeSelect.options.find((option) => option.value === resumeId)?.label ??
        t("assistantComposer.context.resumeFallback", { id: resumeId }));

  const refs = useMemo<AssistantMessageReferences>(
    () => ({
      job_id: jobId ?? null,
      resume_id: resumeId ?? null,
      // 标签已含公司（`标题 · 公司`），乐观气泡不再拼一次 company。
      job_title: jobId == null ? undefined : jobLabel,
      resume_title: resumeId == null ? undefined : resumeLabel,
    }),
    [jobId, jobLabel, resumeId, resumeLabel],
  );

  return { jobLabel, resumeLabel, refs };
}
