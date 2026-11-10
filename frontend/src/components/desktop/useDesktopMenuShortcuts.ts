// SPDX-License-Identifier: Apache-2.0
/**
 * 标题栏加速键（问题清单 §19.3 菜单树里标注的 Ctrl+N / Ctrl+O / Ctrl+± / Ctrl+0 / F11）。
 *
 * 抽成 hook 的原因：这些绑定与菜单结构无关，只负责"窗口级按键 → 固定动作"，
 * 而 DesktopTitleBar 已经贴着 500 行预算。编辑类 Ctrl+Z/X/C/V 不在这里重复拦截——
 * 它们由 Chromium 原生处理（自绘菜单只负责给用户提示）。
 */
import { useEffect } from "react";
import type { DesktopShellBridge } from "./desktopShellBridge";

interface Options {
  bridge: DesktopShellBridge;
  isMac: boolean;
  navigate: (path: string) => void;
}

export function useDesktopMenuShortcuts({ bridge, isMac, navigate }: Options): void {
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
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const code = event.code;
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
  }, [bridge, isMac, navigate]);
}
