// SPDX-License-Identifier: Apache-2.0
/**
 * 标题栏加速键（问题清单 §19.3 菜单树里标注的组合键）。
 *
 * 抽成 hook 的原因：这些绑定与菜单结构无关，只负责"窗口级按键 → 固定动作"，
 * 而 DesktopTitleBar 已经贴着 500 行预算。编辑类 Ctrl+Z/X/C/V 不在这里重复拦截——
 * 它们由 Chromium 原生处理（自绘菜单只负责给用户提示）。
 *
 * 本轮 #34 补的三条（自绘菜单替换掉 Electron 默认菜单后，它们原本随默认菜单一起消失）：
 *  - Ctrl/Cmd+R：重新加载（走容器给的 onReload，刷新前先记住路由）；
 *  - F12：开发者工具；
 *  - Alt+F4（macOS ⌘W）：关闭窗口，与菜单里标注的加速键一致。
 */
import { useEffect } from "react";
import type { DesktopShellBridge } from "./desktopShellBridge";

interface Options {
  bridge: DesktopShellBridge;
  isMac: boolean;
  navigate: (path: string) => void;
  /** 重新加载：由容器注入（它要先把当前路由记成交接信息，见 desktopRouteMemory）。 */
  onReload: () => void;
}

export function useDesktopMenuShortcuts({ bridge, isMac, navigate, onReload }: Options): void {
  useEffect(() => {
    const runIpc = (event: KeyboardEvent, action: string) => {
      event.preventDefault();
      const pending = bridge.menuAction?.(action);
      if (pending) void pending.catch(() => undefined);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "F11") {
        runIpc(event, "view.toggleFullscreen");
        return;
      }
      if (event.key === "F12") {
        runIpc(event, "view.toggleDevTools");
        return;
      }
      if (event.altKey && event.key === "F4") {
        runIpc(event, "window.close");
        return;
      }
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const code = event.code;
      if (key === "r" || code === "KeyR") {
        event.preventDefault();
        onReload();
        return;
      }
      if (isMac && (key === "w" || code === "KeyW")) {
        // macOS 关闭窗口的惯例是 ⌘W；Windows 的 Alt+F4 在 mac 上是 Option+F4（无意义）。
        runIpc(event, "window.close");
        return;
      }
      if (key === "n" || code === "KeyN") {
        event.preventDefault();
        navigate("/resumes");
        return;
      }
      if (key === "o" || code === "KeyO") {
        event.preventDefault();
        navigate("/settings?tab=data");
        return;
      }
      if (key === "=" || key === "+" || code === "Equal") {
        runIpc(event, "view.zoomIn");
        return;
      }
      if (key === "-" || key === "_" || code === "Minus") {
        runIpc(event, "view.zoomOut");
        return;
      }
      if (key === "0" || code === "Digit0") runIpc(event, "view.zoomReset");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bridge, isMac, navigate, onReload]);
}
