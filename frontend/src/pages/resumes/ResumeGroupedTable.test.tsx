// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠视图（按岗位分组）的整行右键守卫（2026-11-26，问题 1）。
 *
 * 这张表此前**一个测试都没有**：新视图 + 无测试 = 整行右键与列头排序的回归没有任何
 * 闸门能拦住。三条用例按"行类型"分派，正好对应三种不同的菜单口径：
 *
 * 1. 多版本组行：出现菜单，且**不含**删除 / 批量选择（CR-33 禁止组级破坏性动作）；
 * 2. 版本行：出现单条动作（含「预览」），但**不含**批量选择；
 * 3. 单版本组行：与平铺行同一份清单，含「批量选择」。
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
import { DEFAULT_RESUME_SORT_STATE } from "../../utils/resumeSort";
import { groupResumes } from "../../features/resume/list/resumeGroups";
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

/** 一个 3 版本的岗位组 + 一个单版本岗位组。 */
function stackedGroups() {
  return groupResumes([
    resume({ id: 11, job_id: 7, job_title: "frontend", company: "acme" }),
    resume({ id: 12, job_id: 7, job_title: "frontend", company: "acme" }),
    resume({ id: 13, job_id: 7, job_title: "frontend", company: "acme" }),
    resume({ id: 21, job_id: 9, job_title: "backend", company: "beta" }),
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

function renderTable(options: { expandedKeys?: string[] } = {}) {
  const groups = stackedGroups();
  const result = render(
    <AntdApp>
      <ResumeGroupedTable
        groups={groups}
        totalGroups={groups.length}
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
        sortState={DEFAULT_RESUME_SORT_STATE}
        onSortChange={noop}
        navigate={noop}
        expandedKeys={options.expandedKeys ?? []}
        setExpandedKeys={noop}
      />
    </AntdApp>,
  );
  return { ...result, groups };
}

function rowOf(container: HTMLElement, rowKey: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`tbody tr[data-row-key="${rowKey}"]`);
  if (!row) throw new Error(`row not found: ${rowKey}`);
  return row;
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
