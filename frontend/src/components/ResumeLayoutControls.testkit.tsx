/**
 * ResumeLayoutControls 测试共用夹具：默认版式、预览假句柄、render 外壳与键盘辅助。
 *
 * 2026-10-19：文件行数预算（500 行）触顶后，按内聚域把「字号」那一组用例拆到
 * `ResumeLayoutControls.font.test.tsx`。`vi.mock` 不能跨文件 hoist（vitest 的 mock
 * 注册是文件级的），所以 api mock 与 `beforeEach` 仍留在各测试文件内；但**渲染外壳**
 * 与**假句柄**只有一份实现——就是本文件。
 *
 * 文件名不带 `.test.`/`.spec.`：vitest 不会把它当测试文件收集（`vitest.config.ts` 的
 * include 只收 `src/**\/*.{test,spec}.{ts,tsx}`），行数预算守卫也把它当普通源码扫描
 * ——所以它自己同样要守在 500 行以内。与 `src/test/profilePageHarness.tsx` 同类。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import type { ComponentProps } from "react";
import { vi } from "vitest";
import type { ResumeLayout } from "../types";
import ResumeLayoutControls from "./ResumeLayoutControls";
import type { ResumePreviewHandle } from "./ResumePreview";

/** 「什么都没调过」的版式：模板经典档、标准字号、无任何覆盖。 */
export const DEFAULT_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
};

/**
 * 假的预览句柄：只记录 `setLiveProbe` 被调过什么，不涉及真实 iframe。
 *
 * 拖动字号时的即时反馈走的就是这个句柄（本地注入 CSS 探针，零网络往返），
 * 所以测试要能看见"探针被注入了什么"。
 */
export function makePreviewRef() {
  const setLiveProbe = vi.fn();
  const measureWithProbe = vi.fn(() => null);
  const ref = createRef<ResumePreviewHandle>();
  (ref as { current: ResumePreviewHandle | null }).current = { setLiveProbe, measureWithProbe };
  return { ref, setLiveProbe, measureWithProbe };
}

/**
 * 用 antd 的 `App` 外壳渲染控件（组件内部用 `App.useApp()` 拿 message/modal）。
 *
 * @param props 覆盖默认版式与回调；不传即为"默认版式 + 空回调"。
 * @param onChange 版式变更回调；默认是一个新 `vi.fn()`，需要断言时显式传入。
 * @returns 本次渲染使用的 `onChange` mock。
 */
export function renderControls(
  props: Partial<ComponentProps<typeof ResumeLayoutControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ResumeLayoutControls layout={DEFAULT_LAYOUT} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return onChange;
}

/** 键盘可访问：方向键微调字号。rc-slider 读的是 `keyCode`/`which`，不是 `key`。 */
export function pressArrow(target: Element, direction: "ArrowLeft" | "ArrowRight") {
  const keyCode = direction === "ArrowRight" ? 39 : 37;
  fireEvent.keyDown(target, { key: direction, keyCode, which: keyCode });
}
