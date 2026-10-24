// SPDX-License-Identifier: Apache-2.0
/**
 * D02 的一行控件：直接输入 / 步进 / 临时放大步进 / 恢复继承 / 拖动中探针。
 * 文案一律走 `t()` 或 role/label 查询，不在断言里写中文（i18n 棘轮）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import StyleValueRow from "./StyleValueRow";

const LABEL = t("typography.prop.line_height");

function renderRow(props: Partial<ComponentProps<typeof StyleValueRow>> = {}) {
  const onCommit = vi.fn();
  render(
    <AntdApp>
      <StyleValueRow
        prop="line_height"
        label={LABEL}
        value={1.7}
        own={undefined}
        source="template"
        onCommit={onCommit}
        {...props}
      />
    </AntdApp>,
  );
  return onCommit;
}

function last(onCommit: ReturnType<typeof vi.fn>) {
  return onCommit.mock.calls[onCommit.mock.calls.length - 1]?.[0];
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("StyleValueRow · 数值输入", () => {
  it("直接输入失焦后提交一次", () => {
    const onCommit = renderRow();
    const input = screen.getByRole("spinbutton", {
      name: t("typography.row.directInputAria", { label: LABEL }),
    });
    fireEvent.change(input, { target: { value: "1.55" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(last(onCommit)).toBe(1.55);
  });

  it("± 按钮走一步；Shift 单击走五倍步进", () => {
    const onCommit = renderRow();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: LABEL }),
      }),
    );
    expect(last(onCommit)).toBe(1.71);

    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: LABEL }),
      }),
      { shiftKey: true },
    );
    // 第一下已经到 1.71，Shift 再走五步 → 1.76
    expect(last(onCommit)).toBe(1.76);
  });

  it("拖动中只注入探针，松手后才提交", () => {
    const onProbe = vi.fn();
    const onCommit = renderRow({
      toProbeCss: (value) => `ROLE { value: ${String(value)}; }`,
      onProbe,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: LABEL }),
      }),
    );
    expect(onProbe).toHaveBeenCalledWith("ROLE { value: 1.71; }");
    expect(last(onCommit)).toBe(1.71);
  });

  it("恢复继承 = 提交 null（删键），且只在有覆盖时出现", () => {
    const onCommit = renderRow({ value: 1.55, own: 1.55, source: "role" });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", { label: LABEL }),
      }),
    );
    expect(last(onCommit)).toBeNull();
    cleanup();
    render(
      <AntdApp>
        <StyleValueRow
          prop="line_height"
          label={LABEL}
          value={1.7}
          own={undefined}
          source="template"
          onCommit={vi.fn()}
        />
      </AntdApp>,
    );
    expect(
      screen.queryByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", { label: LABEL }),
      }),
    ).toBeNull();
  });

  it("字号比例显示 pt 对照读数（只显示）", () => {
    renderRow({ prop: "font_scale", label: t("typography.prop.font_scale"), value: 1, basePx: 14 });
    expect(screen.getByText("1× · " + t("typography.value.pt", { pt: 10.5 }))).toBeInTheDocument();
  });
});

describe("StyleValueRow · 开关与枚举", () => {
  it("布尔属性用开关写入", () => {
    const onCommit = renderRow({
      prop: "bold",
      label: t("typography.prop.bold"),
      value: false,
      source: "template",
    });
    fireEvent.click(screen.getByRole("switch", { name: t("typography.prop.bold") }));
    expect(last(onCommit)).toBe(true);
  });

  it("枚举属性用下拉写入，选项来自白名单", () => {
    const onCommit = renderRow({
      prop: "bullet",
      label: t("typography.prop.bullet"),
      value: "dot",
      source: "template",
    });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("typography.prop.bullet") }));
    fireEvent.click(screen.getByTitle(t("typography.enum.bullet.dash")));
    expect(last(onCommit)).toBe("dash");
  });
});
