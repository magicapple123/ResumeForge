// SPDX-License-Identifier: Apache-2.0
/**
 * 多选批量调整（D03）：只写用户动过的键、重复条目提醒、应用后回到宿主更新布局。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import MultiStyleBar from "./MultiStyleBar";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

const SELECTED = [
  { id: "exp_12345678", label: "Acme", meta: "2023-01 to 2024-06" },
  { id: "prj_87654321", label: "Data Platform", meta: "2022" },
];

function renderBar(props: Partial<ComponentProps<typeof MultiStyleBar>> = {}, onChange = vi.fn()) {
  const onClearSelection = vi.fn();
  const onApplied = vi.fn();
  render(
    <AntdApp>
      <MultiStyleBar
        layout={LAYOUT}
        selected={SELECTED}
        onChange={onChange}
        onClearSelection={onClearSelection}
        onApplied={onApplied}
        {...props}
      />
    </AntdApp>,
  );
  return { onChange, onClearSelection, onApplied };
}

function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("MultiStyleBar", () => {
  it("未多选时给出提示", () => {
    renderBar({ selected: [] });
    expect(screen.getByText(t("typography.multi.empty"))).toBeInTheDocument();
  });

  it("显示选中数量，取消选择回传宿主", () => {
    const { onClearSelection } = renderBar();
    expect(
      screen.getByText(t("typography.multi.count", { count: SELECTED.length })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("typography.multi.clear")));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("只把用户动过的键写进每个对象（不改的不出现）", async () => {
    const { onChange, onApplied } = renderBar();
    const input = screen.getByRole("spinbutton", {
      name: t("typography.prop.line_height"),
    });
    fireEvent.change(input, { target: { value: "1.4" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: t("typography.multi.apply") }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange).format_config).toEqual({
      accent: "#123456",
      objects: {
        version: 1,
        exp_12345678: { line_height: 1.4 },
        prj_87654321: { line_height: 1.4 },
      },
    });
    expect(onApplied).toHaveBeenCalledWith(2);
  });

  it("没有任何改动时应用不可用", () => {
    renderBar();
    expect(screen.getByRole("button", { name: t("typography.multi.apply") })).toBeDisabled();
  });

  it("选中内容重复时提醒（含条数与名称）", () => {
    renderBar({
      selected: [
        { id: "exp_12345678", label: "Acme", meta: "2023-01 to 2024-06" },
        { id: "exp_87654321", label: "Acme", meta: "2023-01 to 2024-06" },
      ],
    });
    expect(screen.getByText(t("typography.multi.duplicate"))).toBeInTheDocument();
    expect(
      screen.getByText(t("typography.multi.duplicateDetail", { count: 2, names: "Acme ×2" })),
    ).toBeInTheDocument();
  });
});
