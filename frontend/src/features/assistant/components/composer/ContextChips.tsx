// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区的关联上下文（岗位 / 简历）：**只渲染已选的 chip**。
 *
 * R06-A：未选时那枚「+ 关联岗位或简历」虚线按钮删掉了——入口统一收到工具栏最左的 `+`
 * 面板（`composer/AddMenu.tsx`）。这里只剩"已经关联了什么"的可读反馈 + 一键取消。
 *
 * F36：取数与标题口径下沉到 `useAssistantContextRefs`（页面持有），这里只负责显示——
 * 发送时页面要用同一份标题做乐观气泡的「本轮引用」快照，两处各算一次迟早不一致。
 *
 * 都没选时返回 `null`：父容器是 `display: grid; gap: 12px`，渲染一个空 div 会白多
 * 一行间距（空对话里最显眼的就是这种空档）。
 */

import { CloseOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";

interface Props {
  jobId: number | undefined;
  resumeId: number | undefined;
  jobLabel: string;
  resumeLabel: string;
  onJobChange: (value: number | undefined) => void;
  onResumeChange: (value: number | undefined) => void;
}

export default function ContextChips({
  jobId,
  resumeId,
  jobLabel,
  resumeLabel,
  onJobChange,
  onResumeChange,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();

  if (jobId == null && resumeId == null) return null;

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
