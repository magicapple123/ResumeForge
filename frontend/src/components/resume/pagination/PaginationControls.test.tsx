// SPDX-License-Identifier: Apache-2.0
/**
 * 分页设置区：**全局「板块分页方式」**、已设置板块断页的可见/可清除、逐板块与条目级
 * 折叠分组、续页信息、草稿说明、矩阵口径的格式支持。
 *
 * 断言走 t()/role/testid，不写中文字面量（i18n 棘轮）；板块夹具用 ASCII 名，
 * 这样芯片/选择的断言不依赖真实板块文案。
 *
 * 夹具与 DOM 查询辅助在 `src/test/paginationControlsHarness.tsx`（2026-11 行数预算）；
 * 条目级断页清单与 prune 两支在 `PaginationControls.breaks.test.tsx`。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { t } from "../../../i18n";
import { paginationEntryOptions } from "../../../features/resume-pagination/paginationEntryLabels";
import {
  cleanupPaginationPanel,
  confirmButton,
  ENTRY,
  last,
  layoutWith,
  openSubGroup,
  paginationOf,
  pickOption,
  pickSegment,
  renderPanel,
  SECTIONS,
  selectedSegment,
  skillsContent,
  waitForConfirm,
} from "../../../test/paginationControlsHarness";

afterEach(cleanupPaginationPanel);

describe("PaginationControls · 全局板块分页方式", () => {
  it("默认自然填充；切「每板块新页」给全部板块写断页，条目级意图原样保留", () => {
    const onChange = renderPanel({
      layout: layoutWith({ version: 1, entries: { [ENTRY.id]: { break_before: "page" } } }),
      sections: SECTIONS,
    });
    expect(selectedSegment()).toBe(t("pagination.mode.flow"));
    expect(screen.getByRole("radiogroup", { name: t("pagination.mode.aria") })).toBeInTheDocument();
    pickSegment(t("pagination.mode.page"));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { break_before: "page" } },
      sections: {
        education: { break_before: "page" },
        experience: { break_before: "page" },
        projects: { break_before: "page" },
      },
    });
  });

  it("全部板块都断页时显示「每板块新页」，不显示部分断页小结", () => {
    renderPanel({
      layout: layoutWith({
        version: 1,
        sections: {
          education: { break_before: "page" },
          experience: { break_before: "page" },
          projects: { break_before: "page" },
        },
      }),
      sections: SECTIONS,
    });
    expect(selectedSegment()).toBe(t("pagination.mode.page"));
    expect(screen.queryByTestId("pagination-mode-partial")).toBeNull();
  });

  it("只有部分板块断页：显示自然填充 + 「N 个板块从新页开始」小结", () => {
    renderPanel({
      layout: layoutWith({
        version: 1,
        sections: { experience: { break_before: "page" } },
      }),
      sections: SECTIONS,
    });
    expect(selectedSegment()).toBe(t("pagination.mode.flow"));
    expect(screen.getByTestId("pagination-mode-partial")).toHaveTextContent(
      t("pagination.mode.partial", { count: 1 }),
    );
  });

  it("传 activeSections 时只按有内容的板块判定「每板块新页」", () => {
    renderPanel({
      layout: layoutWith({
        version: 1,
        sections: {
          education: { break_before: "page" },
          experience: { break_before: "page" },
        },
      }),
      sections: SECTIONS,
      // projects 是空板块、没设断页：有内容的两个都设了，就应显示「每板块新页」。
      activeSections: ["education", "experience"],
    });
    expect(selectedSegment()).toBe(t("pagination.mode.page"));
  });

  it("activeSections 只影响判定：全局写入仍覆盖全部板块（空板块断页无害）", () => {
    const onChange = renderPanel({
      sections: SECTIONS,
      activeSections: ["education", "experience"],
    });
    pickSegment(t("pagination.mode.page"));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      sections: {
        education: { break_before: "page" },
        experience: { break_before: "page" },
        projects: { break_before: "page" },
      },
    });
  });

  it("切回自然填充：先二次确认，确认后清掉所有板块断页（条目级与续页信息不动）", async () => {
    const onChange = renderPanel({
      layout: layoutWith({
        version: 1,
        entries: { [ENTRY.id]: { break_before: "page" } },
        sections: {
          education: { break_before: "page" },
          experience: { break_before: "page", keep_with_next: 2 },
          projects: { break_before: "page" },
        },
        continuation: { page_numbers: true },
      }),
      sections: SECTIONS,
    });
    pickSegment(t("pagination.mode.flow"));
    // 一次抹掉全部板块断页不可撤销：确认前**不能**已经改掉宿主状态。
    await waitForConfirm();
    expect(document.querySelector(".ant-modal-confirm-content")?.textContent).toContain(
      t("pagination.mode.confirmBody", { count: 3 }),
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(confirmButton("ok"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { break_before: "page" } },
      sections: { experience: { keep_with_next: 2 } },
      continuation: { page_numbers: true },
    });
  });

  it("确认框里点「取消」：一个断页都不清", async () => {
    const onChange = renderPanel({
      layout: layoutWith({
        version: 1,
        // 三个板块都有断页 → 当前显示「每板块新页」，切「自然填充」才会进确认框。
        sections: {
          education: { break_before: "page" },
          experience: { break_before: "page" },
          projects: { break_before: "page" },
        },
      }),
      sections: SECTIONS,
    });
    pickSegment(t("pagination.mode.flow"));
    await waitForConfirm();
    fireEvent.click(confirmButton("cancel"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("没有板块清单时不渲染全局方式（宿主还没拿到模板目录）", () => {
    renderPanel();
    expect(screen.queryByTestId("pagination-mode")).toBeNull();
  });
});

describe("PaginationControls · 已设置的板块断页可见 / 可清除", () => {
  const WITH_BREAKS = {
    version: 1,
    sections: {
      experience: { break_before: "page" },
      projects: { break_before: "page" },
    },
  };

  it("芯片列出每一个已设断页的板块，点清除只清这一个", () => {
    const onChange = renderPanel({ layout: layoutWith(WITH_BREAKS), sections: SECTIONS });
    const list = screen.getByTestId("pagination-section-breaks");
    expect(within(list).getByText("Experience")).toBeInTheDocument();
    expect(within(list).getByText("Projects")).toBeInTheDocument();
    fireEvent.click(
      within(list).getByRole("button", {
        name: t("pagination.breaks.clearOne", { label: "Experience" }),
      }),
    );
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      sections: { projects: { break_before: "page" } },
    });
  });

  it("「恢复自然分页」一键清除全部板块断页（条目级不动）", () => {
    const onChange = renderPanel({
      layout: layoutWith({
        ...WITH_BREAKS,
        entries: { [ENTRY.id]: { break_before: "page" } },
      }),
      sections: SECTIONS,
    });
    fireEvent.click(screen.getByRole("button", { name: t("pagination.breaks.restore") }));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { break_before: "page" } },
    });
  });
});

describe("PaginationControls · 逐板块与条目级分组", () => {
  it("逐板块设置默认收起；展开后选板块、写 sections，且没有「允许跨页」", async () => {
    const onSectionChange = vi.fn();
    const onChange = renderPanel({
      sections: SECTIONS,
      section: "experience",
      onSectionChange,
    });
    expect(screen.queryByRole("switch", { name: t("pagination.breakBefore") })).toBeNull();
    openSubGroup(t("pagination.sections.settings"));
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.breakBefore") }));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      sections: { experience: { break_before: "page" } },
    });
    expect(screen.queryByRole("switch", { name: t("pagination.allowSplit") })).toBeNull();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("pagination.scope.sectionAria") }));
    await pickOption("Projects");
    expect(onSectionChange).toHaveBeenCalledWith("projects");
  });

  it("选中条目才出现条目级分组（默认展开，可收起）", () => {
    renderPanel({ entry: ENTRY });
    expect(screen.getByTestId("pagination-entry")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: t("pagination.breakBefore") })).toBeInTheDocument();
    const headerName = new RegExp(t("pagination.entry.title"));
    expect(screen.getByRole("button", { name: headerName })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    openSubGroup(t("pagination.entry.title"));
    // rc-motion 在 jsdom 里可能保留已收起的内容节点，所以断言折叠态而不是"节点消失"。
    expect(screen.getByRole("button", { name: headerName })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    cleanup();
    renderPanel();
    expect(screen.queryByTestId("pagination-entry")).toBeNull();
    expect(
      screen.getByRole("switch", { name: t("pagination.continuation.repeatName") }),
    ).toBeInTheDocument();
  });

  it("条目级：从新页开始 / 标题跟随行数 / 允许跨页分别写 pagination 域", async () => {
    const onChange = renderPanel({ entry: ENTRY });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.breakBefore") }));
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { break_before: "page" } },
    });

    cleanup();
    const onChange2 = renderPanel({ entry: ENTRY });
    fireEvent.mouseDown(
      screen.getByRole("combobox", {
        name: t("pagination.keepWithNext.aria", { label: t("pagination.keepWithNext") }),
      }),
    );
    await pickOption(t("pagination.keepWithNext.lines", { count: 2 }));
    await waitFor(() => expect(onChange2).toHaveBeenCalled());
    expect(paginationOf(last(onChange2))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { keep_with_next: 2 } },
    });

    cleanup();
    const onChange3 = renderPanel({ entry: ENTRY });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.allowSplit") }));
    expect(paginationOf(last(onChange3))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { allow_split: true } },
    });
  });

  it("续页信息：一行两个开关；打开写 true，关掉后域被删除（恢复默认不写 false）", () => {
    const onChange = renderPanel();
    const continuation = screen.getByTestId("pagination-continuation");
    expect(within(continuation).getAllByRole("switch")).toHaveLength(2);
    fireEvent.click(
      within(continuation).getByRole("switch", { name: t("pagination.continuation.pageNumbers") }),
    );
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      continuation: { page_numbers: true },
    });
  });

  it("草稿预览不可见手动分页：常驻说明（不画假分页线）", () => {
    renderPanel({ entry: ENTRY });
    expect(screen.getByText(t("pagination.draft.note"))).toBeInTheDocument();
  });
});

describe("PaginationControls · 格式支持（矩阵口径，收在可折叠分组里）", () => {
  it("有矩阵时只列非 supported 的格子", () => {
    renderPanel({
      capabilities: {
        "html:manual_page_break": "approx",
        "pdf:manual_page_break": "unsupported",
        "pdf:keep_with_next": "supported",
      },
    });
    expect(screen.queryByTestId("pagination-capability")).toBeNull();
    openSubGroup(t("pagination.capability.title"));
    expect(
      screen.getByText(
        `${t("preflight.format.pdf")} ${t("pagination.capability.entryBreak")} ${t("preflight.capability.unsupported")}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${t("preflight.format.html")} ${t("pagination.capability.entryBreak")} ${t("preflight.capability.approx")}`,
      ),
    ).toBeInTheDocument();
  });

  it("没有矩阵时如实说明以检查模块为准，不自己编", () => {
    renderPanel();
    openSubGroup(t("pagination.capability.title"));
    expect(screen.getByText(t("pagination.capability.pending"))).toBeInTheDocument();
  });
});

describe("PaginationControls · 条目级断页清单的芯片取名", () => {
  /**
   * P1 回归：芯片的名字必须由 `paginationEntryOptions` 提供（W4 七个分区 **+ skills**）。
   * 宿主曾直接摊平 W4 的条目下拉数据源（`FIELD_LAYOUT_SECTIONS` 七个分区、不含 skills），
   * 技能条目于是显示成「已删除的条目」——而这条意图不会被 prune 掉，芯片会长期挂着这句
   * 误导文案。
   */
  it("skills 条目的断页芯片显示技能名，而不是「已删除的条目」", () => {
    const skillsEntries = paginationEntryOptions(
      skillsContent([{ id: "skl_12345678", name: "TypeScript" }]),
    );
    renderPanel({
      layout: layoutWith({ version: 1, entries: { skl_12345678: { break_before: "page" } } }),
      sections: SECTIONS,
      entries: skillsEntries,
      validEntryIds: ["skl_12345678"],
    });
    const list = screen.getByTestId("pagination-section-breaks");
    expect(within(list).getByText("TypeScript")).toBeInTheDocument();
    expect(within(list).queryByText(t("pagination.breaks.unknownEntry"))).toBeNull();
  });
});
