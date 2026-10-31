// SPDX-License-Identifier: Apache-2.0
/**
 * 分页面板（Q07/Q08/Q09）：
 * - 只保留板块级两开关（条目级断页挪进「本份简历结构」页签）；
 * - 「已设置断页」汇总条：板块与条目芯片、点击跳转、单个 ✕ 清除、恢复自然分页；
 * - 顶部「切到精确预览」（宿主给回调才渲染）、首次拨动开关的轻提示只出现一次；
 * - 行内/单段板块不再出现条目级控件（面板里本就没有条目级行，这里守"没有回来"）。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeDocument } from "../../../types/resumeDocument";
import SectionPaginationPanel from "./SectionPaginationPanel";

beforeEach(() => {
  window.sessionStorage.clear();
});

function sectionDefaults() {
  return {
    columns: 1 as const,
    align: "equal" as const,
    gap: null,
    hide_title: false,
    keep_together: false,
    start_on_new_page: false,
    title_override: "",
  };
}

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
        layout: sectionDefaults(),
        entries: [
          {
            id: "entry_edu_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              {
                kind: "field",
                id: "school_01",
                key: "school",
                label: "",
                value: "Fixture University",
                placement: "title",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                source: null,
                body_style: "bullet",
              },
            ],
          },
        ],
      },
      {
        key: "summary",
        title: "",
        kind: "text",
        layout: sectionDefaults(),
        entries: [
          {
            id: "entry_sum_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              { kind: "text", id: "text_01", style: "paragraph", text: "总结", hidden: false },
            ],
          },
        ],
      },
      {
        key: "custom:sec_0001",
        title: "开源项目",
        kind: "entries",
        layout: sectionDefaults(),
        entries: [],
      },
    ],
  };
}

function renderPanel(document: ResumeDocument, props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const view = render(
    <AntdApp>
      <SectionPaginationPanel document={document} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return { container: view.container, onChange };
}

describe("SectionPaginationPanel · 板块级开关（Q08）", () => {
  it("每个板块只渲染两个开关，不再展开条目行；保留提示与自建板块标题", () => {
    const { container } = renderPanel(makeDocument());
    expect(screen.getByText(t("structure.pagination.hint"))).toBeInTheDocument();
    expect(screen.getByText("开源项目")).toBeInTheDocument();
    expect(screen.getByText(t("structure.section.education"))).toBeInTheDocument();
    // 3 个板块 × 2 个开关 = 6；条目级开关已搬走。
    expect(container.querySelectorAll('[data-section-pagination] [role="switch"]')).toHaveLength(6);
    expect(container.querySelector("[data-entry-pagination]")).toBeNull();
  });

  it("打开「从新页开始」写 document.sections[i].layout.start_on_new_page", () => {
    const { container, onChange } = renderPanel(makeDocument());
    const row = container.querySelector<HTMLElement>('[data-section-pagination="education"]');
    if (!row) throw new Error("missing row");
    fireEvent.click(row.querySelectorAll('button[role="switch"]')[0]);
    const next = onChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[0].layout.start_on_new_page).toBe(true);
    expect(next.sections[1].layout.start_on_new_page).toBe(false);
  });

  it("打开「整块不跨页」写 keep_together", () => {
    const { container, onChange } = renderPanel(makeDocument());
    const row = container.querySelector<HTMLElement>('[data-section-pagination="custom:sec_0001"]');
    if (!row) throw new Error("missing row");
    fireEvent.click(row.querySelectorAll('button[role="switch"]')[1]);
    const next = onChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[2].layout.keep_together).toBe(true);
  });

  it("值没变化时不派发新文档（不制造脏值/历史点）", () => {
    const document = makeDocument();
    document.sections[0].layout.start_on_new_page = true;
    const { container, onChange } = renderPanel(document);
    const row = container.querySelector<HTMLElement>('[data-section-pagination="education"]');
    if (!row) throw new Error("missing row");
    fireEvent.click(row.querySelectorAll('button[role="switch"]')[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[0].layout.start_on_new_page).toBe(false);
  });

  it("disabled 时板块级开关禁用", () => {
    const { container } = renderPanel(makeDocument(), { disabled: true });
    for (const sw of container.querySelectorAll(
      '[data-section-pagination] button[role="switch"]',
    )) {
      expect(sw).toBeDisabled();
    }
  });
});

describe("SectionPaginationPanel · 已设置断页汇总（Q08）", () => {
  it("没有断页时显示空态，不渲染恢复按钮", () => {
    const { container } = renderPanel(makeDocument());
    expect(screen.getByText(t("pagination.breaks.empty"))).toBeInTheDocument();
    expect(container.querySelector(".resume-pagination-restore")).toBeNull();
  });

  it("板块级与条目级断页都列成芯片；条目芯片用共享条目名", () => {
    const document = makeDocument();
    document.sections[0].layout.start_on_new_page = true;
    document.sections[0].entries[0].layout.start_on_new_page = true;
    document.sections[0].entries[0].layout.keep_together = true;
    renderPanel(document);
    const labels = screen.getAllByRole("listitem").map((node) => node.textContent ?? "");
    expect(labels.some((label) => label.includes(t("structure.section.education")))).toBe(true);
    expect(
      labels.some((label) => label.includes("Fixture University · " + t("pagination.breakBefore"))),
    ).toBe(true);
    expect(screen.getByText(t("pagination.breaks.entryHint"))).toBeInTheDocument();
  });

  it("单个 ✕ 只清对应开关（不动同一条目的另一个开关）", () => {
    const document = makeDocument();
    document.sections[0].entries[0].layout.start_on_new_page = true;
    document.sections[0].entries[0].layout.keep_together = true;
    const { onChange } = renderPanel(document);
    const chip = window.document.querySelector<HTMLElement>(
      '[data-break-chip="entry:education:entry_edu_01:start_on_new_page"]',
    );
    if (!chip) throw new Error("missing chip");
    fireEvent.click(chip.querySelector("button.resume-pagination-break-clear") as HTMLElement);
    const next = onChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[0].entries[0].layout.start_on_new_page).toBe(false);
    expect(next.sections[0].entries[0].layout.keep_together).toBe(true);
  });

  it("点击芯片标签跳转（宿主切结构页签并选中）", () => {
    const document = makeDocument();
    document.sections[0].entries[0].layout.keep_together = true;
    const onJumpToBreak = vi.fn();
    renderPanel(document, { onJumpToBreak });
    const chip = window.document.querySelector<HTMLElement>(
      '[data-break-chip="entry:education:entry_edu_01:keep_together"]',
    );
    if (!chip) throw new Error("missing chip");
    fireEvent.click(chip.querySelector(".resume-pagination-break-label") as HTMLElement);
    expect(onJumpToBreak).toHaveBeenCalledWith("education.entry_edu_01");
  });

  it("「恢复自然分页」清掉板块级断页，条目级保留", () => {
    const document = makeDocument();
    document.sections[0].layout.start_on_new_page = true;
    document.sections[0].entries[0].layout.start_on_new_page = true;
    const { onChange } = renderPanel(document);
    fireEvent.click(screen.getByRole("button", { name: t("pagination.breaks.restore") }));
    const next = onChange.mock.calls[0][0] as ResumeDocument;
    expect(next.sections[0].layout.start_on_new_page).toBe(false);
    expect(next.sections[0].entries[0].layout.start_on_new_page).toBe(true);
  });
});

describe("SectionPaginationPanel · 精确预览与轻提示（Q09）", () => {
  it("宿主没给回调时不渲染「切到精确预览」（不留死控件）", () => {
    renderPanel(makeDocument());
    expect(screen.queryByRole("button", { name: t("pagination.exactPreview.switch") })).toBeNull();
  });

  it("点击「切到精确预览」调用宿主回调；已在精确预览时禁用", () => {
    const onSwitchToExactPreview = vi.fn();
    const view = render(
      <AntdApp>
        <SectionPaginationPanel
          document={makeDocument()}
          onChange={vi.fn()}
          onSwitchToExactPreview={onSwitchToExactPreview}
        />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("pagination.exactPreview.switch") }));
    expect(onSwitchToExactPreview).toHaveBeenCalledTimes(1);
    view.unmount();
    render(
      <AntdApp>
        <SectionPaginationPanel
          document={makeDocument()}
          onChange={vi.fn()}
          previewMode="exact"
          onSwitchToExactPreview={vi.fn()}
        />
      </AntdApp>,
    );
    expect(
      screen.getByRole("button", { name: t("pagination.exactPreview.switch") }),
    ).toBeDisabled();
  });

  it("本会话第一次拨动断页开关时提示一次，之后再拨不再提示", () => {
    const onNotify = vi.fn();
    const { container } = renderPanel(makeDocument(), { onNotify });
    const row = container.querySelector<HTMLElement>('[data-section-pagination="education"]');
    if (!row) throw new Error("missing row");
    fireEvent.click(row.querySelectorAll('button[role="switch"]')[0]);
    expect(onNotify).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith(t("toast.pageBreakApplied"));
    fireEvent.click(row.querySelectorAll('button[role="switch"]')[1]);
    expect(onNotify).toHaveBeenCalledTimes(1);
  });
});

describe("SectionPaginationPanel · 空态", () => {
  it("没有板块时显示空态", () => {
    const empty: ResumeDocument = { ...makeDocument(), sections: [] };
    renderPanel(empty);
    expect(screen.getByText(t("structure.pagination.empty"))).toBeInTheDocument();
  });
});
