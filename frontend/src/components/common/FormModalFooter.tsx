// SPDX-License-Identifier: Apache-2.0
/**
 * `FormModal` 的底部区域（两态）：正常按钮组 / L2 内联确认条。
 *
 * 单独成文件是方案 §4.9 的预案：`FormModal` 一旦超过 130 行就把它拆出来，避免底座继续长。
 * 它只做渲染与转发——判据全在 `useDiscardGuard`，这里不判断"要不要问"。
 */
import { Button, Space } from "antd";
import type { ReactNode, RefObject } from "react";
import { t } from "../../i18n";

export interface FormModalFooterProps {
  /** 是否显示「放弃未保存的修改？」那一条。 */
  confirming: boolean;
  /** 提交中：两颗按钮都动不了。 */
  busy: boolean;
  danger: boolean;
  okText: string;
  okIcon?: ReactNode;
  cancelText?: string;
  /** 安全项的焦点落点（确认条出现时移过去）。 */
  keepRef: RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
  onConfirmDiscard: () => void;
  onKeepEditing: () => void;
  onSubmit: () => void;
}

export default function FormModalFooter({
  confirming,
  busy,
  danger,
  okText,
  okIcon,
  cancelText,
  keepRef,
  onRequestClose,
  onConfirmDiscard,
  onKeepEditing,
  onSubmit,
}: FormModalFooterProps) {
  if (confirming) {
    // L2：确认条就地出现。**不新开 modal.confirm**——那会是第二层容器（3300）。
    return (
      <div className="rf-form-modal-discard" role="alert" aria-live="assertive">
        <span className="rf-form-modal-discard-text">{t("common.discard.body")}</span>
        <Space>
          <Button ref={keepRef} onClick={onKeepEditing}>
            {t("common.action.keep-editing")}
          </Button>
          <Button danger onClick={onConfirmDiscard}>
            {t("common.action.discard")}
          </Button>
        </Space>
      </div>
    );
  }

  return (
    <Space>
      <Button onClick={onRequestClose} disabled={busy || undefined}>
        {cancelText ?? t("common.action.cancel")}
      </Button>
      <Button type="primary" danger={danger} loading={busy} icon={okIcon} onClick={onSubmit}>
        {okText}
      </Button>
    </Space>
  );
}
