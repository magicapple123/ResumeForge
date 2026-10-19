/** 简历表格（R14-b）：标题列宽度与省略、最近修改列。

 * 直接渲染表格而不是整个页面：这两件事都只跟列定义有关，走页面会把列表请求、
 * 岗位筛选等无关依赖一起拖进来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import type { ResumeBrief } from "../../types";
import ResumeTable from "./ResumeTable";

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

function Harness({ item }: { item: ResumeBrief }) {
  const batch = useBatchSelection<number>();
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
        navigate={() => {}}
      />
    </AntdApp>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeTable 标题列（R14-b）", () => {
  it("给出宽度下限并省略，悬停能看到完整标题", async () => {
    render(<Harness item={RESUME} />);
    const cell = await screen.findByRole("columnheader", { name: "简历标题" });

    // 列级 ellipsis 才会把整表切成 table-layout: fixed，宽度提示才生效。
    expect(cell.className).toContain("ant-table-cell-ellipsis");
    // antd 把列宽写在 colgroup 里（第 2 列是简历标题），1080px 下不再被压成一个字宽。
    expect(document.querySelectorAll("colgroup col")[1]).toHaveStyle({ width: "220px" });

    const title = screen.getByRole("button", { name: RESUME.title });
    expect(title).toHaveStyle({ textOverflow: "ellipsis", overflow: "hidden" });

    fireEvent.mouseEnter(title);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(RESUME.title);
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
