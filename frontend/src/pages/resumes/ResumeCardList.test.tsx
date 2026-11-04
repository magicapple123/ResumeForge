// SPDX-License-Identifier: Apache-2.0
/**
 * 简历卡片视图的动作清单（问题 26a）。
 *
 * 病根不是"没有右键"，而是**动作清单有两份**：表格视图 5 项（含「对比」、删除走菜单内
 * 二次确认），卡片视图手写 3 项（缺「对比」、删除另开 Popconfirm）。所以这里钉的是
 * "两个视图同一份清单"，而不只是"卡片上也能右键"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";
import { DEFAULT_RESUME_SORT_STATE } from "../../utils/resumeSort";
import ResumeCardList from "./ResumeCardList";
import { secondaryActionsFor, type RowActionDeps } from "./resumeTableActions";

const RESUME: ResumeBrief = {
  id: 8,
  title: "制造工程师岗位简历",
  job_id: 3,
  job_title: "制造工程师",
  company: "示例制造企业",
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
  created_at: "2026-08-20T02:00:00",
  updated_at: "2026-08-21T09:30:00",
};

const SELECTING_BATCH: BatchSelection<number> = {
  selecting: true,
  selectedIds: new Set([8]),
  selectedCount: 1,
  isSelected: () => true,
  toggle: () => {},
  toggleAll: () => {},
  setSelected: () => {},
  selectPage: () => {},
  enterSelecting: () => {},
  exitSelecting: () => {},
};

const IDLE_BATCH: BatchSelection<number> = {
  ...SELECTING_BATCH,
  selecting: false,
  selectedIds: new Set(),
  selectedCount: 0,
  isSelected: () => false,
};

function Harness({
  batch = IDLE_BATCH,
  setPreviewId = vi.fn(),
}: {
  batch?: BatchSelection<number>;
  setPreviewId?: (id: number | null) => void;
}) {
  return (
    <AntdApp>
      <ResumeCardList
        data={{ items: [RESUME], total: 1 }}
        loading={false}
        batch={batch}
        favoriteResumeId={null}
        page={1}
        setPage={() => {}}
        pageSize={20}
        setPageSize={() => {}}
        toggleFavorite={async () => {}}
        remove={async () => {}}
        setPreviewId={setPreviewId}
        setRenameTarget={() => {}}
        setRenameValue={() => {}}
        setNoteTarget={() => {}}
        setNoteValue={() => {}}
        setDiffBase={() => {}}
        setDiffAgainstId={() => {}}
        setDiffResult={() => {}}
        sortState={DEFAULT_RESUME_SORT_STATE}
        onSortChange={() => {}}
      />
    </AntdApp>
  );
}

/** 与卡片同一份依赖形状：用来算"期望的菜单项文案"。 */
function expectedLabels(): string[] {
  const deps: RowActionDeps = {
    setPreviewId: vi.fn(),
    setRenameTarget: vi.fn(),
    setRenameValue: vi.fn(),
    setNoteTarget: vi.fn(),
    setNoteValue: vi.fn(),
    setDiffBase: vi.fn(),
    setDiffAgainstId: vi.fn(),
    setDiffResult: vi.fn(),
    toggleFavorite: async () => {},
    remove: async () => {},
  };
  return secondaryActionsFor(RESUME, deps).map((item) => item.label);
}

const menuLabels = () => screen.getAllByRole("menuitem").map((node) => node.textContent ?? "");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("简历卡片视图与表格视图共用一份动作清单（26a）", () => {
  it("⋯ 菜单的五项与表格行菜单同源（含「对比」与「删除」）", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: t("common.rowActions.more") }));

    expect(menuLabels()).toEqual(expectedLabels());
    expect(menuLabels()).toHaveLength(5);
  });

  it("整卡右键弹出同一份菜单", async () => {
    const { container } = render(<Harness />);
    const card = container.querySelector(".resume-card");
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card as HTMLElement, { clientX: 60, clientY: 80 });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(menuLabels()).toEqual(expectedLabels());
  });

  it("右键不触发卡片的预览（右键不是左键）", () => {
    const setPreviewId = vi.fn();
    const { container } = render(<Harness setPreviewId={setPreviewId} />);
    fireEvent.contextMenu(container.querySelector(".resume-card") as HTMLElement, {
      clientX: 10,
      clientY: 10,
    });
    expect(setPreviewId).not.toHaveBeenCalled();
  });

  it("多选模式下不接管右键（批量入口在工具栏，交给浏览器原生菜单）", () => {
    const { container } = render(<Harness batch={SELECTING_BATCH} />);
    const card = container.querySelector(".resume-card") as HTMLElement;

    // `fireEvent.contextMenu` 返回 false 表示原生菜单被拦掉了。
    expect(fireEvent.contextMenu(card, { clientX: 10, clientY: 10 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
