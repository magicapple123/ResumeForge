// SPDX-License-Identifier: Apache-2.0
/** 格式刷按钮：无差异置灰、armed 状态、显式第二动作"固化为局部调整"。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import FormatPainterButton from "./FormatPainterButton";

function renderButton(overrides: Partial<Parameters<typeof FormatPainterButton>[0]> = {}) {
  const handlers = {
    onArm: vi.fn(),
    onCancel: vi.fn(),
    onApply: vi.fn(),
    onFreeze: vi.fn(),
  };
  render(<FormatPainterButton hasSource hasDiff armed={false} {...handlers} {...overrides} />);
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
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.copy") }));
    expect(handlers.onArm).toHaveBeenCalledTimes(1);
  });

  it("没有局部调整时复制按钮置灰（并给说明，不让用户点了没反应）", () => {
    renderButton({ hasDiff: false });
    expect(screen.getByRole("button", { name: t("typography.painter.copy") })).toBeDisabled();
  });

  it("没有来源对象时复制与固化都不可用", () => {
    renderButton({ hasSource: false });
    expect(screen.getByRole("button", { name: t("typography.painter.copy") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("typography.painter.freeze") })).toBeDisabled();
  });

  it("armed 后显示应用/退出；没有目标时应用不可用", () => {
    const handlers = renderButton({ armed: true, targetCount: 0 });
    expect(screen.getByText(t("typography.painter.armed"))).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: t("typography.painter.apply") });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.cancel") }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("armed 且有目标时可应用", () => {
    const handlers = renderButton({ armed: true, targetCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.apply") }));
    expect(handlers.onApply).toHaveBeenCalledTimes(1);
  });

  it("固化是显式第二动作：有来源就能点，并回传 onFreeze", () => {
    const handlers = renderButton({ hasDiff: false });
    const freeze = screen.getByRole("button", { name: t("typography.painter.freeze") });
    expect(freeze).toBeEnabled();
    fireEvent.click(freeze);
    expect(handlers.onFreeze).toHaveBeenCalledTimes(1);
  });
});
