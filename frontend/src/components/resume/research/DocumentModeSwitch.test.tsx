// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档模式」入口（W14）：只读态、长 CV 预算、切回普通简历的页数夹紧、超限提示。
 *
 * 这个控件不拥有状态，断言因此分两半：**回传什么值**（onChange 的参数）与
 * **界面上说了什么**（预算/夹紧/超限三句）。前者错了会写坏数据，后者错了用户会困惑。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rt } from "../../../features/resume-research/i18n";
import DocumentModeSwitch from "./DocumentModeSwitch";

function renderSwitch(overrides: Partial<React.ComponentProps<typeof DocumentModeSwitch>> = {}) {
  const onChange = vi.fn();
  const props: React.ComponentProps<typeof DocumentModeSwitch> = {
    mode: "resume",
    pageLimit: 1,
    onChange,
    ...overrides,
  };
  render(
    <AntdApp>
      <DocumentModeSwitch {...props} />
    </AntdApp>,
  );
  return { onChange };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("DocumentModeSwitch", () => {
  it("没有 onChange 时只读，并说明由谁保存", () => {
    render(
      <AntdApp>
        <DocumentModeSwitch mode="resume" pageLimit={1} />
      </AntdApp>,
    );
    expect(screen.getByText(rt("research.mode.readonlyHint"))).toBeTruthy();
    expect(screen.getByRole("radio", { name: rt("research.mode.resume") })).toBeDisabled();
  });

  it("长 CV 显示预算说明，上限可选到 10 页", async () => {
    renderSwitch({ mode: "long_cv", pageLimit: 2 });
    expect(screen.getByText(rt("research.mode.budget"))).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: rt("research.mode.limitLabel") }));
    expect(await screen.findByText(rt("research.mode.limitOption", { count: 10 }))).toBeTruthy();
    expect(screen.getByText(rt("research.mode.limitOption", { count: 3 }))).toBeTruthy();
  });

  it("切到长 CV：页数在区间内则原样保留", () => {
    const { onChange } = renderSwitch({ mode: "resume", pageLimit: 3 });
    fireEvent.click(screen.getByText(rt("research.mode.longCv")));
    expect(onChange).toHaveBeenCalledWith({ mode: "long_cv", pageLimit: 3 });
  });

  it("从长 CV 切回普通简历：超过 3 页被夹到 3，并就地提示", () => {
    const { onChange } = renderSwitch({ mode: "long_cv", pageLimit: 7 });
    fireEvent.click(screen.getByText(rt("research.mode.resume")));
    expect(onChange).toHaveBeenCalledWith({ mode: "resume", pageLimit: 3 });
    expect(screen.getByText(rt("research.mode.clampedToResume"))).toBeTruthy();
  });

  it("排版页数超过上限时给出「约需 N 页 / 上限 M 页」", () => {
    renderSwitch({ mode: "resume", pageLimit: 1, pagesNeeded: 3 });
    expect(screen.getByText(rt("research.mode.overBudget", { pages: 3, limit: 1 }))).toBeTruthy();
  });

  it("保存中禁用控件，点击不回调", () => {
    const { onChange } = renderSwitch({ saving: true });
    fireEvent.click(screen.getByText(rt("research.mode.longCv")));
    expect(onChange).not.toHaveBeenCalled();
  });
});
