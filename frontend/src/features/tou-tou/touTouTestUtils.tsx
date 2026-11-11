// SPDX-License-Identifier: Apache-2.0
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, vi } from "vitest";
import { resetTouTouContextRegistry } from "./touTouPageContext";
import { resetTouTouProposal } from "./touTouProposalStore";
import { resetWorkbenchLayout } from "../../components/resume/workbenchLayoutStore";
import { setProfileEditControl, setProfileSaveControl } from "./profileSaveBridge";
import { INTERVENTION_STORAGE_KEY } from "./touTouIntervention";

/**
 * TouTouOrb 测试文件共享的测试基建。
 * 与 TouTouOrb.test.tsx / TouTouOrb.moods.test.tsx / TouTouOrb.signals.test.tsx 保持同步。
 */

// 模块导入即注册钩子：所有 import 本模块的测试文件共享统一的生命周期清理。
afterEach(() => {
  cleanup();
  // 模块级单例：注册表、提案、画布测量、保存桥、节流状态都清掉，避免泄漏到其它用例。
  resetTouTouContextRegistry();
  resetTouTouProposal();
  resetWorkbenchLayout();
  setProfileSaveControl(null);
  setProfileEditControl(null);
  window.localStorage.removeItem(INTERVENTION_STORAGE_KEY);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * 渲染悬浮球：它现在要读路由（页面感知）与导航（动作跳转），必须有 Router。
 * `rerender` 也包一层 MemoryRouter——否则测试里换 context 会把 Router 一起换掉。
 */
export function renderOrb(ui: ReactElement) {
  const result = render(<MemoryRouter>{ui}</MemoryRouter>);
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<MemoryRouter>{next}</MemoryRouter>),
  };
}

/** 当前显示的那张脸（`is-active` 的那张图的 src）。 */
export function activeFaceSrc(): string {
  return document.querySelector(".tt-face.is-active")?.getAttribute("src") ?? "";
}
