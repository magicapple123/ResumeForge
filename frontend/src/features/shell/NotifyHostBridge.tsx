// SPDX-License-Identifier: Apache-2.0
/**
 * 把 AntD 的通知 / 弹窗实例注册到统一通知出口（`utils/taskNotify`）。
 *
 * 为什么需要这一层：`App.useApp()` 只能在组件里调用，而"生成完成后弹窗 + 发声"要在各种
 * 非组件上下文（异步回调、全局 watcher）里触发。这里在应用启动时把实例存进模块级单例，
 * 之后任何地方都能调 `notifyTaskDone`。
 */
import { App } from "antd";
import { useEffect } from "react";
import { restoreBackgroundTasks } from "../../utils/backgroundTasks";
import { refreshNotificationSettings } from "../../utils/notificationPreferences";
import { navigateForTask, registerNotifyHost, type NotifyHost } from "../../utils/taskNotify";

/** preload 的点击回执（与 desktop/preload.js 的 onNotifyClick 一一对应）。 */
interface NotifyClickBridge {
  onNotifyClick?: (listener: (deepLink: string | null) => void) => () => void;
}

function notifyClickBridge(): NotifyClickBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { resumeForge?: NotifyClickBridge }).resumeForge;
  return bridge && typeof bridge.onNotifyClick === "function" ? bridge : null;
}

// StrictMode 下 effect 会经历挂载-卸载-再挂载；恢复登记表只做一次，
// 否则"刷新前已完成的任务"会被补发两遍提醒。
let restoreInvoked = false;

export default function NotifyHostBridge() {
  const { notification, modal } = App.useApp();

  useEffect(() => {
    registerNotifyHost({ notification, modal } as unknown as NotifyHost);
    // CR-29：通知偏好先拉一次再恢复任务——否则启动时补发的完成提醒会用出厂默认值判定
    // （结果类默认安静，用户明明打开了却收不到）。失败不阻断首屏，按"还没设置"处理。
    void refreshNotificationSettings();
    // 通知出口就位后恢复刷新前遗留的后台任务：已完成→补发提醒、运行中→恢复轮询。
    // 恢复是异步查询，fire-and-forget，绝不阻塞首屏。
    if (!restoreInvoked) {
      restoreInvoked = true;
      void restoreBackgroundTasks();
    }
    return () => registerNotifyHost(null);
  }, [notification, modal]);

  // 桌面系统通知的点击回执（CR-24）：主进程已经恢复/聚焦窗口，这里只负责跳深链。
  useEffect(() => {
    const bridge = notifyClickBridge();
    if (!bridge?.onNotifyClick) return;
    return bridge.onNotifyClick((deepLink) => {
      if (typeof deepLink === "string" && deepLink) navigateForTask(deepLink);
    });
  }, []);

  return null;
}
