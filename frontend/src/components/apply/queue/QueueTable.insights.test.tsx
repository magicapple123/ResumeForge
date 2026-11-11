// SPDX-License-Identifier: Apache-2.0
/**
 * #15C 队列「操作」列里的「体检」按钮：只负责回调，不自己取数。
 *
 * 断言的是**回调拿到的是哪一行**——按钮挂在每一行上，点第一行的按钮却把第二行传出去，
 * 在界面上看不出任何异常，只会让用户看到别人的体检结论。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyQueueItem } from "../../../types";
import { ContextMenuHost } from "../../../features/context-menu/ContextMenuHost";
import { QueueTable } from "./QueueTable";

function item(id: number, jobTitle: string): ApplyQueueItem {
  return {
    id,
    job_id: id * 10,
    job_title: jobTitle,
    company: "ACME",
    resume_id: null,
    resume_title: "",
    greeting: "",
    sort_order: id,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
  };
}

const ITEMS: ApplyQueueItem[] = [item(1, "Backend Engineer"), item(2, "Frontend Engineer")];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderTable(onInspect: (record: ApplyQueueItem) => void) {
  return render(
    <AntdApp>
      <ContextMenuHost>
        <QueueTable
          items={ITEMS}
          busy={false}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          setDetail={vi.fn()}
          rowMenuItems={() => [{ key: "x", label: "placeholder" }]}
          onInspect={onInspect}
        />
      </ContextMenuHost>
    </AntdApp>,
  );
}

describe("QueueTable 体检入口（#15C）", () => {
  it("hands the row that was clicked to the inspect callback", () => {
    const onInspect = vi.fn();
    renderTable(onInspect);

    const buttons = screen.getAllByRole("button", {
      name: t("applyQueue.insights.inspect.action"),
    });
    expect(buttons).toHaveLength(ITEMS.length);

    fireEvent.click(buttons[0]);

    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(onInspect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("keeps the more-actions menu on the same row untouched", () => {
    const onInspect = vi.fn();
    renderTable(onInspect);

    // 「体检」只在操作列里出现，不要顺带打开行操作菜单（两枚按钮贴着放，最容易串）。
    fireEvent.click(
      screen.getAllByRole("button", { name: t("applyQueue.insights.inspect.action") })[1],
    );

    expect(onInspect).toHaveBeenCalledWith(ITEMS[1]);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
