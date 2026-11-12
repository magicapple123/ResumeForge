// SPDX-License-Identifier: Apache-2.0
/**
 * 校对清单（项 13 / D23）：分组、原地编辑、新字段勾选，以及**没有增删按钮**。
 *
 * 最后一条是刻意的产品约束：这张表的用途是"核对识别结果"，不是编辑资料。给增删入口
 * 会让它悄悄变成半个资料编辑器，而真正的编辑器就在这一页上。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecognitionReviewList from "./RecognitionReviewList";
import type { RecognitionReviewRow } from "./RecognitionReviewList";

const ROWS: RecognitionReviewRow[] = [
  { id: "name", section: "基本信息", label: "姓名", value: "张三" },
  { id: "summary", section: "基本信息", label: "个人总结", value: "五年后端经验", multiline: true },
  { id: "educations.0.school", section: "教育经历", label: "学校", value: "示例大学" },
  {
    id: "CUSTOM_是否有驾照",
    section: "待确认的新字段",
    label: "是否有驾照",
    value: "C1",
    isNew: true,
    selected: false,
  },
];

function renderList(rows: RecognitionReviewRow[] = ROWS) {
  const onChange = vi.fn();
  render(
    <AntdApp>
      <RecognitionReviewList rows={rows} onChange={onChange} />
    </AntdApp>,
  );
  return onChange;
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
  if (!element) throw new Error(`清单里没有 ${id}`);
  return element;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("RecognitionReviewList", () => {
  it("按 section 分组、显示条数，且默认全部展开", () => {
    renderList();

    const headers = [...document.querySelectorAll(".ant-collapse-header")];
    expect(headers).toHaveLength(3);
    expect(headers[0].textContent).toContain("基本信息");
    expect(headers[0].textContent).toContain("2 项");
    expect(headers[1].textContent).toContain("教育经历");
    // 默认展开：三组都是 active，用户不用先点三次才看得到要核对什么。
    expect(document.querySelectorAll(".ant-collapse-item-active")).toHaveLength(3);
    // 长文本用多行输入，短值用单行（形态跟着内容量走）。
    expect(within(row("summary")).getByLabelText("个人总结").tagName).toBe("TEXTAREA");
    expect(within(row("name")).getByLabelText("姓名").tagName).toBe("INPUT");
  });

  it("原地改值后把整份 rows 回传（受控、无自有状态）", () => {
    const onChange = renderList();

    fireEvent.change(within(row("name")).getByLabelText("姓名"), { target: { value: "王五" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as RecognitionReviewRow[];
    expect(next.find((item) => item.id === "name")?.value).toBe("王五");
    // 其余行原样带过去（不能只回传被改的那一行——这是受控组件的契约）。
    expect(next).toHaveLength(ROWS.length);
    expect(next.find((item) => item.id === "educations.0.school")?.value).toBe("示例大学");
  });

  it("新字段行：有勾选框（默认不勾）、「新增字段」标签，且名字可改", () => {
    const onChange = renderList();
    const newRow = row("CUSTOM_是否有驾照");

    const checkbox = within(newRow).getByRole("checkbox", { name: "选用 是否有驾照" });
    expect(checkbox).not.toBeChecked();
    expect(within(newRow).getByText("新增字段")).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect((onChange.mock.calls[0][0] as RecognitionReviewRow[])[3].selected).toBe(true);

    // 名字也能改：模型抄错栏目名是常事，而 key 由后端按 label 生成，改这里才有意义。
    fireEvent.change(within(newRow).getByLabelText("字段名 是否有驾照"), {
      target: { value: "驾照类型" },
    });
    expect((onChange.mock.calls[1][0] as RecognitionReviewRow[])[3].label).toBe("驾照类型");
  });

  it("不提供增删行的入口（这是校对表，不是编辑器）", () => {
    renderList();

    expect(screen.queryByRole("button", { name: /添加|新增行|删除/ })).toBeNull();
  });
});
