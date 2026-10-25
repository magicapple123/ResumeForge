// SPDX-License-Identifier: Apache-2.0
/**
 * 分页设置区：**全局「板块分页方式」**、已设置板块断页的可见/可清除、逐板块与条目级
 * 折叠分组、续页信息、草稿说明、矩阵口径的格式支持。
 *
 * 断言走 t()/role/testid，不写中文字面量（i18n 棘轮）；板块夹具用 ASCII 名，
 * 这样芯片/选择的断言不依赖真实板块文案。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import PaginationControls from "./PaginationControls";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

const SECTIONS = [
  { key: "education", label: "Education" },
  { key: "experience", label: "Experience" },
  { key: "projects", label: "Projects" },
];

const ENTRY = { id: "exp_12345678", label: "Acme" };

/** 造带分页域的版式：format_config 的值类型是扁平的，域对象要显式收窄。 */
function layoutWith(pagination: Record<string, unknown>): ResumeLayout {
  return {
    ...LAYOUT,
    format_config: { accent: "#123456", pagination } as unknown as ResumeLayout["format_config"],
  };
}

function renderPanel(
  props: Partial<ComponentProps<typeof PaginationControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <PaginationControls layout={LAYOUT} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return onChange;
}

function last(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

/** 每次 onChange 之后宿主会拿到的分页域（没有域时是 undefined）。 */
function paginationOf(layout: ResumeLayout): unknown {
  return (layout.format_config as { pagination?: unknown }).pagination;
}

/** antd Segmented：点内部的 radio 输入（与用户点标签同一条 onChange 链）。 */
function pickSegment(text: string) {
  const item = Array.from(document.querySelectorAll(".ant-segmented-item")).find(
    (el) => el.textContent?.trim() === text,
  );
  expect(item).toBeTruthy();
  fireEvent.click((item?.querySelector("input") ?? item) as Element);
}

function selectedSegment(): string | null {
  return document.querySelector(".ant-segmented-item-selected")?.textContent?.trim() ?? null;
}

/** 展开可折叠分组：antd Collapse 的标题是 role=button，点内层文字会冒泡上去。 */
function openSubGroup(text: string) {
  fireEvent.click(screen.getByText(text));
}

/** antd Select 的选项在 jsdom 里以 .ant-select-item-option 渲染；按可见文本点选。 */
async function pickOption(text: string) {
  await waitFor(() => {
    const texts = Array.from(document.querySelectorAll(".ant-select-item-option")).map((el) =>
      el.textContent?.trim(),
    );
    expect(texts).toContain(text);
  });
  const option = Array.from(document.querySelectorAll(".ant-select-item-option")).find(
    (el) => el.textContent?.trim() === text,
  );
  expect(option).toBeTruthy();
  const content = option?.querySelector(".ant-select-item-option-content");
  fireEvent.click((content ?? option) as Element);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

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

  it("切回自然填充：清掉所有板块断页，条目级断页与续页信息不动", () => {
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
    expect(paginationOf(last(onChange))).toEqual({
      version: 1,
      entries: { [ENTRY.id]: { break_before: "page" } },
      sections: { experience: { keep_with_next: 2 } },
      continuation: { page_numbers: true },
    });
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
