// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板多选（U7）的交互测试——R-12 之后勾选框已删除，连选只有两条入口：
 * **Shift + 点击**与**Shift + ↑/↓**，选中行靠 `is-multi-selected`（左侧 2px 色条）标识。
 *
 * 从 StructurePanel.test.tsx 拆出，保持单文件 500 行预算。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import type { ResumeDocument } from "../../../types/resumeDocument";
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

function entryFixture(id: string, itemId: string, value: string) {
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: { head: "split" as const, columns: null, align: null, gap: null },
    items: [field(itemId, "school", value)],
  };
}

/** 两个板块、三条条目（教育两条相邻、开源项目一条隔开），用于验证区间连选。 */
function makeDocument(): ResumeDocument {
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
        entries: [
          entryFixture("entry_edu_01", "school_01", "上海大学"),
          entryFixture("entry_edu_02", "school_02", "复旦大学"),
        ],
      },
      {
        key: "custom:sec_0001",
        title: "开源项目",
        kind: "entries",
        layout,
        entries: [entryFixture("entry_proj_01", "pname_001", "项目甲")],
      },
    ],
  };
}

function MultiHarness({ readOnly }: { readOnly?: boolean }) {
  const [document, setDocument] = useState(makeDocument());
  const [selected, setSelected] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  return (
    <StructurePanel
      document={document}
      onChange={setDocument}
      readOnly={readOnly}
      selectedPath={selected}
      onSelectPath={setSelected}
      multiSelectedPaths={paths}
      onMultiSelectedPathsChange={setPaths}
    />
  );
}

function treeRow(container: HTMLElement, key: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!row) throw new Error("missing tree row: " + key);
  return row;
}

function isMultiSelected(container: HTMLElement, key: string): boolean {
  return treeRow(container, key).className.includes("is-multi-selected");
}

describe("StructurePanel · 结构树多选（U7 / R-12）", () => {
  it("不再渲染勾选框；多选入口写在底部提示里", () => {
    const { container } = render(<MultiHarness />);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.getByText(t("structure.multi.selectHint"))).toBeInTheDocument();
  });

  it("Shift 点击：锚点到当前条目整段并入选择，并带左侧色条", () => {
    const { container } = render(<MultiHarness />);
    // 普通点击先立锚点（此时还没有任何多选）。
    fireEvent.click(treeRow(container, "education.entry_edu_01"));
    expect(isMultiSelected(container, "education.entry_edu_01")).toBe(false);
    fireEvent.click(treeRow(container, "education.entry_edu_02"), { shiftKey: true });
    expect(isMultiSelected(container, "education.entry_edu_01")).toBe(true);
    expect(isMultiSelected(container, "education.entry_edu_02")).toBe(true);
    // 区间之外（另一个板块）不进选择。
    expect(isMultiSelected(container, "custom:sec_0001.entry_proj_01")).toBe(false);
  });

  it("普通点击清空已有选择（没有勾选框后的唯一清空入口）", () => {
    const { container } = render(<MultiHarness />);
    fireEvent.click(treeRow(container, "education.entry_edu_01"));
    fireEvent.click(treeRow(container, "education.entry_edu_02"), { shiftKey: true });
    expect(isMultiSelected(container, "education.entry_edu_02")).toBe(true);
    // 非 Shift 点击：多选归零，只剩当前这一条"单选"。
    fireEvent.click(treeRow(container, "custom:sec_0001.entry_proj_01"));
    expect(isMultiSelected(container, "education.entry_edu_01")).toBe(false);
    expect(isMultiSelected(container, "education.entry_edu_02")).toBe(false);
  });

  it("Shift + ↓ 把下一条条目并入选择（键盘等价）", () => {
    const { container } = render(<MultiHarness />);
    const first = treeRow(container, "education.entry_edu_01");
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });
    expect(isMultiSelected(container, "education.entry_edu_01")).toBe(true);
    expect(isMultiSelected(container, "education.entry_edu_02")).toBe(true);
  });

  it("没有宿主多选状态时完全不出现多选能力（防死控件）", () => {
    const { container } = render(<StructurePanel document={makeDocument()} onChange={() => {}} />);
    expect(screen.queryByText(t("structure.multi.selectHint"))).toBeNull();
    fireEvent.click(treeRow(container, "education.entry_edu_01"));
    fireEvent.click(treeRow(container, "education.entry_edu_02"), { shiftKey: true });
    expect(isMultiSelected(container, "education.entry_edu_01")).toBe(false);
    expect(isMultiSelected(container, "education.entry_edu_02")).toBe(false);
  });

  it("只读态不响应 Shift 连选", () => {
    const { container } = render(<MultiHarness readOnly />);
    expect(screen.queryByText(t("structure.multi.selectHint"))).toBeNull();
    fireEvent.click(treeRow(container, "education.entry_edu_01"));
    fireEvent.click(treeRow(container, "education.entry_edu_02"), { shiftKey: true });
    expect(isMultiSelected(container, "education.entry_edu_01")).toBe(false);
    expect(isMultiSelected(container, "education.entry_edu_02")).toBe(false);
  });
});
