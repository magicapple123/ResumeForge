// SPDX-License-Identifier: Apache-2.0
/** 格式刷按钮（Q14）：无差异置灰、armed 状态、显示可复制项数与属性名；不再包含"固化"。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import FormatPainterButton from "./FormatPainterButton";

const SOURCE_NAME = "甲公司";
const COPY_LABEL = t("typography.painter.copy", { name: SOURCE_NAME });

function renderButton(overrides: Partial<Parameters<typeof FormatPainterButton>[0]> = {}) {
  const handlers = {
    onArm: vi.fn(),
    onCancel: vi.fn(),
    onApply: vi.fn(),
  };
  render(
    <FormatPainterButton
      hasSource
      hasDiff
      sourceName={SOURCE_NAME}
      sourceProps={["space_after", "line_height"]}
      armed={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("FormatPainterButton", () => {
  it("有差异时复制可用，点击进入 armed（宿主负责收差异）", () => {
    const handlers = renderButton();
    fireEvent.click(screen.getByRole("button", { name: COPY_LABEL }));
    expect(handlers.onArm).toHaveBeenCalledTimes(1);
  });

  it("按钮文案带来源条目名，并显示可复制项数与属性名", () => {
    renderButton();
    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeInTheDocument();
    expect(
      screen.getByText(
        t("typography.painter.copyProps", {
          count: 2,
          props: [t("typography.prop.space_after"), t("typography.prop.line_height")].join(
            t("typography.painter.propSeparator"),
          ),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("没有局部调整时复制按钮置灰（并给说明，不让用户点了没反应）", () => {
    renderButton({ hasDiff: false, sourceProps: [] });
    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeDisabled();
    expect(
      screen.queryByText(t("typography.painter.copyProps", { count: 0, props: "" })),
    ).toBeNull();
  });

  it("没有来源对象时复制不可用", () => {
    renderButton({ hasSource: false });
    expect(screen.getByRole("button", { name: COPY_LABEL })).toBeDisabled();
  });

  it("armed 后显示应用/退出；没有目标时应用不可用", () => {
    const handlers = renderButton({ armed: true, targetCount: 0 });
    expect(screen.getByText(t("typography.painter.armed"))).toBeInTheDocument();
    const apply = screen.getByRole("button", {
      name: t("typography.painter.apply", { count: 0 }),
    });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.cancel") }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("armed 且有目标时应用，按钮文案显示目标数", () => {
    const handlers = renderButton({ armed: true, targetCount: 2 });
    const apply = screen.getByRole("button", { name: t("typography.painter.apply", { count: 2 }) });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(handlers.onApply).toHaveBeenCalledTimes(1);
  });
});
