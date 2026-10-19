import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SelectionContextMenu from "./SelectionContextMenu";
import type { SelectionTarget } from "./selectionTarget";

const TEXT = "负责后端接口开发";

function makeField(value: string): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.value = value;
  document.body.append(field);
  field.focus();
  field.setSelectionRange(0, 2);
  return field;
}

function makeTarget(field: HTMLTextAreaElement): SelectionTarget {
  return {
    kind: "textarea",
    element: field,
    start: 0,
    end: 2,
    text: TEXT.slice(0, 2),
    rect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
  };
}

function renderMenu(target: SelectionTarget | null) {
  const onClose = vi.fn();
  const onAiPolish = vi.fn();
  render(
    <SelectionContextMenu
      x={40}
      y={60}
      target={target}
      text={TEXT}
      onClose={onClose}
      onAiPolish={onAiPolish}
    />,
  );
  return { onClose, onAiPolish };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SelectionContextMenu", () => {
  it("有可编辑目标时给出五项，且菜单自己拿到焦点", () => {
    const field = makeField(TEXT);
    renderMenu(makeTarget(field));

    const menu = screen.getByRole("menu", { name: "文本操作" });
    expect(menu).toHaveFocus();
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("没有可编辑目标时不出现 AI 润色，剪切与粘贴禁用", () => {
    renderMenu(null);

    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    expect(screen.queryByRole("menuitem", { name: "AI 润色" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "剪切" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "粘贴" })).toBeDisabled();
  });

  it("方向键在可用项之间移动焦点", () => {
    const field = makeField(TEXT);
    renderMenu(makeTarget(field));
    const menu = screen.getByRole("menu", { name: "文本操作" });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "剪切" })).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "复制" })).toHaveFocus();

    // 到顶后回绕到最后一项。
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "AI 润色" })).toHaveFocus();
  });

  it("Esc 与点击外部都通知关闭", () => {
    const field = makeField(TEXT);
    const { onClose } = renderMenu(makeTarget(field));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("点 AI 润色先收起菜单再交给浮层开卡片", () => {
    const field = makeField(TEXT);
    const { onClose, onAiPolish } = renderMenu(makeTarget(field));

    fireEvent.click(screen.getByRole("menuitem", { name: "AI 润色" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAiPolish).toHaveBeenCalledTimes(1);
  });
});
