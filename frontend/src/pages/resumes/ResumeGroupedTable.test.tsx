// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图（按岗位分组）的守卫（2026-11-26）。
 *
 * 这张表此前**一个测试都没有**：新视图 + 无测试 = 整行右键与列头排序的回归都没有
 * 闸门能拦住。两类用例：
 *
 * ## 整行右键（问题 1）
 * 1. 多版本组行：出现菜单，且**不含**删除 / 批量选择（CR-33 禁止组级破坏性动作）；
 * 2. 版本行：出现单条动作（含「预览」），但**不含**批量选择；
 * 3. 单版本组行：与平铺行同一份清单，含「批量选择」。
 *
 * ## 列头三态（问题 2）
 * 4. 默认态三列都**不带**箭头（默认排序不是用户的选择）；
 * 5. 点「投递」按组内投递次数重排，且展开的组仍带着自己的版本行；
 * 6. 排序**不穿透**版本层：组内版本顺序仍是时间倒序；
 * 7. 点第三次取消，回默认态（等价于「恢复默认排序」重新出现）。
 *
 * ## 列宽声明（窄档裁字的根因，2026-11-26 返工）
 * 8. 表格必须是**定宽布局**，且身份列是唯一"不写宽度"的列。
 *    jsdom 没有排版能力，这条守的是**声明**：真机数字（940 下 834/834、
 *    操作列右缘 = 容器右缘）由实机验收负责，这里只保证根因不再被改回去。
 *
 * ## 版本行与组行逐列对齐（#2 剩下的 32px，2026-11-26）
 * 9. 版本行栅格的**跟踪列**必须与父表 `colgroup` 逐列对上（首格吃掉「展开列 + 身份列」，
 *    尾随三列同宽同序），窄档投递列在两边一起消失；
 * 10. 两套排布的水平内边距必须引用**同一个** `--rf-group-cell-pad-x`（读 CSS 文本断言）。
 *     jsdom 量不到像素，所以第 9/10 条守的是"能用的宽度"这件事：列宽同源、内边距同源、
 *     间距不存在——三者一起成立，尾随列才可能落在同一条竖线上。
 *
 * 断言一律走 `t()`，不写死中文文案；菜单项用 `within(菜单)` 定位——菜单里有带图标的
 * 项，`getByRole("menuitem", { name })` 的可读名会把图标的 aria-label 也算进去，
 * 用文本定位更贴近用户看到的东西。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";
import { DEFAULT_GROUP_SORT_STATE, sortGroups, type GroupSortState } from "../../utils/groupSort";
import { groupResumes } from "../../features/resume/list/resumeGroups";
import { useState } from "react";
import ResumeGroupedTable from "./ResumeGroupedTable";
import { GROUP_COLUMN_WIDTHS } from "./resumeGroupLayout";

function resume(overrides: Partial<ResumeBrief> & { id: number }): ResumeBrief {
  return {
    title: `resume ${overrides.id}`,
    job_id: null,
    job_title: "",
    company: "",
    source: "manual",
    favorite: false,
    note: "",
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
    delivery_count: 0,
    ...overrides,
  };
}

/**
 * 一个 3 版本的岗位组（投递 1 次）+ 一个单版本岗位组（投递 5 次）。
 *
 * 两个组的投递次数刻意不同：点「投递」排序时行序必须真的变——只断言"点得动"是不够的。
 */
function stackedGroups() {
  return groupResumes([
    resume({
      id: 11,
      job_id: 7,
      job_title: "frontend",
      company: "acme",
      delivery_count: 1,
      updated_at: "2026-11-10T08:00:00",
    }),
    resume({
      id: 12,
      job_id: 7,
      job_title: "frontend",
      company: "acme",
      delivery_count: 1,
      updated_at: "2026-11-09T08:00:00",
    }),
    resume({
      id: 13,
      job_id: 7,
      job_title: "frontend",
      company: "acme",
      delivery_count: 1,
      updated_at: "2026-11-08T08:00:00",
    }),
    resume({
      id: 21,
      job_id: 9,
      job_title: "backend",
      company: "beta",
      delivery_count: 5,
      updated_at: "2026-11-01T08:00:00",
    }),
  ]);
}

const IDLE_BATCH: BatchSelection<number> = {
  selecting: false,
  selectedIds: new Set(),
  selectedCount: 0,
  isSelected: () => false,
  toggle: () => {},
  toggleAll: () => {},
  setSelected: () => {},
  selectPage: () => {},
  enterSelecting: () => {},
  exitSelecting: () => {},
};

const noop = () => undefined;

interface RenderOptions {
  expandedKeys?: string[];
  /** 打开组级排序回路（页面在 useResumesPageView 里做的正是这件事）。 */
  sortable?: boolean;
  onSortChange?: (next: GroupSortState) => void;
}

/** 受控外壳：页面把 `sortGroups(groups, state)` 的结果喂给表格，这里照做。 */
function Harness({ options }: { options: RenderOptions }) {
  const [sortState, setSortState] = useState<GroupSortState>(DEFAULT_GROUP_SORT_STATE);
  const [expandedKeys, setExpandedKeys] = useState<string[]>(options.expandedKeys ?? []);
  const groups = sortGroups(stackedGroups(), sortState);
  return (
    <AntdApp>
      <ResumeGroupedTable
        groups={groups}
        totalGroups={groups.length}
        resumeCount={4}
        loading={false}
        batch={IDLE_BATCH}
        favoriteResumeId={null}
        page={1}
        setPage={noop}
        pageSize={10}
        setPageSize={noop}
        toggleFavorite={vi.fn()}
        remove={vi.fn()}
        setPreviewId={noop}
        setRenameTarget={noop}
        setRenameValue={noop}
        setNoteTarget={noop}
        setNoteValue={noop}
        setDiffBase={noop}
        setDiffAgainstId={noop}
        setDiffResult={noop}
        groupSortState={sortState}
        onGroupSortChange={(next) => {
          options.onSortChange?.(next);
          setSortState(next);
        }}
        navigate={noop}
        expandedKeys={expandedKeys}
        setExpandedKeys={setExpandedKeys}
      />
    </AntdApp>
  );
}

function renderTable(options: RenderOptions = {}) {
  return render(<Harness options={options} />);
}

function rowOf(container: HTMLElement, rowKey: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`tbody tr[data-row-key="${rowKey}"]`);
  if (!row) throw new Error(`row not found: ${rowKey}`);
  return row;
}

/** 当前页的组行 key（按渲染顺序）。 */
function rowKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].map(
    (row) => row.getAttribute("data-row-key") ?? "",
  );
}

/** 右键打开菜单并返回最近一次弹出的菜单容器。 */
async function openRowMenu(target: HTMLElement): Promise<HTMLElement> {
  fireEvent.contextMenu(target);
  return waitFor(() => {
    const menus = document.querySelectorAll<HTMLElement>(".ant-dropdown");
    const menu = menus[menus.length - 1];
    if (!menu) throw new Error("context menu did not open");
    return menu;
  });
}

/** 点一次列头。 */
function clickHeader(container: HTMLElement, label: string): void {
  const header = [...container.querySelectorAll<HTMLElement>(".ant-table-thead th")].find((th) =>
    th.textContent?.includes(label),
  );
  if (!header) throw new Error(`header not found: ${label}`);
  fireEvent.click(header);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeGroupedTable 多版本组行右键", () => {
  it("出现组级菜单：展开 / 去岗位广场 / 复制，且不含删除与批量选择", async () => {
    const { container } = renderTable();
    const group = stackedGroups().find((item) => item.versionCount > 1);
    if (!group) throw new Error("fixture must contain a stacked group");

    const menu = await openRowMenu(rowOf(container, group.key));

    expect(
      within(menu).getByText(
        t("resumesPage.list.group.expandVersions", { count: group.versionCount }),
      ),
    ).toBeInTheDocument();
    expect(within(menu).getByText(t("resumesPage.list.group.openJob"))).toBeInTheDocument();
    expect(within(menu).getByText(t("resumes.copy.job"))).toBeInTheDocument();
    // CR-33：组级禁区——删除与批量选择都不能出现。
    expect(within(menu).queryByText(t("common.action.delete"))).toBeNull();
    expect(within(menu).queryByText(t("common.action.batchSelect"))).toBeNull();
  });
});

describe("ResumeGroupedTable 版本行右键", () => {
  it("展开后版本行有单条动作（含预览），但不含批量选择", async () => {
    const { container } = renderTable({ expandedKeys: ["job:7"] });
    const versionRow = container.querySelector<HTMLElement>(".resume-version-row");
    if (!versionRow) throw new Error("expanded group must render version rows");

    const menu = await openRowMenu(versionRow);

    expect(within(menu).getByText(t("resumes.list.preview"))).toBeInTheDocument();
    expect(within(menu).getByText(t("common.action.delete"))).toBeInTheDocument();
    // 多版本组不可整组勾选：版本行不给「批量选择」。
    expect(within(menu).queryByText(t("common.action.batchSelect"))).toBeNull();
  });
});

describe("ResumeGroupedTable 单版本组行右键", () => {
  it("与平铺行同一份清单：含批量选择与预览", async () => {
    const { container } = renderTable();
    const single = stackedGroups().find((item) => item.versionCount === 1);
    if (!single) throw new Error("fixture must contain a single-version group");

    const menu = await openRowMenu(rowOf(container, single.key));

    expect(within(menu).getByText(t("common.action.batchSelect"))).toBeInTheDocument();
    expect(within(menu).getByText(t("resumes.list.preview"))).toBeInTheDocument();
    // 单版本组就是一份简历：删除可以出现（右键删除仍走菜单里的二次确认）。
    expect(within(menu).getByText(t("common.action.delete"))).toBeInTheDocument();
  });
});

describe("ResumeGroupedTable 列宽声明", () => {
  it("定宽布局：身份列不写宽度（独占剩余空间），其余列写死（含展开列）", () => {
    const { container } = renderTable();
    const table = container.querySelector<HTMLTableElement>(".ant-table-content table");
    if (!table) throw new Error("grouped table not rendered");

    /**
     * 根因守卫：`auto` 布局会把每一列撑到 min-content，而身份列里的岗位名是
     * `white-space: nowrap`（要省略号），min-content 就是整串岗位名的宽度。940 视口实测
     * 被撑到 653，四列合计 968 > 容器 834，「操作」列被裁到只剩半个「展」字。
     */
    expect(table.style.tableLayout).toBe("fixed");

    const widths = [...table.querySelectorAll<HTMLTableColElement>("colgroup col")].map(
      (col) => col.style.width,
    );
    expect(widths).toEqual([
      // 展开列必须显式定宽：没有宽度的列会去瓜分剩余空间，与身份列抢同一份余量。
      `${GROUP_COLUMN_WIDTHS.expand}px`,
      // 身份列**不能**有宽度：它是唯一吸收剩余空间的列，内部靠省略号收缩。
      "",
      `${GROUP_COLUMN_WIDTHS.updated}px`,
      `${GROUP_COLUMN_WIDTHS.delivery}px`,
      `${GROUP_COLUMN_WIDTHS.actions}px`,
    ]);
  });
});

describe("ResumeGroupedTable 列头三态排序", () => {
  it("默认态三列都不带排序箭头", () => {
    const { container } = renderTable();

    // 默认排序是接口缺省行为，不是用户的选择：给它加箭头会让表头永远高亮。
    expect(container.querySelectorAll("th.ant-table-column-sort")).toHaveLength(0);
  });

  it("点「投递」按组内投递次数重排，展开的组仍带着自己的版本行", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable({ expandedKeys: ["job:7"], onSortChange });
    const before = rowKeys(container);
    // 默认（最近更新倒序）：刚更新过的 job:7 在前。
    expect(before[0]).toBe("job:7");

    clickHeader(container, t("resumes.list.column.delivery"));

    // 一次点击 = 该列的默认方向（投递默认降序）：5 次的单版本组排到前面。
    expect(onSortChange).toHaveBeenCalledWith({
      field: "delivery",
      order: "desc",
      explicit: true,
    });
    const after = rowKeys(container);
    expect(after).not.toEqual(before);
    expect(after[0]).toBe("job:9");
    // 展开状态不因排序丢失：组行下面仍然挂着版本行。
    expect(container.querySelectorAll(".resume-version-row")).toHaveLength(3);
  });

  it("排序不穿透版本层：组内仍是时间倒序（最新在上）", () => {
    const { container } = renderTable({ expandedKeys: ["job:7"] });

    clickHeader(container, t("resumes.list.column.delivery"));

    // 版本行的第一列写着版本号：最新（第 3 版）必须仍在最上面。
    const labels = [...container.querySelectorAll(".resume-version-index")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      t("resumes.list.versionLabel", { index: 3 }),
      t("resumes.list.versionLabel", { index: 2 }),
      t("resumes.list.versionLabel", { index: 1 }),
    ]);
  });

  it("点第三次取消排序，回到默认态", () => {
    const onSortChange = vi.fn();
    const { container } = renderTable({ onSortChange });

    clickHeader(container, t("resumes.list.column.delivery"));
    expect(container.querySelectorAll("th.ant-table-column-sort")).toHaveLength(1);

    clickHeader(container, t("resumes.list.column.delivery"));
    expect(onSortChange).toHaveBeenLastCalledWith({
      field: "delivery",
      order: "asc",
      explicit: true,
    });

    clickHeader(container, t("resumes.list.column.delivery"));
    // 第三次 = 取消：回默认态，箭头消失（页面上「恢复默认排序」也随之不再渲染）。
    expect(onSortChange).toHaveBeenLastCalledWith(DEFAULT_GROUP_SORT_STATE);
    expect(container.querySelectorAll("th.ant-table-column-sort")).toHaveLength(0);
  });

  it("分页文案同时给出岗位数与简历数", () => {
    const { container } = renderTable();

    expect(
      container.textContent?.includes(
        t("resumesPage.list.totalGroups", { groups: 2, resumes: 4 }),
      ),
    ).toBe(true);
  });
});

/**
 * jsdom 的 `matchMedia` 桩恒返回 `matches: false`（`src/test/setup.ts`），也就是"宽档"。
 * 窄档要单独打开：只让 `max-width` 查询命中，其它（颜色偏好等）维持 false。
 */
function stubNarrow(): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  return () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
  };
}

/** 按**顶层**空格切分 `grid-template-columns`（`minmax(0,1fr)` 括号里的空格不算分隔）。 */
function splitTracks(template: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of template) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === " " && depth === 0) {
      if (current) tracks.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tracks.push(current);
  // jsdom 会把 `minmax(0,1fr)` 序列化成 `minmax(0px, 1fr)`：比之前先去空白。
  return tracks.map((track) => track.replace(/\s+/g, ""));
}

/** 版本行栅格的跟踪列 vs 父表 `colgroup`：这条是 32px 偏差的直接守卫。 */
function expectVersionTracksMatchTable(container: HTMLElement): void {
  const table = container.querySelector<HTMLTableElement>(".ant-table-content table");
  if (!table) throw new Error("grouped table not rendered");
  const columnWidths = [...table.querySelectorAll<HTMLTableColElement>("colgroup col")].map(
    (col) => col.style.width,
  );
  const versionRow = container.querySelector<HTMLElement>(".resume-version-row");
  if (!versionRow) throw new Error("expanded group must render version rows");
  const tracks = splitTracks(versionRow.style.gridTemplateColumns || "");

  // 父表第 1 列是展开箭头（定宽），第 2 列是身份列（不写宽度、吃剩余空间）：
  // 版本行把这两列并进首格，1fr 才和父表算出同一个宽度。
  expect(tracks[0]).toMatch(/^minmax\(0(px)?,1fr\)$/);
  expect(columnWidths[1]).toBe("");
  // 尾随列同宽同序（窄档投递列在两边一起消失，所以按父表实际列数比，不写死 4/5）。
  expect(tracks.slice(1)).toEqual(columnWidths.slice(2));
  expect(tracks).toHaveLength(columnWidths.length - 1);
  // 格子数必须等于跟踪列数：多一个格子会落到隐式跟踪列上，右侧整体左移。
  expect(versionRow.children.length).toBe(tracks.length);
}

/** 版本行里每一格的语义标记（按 DOM 顺序），用于核对"格子顺序 == 跟踪列顺序"。 */
function versionCellMarkers(versionRow: HTMLElement): string[] {
  const names = ["leading", "time", "delivery", "actions"];
  return [...versionRow.children].map((child) => {
    const hit = names.find((name) => child.classList.contains(`resume-version-${name}`));
    return hit ?? "unknown";
  });
}

describe("ResumeGroupedTable 版本行与组行逐列对齐", () => {
  it("宽档：尾随三列与父表同宽同序，投递占位占住父表投递列", () => {
    const { container } = renderTable({ expandedKeys: ["job:7"] });

    expectVersionTracksMatchTable(container);
    const versionRow = container.querySelector<HTMLElement>(".resume-version-row");
    if (!versionRow) throw new Error("expanded group must render version rows");
    expect(versionCellMarkers(versionRow)).toEqual(["leading", "time", "delivery", "actions"]);
  });

  it("窄档：投递列在父表与版本行一起消失，不留下 0 宽的跟踪列", () => {
    const restore = stubNarrow();
    try {
      const { container } = renderTable({ expandedKeys: ["job:7"] });

      // 留一个 0px 的空跟踪列不会"看不见"：它后面的格子会被挤到错误的跟踪列上，
      // 操作列因此整体左移（真机 940 视口实测 32px 的一部分）。
      expect(container.querySelector(".resume-version-delivery")).toBeNull();
      expectVersionTracksMatchTable(container);
    } finally {
      restore();
    }
  });
});

