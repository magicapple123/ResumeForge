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
import type { ResumeDocument, ResumeEntry, ResumeSection } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import { defaultSectionLayout } from "../document";
import I18nProvider from "../../../i18n/I18nProvider";
import { t } from "../../../i18n";

vi.mock("../../profile/library/fieldPlacement", () => ({
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

function renderWith(state: ChipStylePopoverState, layout: ResumeLayout) {
  const onLayoutChange = vi.fn();
  render(
    <I18nProvider>
      <DocumentExpandContext.Provider
        value={{ expandedPath: null, toggleExpand: () => {}, setExpanded: () => {} }}
      >
        <ChipStylePopover
          state={state}
          document={makeDoc()}
          layout={layout}
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
    expect(dialog.getAttribute("aria-label") ?? "").toContain(
      t("typography.entryStyle.scope.field"),
    );
    expect(
      screen.getByText(
        t("document.editor.stylePopoverTitle", {
          scope: t("typography.entryStyle.scope.field"),
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("typography.object.levelHint"))).toBeNull();
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

  it('字段路径 → 只改这个字段：清空的是 object_roles["<路径>:<角色>"]', () => {
    const key = "education.ob_entry001.ob_item0001:entry_title";
    const layout = {
      template: "classic",
      font_scale: "standard",
      format_config: { object_roles: { [key]: { color: "#c0392b" } } },
    } as unknown as ResumeLayout;
    const { onLayoutChange } = renderWith(STATE, layout);

    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.entryStyle.restore", {
          scope: t("typography.entryStyle.scope.field"),
        }),
      }),
    );

    const next = onLayoutChange.mock.calls[0][0] as ResumeLayout;
    expect(next.format_config?.object_roles ?? {}).not.toHaveProperty(key);
  });

  it("条目行路径（「排版整条…」）→ 整条范围，清空的是 objects[<entryId>]", () => {
    const layout = {
      template: "classic",
      font_scale: "standard",
      format_config: { objects: { ob_entry001: { color: "#c0392b" } } },
    } as unknown as ResumeLayout;
    const { onLayoutChange } = renderWith({ ...STATE, path: "education.ob_entry001" }, layout);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label") ?? "").toContain(
      t("typography.entryStyle.scope.object"),
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.object.clear") }));

    const next = onLayoutChange.mock.calls[0][0] as ResumeLayout;
    const objects = next.format_config?.objects ?? {};
    // 关键：写的是条目 id，不是 "education.ob_entry001" 这种没人读的路径键。
    expect(objects).not.toHaveProperty("ob_entry001");
    expect(objects).not.toHaveProperty("education.ob_entry001");
  });
});
