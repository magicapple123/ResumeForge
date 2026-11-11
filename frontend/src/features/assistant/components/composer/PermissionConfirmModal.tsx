// SPDX-License-Identifier: Apache-2.0
/**
 * 权限一次性确认卡（#12）。
 *
 * 为什么不用 `common/FormModal.tsx`：那个组件的语义是**表单提交**（`okText` 必填、
 * `onSubmit` 抛错处理、草稿恢复）。本卡片没有表单字段，主按钮还需要随勾选态在
 * enabled/disabled 之间切换——用受控 `Modal` 更直接。**这是有意偏离**，不要"按规范改回去"。
 *
 * 三条行为约束（改之前先读）：
 * 1. **选择不立即生效**：卡片打开期间调用方仍用旧档位发送；只有 `onConfirm` 才落盘。
 * 2. **写档位必须勾选**：未勾选时主按钮 disabled——这是本轮唯一改变安全边界的位置。
 * 3. 取消 / × / Esc / 点背板一律走 `onCancel`，不写任何存储。
 */
import { Checkbox, Modal, Typography } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import {
  ASSISTANT_PERMISSION_LABEL_KEYS,
  isWriteLevel,
  type AssistantPermissionLevel,
} from "../../assistantPermission";

export interface PermissionConfirmModalProps {
  level: AssistantPermissionLevel | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PermissionConfirmModal({
  level,
  onConfirm,
  onCancel,
}: PermissionConfirmModalProps) {
  // 模块级 t()：必须订阅语言变化，否则切语言后卡片文案不变。
  useLocale();
  const [checked, setChecked] = useState(false);

  // 每次换档位都重置勾选：不能把"勾过完全权限"带到下一个档位。
  useEffect(() => {
    setChecked(false);
  }, [level]);

  if (level == null) return null;
  const write = isWriteLevel(level);
  const levelLabel = t(ASSISTANT_PERMISSION_LABEL_KEYS[level]);

  return (
    <Modal
      open
      centered

      keyboard
      title={
        <span className="assistant-permission-confirm-title">
          <ExclamationCircleFilled
            className={
              write
                ? "assistant-permission-confirm-icon is-write"
                : "assistant-permission-confirm-icon is-read"
            }
          />
          {t("assistantPermission.confirm.title", { level: levelLabel })}
        </span>
      }
      okText={
        write
          ? t("assistantPermission.confirm.ok", { level: levelLabel })
          : t("assistantPermission.confirm.okReadFull")
      }
      cancelText={t("assistantPermission.confirm.cancel")}
      okButtonProps={{ disabled: write && !checked }}
      onOk={onConfirm}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Typography.Paragraph className="assistant-permission-confirm-body">
        {write
          ? t("assistantPermission.confirm.body")
          : t("assistantPermission.confirm.readFullBody")}
      </Typography.Paragraph>
      {write ? (
        <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)}>
          {t("assistantPermission.confirm.risk")}
        </Checkbox>
      ) : null}
    </Modal>
  );
}
