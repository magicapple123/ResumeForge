// SPDX-License-Identifier: Apache-2.0
/**
 * 折叠表的多选口径（2026-11-26，R1 三态整组 + R4 跨页不丢 + R3 版本行批量入口）。
 *
 * 与 `ResumeGroupedTable.test.tsx` 分开住：那份守的是菜单与列宽声明，这份守的是
 * **选区语义**——两件事的失败方式完全不同（前者是"看起来没排过版"，后者是"勾了会丢"）。
 *
 * 四条：
 * 1. 勾组行 = 勾上这一组的**每一份**简历（多版本组不再被排除）；
 * 2. 版本行勾一部分 → 组行半选（且**不加**底色，只由勾选框表达）；
 * 3. 跨页累加不丢（R4 的真 bug：`onChange` 只回传 dataSource 里存在的 key，
 *    用 `setSelected(keys)` 会把别的页的选区整批扔掉）；
 * 4. 版本行右键的「批量选择」真的进入多选（R3），且「在岗位广场打开」调的是 navigate（R25）。
 *
 * 断言一律走 `t()`，不写死中文。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";
import { DEFAULT_GROUP_SORT_STATE } from "../../utils/groupSort";
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
 * 两页数据：第 1 页 = 岗位 7（2 个版本）+ 岗位 9（1 份）；第 2 页 = 岗位 11（1 份）。
 * 总 4 份简历。这样"第 1 页勾 2 组 + 第 2 页勾 1 组 = 4 份"能被逐份核对。
 */
const PAGE_GROUPS = [
  groupResumes([
    resume({ id: 71, job_id: 7, job_title: "frontend", updated_at: "2026-11-10T08:00:00" }),
    resume({ id: 72, job_id: 7, job_title: "frontend", updated_at: "2026-11-09T08:00:00" }),
    resume({ id: 91, job_id: 9, job_title: "backend", updated_at: "2026-11-08T08:00:00" }),
  ]),
  groupResumes([
    resume({ id: 111, job_id: 11, job_title: "mobile", updated_at: "2026-11-07T08:00:00" }),
  ]),
];

const noop = () => undefined;

/** 受控外壳：真 `useBatchSelection` + 真翻页（跨页用例必须同时具备这两个）。 */
function Harness({ expandedKeys = [] as string[], onNavigate = noop as (p: string) => void }) {
  const batch = useBatchSelection<number>();
  const [page, setPage] = useState(0);
  const groups = PAGE_GROUPS[page];
  const [expanded, setExpanded] = useState<string[]>(expandedKeys);
  return (
    <AntdApp>
      <button type="button" onClick={batch.enterSelecting}>
        enter-selecting
      </button>
      <button type="button" onClick={() => setPage((current) => (current + 1) % 2)}>
        flip-page
      </button>
      <output data-testid="count">{batch.selectedCount}</output>
      <ResumeGroupedTable
        groups={groups}
        totalGroups={4}
        resumeCount={4}
        loading={false}
        batch={batch}
        favoriteResumeId={null}
        page={page + 1}
        setPage={noop}
        pageSize={2}
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
        groupSortState={DEFAULT_GROUP_SORT_STATE}
        onGroupSortChange={noop}
        navigate={onNavigate}
        expandedKeys={expanded}
        setExpandedKeys={setExpanded}
      />
    </AntdApp>
  );
}

function rowCheckbox(container: HTMLElement, rowKey: string): HTMLElement {
  const input = container.querySelector<HTMLElement>(
    `tbody tr[data-row-key="${rowKey}"] .ant-checkbox-input`,
  );
  if (!input) throw new Error(`checkbox not found for ${rowKey}`);
  return input;
}

function selectedCount(): number {
  return Number(screen.getByTestId("count").textContent ?? "0");
}

/** 版本行的勾选框（每次重查：antd 的 Checkbox 在受控重渲染下可能换掉节点）。 */
function versionCheckboxes(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>(".resume-version-check input")];
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeGroupedTable 三态整组勾选（R1）", () => {
  it("勾组行 = 勾上整组每一份；再点一次整组清空", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("enter-selecting"));
    await waitFor(() => expect(rowCheckbox(container, "job:7")).toBeTruthy());

    fireEvent.click(rowCheckbox(container, "job:7"));
    // 岗位 7 有 2 个版本 → 勾一行进来 2 份（不是 1 份）。
    await waitFor(() => expect(selectedCount()).toBe(2));

    fireEvent.click(rowCheckbox(container, "job:7"));
    await waitFor(() => expect(selectedCount()).toBe(0));
  });

  it("版本行勾一部分 → 组行半选；勾满 → 组行全选", async () => {
    const { container } = render(<Harness expandedKeys={["job:7"]} />);
    fireEvent.click(screen.getByText("enter-selecting"));

    expect(versionCheckboxes(container)).toHaveLength(2);

    fireEvent.click(versionCheckboxes(container)[0]);
    await waitFor(() => expect(selectedCount()).toBe(1));
    // 半选是"过程态"：只在勾选框上表达（indeterminate），组行**不加**底色。
    const groupBox = container.querySelector(
      'tbody tr[data-row-key="job:7"] .ant-checkbox',
    ) as HTMLElement;
    expect(groupBox.className).toContain("ant-checkbox-indeterminate");
    expect(
      (container.querySelector('tbody tr[data-row-key="job:7"]') as HTMLElement).className,
    ).not.toContain("ant-table-row-selected");

    fireEvent.click(versionCheckboxes(container)[1]);
    await waitFor(() => expect(selectedCount()).toBe(2));
    expect(
      (container.querySelector('tbody tr[data-row-key="job:7"]') as HTMLElement).className,
    ).toContain("ant-table-row-selected");
  });
});

describe("ResumeGroupedTable 跨页勾选（R4）", () => {
  it("第 1 页勾 2 组 + 第 2 页勾 1 组 = 4 份，翻回来选区还在", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("enter-selecting"));

    fireEvent.click(rowCheckbox(container, "job:7"));
    await waitFor(() => expect(selectedCount()).toBe(2));
    fireEvent.click(rowCheckbox(container, "job:9"));
    await waitFor(() => expect(selectedCount()).toBe(3));

    // 翻到第 2 页：第 1 页的选区必须留着（R4 的 bug 就丢在这里）。
    fireEvent.click(screen.getByText("flip-page"));
    await waitFor(() => expect(rowCheckbox(container, "job:11")).toBeTruthy());
    expect(selectedCount()).toBe(3);

    fireEvent.click(rowCheckbox(container, "job:11"));
    await waitFor(() => expect(selectedCount()).toBe(4));

    // 翻回第 1 页：两组的勾选框应当仍是勾上的（由 selectedIds 反推，不是本地状态）。
    fireEvent.click(screen.getByText("flip-page"));
    await waitFor(() => expect(rowCheckbox(container, "job:7")).toBeTruthy());
    expect((rowCheckbox(container, "job:7") as HTMLInputElement).checked).toBe(true);
    expect((rowCheckbox(container, "job:9") as HTMLInputElement).checked).toBe(true);
  });

  it("选区摘要说清「N 份（含 M 个整组岗位）」", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("enter-selecting"));
    fireEvent.click(rowCheckbox(container, "job:7"));

    await waitFor(() =>
      expect(
        container.textContent?.includes(
          t("resumesPage.list.group.selectionSummary", { count: 2, groups: 1 }),
        ),
      ).toBe(true),
    );
  });
});

describe("ResumeGroupedTable 版本行入口（R3 / R25）", () => {
  async function openVersionMenu(container: HTMLElement): Promise<HTMLElement> {
    const versionRow = container.querySelector<HTMLElement>(".resume-version-row");
    if (!versionRow) throw new Error("expanded group must render version rows");
    fireEvent.contextMenu(versionRow);
    return waitFor(() => {
      const menus = document.querySelectorAll<HTMLElement>(".ant-dropdown");
      const menu = menus[menus.length - 1];
      if (!menu) throw new Error("context menu did not open");
      return menu;
    });
  }

  it("版本行右键的「批量选择」进入多选，且该版本处于已选", async () => {
    const { container } = render(<Harness expandedKeys={["job:7"]} />);
    const menu = await openVersionMenu(container);

    fireEvent.click(within(menu).getByText(t("common.action.batchSelect")));

    // 点的是"第 2 版"（列表第一行 = 最新那版，id 71）。
    await waitFor(() => expect(selectedCount()).toBe(1));
    const firstVersion = container.querySelector<HTMLInputElement>(".resume-version-check input");
    expect(firstVersion?.checked).toBe(true);
  });

  it("「在岗位广场打开」复用页面的 navigate（不再是左键链接）", async () => {
    const onNavigate = vi.fn();
    const { container } = render(<Harness expandedKeys={["job:7"]} onNavigate={onNavigate} />);
    const menu = await openVersionMenu(container);

    fireEvent.click(within(menu).getByText(t("resumesPage.list.group.openJob")));

    expect(onNavigate).toHaveBeenCalledWith("/jobs?job_id=7");
  });
});
