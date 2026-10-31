// SPDX-License-Identifier: Apache-2.0
/**
 * U7 宿主接线契约：结构树勾选 ↔ 样式页签的批量目标**同一份状态**。
 *
 * 这个文件守的是"死控件"不会回来：
 * - 宿主不提供多选回调时，结构树不渲染勾选框；
 * - 结构页签勾选一条 → 样式页签的多选批量条立刻显示同一条数；
 * - 用该批量目标写一次 format_config（一次 onChange = 历史一步），且不动正文。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import { makeResumeDocument } from "../../test/documentHarness";
import type { ResumePreviewHandle } from "../ResumePreview";
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

function readObjects(): Record<string, unknown> {
  const config = JSON.parse(screen.getByTestId("layout").textContent ?? "{}") as {
    objects?: Record<string, unknown>;
  };
  return config.objects ?? {};
}

describe("WorkbenchParamsColumnV2 · U7 结构树多选宿主接线", () => {
  it("结构树勾选 → 样式页签批量目标同源，批量写一次 format_config", () => {
    const onLayoutChange = vi.fn();
    const onDocumentChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness withMulti onLayoutChange={onLayoutChange} onDocumentChange={onDocumentChange} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));
    fireEvent.click(within(entryRow(container, "education.edu_entry_01")).getByRole("checkbox"));
    // 切到样式页签：多选批量条显示同一条（说明两处共用宿主状态）。
    fireEvent.click(screen.getByRole("tab", { name: t("responsive.action.params") }));
    expect(screen.getByText(t("typography.multi.count", { count: 1 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.caption") }));
    expect(readObjects().edu_entry_01).toMatchObject({ font_scale: 0.9 });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("宿主不提供多选回调：结构树不渲染勾选框（不留死控件）", () => {
    const { container } = render(
      <AntdApp>
        <Harness withMulti={false} onLayoutChange={() => {}} onDocumentChange={() => {}} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));
    expect(
      within(entryRow(container, "education.edu_entry_01")).queryByRole("checkbox"),
    ).toBeNull();
  });
});
