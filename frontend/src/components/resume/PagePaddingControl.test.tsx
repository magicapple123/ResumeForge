// SPDX-License-Identifier: Apache-2.0
/**
 * 总页边距滑杆的三态：`unset`（随模板）/ `uniform`（用户自己选的值）/ `custom`（四边不全等）。
 *
 * 三态的分界只有一处判断（`customized && !uniform`），本文件把它钉住：
 * 1. 只有 `unset` 才显示来源标签；
 * 2. `custom` 的读数是「自定义」——这个位置上**没有**一个页边距值，写数字就是撒谎；
 * 3. `custom` 下拖一下总滑杆就回到「统一」（父组件会把四条支路清掉，这里是那个提交的入口）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import PagePaddingControl from "./PagePaddingControl";

function renderPadding(props: Partial<ComponentProps<typeof PagePaddingControl>> = {}) {
  const onChange = vi.fn();
  const onProbe = vi.fn();
  render(
    <AntdApp>
      <PagePaddingControl
        value={14}
        customized={false}
        uniform
        onChange={onChange}
        onProbe={onProbe}
        {...props}
      />
    </AntdApp>,
  );
  return { onChange, onProbe };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PagePaddingControl · 三态", () => {
  it("unset：读数是一个具体的 mm，并标出来源", async () => {
    renderPadding({ defaultHint: t("resume.measure.hintTemplate") });

    expect(await screen.findByText("14mm")).toBeInTheDocument();
    expect(screen.getByText(t("resume.measure.hintTemplate"))).toBeInTheDocument();
  });

  it("uniform：读数仍是具体值，但不再标来源（这是用户自己的选择）", async () => {
    renderPadding({ value: 18, customized: true, defaultHint: t("resume.measure.hintTemplate") });

    expect(await screen.findByText("18mm")).toBeInTheDocument();
    expect(screen.queryByText(t("resume.measure.hintTemplate"))).not.toBeInTheDocument();
  });

  it("custom：读数写「自定义」，四边具体值在悬停说明里", async () => {
    renderPadding({
      value: 8,
      customized: true,
      uniform: false,
      margins: { top: 8, right: 12, bottom: 12, left: 12 },
    });

    expect(await screen.findByText(t("resume.pagePadding.custom"))).toBeInTheDocument();
    // 自定义态下没有"一个页边距值"：不可能同时出现一个 mm 读数。
    expect(screen.queryByText("8mm")).not.toBeInTheDocument();
  });
});

describe("PagePaddingControl · 拖动与复位", () => {
  it("custom 下拖一次 +0.1：探针立刻给单值形态，提交的是页边距数值", async () => {
    const { onChange, onProbe } = renderPadding({
      value: 8,
      customized: true,
      uniform: false,
      margins: { top: 8, right: 12, bottom: 12, left: 12 },
    });

    fireEvent.click(await screen.findByRole("button", { name: t("resume.pagePadding.increase") }));

    // 总滑杆永远是单值形态（它写的是 page_padding）。
    expect(onProbe).toHaveBeenLastCalledWith("body { padding: 8.1mm !important; }");
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // 父组件拿到的只是一个数值：`withUniformMargin` 会顺带清掉四条支路。
    expect(onChange).toHaveBeenCalledWith(8.1);
  });

  it("双击标题：传 null（父组件据此把 total 与四条支路一起清掉），并清掉探针", async () => {
    const { onChange, onProbe } = renderPadding({ customized: true, uniform: false });

    fireEvent.doubleClick(await screen.findByText(t("resume.pagePadding.label")));

    expect(onProbe).toHaveBeenLastCalledWith("");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("没设过时双击标题不产生变更", async () => {
    const { onChange } = renderPadding();

    fireEvent.doubleClick(await screen.findByText(t("resume.pagePadding.label")));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PagePaddingControl · 行内不再有分边入口", () => {
  it("分边入口已搬到分边面板自己的折叠标题上：这一行不会再多出一颗按钮", async () => {
    renderPadding();

    await screen.findByText("14mm");
    // 2026-10-22 用户截图：这颗按钮把同行的「随模板」胶囊压在了下面。
    // 行内少一件东西之后，窄窗口里尾部才有位置。
    expect(
      screen.queryByRole("button", { name: t("resume.pagePadding.sidesToggle") }),
    ).not.toBeInTheDocument();
  });

  it("下限是 0：读数 0mm 时减小按钮置灰，而不是停在 8", async () => {
    renderPadding({ value: 0, customized: true });

    expect(
      await screen.findByRole("button", { name: t("resume.pagePadding.decrease") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("slider", { name: new RegExp(t("resume.pagePadding.label")) }),
    ).toHaveAttribute("aria-valuemin", "0");
  });
});
