// SPDX-License-Identifier: Apache-2.0
/**
 * 「有未保存的修改」确认卡片（R-26 的出口）。
 *
 * 为什么是居中卡片而不是页内 Alert：dirty 时的三个出口（路由离页 / 取消编辑 /
 * 程序触发切方案）原先都在**页面最顶部**渲染一条内联 Alert，而触发它的按钮在页头
 * 甚至页外——用户点了「取消编辑」只看到页面闪一下，以为按钮没反应，接着重复点。
 * 确认必须出现在**视线落点**上，所以改成带遮罩的居中卡片。
 *
 * 关闭语义（与 AGENTS「弹层形态与关闭语义」一致）：
 * - 蒙层不可关（`mask.closable: false`）：这是"有内容会丢"的决策，不能靠点空白跳过；
 * - Esc 与 × 同义，且**都等于「继续编辑」**——关闭这个卡片本身是无损动作，
 *   内容原样留在页面上，所以不需要"关闭即丢弃"的危险路径；
 * - 危险动作（放弃修改）用 `danger`，默认焦点落在「继续编辑」上：手快连按两下
 *   也不会把内容丢掉。
 */
import { Button, Modal } from "antd";
import { useEffect, useRef } from "react";
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ProfileLeaveKind } from "../../features/profile/useProfileLeaveGuard";

/** 三种离开方式的正文：文案随种类变，卡片形态与动作不变。 */
const BODY_KEY: Record<ProfileLeaveKind, MessageKey> = {
  navigate: "profileGroups.leave.body.navigate",
  "switch-group": "profileGroups.leave.body.switchGroup",
  cancel: "profileGroups.leave.body.cancel",
};

interface Props {
  /** 是否展示（有脏值且用户触发了离开时才为真）。 */
  open: boolean;
  /** 待处理的离开种类；只用于选正文，缺省按「取消编辑」处理。 */
  kind: ProfileLeaveKind | null;
  /** 确认放弃：执行挂起的动作 / 放行被拦下的路由。 */
  onDiscard: () => void;
  /** 继续编辑：清挂起、留在原页（Esc / × / 主按钮三处同一出口）。 */
  onKeep: () => void;
}

export default function ProfileLeaveConfirmModal({ open, kind, onDiscard, onKeep }: Props) {
  useLocale();
  const keepRef = useRef<HTMLButtonElement>(null);

  // 打开后把焦点送到安全项（「继续编辑」）。不能直接在本组件的 effect 里 focus：
  // Modal 的内容由 rc-motion 在**下一帧**才挂载（首次提交时 footer 里的按钮还不存在，
  // ref 是 null）。放到打开后的第一个宏任务里送，早于用户可能的下一次按键。
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => keepRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <Modal
      open={open}
      title={t("profileGroups.leave.title")}
      width={420}
      mask={{ closable: false }}
      keyboard
      onCancel={onKeep}
      destroyOnHidden
      footer={
        <div className="profile-leave-confirm-actions">
          <Button danger onClick={onDiscard}>
            {t("profileGroups.leave.discard")}
          </Button>
          <Button ref={keepRef} type="primary" onClick={onKeep}>
            {t("profileGroups.leave.keep")}
          </Button>
        </div>
      }
    >
      <p className="profile-leave-confirm-body">{t(BODY_KEY[kind ?? "cancel"])}</p>
    </Modal>
  );
}
