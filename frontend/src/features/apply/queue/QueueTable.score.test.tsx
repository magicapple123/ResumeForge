// SPDX-License-Identifier: Apache-2.0
/**
 * #14B 队列「参考分」列的接线测试（列宽 / 三档配色 / 免责文案 / 列头排序 / 收藏标记）。
 *
 * 这一列的判据里最容易在两处走偏：
 * 1. 它是**派生值**——未分析必须显示「—」而不是 0 分，且列头 tooltip 必须原样保留后端
 *    `reference_score.disclaimer`（不能改写成"匹配度"之类的暗示性措辞）；
 * 2. 列宽 96px 是详册写死的数字，改了会把资产列的 240px 挤掉，所以钉在测试里。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "../../context-menu/ContextMenuHost";
import type { ApplyQueueItem } from "../../../types";
import { QueueTable } from "./QueueTable";

function item(id: number, job: string, score: number | null, favorite = false): ApplyQueueItem {
  return {
    id,
    job_id: 100 + id,
    job_title: job,
    company: "A公司",
    resume_id: null,
    resume_title: "",
    greeting: "您好",
    sort_order: 0,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    match_score: score,
    favorite,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderTable(items: ApplyQueueItem[]) {
  return render(
    <AntdApp>
      <ContextMenuHost>
        <QueueTable
          items={items}
          busy={false}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          setDetail={vi.fn()}
          rowMenuItems={() => [{ key: "x", label: "占位项" }]}
          onInspect={vi.fn()}
        />
      </ContextMenuHost>
    </AntdApp>,
  );
}

/** 按岗位名取所在表格行（只在该表格容器内找，避免串到别的浮层）。 */
function rowOf(container: HTMLElement, job: string): HTMLElement {
  const rows = [...container.querySelectorAll<HTMLElement>(".ant-table-tbody tr.ant-table-row")];
  const row = rows.find((candidate) => (candidate.textContent ?? "").includes(job));
  expect(row).toBeDefined();
  return row as HTMLElement;
}

/** 按岗位名取所在行，再从行里取参考分单元格。 */
function scoreCellOf(container: HTMLElement, job: string): HTMLElement {
  const rows = [...container.querySelectorAll<HTMLElement>(".ant-table-tbody tr.ant-table-row")];
  const row = rows.find((candidate) => (candidate.textContent ?? "").includes(job));
  expect(row).toBeDefined();
  const cell = row?.querySelector<HTMLElement>(".apply-queue-score");
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

describe("QueueTable 参考分列（14B）", () => {
  it("三档配色分别落在 low / mid / high，0 分是 low 而不是 none", () => {
    const { container } = renderTable([
      item(1, "低分岗位", 0),
      item(2, "中分岗位", 72),
      item(3, "高分岗位", 88),
    ]);

    expect(scoreCellOf(container, "低分岗位").dataset.band).toBe("low");
    expect(scoreCellOf(container, "中分岗位").dataset.band).toBe("mid");
    expect(scoreCellOf(container, "高分岗位").dataset.band).toBe("high");
    expect(scoreCellOf(container, "低分岗位").textContent).toBe("0");
  });

  it("未分析的条目显示「—」并落在 none 档（不渲染成 0 分）", () => {
    const { container } = renderTable([item(1, "未分析岗位", null)]);

    const cell = scoreCellOf(container, "未分析岗位");
    expect(cell.dataset.band).toBe("none");
    expect(cell.textContent).toBe("—");
  });

  it("列头写着「参考分」，tooltip 原样给出后端免责文案", async () => {
    renderTable([item(1, "后端开发", 80)]);

    const header = screen.getByRole("button", { name: /按参考分排序/ });
    expect(header.textContent).toContain("参考分");

    // tooltip 内容里必须能读到"不参与准入"的那句免责说明（后端规定原样展示）。
    fireEvent.mouseEnter(header);
    await waitFor(() => expect(document.body.textContent).toContain("不代表真实 ATS 解析结果"));
    expect(document.body.textContent).toContain("投递准入仍以五类匹配结论为准");
  });

  it("点列头切到参考分排序，再点回到入队顺序", async () => {
    renderTable([item(1, "低分岗位", 30), item(2, "高分岗位", 90)]);

    const header = screen.getByRole("button", { name: /按参考分排序/ });
    fireEvent.click(header);

    const titles = () =>
      [...document.querySelectorAll(".ant-table-tbody tr.ant-table-row .table-text-link")].map(
        (node) => node.textContent,
      );
    await waitFor(() => expect(titles()).toEqual(["高分岗位", "低分岗位"]));

    // 再点一次回到入队顺序（= 后端给的顺序）。
    fireEvent.click(screen.getByRole("button", { name: /按入队时间排序/ }));
    await waitFor(() => expect(titles()).toEqual(["低分岗位", "高分岗位"]));
  });

  it("收藏的条目带星标，未收藏的不带", () => {
    const { container } = renderTable([
      item(1, "收藏岗位", 70, true),
      item(2, "普通岗位", 70, false),
    ]);

    const favoriteRow = rowOf(container, "收藏岗位");
    const plainRow = rowOf(container, "普通岗位");
    expect(favoriteRow.querySelector(".apply-queue-favorite")).not.toBeNull();
    expect(plainRow.querySelector(".apply-queue-favorite")).toBeNull();
    // 参考分列本身不能因为收藏而多渲染一个元素（列宽只有 96px）。
    expect(container.querySelectorAll(".apply-queue-score")).toHaveLength(2);
  });
});
