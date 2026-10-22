// SPDX-License-Identifier: Apache-2.0
/**
 * 结果反馈的统一出口：**带撤销**的那种 Toast 只能从这里发。
 *
 * 为什么是 hook 而不是像 `taskNotify` 那样的全局桥：撤销场景全发生在组件内（列表、抽屉、
 * 面板），调用方就在 React 树里，hook 少一层全局可变状态。`NotifyHostBridge` 那套继续
 * 服务"非组件代码 + 系统通知"，两者不重叠。
 *
 * 存量 620 次 `message.*` 调用点**不动**：它们的默认时长由
 * `<AntdApp message={MESSAGE_CONFIG}>` 一处改掉（3s → 2.5s）。
 */
import { App, Button } from "antd";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { t } from "../i18n";

/** 结果类（成功 / 信息 / 警告）：够读完，又不至于挡着下一步。 */
export const RESULT_TOAST_MS = 2500;
/** 错误类：要读得完，给 4 秒。 */
export const ERROR_TOAST_MS = 4000;
/** 撤销窗口：规范已拍板 5 秒，不加设置项。 */
export const UNDO_TOAST_MS = 5000;

export interface ToastAction {
  /** ≤6 字（如「撤销」「查看」）。 */
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastOptions {
  /** 去重键：同 key 的卡片就地更新而不是叠加（连点两次删除只留一张）。 */
  key?: string;
  /** 覆盖默认时长（**毫秒**；内部换算成 antd 的秒）。 */
  duration?: number;
  /** 附加动作（撤销 / 查看）。 */
  action?: ToastAction;
}

export interface ToastApi {
  success(text: string, options?: ToastOptions): void;
  error(text: string, options?: ToastOptions): void;
  warning(text: string, options?: ToastOptions): void;
  info(text: string, options?: ToastOptions): void;
  /** 「做完了，但可以退回去」：固定 5s，强制带动作。 */
  undo(text: string, action: ToastAction, options?: ToastOptions): void;
}

export function useToast(): ToastApi {
  const { message } = App.useApp();

  return useMemo<ToastApi>(() => {
    /**
     * 带动作的 toast 内容。
     *
     * antd 6 的 `message` 配置里**没有** `btn` 字段（`message/interface.d.ts` 的
     * `ArgsProps` 只有 content/duration/type/icon/key/onClick…），所以动作按钮只能
     * 作为 `content` 的一部分渲染——这也是能拿到"点完就关掉这张卡"的唯一办法。
     */
    const render = (text: string, key: string, action?: ToastAction): ReactNode => {
      if (!action) return text;
      return (
        <span className="rf-toast-content">
          <span>{text}</span>
          <Button
            type="link"
            size="small"
            className="rf-toast-action"
            onClick={() => {
              message.destroy(key);
              void Promise.resolve()
                .then(() => action.onClick())
                .catch(() => message.error(t("toast.restore.failed")));
            }}
          >
            {action.label}
          </Button>
        </span>
      );
    };

    const open = (
      type: "success" | "error" | "warning" | "info",
      text: string,
      options: ToastOptions | undefined,
      fallbackDuration: number,
    ): void => {
      const key = options?.key ?? `rf-toast-${type}-${Date.now()}`;
      message.open({
        type,
        key,
        content: render(text, key, options?.action),
        duration: (options?.duration ?? fallbackDuration) / 1000,
      });
    };

    return {
      success: (text, options) => open("success", text, options, RESULT_TOAST_MS),
      error: (text, options) => open("error", text, options, ERROR_TOAST_MS),
      warning: (text, options) => open("warning", text, options, RESULT_TOAST_MS),
      info: (text, options) => open("info", text, options, RESULT_TOAST_MS),
      undo: (text, action, options) => {
        const key = options?.key ?? `rf-undo-${Date.now()}`;
        message.open({
          type: "success",
          key,
          content: render(text, key, action),
          duration: UNDO_TOAST_MS / 1000,
        });
      },
    };
  }, [message]);
}
