// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列表格的横向滚动区（C-20 收尾核验）。
 *
 * antd 只在传了 `scroll.x` 时把表格塞进 `.ant-table-content` 并挂 `overflow-x: auto`，
 * 但**不给那个容器 tabindex**。可滚动区域里如果又没有任何可聚焦元素，键盘用户既拿不到
 * 焦点也滚不动，命中 axe 的 `scrollable-region-focusable`（WCAG 2.1.1，serious）。
 *
 * jsdom 不算布局（`scrollWidth`/`clientWidth` 恒为 0），这条规则在单测里**永远不会真的
 * 命中**——所以这里沿用 JobTable / ResumeTable 的做法：把"空态不该出现无键盘入口的滚动
 * 容器"这件事在结构上钉住，等真实浏览器的冒烟（tests/smoke/a11y.spec.ts）去验规则本身。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoUnfocusableScroller } from "../../../test/a11yScrollRegion";
import type { ApplyQueueItem } from "../../../types";
import { QueueTable } from "./QueueTable";

const BASE_ITEM: ApplyQueueItem = {
  id: 1,
  job_id: 11,
  job_title: "后端开发",
  company: "A公司",
  resume_id: null,
  resume_title: "",
  greeting: "",
  sort_order: 0,
  status: "pending",
  admission: null,
  hard_gate: null,
  requires_confirm: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderTable(items: ApplyQueueItem[]) {
  return render(
    <AntdApp>
      <QueueTable
        items={items}
        busy={false}
        selectedIds={[]}
        setSelectedIds={vi.fn()}
        setDetail={vi.fn()}
        rowMenuItems={() => [{ key: "x", label: "占位项" }]}
      />
    </AntdApp>,
  );
}

/**
 * 空态必须满足的不变量：`.ant-table-content` 要么不是横向滚动区（0 行时不传 `scroll.x`，
 * 仓库里 JobTable 就是这么修的），要么自带键盘入口（`tabIndex=0`，ResumeTable 的修法）。
 * 两者都不满足时，空态留下一个「可横滚、区内又没有任何可聚焦元素」的容器。
 * 判定逻辑在 `src/test/a11yScrollRegion.ts`，三处调用点共用同一份，避免口径漂移。
 */
describe("QueueTable 横向滚动区（a11y）", () => {
  it("空队列：不产生「可横滚、区内却无可聚焦元素」的容器（axe scrollable-region-focusable）", () => {
    const { container } = renderTable([]);

    // 先确认确实落在空态：0 行时 antd 渲染占位行，而不是把表格整个拿掉。
    expect(container.querySelector(".ant-table-placeholder")).not.toBeNull();
    expectNoUnfocusableScroller(container);
  });

  it("有数据时保持原行为：列宽固定 880px + 横向滚动", async () => {
    const { container } = renderTable([BASE_ITEM]);
    // 用 role/aria-label 定位，不用中文文案做 ByText 断言（i18n 棘轮只降不升）。
    await screen.findByRole("button", { name: /查看队列条目详情/ });

    const content = container.querySelector<HTMLElement>(".ant-table-content");
    expect(content?.style.overflowX).toBe("auto");
    expect(
      container.querySelector(".ant-table")?.classList.contains("ant-table-scroll-horizontal"),
    ).toBe(true);
    expect(container.querySelector<HTMLElement>(".ant-table table")?.style.width).toBe("880px");
  });

  it("悬停「来源不支持」标签只弹一个提示，不与岗位提示叠在一起", async () => {
    const { container } = renderTable([{ ...BASE_ITEM, apply_supported: false }]);
    const tag = container.querySelector<HTMLElement>(".ant-tag");
    expect(tag).not.toBeNull();
    fireEvent.mouseEnter(tag as HTMLElement);
    const visibleTips = () =>
      [...document.querySelectorAll(".ant-tooltip")].filter(
        (node) => !node.classList.contains("ant-tooltip-hidden"),
      );
    await waitFor(() => expect(visibleTips()).toHaveLength(1), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    // 修复前：岗位提示（外层）与来源提示（标签自己）会同时出现 = 2 条。
    expect(visibleTips()).toHaveLength(1);
    expect(visibleTips()[0]?.textContent ?? "").toContain("来源不在投递台支持");
  });

  it("有数据时滚动区里有可聚焦元素（行内「查看详情」链接按钮），规则不会命中", async () => {
    renderTable([BASE_ITEM]);

    expect(await screen.findByRole("button", { name: /查看队列条目详情/ })).toBeEnabled();
  });
});
