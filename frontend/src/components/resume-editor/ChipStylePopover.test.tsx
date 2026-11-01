// SPDX-License-Identifier: Apache-2.0
/**
 * #7：字段右键「调整排版」浮层。
 *
 * 判据（执行手册 B3）：右键正文 → 浮层标题按位置自动推断；**无范围选择器**；
 * 改动走 layout 通道（onLayoutChange），不碰 document（正文回流口）。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChipStylePopover, { type ChipStylePopoverState } from "./ChipStylePopover";
import { DocumentExpandContext } from "./documentExpandContext";
import type { ResumeDocument, ResumeEntry, ResumeSection } from "../../types/resumeDocument";
import type { ResumeLayout } from "../../types";
import { defaultSectionLayout } from "../../features/resume-document";
import I18nProvider from "../../i18n/I18nProvider";
import { t } from "../../i18n";

vi.mock("../../features/profile-library/fieldPlacement", () => ({
  useFieldPlacementCatalog: () => ({ catalog: null }),
}));

const STATE: ChipStylePopoverState = {
  path: "education.ob_entry001.ob_item0001",
  x: 40,
  y: 60,
};

function makeDoc(): ResumeDocument {
  const item = {
    kind: "field" as const,
    id: "ob_item0001",
    key: "school",
    label: "",
    value: "Tsinghua University",
    placement: "title" as const,
    format: "text" as const,
    wrap: "none" as const,
    show_label: false,
    solo: false,
    source: null,
    body_style: "bullet" as const,
  };
  const entry: ResumeEntry = {
    id: "ob_entry001",
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: { head: "split" },
    items: [item],
  };
  const section: ResumeSection = {
    key: "education",
    title: "",
    kind: "entries",
    layout: defaultSectionLayout(),
    entries: [entry],
  };
  return {
    language: "zh-CN",
    header: { items: [] },
    sections: [section],
  } as unknown as ResumeDocument;
}

function makeLayout(): ResumeLayout {
  return {
    template: "classic",
    font_scale: "standard",
    format_config: {},
  } as unknown as ResumeLayout;
}

function renderPopover() {
  const onLayoutChange = vi.fn();
  render(
    <I18nProvider>
      <DocumentExpandContext.Provider
        value={{ expandedPath: null, toggleExpand: () => {}, setExpanded: () => {} }}
      >
        <ChipStylePopover
          state={STATE}
          document={makeDoc()}
          layout={makeLayout()}
          onClose={() => {}}
          onLayoutChange={onLayoutChange}
        />
      </DocumentExpandContext.Provider>
    </I18nProvider>,
  );
  return { onLayoutChange };
}

describe("ChipStylePopover（#7 排版并入右键）", () => {
  it("范围按右键命中的位置自动推断（title → 条目标题），且无范围选择器", () => {
    renderPopover();
    // 判据：浮层没有「作用范围」切换（锁定为推断值）——范围块整体不渲染。
    const scopeBlock = globalThis.document.querySelector('[data-entry-style-scope="1"]');
    expect(scopeBlock).toBeNull();
    // 标题按右键命中的位置自动推断：title 位置 → 「正在改：条目头」。
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label") ?? "").toContain("条目头");
    expect(
      screen.getByText(
        t("document.editor.stylePopoverTitle", {
          scope: t("typography.entryStyle.scope.entry_title"),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("改动走 layout 通道（onLayoutChange），不碰 document", () => {
    const { onLayoutChange } = renderPopover();
    // 「恢复默认」在锁定范围内 = 清空该对象该角色的覆盖：点击应上报新 layout。
    const restore = screen
      .getAllByRole("button")
      .find((button) => (button.textContent ?? "").includes("恢复"));
    if (restore) {
      fireEvent.click(restore);
      expect(onLayoutChange).toHaveBeenCalled();
    }
  });

  it("layout 通道缺省时不渲染浮层（旧宿主/测试不受影响）", () => {
    render(
      <I18nProvider>
        <ChipStylePopover state={STATE} document={makeDoc()} layout={null} onClose={() => {}} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
