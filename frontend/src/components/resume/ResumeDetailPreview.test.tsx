// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览：**「写作增强」页签必须真的够得着**。
 *
 * 这条用例防的是一类很隐蔽的失效：`ResumeEditorModal` 的「写作增强」页签只在拿到
 * `resumeId` 时才挂载，而后端、面板组件、接口、README 与使用指南早就都齐了——
 * 唯独**调用点没有把简历 id 传进去**。于是功能"存在"却在界面上点不到，用户问到
 * 助手时只能得到"暂不可达"。组件级测试抓不到这种断链，必须在**调用点**这一层钉住。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeDetail, ResumeLayout } from "../../types";
import ResumeDetailPreview from "./ResumeDetailPreview"; // 预览是真的 iframe + 量高，与本用例无关，替掉以免拖慢/拖挂。

// 与 `styles/color-regression.test.ts` 同一套写法：从磁盘读 CSS 原文（jsdom 不求值网格位置）。
declare const process: { cwd(): string };
// 预览本身由 ResumePreview.test.tsx 覆盖；这里把它替成一个**只做插槽接线**的桩：
// 两个具名插槽（结构类 / 度量类）原样渲染出来，好让"调用点有没有把两组喂进去"被钉住。
// 桩不再提供"点中某一栏"的按钮——预览的点击编辑已于 2026-10-21 整块去掉。
vi.mock("../ResumePreview", () => ({
  default: ({
    templateControls,
    measureControls,
    previewMode,
    onPreviewModeChange,
    exactPreview,
  }: {
    templateControls?: ReactNode;
    measureControls?: ReactNode;
    previewMode?: string;
    onPreviewModeChange?: (mode: "draft" | "exact") => void;
    exactPreview?: { resumeId: number };
  }) => (
    <div>
      <div data-testid="toolbar-template-slot">{templateControls}</div>
      <div data-testid="toolbar-measure-slot">{measureControls}</div>
      <div data-testid="preview-mode">{previewMode ?? "draft"}</div>
      <div data-testid="preview-exact-resume">{exactPreview?.resumeId ?? ""}</div>
      <button type="button" onClick={() => onPreviewModeChange?.("exact")}>
        切到精确
      </button>
    </div>
  ),
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
// 工具栏两行的两组控件：P2 起由具名插槽渲染（不再经过 `ResumeLayoutControls` 壳）。
// 这里给它们各自一句可辨认的文案，配合上面的插槽桩判断"组长有没有被接上"。
vi.mock("./ResumeTemplateControls", () => ({ default: () => <span>结构类版式控件</span> }));
vi.mock("./ResumeMeasureControls", () => ({ default: () => <span>度量类版式控件</span> }));
// 导出按钮渲染成真按钮：footer 的"左确认 / 右导出"顺序断言需要一个可定位的导出节点
// （`导出选项` 是弹出面板里的另一个文案，不会撞）。
vi.mock("../ExportButtons", () => ({ default: () => <button type="button">导出</button> }));

const DETAIL: ResumeDetail = {
  id: 42,
  title: "后端开发-示例科技",
  job_id: 7,
  job_title: "后端开发",
  company: "示例科技",
  source: "ai",
  favorite: false,
  note: "",
  model: "demo-model",
  enhancement_enabled: false,
  enhancement_level: "balanced",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-09-20T08:00:00",
  content: {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "后端开发",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  },
  warnings: [],
  parse_error: "",
  rationale: "",
  parent_revision_id: null,
  coverage_notes: [],
};

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

function renderPreview(extraActions?: ReactNode) {
  const previewRef = { current: null };
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={DETAIL}
          html="<html></html>"
          layout={LAYOUT}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={previewRef}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={vi.fn()}
          extraActions={extraActions}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeDetailPreview 的「手动调整」", () => {
  it("打开整份编辑器后能拿到「写作增强」页签", async () => {
    renderPreview();

    fireEvent.click(await screen.findByRole("button", { name: /手动调整/ }));

    // 页签出现 = 调用点确实把简历 id 传给了编辑弹窗；没传的话这里会一直找不到。
    expect(await screen.findByText("写作增强")).toBeInTheDocument();
  });
});

describe("ResumeDetailPreview 的工具栏两行插槽", () => {
  /**
   * 断链守卫（与文件头同一个理由）：`ResumePreview` 的两个插槽是**具名的**，调用点漏传
   * 一个不会有任何报错——用户只是发现"字号调不了"或"页数改不了"。所以这里钉住两条线都通。
   */
  it("结构类与度量类两组控件都被喂进各自的插槽", () => {
    renderPreview();

    expect(
      within(screen.getByTestId("toolbar-template-slot")).getByText("结构类版式控件"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("toolbar-measure-slot")).getByText("度量类版式控件"),
    ).toBeInTheDocument();
  });
});

describe("生成说明与警告分级", () => {
  function detailWith(overrides: Partial<ResumeDetail>): ResumeDetail {
    return {
      ...DETAIL,
      ...overrides,
      content: { ...DETAIL.content, ...overrides.content },
    };
  }

  function renderWith(overrides: Partial<ResumeDetail>) {
    const previewRef = { current: null };
    return render(
      <MemoryRouter>
        <AntdApp>
          <ResumeDetailPreview
            detail={detailWith(overrides)}
            html="<html></html>"
            layout={LAYOUT}
            layoutStatus={null}
            measure={null}
            pdfDirectAvailable
            relayouting={false}
            previewRef={previewRef}
            onLayoutStatus={vi.fn()}
            onMeasure={vi.fn()}
            onApplyLayout={vi.fn()}
            onApplyFittedFormat={vi.fn()}
            onSaveEditedResume={vi.fn()}
            suggestionsGenerated={false}
            suggestionsResetKey={0}
            onSuggestionsGenerated={vi.fn()}
            onResumeRevised={vi.fn()}
          />
        </AntdApp>
      </MemoryRouter>,
    );
  }

  it("shows the generation rationale in a collapsible section", async () => {
    renderWith({ rationale: "目标岗位「产品运营」：候选资料组成：项目 2 条。" });

    fireEvent.click(await screen.findByText("为什么是这样一份简历（生成说明）"));

    expect(await screen.findByText(/候选资料组成：项目 2 条/)).toBeInTheDocument();
  });

  it("renders structured coverage notes as a neutral group with an action button", async () => {
    renderWith({
      coverage_notes: [
        {
          section: "projects",
          section_label: "项目经历",
          names: ["Amazon ESG"],
          filtered: ["Amazon ESG"],
          model_omitted: [],
          total: 1,
        },
      ],
    });

    expect(await screen.findByText("这些资料内容没有写进这份简历")).toBeInTheDocument();
    expect(screen.getByText(/「Amazon ESG」/)).toBeInTheDocument();

    // 「AI 补上这段」打开修订弹窗，并把这条内容的补充指令预填好。
    fireEvent.click(screen.getByRole("button", { name: "AI 补上这段" }));
    const box = await screen.findByPlaceholderText(/留空则整体重新生成/);
    expect((box as HTMLTextAreaElement).value).toContain("Amazon ESG");
    expect((box as HTMLTextAreaElement).value).toContain("项目经历");
  });

  it("「打开手动调整」打开的编辑器盖在宿主弹窗之上（zIndex 不低于全局弹层基准）", async () => {
    renderWith({
      coverage_notes: [
        {
          section: "projects",
          section_label: "项目经历",
          names: ["Amazon ESG"],
          filtered: ["Amazon ESG"],
          model_omitted: [],
          total: 1,
        },
      ],
    });

    fireEvent.click(await screen.findByRole("button", { name: "打开手动调整" }));

    // 回归：编辑器弹窗曾写死 zIndex=1100，而全局主题把 zIndexPopupBase 提到了
    // 3100（宿主 Modal 都在 3100），编辑器整张被宿主压住——看起来就是"卡片被挡"。
    // 这里钉住：编辑器节点存在，且 zIndex（在 .ant-modal-wrap 上）高于宿主弹窗。
    await screen.findByText("手动调整简历内容");
    const editorWrap = document.querySelector<HTMLElement>(".ant-modal-wrap");
    expect(editorWrap).not.toBeNull();
    expect(Number(editorWrap!.style.zIndex)).toBeGreaterThanOrEqual(3100);
  });

  it("routes legacy plain-text coverage warnings away from the fabrication group", () => {
    renderWith({
      warnings: [
        "专业技能中出现本岗位候选资料未包含的技能「Excel」，请核对是否为虚构",
        "项目经历中有 1 条没有出现在这份简历里：「Amazon ESG」与这个岗位的关键词交集不足。",
      ],
    });

    // 旧记录的未收录文本归入中性组，不再顶在"疑似虚构"的红色警告下。
    expect(screen.getByText("这些资料内容没有写进这份简历")).toBeInTheDocument();
    expect(screen.getByText(/项目经历中有 1 条没有出现在这份简历里/)).toBeInTheDocument();
  });
});

describe("ResumeDetailPreview 底部按钮排满整行", () => {
  it("「查看大图」打开 1:1 预览弹窗，并把当前页数带过去", async () => {
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /查看大图/ }));

    // 弹窗里复用同一个预览组件：页数必须与外面一致，否则"大图"看到的又是另一种分页。
    // 弹窗打开、并且说明里带上了当前页数（页数一致是这一块的重点）。
    expect(await screen.findByText("查看简历大图")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`与当前 ${LAYOUT.page_limit} 页的设置一致`)),
    ).toBeInTheDocument();
    // 弹窗里复用同一个预览组件（渲染细节由 ResumePreview 自己的测试覆盖，这里只钉"用的是它"）。
    expect(document.querySelector(".resume-zoom-body")).not.toBeNull();
  });

  it("「查看大图」与主预览共用同一份口径：切到精确，大图也是精确", async () => {
    renderPreview();

    // 主预览切到精确 → 状态住在 ResumeDetailPreview，两个预览实例都读它。
    fireEvent.click(screen.getByRole("button", { name: "切到精确" }));
    expect(screen.getAllByTestId("preview-mode").map((el) => el.textContent)).toEqual(["exact"]);

    fireEvent.click(screen.getByRole("button", { name: /查看大图/ }));
    expect(await screen.findByText("查看简历大图")).toBeInTheDocument();

    // 主预览 + 大图里的预览：口径一致，精确预览的上下文也一致（同一份简历 id）。
    expect(screen.getAllByTestId("preview-mode").map((el) => el.textContent)).toEqual([
      "exact",
      "exact",
    ]);
    expect(screen.getAllByTestId("preview-exact-resume").map((el) => el.textContent)).toEqual([
      String(DETAIL.id),
      String(DETAIL.id),
    ]);
  });

  it("「手动调整」才打开整份编辑器", async () => {
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /手动调整/ }));

    expect(await screen.findByText("写作增强")).toBeInTheDocument();
  });

  it("底部操作条使用 grid 布局类，且所有动作按钮都渲染出来", () => {
    renderPreview();

    // grid 布局类存在——每个按钮独占一格、block 拉满，整行不留右侧空当。
    const footer = document.querySelector(".resume-detail-footer");
    expect(footer).not.toBeNull();
    expect(footer!.className).toContain("resume-detail-footer");
    // 动作按钮都在（ExportButtons 在测试里被替成 null，不影响这一层）。
    for (const name of [
      "手动调整",
      "查看大图",
      "生成岗位优化建议",
      "查看对应岗位",
      "咨询求职助手",
      "质量检测",
      "离线分享",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // 导出只有一个入口（ExportButtons）：旧的「导出选项」「一键脱敏」两个按钮已并入面板，
    // 留在页面上就是"两条路径各自拼参数"的老问题。
    expect(screen.queryByText("导出选项")).not.toBeInTheDocument();
    expect(screen.queryByText("一键脱敏")).not.toBeInTheDocument();
  });

  it("有待确认改动时：确认动作与导出并排在同一行（左确认 / 右导出，D8）", () => {
    renderPreview(<button type="button">保存修改</button>);

    const footer = document.querySelector(".resume-detail-footer") as HTMLElement;
    const confirmRow = footer.querySelector(".resume-detail-footer-confirm-row") as HTMLElement;
    expect(confirmRow).not.toBeNull();

    const extraBox = confirmRow.querySelector(".resume-detail-footer-extra") as HTMLElement;
    const exportBox = confirmRow.querySelector(".resume-detail-footer-export") as HTMLElement;
    expect(extraBox).not.toBeNull();
    expect(exportBox).not.toBeNull();
    // 同一行、确认在前导出在后：用户视线在「取消/保存」上时，导出不会掉到新行只剩一格。
    expect([...confirmRow.children]).toEqual([extraBox, exportBox]);
    expect(within(extraBox).getByText("保存修改")).toBeInTheDocument();
    expect(
      within(extraBox)
        .getByText("保存修改")
        .compareDocumentPosition(within(exportBox).getByText("导出")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 导出容器全页只有一个（导出面板的严格模式依赖这一点）。
    expect(footer.querySelectorAll(".resume-detail-footer-export")).toHaveLength(1);
  });

  it("没有待确认改动时：导出仍在最后一行、靠右收尾（D8/T4）", () => {
    renderPreview();

    const footer = document.querySelector(".resume-detail-footer") as HTMLElement;
    // 这一形态不该出现确认行。
    expect(footer.querySelector(".resume-detail-footer-confirm-row")).toBeNull();

    // 最后一行（次动作 + 导出）由 `tail` 承载，它是 footer 的直接网格项。
    const tail = footer.querySelector(".resume-detail-footer-tail") as HTMLElement;
    expect(tail).not.toBeNull();
    expect(tail.parentElement).toBe(footer);

    const exportBox = tail.querySelector(".resume-detail-footer-export") as HTMLElement;
    expect(exportBox).not.toBeNull();
    // 导出是这一行的最后一项：右缘贴着页脚右边界。
    const tailChildren = [...tail.children];
    expect(tailChildren[tailChildren.length - 1]).toBe(exportBox);
    expect(footer.querySelectorAll(".resume-detail-footer-export")).toHaveLength(1);

    // 位置在 CSS 里、jsdom 不求值：读原文断言它占第 4-5 列且靠右收尾。
    const css = readFileSync([process.cwd(), "src", "styles", "resume.css"].join("/"), "utf8");
    expect(css).toContain("grid-column: 4 / 6");
    expect(css).toContain("justify-self: end");
  });
});
