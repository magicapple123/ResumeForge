// SPDX-License-Identifier: Apache-2.0
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import ShortcutProvider from "../shortcuts/ShortcutProvider";
import { afterEach, vi } from "vitest";
import { resetTouTouContextRegistry } from "./touTouPageContext";
import { resetTouTouProposal } from "./touTouProposalStore";
import { resetWorkbenchLayout } from "../resume/editor/workbenchLayoutStore";
import { setProfileEditControl, setProfileSaveControl } from "./profileSaveBridge";
import { INTERVENTION_STORAGE_KEY } from "./touTouIntervention";
import { ORB_HINT_SEEN_KEY } from "./TouTouOrbButton";

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
  window.localStorage.removeItem(ORB_HINT_SEEN_KEY);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * 渲染悬浮球：它现在要读路由（页面感知）与导航（动作跳转），必须有 Router。
 * `rerender` 也包一层 MemoryRouter——否则测试里换 context 会把 Router 一起换掉。
 *
 * `firstRunHint` 默认 **false**（按"已看过"处理）：首次说明（I-17）是一个自动展开的
 * Popover，默认展开会给几乎所有球相关用例多挂一个浮层，断言容易被它污染。专门测
 * "首次进入给一次完整说明"的用例传 `{ firstRunHint: true }`。
 */
export function renderOrb(ui: ReactElement, options: { firstRunHint?: boolean } = {}) {
  if (options.firstRunHint) {
    window.localStorage.removeItem(ORB_HINT_SEEN_KEY);
  } else {
    window.localStorage.setItem(ORB_HINT_SEEN_KEY, "1");
  }
  const wrap = (next: ReactElement) => (
    <MemoryRouter>
      <ShortcutProvider>{next}</ShortcutProvider>
    </MemoryRouter>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(wrap(next)),
  };
}

/** 当前显示的那张脸（`is-active` 的那张图的 src）。 */
export function activeFaceSrc(): string {
  return document.querySelector(".tt-face.is-active")?.getAttribute("src") ?? "";
}
