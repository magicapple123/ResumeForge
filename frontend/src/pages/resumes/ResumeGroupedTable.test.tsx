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
