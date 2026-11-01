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
        // R-34B 起 `own === undefined` 是"继承模板"降级态（± 禁用、输入框空），
        // 所以「能调」的用例一律给一个显式覆盖值。
        own={1.7}
        source="role"
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

  it("字号比例：倍数并入输入框，pt 对照进 title（尾部不再重复数字）", () => {
    renderRow({
      prop: "font_scale",
      label: t("typography.prop.font_scale"),
      value: 1,
      own: 1,
      basePx: 14,
    });
    const input = screen.getByRole("spinbutton", {
      name: t("typography.row.directInputAria", { label: t("typography.prop.font_scale") }),
    });
    expect(input).toHaveDisplayValue("1×");
    expect(input).toHaveAttribute("title", t("typography.value.pt", { pt: 10.5 }));
    // 尾部只剩「来自…」胶囊：读数不再出现第二次。
    expect(screen.queryByText(/^1×$/)).toBeNull();
  });
});

describe("StyleValueRow · 未覆盖 = 继承（R-34B）", () => {
  it("继承态：输入框空 + 占位「继承」、尾部「继承模板」", () => {
    renderRow({ value: 0, own: undefined, source: "template" });
    const input = screen.getByRole("spinbutton", {
      name: t("typography.row.directInputAria", { label: LABEL }),
    });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", t("typography.row.inheritedPlaceholder"));
    expect(screen.getByText(t("typography.row.inherited"))).toBeInTheDocument();
    // 不再把 fallback 的 0 当成读数写出来。
    expect(screen.queryByText(/^0(?:\.0+)?×?$/)).toBeNull();
  });

  it("继承态仍有从基准起算的入口：滑杆停在基准上，± 按一下就落成覆盖", () => {
    const onCommit = renderRow({ prop: "line_height", value: 1.7, own: undefined });
    // antd 的 aria-label 落在容器上、不转发到 handle，所以按 role 取（行内只有一个滑杆）。
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuenow", "1.7");
    fireEvent.click(
      screen.getByRole("button", { name: t("typography.row.increaseAria", { label: LABEL }) }),
    );
    // 起点是基准 1.7，不是 0：一步之后是 1.71。
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(last(onCommit)).toBe(1.71);
  });

  it("目录还没给基准（value undefined）：滑杆与 ± 都禁用", () => {
    renderRow({ value: undefined, own: undefined, source: "template" });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: t("typography.row.increaseAria", { label: LABEL }) }),
    ).toBeDisabled();
  });

  it("覆盖态不显示「继承模板」", () => {
    renderRow({ value: 1.7, own: 1.7 });
    expect(screen.queryByText(t("typography.row.inherited"))).toBeNull();
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
