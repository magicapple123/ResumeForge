// SPDX-License-Identifier: Apache-2.0
/** W16 变体排版编辑器：受控字段、保存/恢复继承的禁用语义。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "./i18n";
import VariantLayoutEditor from "./VariantLayoutEditor";

const FIELDS = { template: "scholar", page_limit: 2, font_scale: "standard" };

afterEach(() => {
  cleanup();
});

describe("VariantLayoutEditor", () => {
  it("继承态显示继承状态与可点保存前的禁用语义", () => {
    render(
      <VariantLayoutEditor
        name="English version"
        fields={FIELDS}
        inherited
        dirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onResetInherit={vi.fn()}
      />,
    );
    expect(screen.getByText(bt("bilingual.layout.inherited"))).toBeTruthy();
    // 标题带版本名：面板里同时有中/英两份，"这份版本的排版"看不出是哪一份。
    expect(
      screen.getByText(bt("bilingual.layout.title", { name: "English version" })),
    ).toBeTruthy();
    expect(screen.getByText("scholar")).toBeTruthy();
    const save = screen.getByRole("button", {
      name: bt("bilingual.layout.save"),
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // 禁用原因要读得到（禁用按钮自身不触发 Tooltip，原生 title 兜底）。
    expect(save.closest("span")?.getAttribute("title")).toBe(bt("bilingual.layout.unchanged"));
    const reset = screen.getByRole("button", {
      name: bt("bilingual.layout.reset"),
    }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    expect(reset.closest("span")?.getAttribute("title")).toBe(
      bt("bilingual.layout.resetInherited"),
    );
  });

  it("改页数会回传完整字段并启用保存", () => {
    const onChange = vi.fn();
    render(
      <VariantLayoutEditor
        name="English version"
        fields={FIELDS}
        inherited={false}
        dirty
        onChange={onChange}
        onSave={vi.fn()}
        onResetInherit={vi.fn()}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: bt("bilingual.layout.pages") }));
    fireEvent.click(screen.getByTitle("3"));
    expect(onChange).toHaveBeenCalledWith({ ...FIELDS, page_limit: 3 });
    const save = screen.getByRole("button", {
      name: bt("bilingual.layout.save"),
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("独立排版可恢复继承，保存中禁用控件", () => {
    const onReset = vi.fn();
    render(
      <VariantLayoutEditor
        name="English version"
        fields={FIELDS}
        inherited={false}
        dirty
        saving
        onChange={vi.fn()}
        onSave={vi.fn()}
        onResetInherit={onReset}
      />,
    );
    const reset = screen.getByRole("button", {
      name: bt("bilingual.layout.reset"),
    }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.click(reset);
    expect(onReset).not.toHaveBeenCalled();
  });
});
