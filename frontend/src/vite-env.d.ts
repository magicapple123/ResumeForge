/// <reference types="vite/client" />

/**
 * 桌面壳注入的桥（desktop/ 批次实现）。浏览器里不存在 `window.splash`；
 * 桌面壳里 `isDesktop === true`，`quitApp()` 退出壳进程。
 */
interface SplashBridge {
  isDesktop?: boolean;
  quitApp?: () => void;
}

interface Window {
  splash?: SplashBridge;
}
