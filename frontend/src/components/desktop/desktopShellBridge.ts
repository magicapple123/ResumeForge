// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面壳窗口桥（desktop/preload.js 暴露的 window.desktopShell）。
 *
 * 与 splash 桥分开的原因：splash 回答"这是不是桌面壳"（浏览器里不存在）；这个桥只被
 * 桌面标题栏使用，浏览器里连元素都不渲染。所有入口都是**固定的**通道 / 动作 id，
 * 主进程 desktop/lib/desktop-shell-ipc.js 侧做发送方校验与动作白名单。
 *
 * 本文件不引入任何运行时 i18n / 业务模块：它只描述桥的形状与调用方式，测试里直接
 * stub 一个同形状对象即可。
 */

/** 主进程推送的窗口状态：菜单里"最大化 / 还原"的文案与全屏隐藏标题栏都读它。 */
export interface DesktopWindowState {
  maximized: boolean;
  fullscreen: boolean;
}

/** 「关于」弹窗需要的静态信息（由主进程 about.getInfo 动作返回）。 */
export interface DesktopAboutInfo {
  version?: string;
  platform?: string;
  dataDir?: string;
  logDir?: string;
  github?: string;
  website?: string;
  license?: string;
}

/** 一次菜单动作的回复：未知动作 / 主窗口不可用等一律 ok:false（不抛到渲染层）。 */
export interface DesktopMenuActionReply {
  ok: boolean;
  error?: string;
  result?: unknown;
}

/** preload 暴露的最小表面。所有字段都可选：宿主版本落后时标题栏安静降级。 */
export interface DesktopShellBridge {
  /** process.platform：macOS 红绿灯左内边距与快捷键文案用。 */
  platform?: string;
  menuAction?: (action: string) => Promise<DesktopMenuActionReply | undefined>;
  getWindowState?: () => Promise<DesktopWindowState | undefined>;
  onWindowState?: (callback: (state: DesktopWindowState) => void) => void;
  setTheme?: (theme: "light" | "dark") => void;
}

/** 「帮助 → 使用指南」：标题栏与引导弹窗分属两棵组件树，用窗口事件对接。 */
export const OPEN_USER_GUIDE_EVENT = "resumeforge:open-user-guide";

type DesktopShellWindow = Window & { desktopShell?: DesktopShellBridge };

/** 桌面壳里返回桥；浏览器（没有 splash.isDesktop）或旧壳（没有桥）返回 null。 */
export function getDesktopShellBridge(): DesktopShellBridge | null {
  if (typeof window === "undefined") return null;
  if (!window.splash?.isDesktop) return null;
  const bridge = (window as DesktopShellWindow).desktopShell;
  return bridge && typeof bridge === "object" ? bridge : null;
}

/** 发一个菜单动作；桥不存在或主进程拒绝时静默（菜单只做用户体验，不承载业务错误）。 */
export function runDesktopMenuAction(action: string): void {
  try {
    const pending = getDesktopShellBridge()?.menuAction?.(action);
    if (pending && typeof pending.catch === "function") void pending.catch(() => undefined);
  } catch {
    // contextIsolation 边界上的异常不该冒泡到 React 渲染。
  }
}

/** 退出应用：走既有 splash.quitApp 桥（before-quit 是唯一停止点）。 */
export function requestDesktopQuit(): void {
  try {
    window.splash?.quitApp?.();
  } catch {
    // 同上：退出失败由主进程的日志负责，不阻断界面。
  }
}

/** 打开使用指南：AppShell 监听同一个事件名（浏览器里没有监听者，事件会被丢弃）。 */
export function openUserGuideFromMenu(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_USER_GUIDE_EVENT));
}
