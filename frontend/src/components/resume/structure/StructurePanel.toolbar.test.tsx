// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板顶栏工具（收起所有条目 / 板块顺序）的交互测试。
 * 从 StructurePanel.test.tsx 拆出，保持单文件 500 行预算。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { DocumentFieldCatalog, ResumeDocument } from "../../../types/resumeDocument";
import StructurePanel from "./StructurePanel";

const layout = {
  columns: 1 as const,
  align: "equal" as const,
  gap: null,
  hide_title: false,
  keep_together: false,
  start_on_new_page: false,
  title_override: "",
};

function field(id: string, key: string, value: string) {
  return {
    kind: "field" as const,
    id,
    key,
    label: "",
    value,
    placement: "title" as const,
    format: "text" as const,
    wrap: "none" as const,
    show_label: false,
    solo: false,
    source: null,
    body_style: "bullet" as const,
  };
}

function makeDocument(): ResumeDocument {
  const entries = (entryId: string, itemId: string, value: string) => [
    {
      id: entryId,
      hidden: false,
      lock_content: false,
      lock_layout: false,
      layout: { head: "split" as const },
      items: [field(itemId, "school", value)],
    },
  ];
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "education",
        title: "",
        kind: "entries",
        layout,
        entries: entries("entry_edu_01", "school_01", "上海大学"),
      },
      {
        key: "custom:sec_0001",
        title: "开源项目",
        kind: "entries",
        layout,
        entries: entries("entry_proj_01", "pname_001", "项目甲"),
      },
    ],
  };
}

function Harness({ onDoc }: { onDoc?: (doc: ResumeDocument) => void }) {
  const [document, setDocument] = useState(makeDocument());
  return (
    <StructurePanel
      document={document}
      pagesNeeded={1}
      fieldCatalog={null as DocumentFieldCatalog | null}
      onChange={(next) => {
        setDocument(next);
        onDoc?.(next);
      }}
    />
  );
}

function treeRow(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
}

describe("StructurePanel · 顶栏工具", () => {
  it("一键收起所有条目：板块保持展开，条目行保留为可再展开的标题", () => {
    const { container } = render(<Harness />);
    expect(treeRow(container, "education.entry_edu_01")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("structure.action.collapseEntries") }));
    expect(treeRow(container, "education.entry_edu_01")).toHaveAttribute("aria-expanded", "false");
    expect(treeRow(container, "education.entry_edu_01.#title")).toBeNull();
    expect(treeRow(container, "education")).not.toBeNull();
    expect(treeRow(container, "custom:sec_0001")).not.toBeNull();
  });

  it("板块顺序：Popover 里上移 / 下移真实写回文档", async () => {
    const onDoc = vi.fn();
    render(<Harness onDoc={onDoc} />);
    fireEvent.click(
      screen.getByRole("button", { name: t("sections.templateControls.orderTriggerAriaLabel") }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("sections.templateControls.orderMoveUpAria", { label: "开源项目" }),
      }),
    );
    expect(onDoc.mock.calls[0][0].sections.map((section: { key: string }) => section.key)).toEqual([
      "custom:sec_0001",
      "education",
    ]);
  });
});
