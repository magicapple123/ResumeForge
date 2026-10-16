import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KnowledgeFormModal from "./KnowledgeFormModal";

afterEach(cleanup);

function editor(submitting = false) {
  const onSubmit = vi.fn();
  render(
    <KnowledgeFormModal
      open
      entry={null}
      categories={[]}
      submitting={submitting}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe("knowledge editor keyboard and validation", () => {
  it("associates labels, validates on blur and keeps the draft when saving an invalid title", () => {
    const submit = editor();
    const title = screen.getByRole("textbox", { name: "标题" });
    const content = screen.getByRole("textbox", { name: "正文内容" });
    fireEvent.change(content, { target: { value: "保留我的草稿" } });
    fireEvent.blur(title);
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("请填写标题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(title).toHaveFocus();
    expect(content).toHaveValue("保留我的草稿");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: "新标题" } });
    expect(title).toHaveAttribute("aria-invalid", "false");
  });

  it("saves once with Ctrl+Enter and leaves IME composition and plain Enter alone", () => {
    const submit = editor();
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), {
      target: { value: "新标题" },
    });
    const content = screen.getByRole("textbox", { name: "正文内容" });
    fireEvent.keyDown(content, { key: "Enter", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(content, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(content, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(content, { key: "Enter", ctrlKey: true, repeat: true });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("blocks keyboard saves while a previous save is pending", () => {
    const submit = editor(true);
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), {
      target: { value: "新标题" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "正文内容" }), {
      key: "s",
      metaKey: true,
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
