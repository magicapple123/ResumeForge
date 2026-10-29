// SPDX-License-Identifier: Apache-2.0
/**
 * `PaginationControls` 测试共用的夹具、渲染与查询辅助。
 *
 * 2026-11（行数预算）：`PaginationControls.test.tsx` 逼近 500 行测试预算，而这些夹具与
 * DOM 查询辅助与"测的是哪个行为"无关——它们只是把 antd 的渲染细节（Segmented 的 radio
 * 输入、Select 的浮层选项、Collapse 的折叠头、confirm 的按钮顺序）包成可读的动作。
 * 抽出来之后用例文件只剩断言本身。
 *
 * 约定与 `src/test/trackerPageHarness.tsx` 一致：**不带 `.test.` 后缀**（不会被 vitest
 * 收集），放在 `src/test/` 下（不进 i18n 棘轮与产品文案扫描的统计口径）。
 * `vi.mock` 声明仍留在各测试文件内——vitest 的 mock 注册是文件级的，搬走会失效。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, vi } from "vitest";
import { t } from "../i18n";
import type { ResumeContent, ResumeLayout } from "../types";
import PaginationControls from "../components/resume/pagination/PaginationControls";

export type PanelProps = ComponentProps<typeof PaginationControls>;

export const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

/** 板块夹具用 ASCII 名：芯片/选择的断言不依赖真实板块文案。 */
export const SECTIONS: PanelProps["sections"] = [
  { key: "education", label: "Education" },
  { key: "experience", label: "Experience" },
  { key: "projects", label: "Projects" },
];

export const ENTRY = { id: "exp_12345678", label: "Acme" };

/** 造带分页域的版式：format_config 的值类型是扁平的，域对象要显式收窄。 */
export function layoutWith(pagination: Record<string, unknown>): ResumeLayout {
  return {
    ...LAYOUT,
    format_config: { accent: "#123456", pagination } as unknown as ResumeLayout["format_config"],
  };
}

export function renderPanel(
  props: Partial<ComponentProps<typeof PaginationControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <PaginationControls layout={LAYOUT} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return onChange;
}

/** 宿主最近一次拿到的版式（`onChange` 的最后一个实参）。 */
export function last(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

/** 每次 onChange 之后宿主会拿到的分页域（没有域时是 undefined）。 */
export function paginationOf(layout: ResumeLayout): unknown {
  return (layout.format_config as { pagination?: unknown }).pagination;
}

/** 造一份只有 skills 的正文：条目名要从 `paginationEntryOptions` 那条唯一实现里取。 */
export function skillsContent(skills: unknown): ResumeContent {
  return { skills } as unknown as ResumeContent;
}

/** antd Segmented：点内部的 radio 输入（与用户点标签同一条 onChange 链）。 */
export function pickSegment(text: string) {
  const item = Array.from(document.querySelectorAll(".ant-segmented-item")).find(
    (el) => el.textContent?.trim() === text,
  );
  expect(item).toBeTruthy();
  fireEvent.click((item?.querySelector("input") ?? item) as Element);
}

export function selectedSegment(): string | null {
  return document.querySelector(".ant-segmented-item-selected")?.textContent?.trim() ?? null;
}

/** 展开可折叠分组：antd Collapse 的标题是 role=button，点内层文字会冒泡上去。 */
export function openSubGroup(text: string) {
  fireEvent.click(screen.getByText(text));
}

/** antd Select 的选项在 jsdom 里以 .ant-select-item-option 渲染；按可见文本点选。 */
export async function pickOption(text: string) {
  await waitFor(() => {
    const texts = Array.from(document.querySelectorAll(".ant-select-item-option")).map((el) =>
      el.textContent?.trim(),
    );
    expect(texts).toContain(text);
  });
  const option = Array.from(document.querySelectorAll(".ant-select-item-option")).find(
    (el) => el.textContent?.trim() === text,
  );
  expect(option).toBeTruthy();
  const content = option?.querySelector(".ant-select-item-option-content");
  fireEvent.click((content ?? option) as Element);
}

/**
 * 确认框里的按钮。
 *
 * 不按 role 名取：antd 会在**两个中文字之间插空格**（`autoInsertSpace`），无障碍名会变成
 * 「取 消」，按 `t("pagination.mode.confirmCancel")` 匹配不上。确认框内按钮恒为
 * `[取消, 确定]` 两个，按位置取反而更稳。
 */
export function confirmButton(kind: "cancel" | "ok"): Element {
  const dialogs = document.querySelectorAll(".ant-modal-confirm");
  const dialog = dialogs[dialogs.length - 1];
  expect(dialog).toBeTruthy();
  const buttons = Array.from(
    (dialog as Element).querySelectorAll(".ant-modal-confirm-btns button"),
  );
  expect(buttons).toHaveLength(2);
  return buttons[kind === "cancel" ? 0 : 1] as Element;
}

/** 等确认框出现（antd 由 Provider 里的 holder 渲染，比静态 confirm 晚一个 tick）。 */
export async function waitForConfirm(): Promise<void> {
  await waitFor(() =>
    expect(document.querySelector(".ant-modal-confirm-title")?.textContent).toContain(
      t("pagination.mode.confirmTitle"),
    ),
  );
}

/**
 * 每个用例之后重置 DOM。
 *
 * 这一块以前在每个测试文件里各写一遍（`cleanup` + 清 body + 还原 mock），三件事少一件
 * 都会让下一条用例读到上一条的浮层节点。
 */
export function cleanupPaginationPanel(): void {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
}
