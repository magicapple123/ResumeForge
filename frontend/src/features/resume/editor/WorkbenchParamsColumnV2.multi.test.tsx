// SPDX-License-Identifier: Apache-2.0
/**
 * U7 宿主接线契约：结构树多选 ↔ 样式页签的批量目标**同一份状态**。
 *
 * 这个文件守的是"死控件"不会回来：
 * - 宿主不提供多选回调时，结构树怎么点都不会出现多选高亮（不留死交互）；
 * - 结构页签 Shift 连选两条 → 样式页签的多选批量条立刻显示同一条数；
 * - 用该批量目标写一次 format_config（一次 onChange = 历史一步），且不动正文。
 *
 * R-12 起结构树的勾选框已删除，多选入口是 **Shift + 点击**（本文件因此改成按 Shift 事件驱动）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { makeResumeDocument } from "../../../test/documentHarness";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import WorkbenchParamsColumnV2 from "./WorkbenchParamsColumnV2";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function baseLayout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    format_config: {} as ResumeLayout["format_config"],
  };
}

function Harness({
  withMulti,
  onLayoutChange,
  onDocumentChange,
}: {
  withMulti: boolean;
  onLayoutChange: (next: ResumeLayout) => void;
  onDocumentChange: (next: ResumeDocument) => void;
}) {
  const [layout, setLayout] = useState<ResumeLayout>(baseLayout);
  const [document] = useState<ResumeDocument>(() => makeResumeDocument());
  const [multi, setMulti] = useState<string[]>([]);
  const previewRef = useRef<ResumePreviewHandle>(null);
  const multiProps = withMulti
    ? { multiSelectedPaths: multi, onMultiSelectedPathsChange: setMulti }
    : {};
  return (
    <>
      <WorkbenchParamsColumnV2
        layout={layout}
        baseline={layout}
        relayouting={false}
        previewRef={previewRef}
        tier="three"
        editorEnabled
        onChange={(next) => {
          setLayout(next);
          onLayoutChange(next);
        }}
        document={document}
        onDocumentChange={onDocumentChange}
        pagesNeeded={null}
        {...multiProps}
      />
      <output data-testid="layout">{JSON.stringify(layout.format_config)}</output>
    </>
  );
}

function entryRow(container: HTMLElement, path: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-tree-key="${path}"]`);
  if (!row) throw new Error("missing structure row: " + path);
  return row;
}

describe("WorkbenchParamsColumnV2 · 结构树多选宿主接线", () => {
  it("structure multi-select stays wired while the batch typography panel is offline (#7)", () => {
    const onLayoutChange = vi.fn();
    const onDocumentChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness withMulti onLayoutChange={onLayoutChange} onDocumentChange={onDocumentChange} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));
    // 先普通点一条（建立锚点），再 Shift 点下一条 → 区间选中两条。
    fireEvent.click(entryRow(container, "education.edu_entry_01"));
    fireEvent.click(entryRow(container, "experience.exp_entry_01"), { shiftKey: true });
    // 宿主仍持有这两条多选（结构面板的高亮由它驱动）。
    expect(container.querySelectorAll(".rf-structure-row.is-multi-selected")).toHaveLength(2);
    // 切回排版参数页签：批量排版条（`.resume-typography-multi`）不出现——#7 已下线。
    // 注意别拿 `.resume-typography-panel` 当代言：R-11 起排版页签里有一个只列「字段名」
    // 角色的紧凑面板（RoleStylePanel visibleRoles=["field_label"]），它用的是同一个 section 类。
    fireEvent.click(screen.getByRole("tab", { name: t("responsive.action.params") }));
    expect(container.querySelectorAll(".resume-typography-multi")).toHaveLength(0);
    expect(screen.queryByText(t("typography.multi.count", { count: 2 }))).toBeNull();
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("宿主不提供多选回调：Shift 点击也不产生多选高亮（不留死交互）", () => {
    const { container } = render(
      <AntdApp>
        <Harness withMulti={false} onLayoutChange={() => {}} onDocumentChange={() => {}} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));
    fireEvent.click(entryRow(container, "education.edu_entry_01"));
    fireEvent.click(entryRow(container, "experience.exp_entry_01"), { shiftKey: true });
    // 没有宿主回调 → 不出现多选高亮类，也不出现勾选框。
    expect(container.querySelectorAll(".rf-structure-row.is-multi-selected")).toHaveLength(0);
    expect(
      within(entryRow(container, "education.edu_entry_01")).queryByRole("checkbox"),
    ).toBeNull();
  });
});
