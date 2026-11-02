// SPDX-License-Identifier: Apache-2.0
/**
 * #7 结构树条目行右键菜单：宿主接线契约（左栏「本份简历结构」）。
 *
 * 守两件事：
 * 1. 条目行右键弹的是与画布条目卡**同一份** 6 项菜单（首项「排版整条…」）；
 * 2. 点「排版整条…」→ 宿主的排版浮层真的出现，且范围是**整条**
 *    （`aria-label` 里的 scope 是「整条」）。
 *
 * 只读 / 没有宿主时不弹空菜单的行为由 `StructurePanel.test.tsx` 一侧的只读用例覆盖，
 * 这里不再重复造文档。
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

function Harness({ onLayoutChange }: { onLayoutChange: (next: ResumeLayout) => void }) {
  const [layout, setLayout] = useState<ResumeLayout>(baseLayout);
  const [resume] = useState<ResumeDocument>(() => makeResumeDocument());
  const previewRef = useRef<ResumePreviewHandle>(null);
  return (
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
      document={resume}
      onDocumentChange={vi.fn()}
      pagesNeeded={null}
    />
  );
}

function entryRow(container: HTMLElement, path: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-tree-key="${path}"]`);
  if (!row) throw new Error("missing structure row: " + path);
  return row;
}

describe("WorkbenchParamsColumnV2 · 结构树条目右键「排版整条…」", () => {
  it("右键条目行 → 6 项菜单；点首项 → 整条范围的排版浮层出现", async () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness onLayoutChange={onLayoutChange} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));

    const row = entryRow(container, "education.edu_entry_01");
    fireEvent.contextMenu(row, { clientX: 16, clientY: 24 });

    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(6);
    expect(within(menu).getByText(t("document.entry.styleWhole"))).toBeInTheDocument();
    // 与画布条目卡同一份：上移 / 下移 / 复制 / 隐藏 / 移除都在。
    expect(within(menu).getByText(t("document.entry.moveUp"))).toBeInTheDocument();
    expect(within(menu).getByText(t("document.entry.moveDown"))).toBeInTheDocument();
    expect(within(menu).getByText(t("document.entry.copy"))).toBeInTheDocument();
    expect(within(menu).getByText(t("document.entry.hide"))).toBeInTheDocument();
    expect(within(menu).getByText(t("document.entry.remove"))).toBeInTheDocument();

    fireEvent.click(within(menu).getByText(t("document.entry.styleWhole")));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label") ?? "").toContain(
      t("typography.entryStyle.scope.object"),
    );
    // 排版只走 layout 通道：这次点击不写文档。
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("「隐藏条目」直接改文档（菜单项不是死控件）", async () => {
    const onDocumentChange = vi.fn();
    const onLayoutChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <HarnessWorld onDocumentChange={onDocumentChange} onLayoutChange={onLayoutChange} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));

    fireEvent.contextMenu(entryRow(container, "education.edu_entry_01"), {
      clientX: 16,
      clientY: 24,
    });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByText(t("document.entry.hide")));

    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    const next = onDocumentChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[0].entries[0].hidden).toBe(true);
  });
});

/** 第二种用例要拿到 onDocumentChange，于是把 Harness 的参数补齐（同一个组件的两份接线）。 */
function HarnessWorld({
  onDocumentChange,
  onLayoutChange,
}: {
  onDocumentChange: (next: ResumeDocument) => void;
  onLayoutChange: (next: ResumeLayout) => void;
}) {
  const [layout, setLayout] = useState<ResumeLayout>(baseLayout);
  const [resume, setResume] = useState<ResumeDocument>(() => makeResumeDocument());
  const previewRef = useRef<ResumePreviewHandle>(null);
  return (
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
      document={resume}
      onDocumentChange={(next) => {
        setResume(next);
        onDocumentChange(next);
      }}
      pagesNeeded={null}
    />
  );
}
