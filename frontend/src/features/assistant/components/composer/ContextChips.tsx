// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区的关联上下文（岗位 / 简历）：**只渲染已选的 chip**。
 *
 * R06-A：未选时那枚「+ 关联岗位或简历」虚线按钮删掉了——入口统一收到工具栏最左的 `+`
 * 面板（`composer/AddMenu.tsx`）。这里只剩"已经关联了什么"的可读反馈 + 一键取消。
 *
 * 两件事必须保留：
 * - `ensure`：深链 / 页面侧带入的 id 不在候选首页里，靠它按 id 回查补进选项，
 *   chip 才能显示**标题**而不是 `#{id}`；
 * - 都没选时返回 `null`：父容器是 `display: grid; gap: 12px`，渲染一个空 div 会白多
 *   一行间距（空对话里最显眼的就是这种空档）。
 */

import { useEffect } from "react";
import { CloseOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { useJobSearchSelect, useResumeSearchSelect } from "../../../../hooks/remoteSearchOptions";

interface Props {
  jobId: number | undefined;
  resumeId: number | undefined;
  onJobChange: (value: number | undefined) => void;
  onResumeChange: (value: number | undefined) => void;
}

export default function ContextChips({ jobId, resumeId, onJobChange, onResumeChange }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();

  // 深链 / 页面侧带入的已选值保显示（P0-1）：按 id 回查补进候选。
  useEffect(() => {
    void jobSelect.ensure(jobId);
    // hook 的回调引用稳定，只跟随已选值变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  useEffect(() => {
    void resumeSelect.ensure(resumeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  if (jobId == null && resumeId == null) return null;

  const jobLabel =
    jobSelect.options.find((option) => option.value === jobId)?.label ??
    t("assistantComposer.context.jobFallback", { id: jobId ?? 0 });
  const resumeLabel =
    resumeSelect.options.find((option) => option.value === resumeId)?.label ??
    t("assistantComposer.context.resumeFallback", { id: resumeId ?? 0 });

  return (
    <div className="assistant-context-chips">
      {jobId != null && (
        <Tag className="assistant-context-chip" icon={<LinkOutlined />}>
          <span className="assistant-context-chip-text">{jobLabel}</span>
          <Button
            type="text"
            size="small"
            className="assistant-context-chip-close"
            aria-label={t("assistantComposer.context.removeJob")}
            icon={<CloseOutlined />}
            onClick={() => onJobChange(undefined)}
          />
        </Tag>
      )}
      {resumeId != null && (
        <Tag className="assistant-context-chip" icon={<LinkOutlined />}>
          <span className="assistant-context-chip-text">{resumeLabel}</span>
          <Button
            type="text"
            size="small"
            className="assistant-context-chip-close"
            aria-label={t("assistantComposer.context.removeResume")}
            icon={<CloseOutlined />}
            onClick={() => onResumeChange(undefined)}
          />
        </Tag>
      )}
    </div>
  );
}
