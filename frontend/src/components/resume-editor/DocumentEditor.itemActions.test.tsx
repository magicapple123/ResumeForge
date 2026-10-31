// SPDX-License-Identifier: Apache-2.0
/**
 * DocumentEditor 的字段 / 条目右键菜单测试。
 * 从 DocumentEditor.test.tsx 拆出，保持单文件 500 行预算。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeDocument } from "../../types/resumeDocument";
import { makeDocument } from "../../features/resume-document/documentFixtures";
import DocumentEditor from "./DocumentEditor";

function chipName(labelKey: Parameters<typeof t>[0], value: string): string {
  return `${t(labelKey)}\uFF1A${value}`;
}

function renderEditor(
  document: ResumeDocument = makeDocument(),
  props: Partial<Parameters<typeof DocumentEditor>[0]> = {},
) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const utils = render(
    <DocumentEditor
      document={document}
      onChange={onChange}
      onSelectPath={onSelectPath}
      {...props}
    />,
  );
  return { ...utils, onChange, onSelectPath };
}

function renderEducation() {
  const result = renderEditor();
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return result;
}

function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

describe("DocumentEditor · 字段与条目右键菜单", () => {
  it("字段隐藏/删除只在右键菜单：chip 上没有可见的眼睛/删除按钮", async () => {
    const first = renderEducation();
    const firstChip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    expect(within(firstChip).queryByRole("button", { name: t("document.item.hide") })).toBeNull();
    expect(within(firstChip).queryByRole("button", { name: t("document.item.remove") })).toBeNull();
    fireEvent.contextMenu(firstChip);
    fireEvent.click(await screen.findByText(t("document.item.hide")));
    expect(
      (lastDocument(first.onChange).sections[0].entries[0].items[0] as { placement?: string })
        .placement,
    ).toBe("hidden");
    first.unmount();

    const second = renderEducation();
    const secondChip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    fireEvent.contextMenu(secondChip);
    fireEvent.click(await screen.findByText(t("document.item.remove")));
    expect(
      lastDocument(second.onChange).sections[0].entries[0].items.some(
        (item) => (item as { key?: string }).key === "school",
      ),
    ).toBe(false);
  });

  it("字段右键菜单有键盘等价物（Shift+F10）", async () => {
    renderEducation();
    const chip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(chip).getAllByRole("button")[0];
    fireEvent.keyDown(main, { key: "F10", shiftKey: true });
    expect(await screen.findByText(t("document.item.hide"))).toBeInTheDocument();
  });

  it("条目头隐藏/删除入口移入右键菜单", async () => {
    const first = renderEducation();
    const firstHead = document.querySelector(
      '[data-document-entry="education.ob_entry001"] .document-entry-head',
    ) as HTMLElement;
    expect(within(firstHead).queryByRole("button", { name: t("document.item.hide") })).toBeNull();
    fireEvent.contextMenu(firstHead);
    fireEvent.click(await screen.findByText(t("document.entry.hide")));
    expect(lastDocument(first.onChange).sections[0].entries[0].hidden).toBe(true);
    first.unmount();

    const second = renderEducation();
    const secondHead = document.querySelector(
      '[data-document-entry="education.ob_entry001"] .document-entry-head',
    ) as HTMLElement;
    fireEvent.contextMenu(secondHead);
    fireEvent.click(await screen.findByText(t("document.entry.remove")));
    expect(lastDocument(second.onChange).sections[0].entries).toHaveLength(1);
  });
});
