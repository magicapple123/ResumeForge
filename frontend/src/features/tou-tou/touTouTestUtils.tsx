import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { setProfileEditControl, setProfileSaveControl } from "./profileSaveBridge";

/**
 * TouTouOrb 两个测试文件共享的测试基建。
 * 与 TouTouOrb.test.tsx / TouTouOrb.moods.test.tsx 保持同步。
 */

// 模块导入即注册钩子：两个测试文件 import 本模块即可获得统一的生命周期清理。
afterEach(() => {
  cleanup();
  // profileSaveBridge 的两个槽都是模块级单例：清掉本文件注册的 control，避免泄漏到其它用例。
  setProfileSaveControl(null);
  setProfileEditControl(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 当前显示的那张脸（`is-active` 的那张图的 src）。 */
export function activeFaceSrc(): string {
  return document.querySelector(".tt-face.is-active")?.getAttribute("src") ?? "";
}
