// SPDX-License-Identifier: Apache-2.0
/**
 * 表单弹窗底座：**有提交动作**的 Modal 一律过这里。
 *
 * 它只做四件事，每一件都是"没有别的地方能可靠兜住"的：
 * 1. 蒙层点击不可关（`mask={{ closable: false }}`）——`maskClosable` 在 antd 6.6.5 已废弃，
 *    新写法是 `mask.closable`（`modal/interface.d.ts:71`）；这条也无法全局兜住，只能逐个写；
 * 2. 主按钮必须给 `okText` 且它描述结果——缺了直接抛错，不落到默认的「确定」；
 * 3. 关闭语义按 L0–L3 分级（`useDiscardGuard`）：Esc 与 × 同义，脏值出内联确认条；
 * 4. 草稿恢复条挂在 body 顶部（内容由调用方给，底座不读存储）。
 *
 * **这是底座，不是某个业务组件**：文件里 import 它时放在列表最前，避免和
 * `ClaimFormModal` / `JobFormModal` 这类业务名看花。
 */
import { Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import DraftRestoreBar from "./DraftRestoreBar";
import FormModalFooter from "./FormModalFooter";
import type { DraftRestoreBarProps } from "./DraftRestoreBar";
import { useDiscardGuard } from "./useDiscardGuard";

export interface FormModalProps {
  /** 打开态（受控）。 */
  open: boolean;
  /** 弹窗标题，**≤7 字**（新增文案守此线）。 */
  title: string;
  /** 表单主体。 */
  children: ReactNode;
  /** 请求关闭；调用时机由分级决定（L2 只在确认「放弃修改」之后）。 */
  onCancel: () => void;
  /** 主按钮动作。抛错时本组件只负责解除 loading，提示由调用方给。 */
  onSubmit: () => void | Promise<void>;
  /** **必填**：必须描述结果（「保存改动」「导入 3 条」），禁止「确定」「是」。 */
  okText: string;
  okIcon?: ReactNode;
  /** 默认取 `t("common.action.cancel")`。 */
  cancelText?: string;
  /** 主按钮是否为危险操作（红色）。 */
  danger?: boolean;
  /** 提交中：主按钮 loading、取消按钮 disabled、× 隐藏、Esc 忽略。 */
  submitting?: boolean;
  /** 内容里是否已有未提交的修改。缺省视为 false（不问，直接关）。 */
  dirty?: boolean;
  /** 启用草稿时 L2 降级为 L1（不问，直接关并保留草稿）。 */
  hasDraft?: boolean;
  /** 草稿恢复条（展示状态 + 恢复/丢弃两个回调）；不传则不渲染该条。 */
  draftBar?: DraftRestoreBarProps | null;
  /**
   * 宽档。新写的一律用 400 / 520 / 720 / 880 四档（判据见方案 §4.1.3）；
   * 存量迁移时保留它原来的具体数值，避免"顺手改宽"把布局和截图一起动了。
   */
  width?: number | string;
  /** 右上角附加动作（如「查看历史」）：渲染在标题行尾。 */
  extra?: ReactNode;
  /** 默认 true：关闭即销毁，避免下次打开闪回旧值。 */
  destroyOnHidden?: boolean;
}

export default function FormModal({
  open,
  title,
  children,
  onCancel,
  onSubmit,
  okText,
  okIcon,
  cancelText,
  danger = false,
  submitting = false,
  dirty = false,
  hasDraft = false,
  draftBar = null,
  width = 520,
  extra,
  destroyOnHidden = true,
}: FormModalProps) {
  // 契约：okText 缺失必须当场炸。兜底成「确定」等于把错误藏到 review 之外。
  // 开发者报错用英文：它是给写代码的人看的，不属于界面文案（也就不该进语言包）。
  if (!okText || okText.trim().length === 0) {
    throw new Error("FormModal requires an okText that describes the result");
  }

  const [pending, setPending] = useState(false);
  const busy = submitting || pending;
  const guard = useDiscardGuard({ open, submitting: busy, dirty, hasDraft, onCancel });
  const keepRef = useRef<HTMLButtonElement>(null);

  // 确认条出现时焦点落到安全项（「继续编辑」），防手快连按两次把内容丢掉。
  useEffect(() => {
    if (guard.confirming) keepRef.current?.focus();
  }, [guard.confirming]);

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      await onSubmit();
    } finally {
      setPending(false);
    }
  };

  const heading = guard.confirming ? t("common.discard.title") : title;

  return (
    <Modal
      open={open}
      title={
        extra ? (
          <span className="rf-form-modal-heading">
            {heading}
            {extra}
          </span>
        ) : (
          heading
        )
      }
      mask={{ closable: false }}
      keyboard={false}
      closable={!busy}
      width={width}
      destroyOnHidden={destroyOnHidden}
      onCancel={guard.requestClose}
      // 字段多时限高，底部按钮不会被推出视口（沿用 ClaimFormModal 已验证的做法）。
      styles={{ body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto" } }}
      footer={
        <FormModalFooter
          confirming={guard.confirming}
          busy={busy}
          danger={danger}
          okText={okText}
          okIcon={okIcon}
          cancelText={cancelText}
          keepRef={keepRef}
          onRequestClose={guard.requestClose}
          onConfirmDiscard={guard.confirmDiscard}
          onKeepEditing={guard.keepEditing}
          onSubmit={() => void submit()}
        />
      }
    >
      {draftBar ? <DraftRestoreBar {...draftBar} /> : null}
      {children}
    </Modal>
  );
}
