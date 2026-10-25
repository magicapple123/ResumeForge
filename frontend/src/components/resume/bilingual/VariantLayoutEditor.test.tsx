// SPDX-License-Identifier: Apache-2.0
/** W16 变体排版编辑器：受控字段、保存/恢复继承的禁用语义。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import VariantLayoutEditor from "./VariantLayoutEditor";

const FIELDS = { template: "scholar", page_limit: 2, font_scale: "standard" };

afterEach(() => {
  cleanup();
});

describe("VariantLayoutEditor", () => {
  it("继承态显示继承状态与可点保存前的禁用语义", () => {
    render(
      <VariantLayoutEditor
        fields={FIELDS}
        inherited
        dirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onResetInherit={vi.fn()}
      />,
    );
    expect(screen.getByText(bt("bilingual.layout.inherited"))).toBeTruthy();
    expect(screen.getByText("scholar")).toBeTruthy();
    const save = screen.getByRole("button", {
      name: bt("bilingual.layout.save"),
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const reset = screen.getByRole("button", {
      name: bt("bilingual.layout.reset"),
    }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
  });

  it("改页数会回传完整字段并启用保存", () => {
    const onChange = vi.fn();
    render(
      <VariantLayoutEditor
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
