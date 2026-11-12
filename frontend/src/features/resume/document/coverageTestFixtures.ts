// SPDX-License-Identifier: Apache-2.0
/**
 * `ResumeCoverageNotes` 测试的共享夹具与渲染脚手架（2026-11 行数预算拆分批）。
 *
 * **为什么抽这一层**：原来的 `ResumeCoverageNotes.test.tsx` 在 prettier 重排后涨到
 * 527 行，超过「测试文件同样 ≤500 行」的预算守卫（backend/tests/test_file_size_budget.py）。
 * 拆分必须做到「用例数与断言逐条不变」，因此夹具只能有一份实现——两份副本一旦漂移，
 * 两个测试文件就会对着不同的 note 形状断言。按 team-lead 的约定放在**同目录**且不带
 * `.test.` 后缀：不会被 vitest 收集，也不会被测试预算 glob 命中。
 *
 * **为什么没有 JSX**：文件名是 `.ts`（不是 `.tsx`），所以 `renderNotes` 用
 * `createElement` 而不是 JSX 语法——`.ts` 里写 JSX 会直接编译失败。
 *
 * 约定（与拆分前逐字一致，勿改）：
 * - 期望文案一律走组件用的同一个 `t()` 解析，本模块内**不出现中文/日文字面量**
 *   （i18n ratchet 禁止新增 CJK 字面量）；
 * - `afterEach` 的清理逻辑导出为 `resetCoverageTestEnv`，由两个测试文件各自注册
 *   （vitest 的 hook 必须在测试文件里注册，隐式注册会让「这个文件到底清理了没」不可见）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { vi } from "vitest";
import { t, translate } from "../../../i18n";
import { RESUME_CATALOG_SECTION_LABEL_KEYS } from "../../../i18n/enum/resumeCatalog";
import type { ResumeCoverageNote } from "../../../types";
import ResumeCoverageNotes from "./ResumeCoverageNotes";

/** 三个动作按钮与折叠头的文案，两个测试文件共用同一份解析结果。 */
export const TITLE: string = t("resume.coverage.title");
export const REVISE: string = t("resume.coverage.revise");
export const APPEND: string = t("resume.coverage.append");
export const GO_WORKBENCH: string = t("resume.coverage.goWorkbench");

/**
 * 每个用例后的统一清理：卸载 React 树、还原 `fetch` 等全局 stub、清空 body。
 *
 * 三个动作缺一不可：`cleanup()` 不还原 stub（会跨用例泄漏 fetch mock），
 * `unstubAllGlobals()` 不卸载组件（antd 的 message 会继续挂在 body 上）。
 */
export function resetCoverageTestEnv(): void {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
}

/** The zh name the backend sends for a built-in section (= the zh value of its catalog key). */
export function backendLabel(section: string): string {
  const key = RESUME_CATALOG_SECTION_LABEL_KEYS[section];
  return key ? translate("zh-CN", key) : section;
}

/** 一条 coverage note 的最小完整形状；`overrides` 只会盖掉它显式给出的字段。 */
export function note(overrides: Partial<ResumeCoverageNote> = {}): ResumeCoverageNote {
  const section = overrides.section ?? "projects";
  return {
    section,
    section_label: backendLabel(section),
    names: [],
    filtered: [],
    model_omitted: [],
    total: 0,
    ...overrides,
  };
}

/**
 * 把 `notes` 渲染进 antd `<App>` 上下文，并把注入的 props 一起返回。
 *
 * `message` 来自 `App.useApp()`，所以树必须坐在 `<App>` 里；返回 props 是为了让用例
 * 直接对 `onRevise` / `onOpenEditor` / `onAppended` 这组 `vi.fn()` 断言调用。
 */
export function renderNotes(
  notes: ResumeCoverageNote[],
  options: { legacyWarnings?: string[]; resumeId?: number; baseRevision?: number | null } = {},
) {
  const props = {
    notes,
    legacyWarnings: options.legacyWarnings ?? [],
    onRevise: vi.fn(),
    onOpenEditor: vi.fn(),
    onAppended: vi.fn(),
    resumeId: options.resumeId,
    baseRevision: options.baseRevision,
  };
  const view = render(createElement(ResumeCoverageNotes, props), { wrapper: AntdApp });
  return { ...view, ...props };
}

/** One group header, built from the same message template the component uses. */
export function groupHeader(section: string, count: number, label?: string): string {
  const key = RESUME_CATALOG_SECTION_LABEL_KEYS[section];
  const fallback = key ? t(key) : section;
  return t("resume.coverage.sectionCount", { label: label ?? fallback, count });
}

/** One group-head reason entry (`<label> <count>`), same template as the component. */
export function reasonCount(
  reason: "filtered" | "capacity" | "model" | "unknown",
  count: number,
): string {
  return t("resume.coverage.reasonCount", {
    label: t(`resume.coverage.reason.${reason}` as "resume.coverage.reason.model"),
    count,
  });
}

/** One row's text, resolved through the same item template the component uses. */
export function itemText(name: string): string {
  return t("resume.coverage.item", { name });
}

/** 展开态下每条 item 的 `<li>`，顺序即渲染顺序。 */
export function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".resume-coverage-items > li")];
}

/** 点开折叠头（默认收起，所有细节断言都要先展开）。 */
export function expandBlock(): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(TITLE) }));
}

/** Stub `fetch` and record every call, so the request body can be asserted verbatim. */
export function stubAppendFetch(appended: string[], skipped: string[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ resume: { id: 7 }, appended, skipped }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { calls };
}
