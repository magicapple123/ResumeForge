// SPDX-License-Identifier: Apache-2.0
/**
 * 简历编辑弹窗的 footer（两态）：正常按钮组 / L2 内联确认条。
 *
 * 单独成文件是 `ResumeEditorModal` 的文件行数预算：确认条那一支一搬走，主文件就只留下
 * "哪个动作待确认"的状态。它只做渲染与转发——判据在 `useEditorDraftBar` 里，这里不判断
 * "要不要问"。
 *
 * 文案全部走 `t()`：这是本批新落地的弹层部件，`cjkRatchet` 不许它再加中文行。
 */
import { SaveOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";
import { t } from "../../i18n";
import type { EditorPendingAction } from "./useEditorDraftBar";

export interface EditorFooterBarProps {
  /** 待确认的动作；`null` 时是正常按钮组。 */
  confirming: EditorPendingAction;
  /** 提交中：两颗按钮都动不了。 */
  saving: boolean;
  /** 主按钮文字（「保存并更新预览」/「保存手写简历」）。 */
  saveLabel: string;
  onRequestClose: () => void;
  onConfirmPending: () => void;
  onKeepEditing: () => void;
  onSubmit: () => void;
}

export default function EditorFooterBar({
  confirming,
  saving,
  saveLabel,
  onRequestClose,
  onConfirmPending,
  onKeepEditing,
  onSubmit,
}: EditorFooterBarProps) {
  if (confirming) {
    // 就地换态：**不新开 `modal.confirm`**——那会是第二层容器（编辑器已在 3110）。
    return (
      <div className="rf-form-modal-discard" role="alert" aria-live="assertive">
        <span className="rf-form-modal-discard-text">
          {confirming === "discard"
            ? t("resume.editor.discard.body")
            : t("resume.editor.fill-all.body")}
        </span>
        <Space>
          <Button onClick={onKeepEditing}>{t("common.action.keep-editing")}</Button>
          <Button
            danger={confirming === "discard"}
            type={confirming === "discard" ? "default" : "primary"}
            onClick={onConfirmPending}
          >
            {confirming === "discard"
              ? t("common.action.discard")
              : t("resume.editor.fill-all.confirm")}
          </Button>
        </Space>
      </div>
    );
  }

  return (
    <Space>
      <Button disabled={saving} onClick={onRequestClose}>
        {t("common.action.cancel")}
      </Button>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSubmit}>
        {saveLabel}
      </Button>
    </Space>
  );
}
