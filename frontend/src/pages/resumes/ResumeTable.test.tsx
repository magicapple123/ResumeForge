// SPDX-License-Identifier: Apache-2.0
/** 简历表格（R14-b / T2 排序 / T3 目标岗位列宽）。

 * 直接渲染表格而不是整个页面：这些事都只跟列定义有关，走页面会把列表请求、
 * 岗位筛选等无关依赖一起拖进来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { useBatchSelection, type BatchSelection } from "../../hooks/useBatchSelection";
import type { RowActionItem } from "../../components/common/RowActions";
import type { ResumeBrief } from "../../types";
import { DEFAULT_RESUME_SORT_STATE, type ResumeSortState } from "../../utils/resumeSort";
import ResumeTable from "./ResumeTable";

// 与 `styles/color-regression.test.ts` 同一套写法：从磁盘读源码原文（jsdom 看得到 DOM，
// 看不到"某个 prop 有没有被传"）。
declare const process: { cwd(): string };

const RESUME: ResumeBrief = {
  id: 8,
  title: "制造工程师岗位简历（含完整项目经历与技能清单，标题故意写得很长以便触发省略）",
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

/** 多选态固定桩：本文件只验"右键菜单换成了批量动作"，不重跑勾选逻辑。 */
const SELECTING_BATCH: BatchSelection<number> = {
  selecting: true,
  selectedIds: new Set([1]),
  selectedCount: 1,
  isSelected: () => true,
  toggle: () => {},
  toggleAll: () => {},
  setSelected: () => {},
  selectPage: () => {},
  enterSelecting: () => {},
  exitSelecting: () => {},
};

function Harness({
  item,
  sortState = DEFAULT_RESUME_SORT_STATE,
  onSortChange = () => {},
  selecting = false,
  batchActions = [],
}: {
  item: ResumeBrief;
  sortState?: ResumeSortState;
  onSortChange?: (next: ResumeSortState) => void;
  selecting?: boolean;
  batchActions?: RowActionItem[];
}) {
  const hookBatch = useBatchSelection<number>();
  const batch = selecting ? SELECTING_BATCH : hookBatch;
  return (
    <AntdApp>
      <ResumeTable
        data={{ items: [item], total: 1 }}
        loading={false}
        batch={batch}
        favoriteResumeId={null}
        page={1}
        setPage={() => {}}
        pageSize={20}
        setPageSize={() => {}}
        toggleFavorite={async () => {}}
        remove={async () => {}}
        setPreviewId={() => {}}
        setRenameTarget={() => {}}
        setRenameValue={() => {}}
        setNoteTarget={() => {}}
        setNoteValue={() => {}}
        setDiffBase={() => {}}
        setDiffAgainstId={() => {}}
        setDiffResult={() => {}}
        sortState={sortState}
        onSortChange={onSortChange}
        navigate={() => {}}
        batchActions={batchActions}
      />
    </AntdApp>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeTable 标题列（R14-b）", () => {
  it("给出宽度下限并省略，且不再有悬停提示", async () => {
    render(<Harness item={RESUME} />);
    const cell = await screen.findByRole("columnheader", { name: "简历标题" });

    // 列级 ellipsis 才会把整表切成 table-layout: fixed，宽度提示才生效。
    expect(cell.className).toContain("ant-table-cell-ellipsis");
    // antd 把列宽写在 colgroup 里（第 2 列是简历标题），1080px 下不再被压成一个字宽。
    expect(document.querySelectorAll("colgroup col")[1]).toHaveStyle({ width: "220px" });

    const title = screen.getByRole("button", { name: RESUME.title });
    expect(title).toHaveStyle({ textOverflow: "ellipsis", overflow: "hidden" });

    // 2026-11 用户要求去掉标题的悬停提示：鼠标扫过列表时那个黑框会挡住相邻行，
    // 而"看完整标题"已经由点击打开预览满足。antd 的 Tooltip 是克隆子节点 + 挂事件，
    // 不改变 DOM 结构，所以这里读源码守住"别再包回去"。
    fireEvent.mouseEnter(title);
    const source = readFileSync(
      [process.cwd(), "src", "pages", "resumes", "ResumeTable.tsx"].join("/"),
      "utf8",
    );
    expect(source).not.toContain("title={record.title}");
  });
});

describe("ResumeTable 最近修改列（R14-b）", () => {
  it("展示后端返回的 updated_at", async () => {
    render(<Harness item={RESUME} />);

    const header = await screen.findByRole("columnheader", { name: "最近修改" });
    expect(header).toBeInTheDocument();
    const row = document.querySelector("tbody tr.ant-table-row") as HTMLElement;
    // 只断言日期：时刻会随运行机器的时区变化。
    expect(within(row).getByText(/2026-08-21/)).toBeInTheDocument();
  });

  it("后端没给 updated_at（旧数据/别的投影）时显示占位符，不显示 NaN 或空单元格", async () => {
    render(<Harness item={{ ...RESUME, updated_at: null }} />);

    const row = (await screen.findByRole("button", { name: RESUME.title })).closest("tr");
    expect(within(row as HTMLElement).getByText("—")).toBeInTheDocument();
  });
});

describe("ResumeTable 横向滚动区（a11y）", () => {
  /** 标题列固定 220px + 最近修改列会让表格宽于容器，antd 用 `.ant-table-content`
   *  承载横向滚动——但它自己不加 tabindex。键盘用户因此滚不到被裁掉的列，
   *  axe 的 `scrollable-region-focusable`（WCAG 2.1.1）会判 serious。
   *  这条只在真实浏览器的冒烟里会红（jsdom 不算布局），所以在这里把"补 tabindex
   *  和 role/aria-label"这件事钉住，避免以后有人把那个 effect 当成多余代码删掉。 */
  it("把 antd 的滚动容器补成可聚焦区域", async () => {
    render(<Harness item={RESUME} />);
    await screen.findByRole("button", { name: RESUME.title });

    const scroller = document.querySelector(".ant-table-content");
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveAttribute("role", "region");
    expect(scroller).toHaveAttribute("aria-label", "简历列表（可横向滚动）");
  });
});

describe("ResumeTable 目标岗位列（T3）", () => {
  it("给出 200px 列宽并省略，长岗位名不会把整表撑宽", async () => {
    const longJob = {
      ...RESUME,
      job_title: "高级制造工艺工程师（新能源电池模组装配线方向，含海外工厂派驻）",
      company: "某某某某某某某某某某某某某某某某股份有限公司",
    };
    render(<Harness item={longJob} />);

    const header = await screen.findByRole("columnheader", { name: "目标岗位" });
    // 列级 ellipsis 是"整表切 fixed 布局"的开关：没有它，width 只是建议值。
    expect(header.className).toContain("ant-table-cell-ellipsis");
    // antd 把列宽写进 colgroup（第 3 列是目标岗位）。
    expect(document.querySelectorAll("colgroup col")[2]).toHaveStyle({ width: "200px" });

    // 两个 Tag 都带上了"自己收敛"的类，长文本靠 CSS 省略而不是撑宽单元格。
    const jobTag = screen.getByText(longJob.job_title);
    expect(jobTag).toHaveClass("resume-job-tag");
    expect(screen.getByText(longJob.company)).toHaveClass("resume-company-tag");
  });
});

describe("ResumeTable 列头排序（T2）", () => {
  /** 点某列列头。表头标题在 antd 6 里会出现多份（测量/克隆节点），统一点 `<th>` 本体。 */
  function clickHeader(label: string) {
    const title = screen.getAllByText(label)[0]!;
    const th = title.closest("th");
    expect(th).toBeTruthy();
    fireEvent.click(th as HTMLElement);
  }

  it("默认态没有任何列头点亮箭头", async () => {
    const { container } = render(<Harness item={RESUME} />);
    await screen.findByRole("columnheader", { name: "简历标题" });

    expect(container.querySelector(".ant-table-column-sort")).toBeNull();
  });

  it("三态：升序 → 降序 → 取消回默认", async () => {
    // 受控组件：每次点击都用"当前状态"重新渲染，模拟页面的 setState 往返。
    const asc = vi.fn();
    const first = render(<Harness item={RESUME} onSortChange={asc} />);
    await screen.findByRole("columnheader", { name: "简历标题" });
    clickHeader("简历标题");
    expect(asc).toHaveBeenLastCalledWith({ field: "title", order: "asc", explicit: true });
    first.unmount();

    const desc = vi.fn();
    const second = render(
      <Harness
        item={RESUME}
        sortState={{ field: "title", order: "asc", explicit: true }}
        onSortChange={desc}
      />,
    );
    await screen.findByRole("columnheader", { name: "简历标题" });
    clickHeader("简历标题");
    expect(desc).toHaveBeenLastCalledWith({ field: "title", order: "desc", explicit: true });
    second.unmount();

    // 第三次点击（antd 给出 order=null）→ 回默认排序：没有箭头、也不写 URL。
    const reset = vi.fn();
    render(
      <Harness
        item={RESUME}
        sortState={{ field: "title", order: "desc", explicit: true }}
        onSortChange={reset}
      />,
    );
    await screen.findByRole("columnheader", { name: "简历标题" });
    clickHeader("简历标题");
    expect(reset).toHaveBeenLastCalledWith(DEFAULT_RESUME_SORT_STATE);
  });

  it("命中的列才带箭头（升序在 up 侧点亮）", async () => {
    render(<Harness item={RESUME} sortState={{ field: "title", order: "asc", explicit: true }} />);

    const header = await screen.findByRole("columnheader", { name: "简历标题" });
    expect(header.className).toContain("ant-table-column-sort");
    expect(header.querySelector(".ant-table-column-sorter-up")).toHaveClass("active");
    // 其它三列不受影响。
    const updated = screen.getByRole("columnheader", { name: "最近修改" });
    expect(updated.className).not.toContain("ant-table-column-sort");
  });

  it("「目标岗位」列映射到 job_title_*（不是 title_*）", async () => {
    const onSortChange = vi.fn();
    render(<Harness item={RESUME} onSortChange={onSortChange} />);
    await screen.findByRole("columnheader", { name: "目标岗位" });

    clickHeader("目标岗位");

    expect(onSortChange).toHaveBeenLastCalledWith({
      field: "job_title",
      order: "asc",
      explicit: true,
    });
  });
});

describe("ResumeTable 多选态右键", () => {
  it("菜单只给批量动作，不再混入单行的编辑/删除", async () => {
    const onExport = vi.fn();
    render(
      <Harness
        item={RESUME}
        selecting
        batchActions={[{ key: "bulk_export", label: "Bulk export", onClick: onExport }]}
      />,
    );

    const title = await screen.findByText(RESUME.title);
    fireEvent.contextMenu(title.closest("tr") as HTMLElement);

    expect(await screen.findByText("Bulk export")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /批量选择/ })).toBeNull();
    fireEvent.click(screen.getByText("Bulk export"));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
