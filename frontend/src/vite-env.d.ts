/// <reference types="vite/client" />

/**
 * 桌面壳注入的桥（desktop/ 批次实现）。浏览器里不存在 `window.splash`；
 * 桌面壳里 `isDesktop === true`，`quitApp()` 退出壳进程。
 */
interface SplashBridge {
  isDesktop?: boolean;
  quitApp?: () => void;
}

/**
 * 简历打印桥（R1，desktop/preload.js）：把预览用的 HTML 交给主进程用 Chromium
 * 打成 PDF。浏览器里不存在，前端据此回落到后端 PDF 引擎 / window.print。
 */
interface ResumeForgeBridge {
  printPdf: (payload: {
    html: string;
    suggestedName?: string;
  }) => Promise<{ saved: boolean; path?: string; canceled?: boolean }>;
}

interface Window {
  splash?: SplashBridge;
  resumeForge?: ResumeForgeBridge;
}
