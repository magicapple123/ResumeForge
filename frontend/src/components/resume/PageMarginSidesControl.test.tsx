// SPDX-License-Identifier: Apache-2.0
/**
 * 分边页边距控件（四行支路）：拖动 → 探针 + 防抖提交；复位 → 只复位那一条边。
 *
 * 三条最容易退化的性质：
 * 1. **四边相等时探针是单值形态**（转调 `pagePaddingProbeCss`）——写成四值形态会让用户
 *    松手后看到画面跳一下，而且与后端 `page_padding_rule` 的产出不再逐字一致；
 * 2. **复位只删那一条边的键**（不是写回一个与默认相等的值），否则以后"总"滑杆或模板默认
 *    改动时，这条被焊死的边不会跟着变；
 * 3. **收起态不渲染四条支路**（`open=false` 只剩折叠标题），展开才出现滑杆——这是
 *    "99% 的用户不该看到四条额外滑杆"的唯一保证。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import PageMarginSidesControl from "./PageMarginSidesControl";

const UNIFORM = { top: 12, right: 12, bottom: 12, left: 12 };

function renderSides(props: Partial<ComponentProps<typeof PageMarginSidesControl>> = {}) {
  const onChangeSide = vi.fn();
  const onResetSide = vi.fn();
  const onProbe = vi.fn();
  const onToggle = vi.fn();
  render(
    <AntdApp>
      <PageMarginSidesControl
        open
        onToggle={onToggle}
        margins={UNIFORM}
        customizedSides={{ top: false, right: false, bottom: false, left: false }}
        onChangeSide={onChangeSide}
        onResetSide={onResetSide}
        onProbe={onProbe}
        {...props}
      />
    </AntdApp>,
  );
  return { onChangeSide, onResetSide, onProbe, onToggle };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PageMarginSidesControl · 折叠与卡片", () => {
  it("收起态只有折叠标题：不渲染四条支路，aria-expanded 为 false", async () => {
    const { onToggle } = renderSides({ open: false });

    const toggle = await screen.findByRole("button", {
      name: t("resume.pagePadding.sidesToggle"),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("展开态：卡片有可读的名字，底部一行说明交代「没出现 ↺ 的边」", async () => {
    renderSides();

    const toggle = await screen.findByRole("button", {
      name: t("resume.pagePadding.sidesToggle"),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("group", { name: t("resume.pageMargin.sidesTitle") }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("resume.pageMargin.sidesNote"))).toBeInTheDocument();
    // 四边都没单独调过 → 一个复位图标都没有（原先这里是四条「随模板」胶囊）。
    expect(
      screen.queryByRole("button", {
        name: t("resume.pageMargin.resetAction", { side: t("resume.pageMargin.top") }),
      }),
    ).not.toBeInTheDocument();
  });

  it("单独调整过的边才出现 ↺，点它整条边复位", async () => {
    const { onResetSide, onProbe } = renderSides({
      customizedSides: { top: true, right: false, bottom: false, left: false },
    });

    // 只有「上」有复位图标。
    expect(
      await screen.findByRole("button", {
        name: t("resume.pageMargin.resetAction", { side: t("resume.pageMargin.top") }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: t("resume.pageMargin.resetAction", { side: t("resume.pageMargin.right") }),
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: t("resume.pageMargin.resetAction", { side: t("resume.pageMargin.top") }),
      }),
    );
    expect(onProbe).toHaveBeenLastCalledWith("");
    expect(onResetSide).toHaveBeenCalledWith("top");
  });
});

describe("PageMarginSidesControl · 四行与读数", () => {
  it("四个方向各一行，读数带 mm 且一位小数", async () => {
    renderSides();

    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(
        await screen.findByRole("slider", {
          name: t("resume.pageMargin.sliderLabel", { side: t(`resume.pageMargin.${side}`) }),
        }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText("12mm")).toHaveLength(4);
  });
});

describe("PageMarginSidesControl · 拖动与探针", () => {
  it("拖「上」到 11.9：探针先给四值形态，静置后只提交那一条边", async () => {
    const { onChangeSide, onProbe } = renderSides();

    fireEvent.click(
      await screen.findByRole("button", {
        name: t("resume.pageMargin.decrease", { side: t("resume.pageMargin.top") }),
      }),
    );

    // 四边不再相等 → CSS 简写顺序的四值形态（与后端 `page_padding_rule` 逐字一致）。
    expect(onProbe).toHaveBeenLastCalledWith("body { padding: 11.9mm 12mm 12mm 12mm !important; }");
    expect(onChangeSide).not.toHaveBeenCalled();

    await waitFor(() => expect(onChangeSide).toHaveBeenCalledTimes(1));
    expect(onChangeSide).toHaveBeenCalledWith("top", 11.9);
  });

  it("四边相等时探针回落到单值形态（逐字等于 pagePaddingProbeCss）", async () => {
    const { onProbe } = renderSides({
      margins: { top: 11.9, right: 12, bottom: 12, left: 12 },
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: t("resume.pageMargin.increase", { side: t("resume.pageMargin.top") }),
      }),
    );

    // 11.9 + 0.1 = 12 → 四边全等 → 单值形态，用户不会看到画面跳一下。
    expect(onProbe).toHaveBeenLastCalledWith("body { padding: 12mm !important; }");
  });

  it("抵达 0 / 26 时对应端点的按钮各自禁用", async () => {
    renderSides({ margins: { top: 0, right: 26, bottom: 12, left: 12 } });

    expect(
      await screen.findByRole("button", {
        name: t("resume.pageMargin.decrease", { side: t("resume.pageMargin.top") }),
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: t("resume.pageMargin.increase", { side: t("resume.pageMargin.right") }),
      }),
    ).toBeDisabled();
  });
});

describe("PageMarginSidesControl · 复位", () => {
  it("双击标签：只复位这一条边，并清掉探针", async () => {
    const { onResetSide, onProbe } = renderSides({
      customizedSides: { top: true, right: false, bottom: false, left: false },
    });

    fireEvent.doubleClick(await screen.findByText(t("resume.pageMargin.top")));

    expect(onProbe).toHaveBeenLastCalledWith("");
    expect(onResetSide).toHaveBeenCalledWith("top");
  });

  it("这条边本来就没自己的值：双击不产生请求", async () => {
    const { onResetSide } = renderSides();

    fireEvent.doubleClick(await screen.findByText(t("resume.pageMargin.left")));

    expect(onResetSide).not.toHaveBeenCalled();
  });

  it("键盘：Enter 也能复位（读屏 / 无鼠标用户拿得到同一个动作）", async () => {
    const { onResetSide } = renderSides({
      customizedSides: { top: false, right: true, bottom: false, left: false },
    });

    const label = await screen.findByText(t("resume.pageMargin.right"));
    fireEvent.keyDown(label, { key: "Enter" });

    expect(onResetSide).toHaveBeenCalledWith("right");
  });
});

describe("PageMarginSidesControl · 禁用态", () => {
  it("disabled 时滑杆与按钮全部禁用", async () => {
    renderSides({ disabled: true });

    expect(
      await screen.findByRole("slider", {
        name: t("resume.pageMargin.sliderLabel", { side: t("resume.pageMargin.bottom") }),
      }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", {
        name: t("resume.pageMargin.increase", { side: t("resume.pageMargin.bottom") }),
      }),
    ).toBeDisabled();
  });
});
