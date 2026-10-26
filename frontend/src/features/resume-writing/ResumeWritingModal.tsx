// SPDX-License-Identifier: Apache-2.0
/**
 * 「写作增强」弹窗：从**右键菜单**打开，入参是用户刚选中的那段文字。
 *
 * 为什么是弹窗而不是原来的编辑器页签：这个工具的输入天然是"我现在选中的这一段"，
 * 而右键正是"对这一段做点什么"的入口。做进页签里，用户得先把文字复制出来、切页签、
 * 粘进去——三步动作换来的是同一个结果。
 *
 * **结果默认回填**（写回刚才选中的位置）：右键的选区还在，`replaceSelection` 能精确
 * 换掉那一段，用户不用自己复制粘贴。选区不可写（右键落在普通段落上、没有可编辑目标）
 * 时才退回「复制」——那种情况下没有"回填到哪里"可言，硬点只会静默失败。
 *
 * `destroyOnHidden` 是必需的：每次右键选的是不同的文字，组件不销毁就会带着上一段的
 * 结果与输入（`initialText` 只在挂载时读一次）。
 */
import { Modal, Typography } from "antd";
import ResumeWritingPanel from "../../components/ResumeWritingPanel";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";

interface Props {
  open: boolean;
  /** 选区的归属简历：四个写作动作都要它（`/resumes/{id}/writing/*`）。 */
  resumeId: number;
  /** 打开时的初始文本 = 用户右键选中的那段。 */
  text: string;
  /**
   * 把结果写回选区，返回是否真的写进去了。
   *
   * 缺省（选区不可写）时面板显示「复制」而不是「回填」。
   */
  onApply?: (result: string) => boolean;
  onClose: () => void;
}

export default function ResumeWritingModal({ open, resumeId, text, onApply, onClose }: Props) {
  useLocale();
  return (
    <Modal
      open={open}
      title={t("writing.menu.entry")}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnHidden
      // 这颗弹窗是从**右键浮层**里开的，而它下面常常还压着简历详情/编辑器弹窗
      // （`layer.editorModal` 3110、容器链 3200/3300）。antd 默认 1000 会让它整个
      // 藏在后面——用户只看到"点了没反应"（2026-10-24 用户反馈）。
      zIndex={layer.aiPolish}
    >
      <Typography.Paragraph type="secondary" className="resume-writing-modal-hint">
        {onApply ? t("writing.modal.hint-apply") : t("writing.modal.hint-copy")}
      </Typography.Paragraph>
      <ResumeWritingPanel resumeId={resumeId} initialText={text} onApply={onApply} />
    </Modal>
  );
}
