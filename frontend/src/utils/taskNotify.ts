// SPDX-License-Identifier: Apache-2.0
/**
 * 「生成 / 批次完成」的统一通知出口：一处负责"弹窗 + 提示声 + 去查看"。
 *
 * 为什么要统一：这类提醒散在各模块里会出现两种不一致——有的响、有的不响；有的在任何页面
 * 都能看到、有的只在当前页弹。用户的要求很直接："每个 AI 生成模块完成后都要弹窗提醒并发出
 * 提醒声"。所以把呈现方式与声音绑在一起，调用方只说"什么完成了、要不要打断我"。
 *
 * 两种呈现，按"值不值得打断"分：
 * - `notification`（右上角卡片）：默认。批次跑完、一次性解读完成——不必立刻停下手上的事。
 * - `modal`（居中弹窗）：用户**明确等了很久**的那件事（例如整份简历生成），或结果需要他
 *   立刻做选择（"去看简历 / 稍后"）。它会打断操作，所以不滥用。
 *
 * **"去查看"由 `deepLink` 一处驱动**：地址由 `utils/taskDeepLinks` 生成，两种呈现都挂同一颗
 * 跳转按钮，点击统一走 `navigateForTask`。这样"点了通知但没跳到那条记录"只剩一个出错点。
 */
import { Button, Space } from "antd";
import { createElement, Fragment } from "react";
import type { ReactNode } from "react";
import { t } from "../i18n";
import { playDoneSound } from "./notifySound";

export interface TaskDoneNotice {
  title: string;
  description?: ReactNode;
  kind?: "success" | "warning" | "error";
  /** 右上角卡片里的动作按钮（调用方用 JSX 构造）。 */
  actions?: ReactNode;
  /** 改成居中弹窗；`confirmLabel` 给出确认按钮文案。 */
  modal?: boolean;
  confirmLabel?: string;
  onConfirm?: () => void;
  /**
   * 完成后该跳去哪（由 `utils/taskDeepLinks` 生成，未知类型或缺 id 时是 `null`）。
   *
   * 给了就多渲染一颗「去查看」按钮：卡片模式挂在 `actions` 后面；弹窗模式放进正文下方，
   * 点击顺手把弹窗收掉。`null` / 不给 = 不渲染跳转入口（例如生成失败，本来就没有落点）。
   */
  deepLink?: string | null;
  /** 「去查看」那颗按钮的文案（例如「查看简历」）；缺省用通用那句。 */
  viewLabel?: string;
}

/** 右上角卡片（AntD `notification`）的字段名。antd 6 起标题参数叫 `title`。 */
interface NotificationPayload {
  title: ReactNode;
  description?: ReactNode;
  duration?: number;
  actions?: ReactNode;
}

/**
 * 居中弹窗（AntD `modal`）的字段名。
 *
 * **必须与上面的卡片分开**：AntD 的 `modal.info` 认的是 `title` / `content`，而
 * `notification` 认的是 `title` / `description`（antd 6 起通知卡片的标题参数由
 * `message` 改名 `title`，但正文仍是 `description`，与弹窗的 `content` 不同）。
 * 曾经两者共用一个 `message` 形状，结果弹窗**标题与正文都是空的**（AntD 收不到
 * 它认识的键，不报错，只是什么都不显示）。
 */
interface ModalPayload {
  title: ReactNode;
  content?: ReactNode;
  okText?: string;
  onOk?: () => void;
}

/** `modal.info` 的返回值：只用到 `destroy`（点「去查看」之后把弹窗收掉）。 */
interface ModalInstance {
  destroy?: () => void;
}

export interface NotifyHost {
  notification: {
    success: (config: NotificationPayload) => void;
    warning: (config: NotificationPayload) => void;
    error: (config: NotificationPayload) => void;
    info: (config: NotificationPayload) => void;
  };
  /**
   * 返回值声明成 `unknown`：真实 AntD 返回 `{ destroy, update }`，而假宿主（单测）
   * 常常什么都不返回或返回一个数组长度。**不要**在这里断言形状，交给 `destroyOf` 判。
   */
  modal: { info: (config: ModalPayload) => unknown };
}

let host: NotifyHost | null = null;

/** 完成通知的跳转通道：App 挂载时注册 react-router 的 navigate（工具模块拿不到 hook）。 */
let taskNavigate: ((path: string) => void) | null = null;

export function registerTaskNavigate(next: ((path: string) => void) | null): void {
  taskNavigate = next;
}

/** 通知动作按钮用的页面跳转；未注册时静默跳过（单测/App 未挂载）。 */
export function navigateForTask(path: string): void {
  taskNavigate?.(path);
}

/** App 挂载时注册一次（AntD 的 App 实例只能在 hooks 里拿，这里只存引用）。 */
export function registerNotifyHost(next: NotifyHost | null): void {
  host = next;
}

/**
 * 「去查看」按钮：跳深链，并顺手把弹窗收掉（否则用户会停在"已完成"上，不知道自己走了）。
 *
 * 用 `createElement` 而不是 JSX：本文件是 `.ts`（工具模块），不参与 JSX 编译。
 */
function viewButton(
  deepLink: string,
  label: string | undefined,
  onNavigate?: () => void,
): ReactNode {
  return createElement(
    Button,
    {
      size: "small",
      type: "primary",
      onClick: () => {
        navigateForTask(deepLink);
        onNavigate?.();
      },
    },
    label ?? t("backgroundTasks.action.view"),
  );
}

/** 把若干动作按钮排成一行；只有一颗时也套一层，两种呈现的间距才一致。 */
function actionRow(nodes: ReactNode[]): ReactNode | null {
  if (nodes.length === 0) return null;
  return createElement(Space, { size: 8, wrap: true, className: "task-notice-actions" }, ...nodes);
}

/** 从 `modal.info` 的返回值里取关闭函数；返回形状不可信时返回 `null`（不关就是了）。 */
function destroyOf(instance: unknown): (() => void) | null {
  if (typeof instance !== "object" || instance === null) return null;
  const target = instance as ModalInstance;
  if (typeof target.destroy !== "function") return null;
  return () => target.destroy?.();
}

/**
 * 弹窗正文：说明 + 一行动作按钮。
 *
 * 单独成函数而不是内联进 `content:` 里，且用 `Fragment` 而不是 `"div"`：
 * `createElement("div", …)` 的标签名是个字符串字面量，会被 i18n 的"产品文案"扫描器当成
 * 一句待翻译的文案（它确实是字符串，只是不是给人看的）。用 Fragment 连这个歧义都没有。
 */
function noticeContent(description: ReactNode, actions: ReactNode | null): ReactNode | undefined {
  if (!description && !actions) return undefined;
  return createElement(Fragment, null, description, actions);
}

/**
 * 报告一件"完成了"的事：**一定**发声（除非用户关掉了），再按 `modal` 决定是否打断。
 *
 * 没有宿主时（单测、或 App 还没挂上）只发声不弹——静默跳过比抛异常好。
 */
export function notifyTaskDone(notice: TaskDoneNotice): void {
  playDoneSound();
  if (!host) return;
  const deepLink = notice.deepLink ?? null;
  // 标题为空时兜一句：弹窗没有标题等于"不知道发生了什么"。
  const title = notice.title.trim() ? notice.title : t("backgroundTasks.notice.done.title");
  if (notice.modal) {
    // `modal.info` 的返回值要等调用之后才知道，所以先留一个可变的关闭句柄：
    // 用户真点到「去查看」时它已经被赋值了。
    let close: (() => void) | null = null;
    const actions = actionRow([
      ...(notice.actions ? [notice.actions] : []),
      ...(deepLink ? [viewButton(deepLink, notice.viewLabel, () => close?.())] : []),
    ]);
    const instance = host.modal.info({
      title,
      // 弹窗没有独立的"动作区"，把动作按钮并进正文，别让它悄悄丢掉。
      content: noticeContent(notice.description, actions),
      okText: notice.confirmLabel ?? t("backgroundTasks.confirm.gotIt"),
      onOk: notice.onConfirm,
    });
    close = destroyOf(instance);
    return;
  }
  const kind = notice.kind ?? "success";
  host.notification[kind]({
    // antd 6 起通知卡片的标题字段由 message 改名 title（渲染类同为
    // .ant-notification-notice-title，见 taskNotify.modal.test.tsx 的选择器）。
    title,
    description: notice.description,
    actions: deepLink
      ? actionRow([
          ...(notice.actions ? [notice.actions] : []),
          viewButton(deepLink, notice.viewLabel),
        ])
      : notice.actions,
    duration: 6,
  });
}
