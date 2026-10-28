// SPDX-License-Identifier: Apache-2.0
/** 多选态批量操作：下拉与右键共用同一组六项动作。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BulkActionsMenu from "./BulkActionsMenu";
import { buildBulkRowActions } from "./bulkActionItems";

afterEach(cleanup);

const LABELS = [
  "匹配度分析",
  "岗位需求解读",
  "AI 生成简历",
  "加入投递队列",
  "导出 CSV",
  "批量删除",
];

describe("BulkActionsMenu", () => {
  it("下拉里是六个批量动作，点击后交回对应动作", async () => {
    const onAction = vi.fn();
    render(
      <AntdApp>
        <BulkActionsMenu disabled={false} onAction={onAction} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: "批量操作" }));

    for (const label of LABELS) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByText(LABELS[0]));
    expect(onAction).toHaveBeenCalledWith("matchAnalysis");
  });

  it("右键菜单项与下拉同源：六项、键不重复、删除是危险项", () => {
    const items = buildBulkRowActions(vi.fn(), false);

    expect(items.map((item) => item.label)).toEqual(LABELS);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    expect(items.find((item) => item.key === "bulk_delete")).toMatchObject({
      danger: true,
      undo: true,
    });
    expect(items.every((item) => item.disabled === false)).toBe(true);
  });

  it("忙碌时全部置灰", () => {
    const items = buildBulkRowActions(vi.fn(), true);
    expect(items.every((item) => item.disabled === true)).toBe(true);
  });
});
