/**
 * 把 AntD 的通知 / 弹窗实例注册到统一通知出口（`utils/taskNotify`）。
 *
 * 为什么需要这一层：`App.useApp()` 只能在组件里调用，而"生成完成后弹窗 + 发声"要在各种
 * 非组件上下文（异步回调、全局 watcher）里触发。这里在应用启动时把实例存进模块级单例，
 * 之后任何地方都能调 `notifyTaskDone`。
 */
import { App } from "antd";
import { useEffect } from "react";
import { restoreBackgroundTasks } from "../utils/backgroundTasks";
import { registerNotifyHost, type NotifyHost } from "../utils/taskNotify";

// StrictMode 下 effect 会经历挂载-卸载-再挂载；恢复登记表只做一次，
// 否则"刷新前已完成的任务"会被补发两遍提醒。
let restoreInvoked = false;

export default function NotifyHostBridge() {
  const { notification, modal } = App.useApp();

  useEffect(() => {
    registerNotifyHost({ notification, modal } as unknown as NotifyHost);
    // 通知出口就位后恢复刷新前遗留的后台任务：已完成→补发提醒、运行中→恢复轮询。
    // 恢复是异步查询，fire-and-forget，绝不阻塞首屏。
    if (!restoreInvoked) {
      restoreInvoked = true;
      void restoreBackgroundTasks();
    }
    return () => registerNotifyHost(null);
  }, [notification, modal]);

  return null;
}
