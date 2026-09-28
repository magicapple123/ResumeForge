import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebFormMemoryTarget, WebFormRememberPending } from "../../types";
import WebFormMemoryDialog from "./WebFormMemoryDialog";

const PENDING: WebFormRememberPending = {
  field_key: "CUSTOM_导师姓名",
  field_label: "导师",
  value: "王教授",
  control_label: "导师姓名",
  source: "rule",
};

// 目标**只有「网申资料」**。以前这里还有 `profile:name`、`educations:1:school`
// 这类简历资料的落点，2026-09-28 收掉了（理由见 services/webform/profile_targets.py）。
const TARGETS: WebFormMemoryTarget[] = [
  {
    target_id: "extra:student_id",
    source: "extra",
    group: "学籍与档案",
    label: "学号",
    value: "2022012345",
    kind: "text",
    field_key: "student_id",
  },
  {
    target_id: "extra:height",
    source: "extra",
    group: "身体情况",
    label: "身高(cm)",
    value: "178",
    kind: "text",
    field_key: "height",
  },
];

function renderDialog(onSubmit = vi.fn()) {
  render(
    <AntdApp>
      <WebFormMemoryDialog
        open
        pending={PENDING}
        targets={TARGETS}
        loading={false}
        saving={false}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />
    </AntdApp>,
  );
  return onSubmit;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("WebFormMemoryDialog", () => {
  it("按模块展示网申资料，并支持非连续字符的模糊搜索", () => {
    renderDialog();

    expect(screen.getByText("学籍与档案")).toBeInTheDocument();
    expect(screen.getByText("身体情况")).toBeInTheDocument();
    expect(screen.queryByText("专业")).not.toBeInTheDocument();
    // **简历资料不是落点**：界面上不该再出现「我的资料」这一区。
    expect(screen.queryByText("我的资料")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/搜索字段、模块或当前值/), {
      target: { value: "学档" },
    });

    expect(screen.getByText("学号")).toBeInTheDocument();
    expect(screen.queryByText("身高(cm)")).not.toBeInTheDocument();
  });

  it("没有对应字段时可以新增自定义网申字段并提交", () => {
    const onSubmit = renderDialog();
    const inputs = screen.getAllByRole("textbox");

    // 顺序：搜索框、自定义字段名、要保存的值。
    fireEvent.change(inputs[1], { target: { value: "导师姓名" } });
    fireEvent.change(inputs[2], { target: { value: "王教授" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到选中的资料" }));

    expect(onSubmit).toHaveBeenCalledWith({
      target_id: "custom",
      value: "王教授",
      label: "导师姓名",
      reuse: "general",
    });
  });
});
