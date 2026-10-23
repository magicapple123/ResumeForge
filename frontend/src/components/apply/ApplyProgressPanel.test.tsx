// SPDX-License-Identifier: Apache-2.0
/**
 * 进度面板：条目明细里 `failure_detail` 这个字段**有两种含义**，标签必须跟着状态走。
 *
 * 「按『同公司只投一个岗位』跳过」这类原因也写在这个字段里（后端没有单独的"跳过原因"列）。
 * 如果一律标成「诊断信息」，用户看到跳过条目会以为出错了——而它其实是一次**正常的**跳过。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ApplyTaskDetail, ApplyTaskItem } from "../../types";
import ApplyProgressPanel from "./ApplyProgressPanel";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function item(overrides: Partial<ApplyTaskItem>): ApplyTaskItem {
  return {
    id: 1,
    task_id: 1,
    job_id: 10,
    job_title: "后端开发",
    company: "核桃编程",
    resume_id: null,
    resume_title: "",
    greeting: "",
    status: "success",
    failure_category: "",
    failure_detail: "",
    attempt: 1,
    sort_order: 0,
    started_at: "2026-09-21T00:00:00",
    finished_at: "2026-09-21T00:00:05",
    created_at: "2026-09-21T00:00:00",
    ...overrides,
  };
}

function task(items: ApplyTaskItem[]): ApplyTaskDetail {
  return {
    id: 1,
    kind: "apply",
    status: "completed",
    total: items.length,
    processed: items.length,
    succeeded: items.filter((i) => i.status === "success").length,
    failed: 0,
    skipped: items.filter((i) => i.status === "skipped").length,
    current_step: "",
    stop_reason: "done",
    config: {},
    message: "",
    started_at: "2026-09-21T00:00:00",
    finished_at: "2026-09-21T00:01:00",
    created_at: "2026-09-21T00:00:00",
    items,
  };
}

function renderPanel(items: ApplyTaskItem[]) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ApplyProgressPanel
          task={task(items)}
          busy={false}
          onPause={() => {}}
          onResume={() => {}}
          onStop={() => {}}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

const SKIP_REASON = "按「同公司只投一个岗位」跳过：本批次已经投过「核桃编程」的岗位";

describe("ApplyProgressPanel 条目明细", () => {
  it("跳过的条目标成「跳过原因」，并写明为什么", async () => {
    renderPanel([
      item({ id: 1, status: "success" }),
      item({ id: 2, job_title: "编程讲师", status: "skipped", failure_detail: SKIP_REASON }),
    ]);

    // 展开跳过的那一行看明细。
    const row = await screen.findByText("编程讲师");
    const expand = within(row.closest("tr") as HTMLElement).getByRole("button", {
      name: /展开行|Expand row/i,
    });
    expand.click();

    expect(await screen.findByText("跳过原因")).toBeInTheDocument();
    expect(screen.getByText(SKIP_REASON)).toBeInTheDocument();
    // 「诊断信息」是失败条目的说法，跳过条目不该用它。
    expect(screen.queryByText("诊断信息")).not.toBeInTheDocument();
  });

  it("失败的条目仍然标「诊断信息」——两种含义不能混成一个标签", async () => {
    renderPanel([
      item({ id: 1, job_title: "后端开发", status: "failed", failure_detail: "等聊天输入框超时" }),
    ]);

    const row = await screen.findByText("后端开发");
    within(row.closest("tr") as HTMLElement)
      .getByRole("button", { name: /展开行|Expand row/i })
      .click();

    expect(await screen.findByText("诊断信息")).toBeInTheDocument();
    expect(screen.getByText("等聊天输入框超时")).toBeInTheDocument();
    expect(screen.queryByText("跳过原因")).not.toBeInTheDocument();
  });
});

/**
 * 横向滚动区（C-20 收尾核验）。
 *
 * 面板里的 Table 带 `scroll={{ x: "max-content" }}`，antd 会把它包进带 `overflow-x: auto`
 * 的 `.ant-table-content`。理论上这条路径也能触发 axe 的 `scrollable-region-focusable`
 * （可滚动区域里没有可聚焦元素），但**空态根本走不到 Table**：
 *
 *   {task.items.length > 0 ? <Table … scroll={{ x: "max-content" }} /> : <Typography.Paragraph …>}
 *
 * 0 条时渲染的是一句说明（ApplyProgressPanel.tsx:183—200），DOM 里连
 * `.ant-table-content` 都没有，因此空态**不适用**该规则。有数据时滚动区里带
 * 「展开行」按钮，属于可聚焦内容，规则也不会命中。
 */
describe("ApplyProgressPanel 横向滚动区（a11y）", () => {
  // 空态文案已经由生产代码给出、且已被 `src` 口径统计；这里只按结构定位
  // （`.apply-progress-empty` 存在 + 没有表格），不新增中文 `ByText` 断言
  // ——`cjkRatchet` 的 tests 口径只降不升。
  it("空态（0 条）不渲染表格，因此不存在可滚动区域（不适用 scrollable-region-focusable）", () => {
    const { container } = renderPanel([]);

    const empty = container.querySelector<HTMLElement>(".apply-progress-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent?.trim().length).toBeGreaterThan(0);
    expect(container.querySelector(".ant-table-content")).toBeNull();
    expect(container.querySelector(".ant-table")).toBeNull();
  });

  it("采集批次的空态走同一个分支：一句说明，同样不渲染表格", () => {
    const { container } = render(
      <MemoryRouter>
        <AntdApp>
          <ApplyProgressPanel
            task={{ ...task([]), kind: "collect" }}
            busy={false}
            onPause={() => {}}
            onResume={() => {}}
            onStop={() => {}}
          />
        </AntdApp>
      </MemoryRouter>,
    );

    expect(container.querySelector(".apply-progress-empty")).not.toBeNull();
    expect(container.querySelector(".ant-table-content")).toBeNull();
  });

  it("有数据时滚动区里有可聚焦的「展开行」按钮，规则不会命中", async () => {
    const { container } = renderPanel([item({ id: 1 })]);

    const content = container.querySelector<HTMLElement>(".ant-table-content");
    expect(content?.style.overflowX).toBe("auto");
    expect(
      await within(content as HTMLElement).findByRole("button", { name: /展开行|Expand row/i }),
    ).toBeEnabled();
  });
});
