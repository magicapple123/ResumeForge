// SPDX-License-Identifier: Apache-2.0
/**
 * 已选岗位/简历的展示口径（F36 一处实现）。
 *
 * 输入区 chip 与气泡里的「本轮引用」必须显示同一个名字：两边各算一次，改了口径就会
 * 出现「chip 写 A、气泡写 B」。`ensure` 保留原语义——深链 / 页面侧带入的值不在候选
 * 首页里时按值回查补进选项，chip 才显示得出标题而不是 `external:7`。
 *
 * T29：简历那一项改用与提醒表单同一个 `useResumeRefSelect`（复合引用、内部 / 外部
 * 两组），展示名取选项的**纯文本** `text`（`label` 是带文件类型徽标的节点，塞不进
 * `title` / refs 快照这类字符串位置）。
 */
import { useEffect, useMemo, useState } from "react";
import type { AssistantMessageReferences } from "../../../../types";
import { t } from "../../../../i18n";
import { useJobSearchSelect } from "../../../../hooks/remoteSearchOptions";
import { useResumeRefSelect } from "../../../../hooks/useResumeRefSelect";
import { decodeResumeRef } from "../../../../types/resumeRef";

export interface ContextLabels {
  jobLabel: string;
  resumeLabel: string;
  /** 发送瞬间的引用快照（乐观气泡用；标题已是完整展示文案）。 */
  refs: AssistantMessageReferences;
}

export function useContextLabels(
  jobId: number | undefined,
  resumeRef: string | undefined,
): ContextLabels {
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeRefSelect();
  // 已选简历的展示名：回查落定前是空串（chip 一直渲染同一个值，不会先闪一个 `#id`）。
  const [resumeLabel, setResumeLabel] = useState("");
  const parsed = useMemo(() => decodeResumeRef(resumeRef), [resumeRef]);

  useEffect(() => {
    void jobSelect.ensure(jobId);
    // hook 的回调引用稳定，只跟随已选值变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (!parsed) {
      setResumeLabel("");
      return;
    }
    let cancelled = false;
    void resumeSelect.ensure(resumeRef).then((option) => {
      if (cancelled) return;
      // 回查不到（记录已删）时降级成 `简历 #id`：与提醒表单同一句兜底文案。
      setResumeLabel(
        option?.text ?? t("assistantComposer.context.resumeFallback", { id: parsed.id }),
      );
    });
    return () => {
      cancelled = true;
    };
    // `resumeRef` 变了才重新回查；`ensure` / `parsed` 的引用都是稳定的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeRef]);

  const jobLabel =
    jobId == null
      ? ""
      : (jobSelect.options.find((option) => option.value === jobId)?.label ??
        t("assistantComposer.context.jobFallback", { id: jobId }));

  const refs = useMemo<AssistantMessageReferences>(
    () => ({
      job_id: jobId ?? null,
      // 外部简历的 id 绝不写进 `resume_id`：两张表 id 会撞号，点引用片会开到别人的简历。
      // 复合引用统一放 `resume_ref`，气泡按 `resume_kind` 决定跳哪一页。
      resume_id: parsed?.kind === "internal" ? parsed.id : null,
      resume_ref: parsed ? resumeRef : undefined,
      resume_kind: parsed?.kind,
      // 标签已含公司（`标题 · 公司`），乐观气泡不再拼一次 company。
      job_title: jobId == null ? undefined : jobLabel,
      resume_title: parsed ? resumeLabel : undefined,
    }),
    [jobId, jobLabel, parsed, resumeLabel, resumeRef],
  );

  return { jobLabel, resumeLabel, refs };
}
