// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情预览：**编辑器内容页签必须真的够得着**。
 *
 * 这条用例防的是一类很隐蔽的失效：`ResumeEditorModal` 的内容页签要由调用点把
 * 简历 id / 详情传进去才挂得出来，而组件级测试抓不到这种断链——功能"存在"却在界面上
 * 点不到，用户问到助手时只能得到"暂不可达"。所以必须在**调用点**这一层钉住。
 *
 * 2026-10-24：原「写作增强」页签搬到右键菜单（`features/ai-polish/AiPolishLayer`），
 * 页签列表少一项；这里同时断言它**没有**作为空壳页签留下来。
 *
 * 夹具、渲染入口与 CSS 断言辅助在 `src/test/resumeDetailPreviewHarness.tsx`
 * （2026-11 行数预算）；`vi.mock` 仍留在本文件——vitest 的 mock 注册是文件级的。
 */
import { t } from "../../i18n";
import { fireEvent, screen, within } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cssDeclarations,
  DETAIL,
  LAYOUT,
  PROFILE,
  renderPreview,
  renderPreviewWith,
  resetResumeDetailDom,
  stripCssComments,
} from "../../test/resumeDetailPreviewHarness";

// 与 `styles/color-regression.test.ts` 同一套写法：从磁盘读 CSS 原文（jsdom 不求值网格位置）。
declare const process: { cwd(): string };

/**
 * 「从我的资料填入」的候选来自 `/profile`：这条入口是**按需**取的（打开编辑器/制作台才
 * 请求），所以这里既要钉住"什么时候请求"，也要钉住"请求失败不能挡住编辑器"。
 */
const profileMocks = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("../../api/profile", () => ({ getProfile: profileMocks.getProfile }));

// 预览本身由 ResumePreview.test.tsx 覆盖；这里把它替成一个**只做插槽接线**的桩：
// 两个具名插槽（结构类 / 度量类）原样渲染出来，好让"调用点有没有把两组喂进去"被钉住。
// 桩不再提供"点中某一栏"的按钮——预览的点击编辑已于 2026-10-21 整块去掉。
// `zoomHint` 也要透出来：制作台把"虚线是分页位置（当前 N 页）"那句说明并进了缩放条，
// 桩把它吞掉的话，"页数有没有带过去"就再也测不到了。
vi.mock("../ResumePreview", () => ({
  default: ({
    templateControls,
    measureControls,
    previewMode,
    onPreviewModeChange,
    exactPreview,
    zoomHint,
  }: {
    templateControls?: ReactNode;
    measureControls?: ReactNode;
    previewMode?: string;
    onPreviewModeChange?: (mode: "draft" | "exact") => void;
    exactPreview?: { resumeId: number };
    zoomHint?: string;
  }) => (
    <div>
      <div data-testid="toolbar-template-slot">{templateControls}</div>
      <div data-testid="toolbar-measure-slot">{measureControls}</div>
      <div data-testid="preview-mode">{previewMode ?? "draft"}</div>
      <div data-testid="preview-exact-resume">{exactPreview?.resumeId ?? ""}</div>
      <div data-testid="preview-zoom-hint">{zoomHint}</div>
      <button type="button" onClick={() => onPreviewModeChange?.("exact")}>
        切到精确
      </button>
    </div>
  ),
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
// 工具栏两行的两组控件：P2 起由具名插槽渲染（不再经过 `ResumeLayoutControls` 壳）。
// 这里给它们各自一句可辨认的文案，配合上面的插槽桩判断"组长有没有被接上"。
vi.mock("./ResumeTemplateControls", () => ({
  default: () => <span data-testid="template-controls">结构类版式控件</span>,
}));
// 度量类控件的桩会把**收到的 props** 记下来：P0-6 的验收口径原话就是
// "以 `showMarginSides={false}` 断言"，而它是调用点决定的，桩以外看不见。
const mockMeasureProps = vi.hoisted<{ current?: Record<string, unknown> }>(() => ({}));
vi.mock("./ResumeMeasureControls", () => ({
  default: (props: Record<string, unknown>) => {
    mockMeasureProps.current = props;
    return <span data-testid="measure-controls">度量类版式控件</span>;
  },
}));
// 导出按钮渲染成真按钮：footer 的"左确认 / 右导出"顺序断言需要一个可定位的导出节点
// （`导出选项` 是弹出面板里的另一个文案，不会撞）。
vi.mock("../ExportButtons", () => ({ default: () => <button type="button">导出</button> }));

afterEach(resetResumeDetailDom);

beforeEach(() => {
  // 缺省有一份可用的资料：绝多数用例只关心"入口在不在"，不关心接口本身。
  profileMocks.getProfile.mockResolvedValue(PROFILE);
});

describe("ResumeDetailPreview 不再提供手动编辑", () => {
  /**
   * 2026-10-28 用户要求：预览界面去掉「手动调整」与「草稿模式编辑」，详细编辑统一去
   * 简历制作台。这里钉住两件事——底部没有这个按钮、点纸面也不会弹出编辑器。
   */
  it("底部没有「手动调整」，也不会渲染编辑器弹层", async () => {
    renderPreview();

    await screen.findByRole("button", { name: /简历制作台/ });
    expect(screen.queryByRole("button", { name: /手动调整/ })).toBeNull();
    // 编辑器弹层的标题只由它自己渲染，全篇不该出现。
    expect(screen.queryByText(t("componentsMisc.resumeEditorModal.title"))).toBeNull();
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

  it("主预览显式关掉分边页边距控件（P0-6：它只在制作台里出现）", () => {
    renderPreview();

    // 能力不删、只在制作台提供：主预览的工具栏是两行紧凑形态，多一行折叠标题就会顶宽。
    // 缺省值虽然是 false，但调用点必须**显式**写出来——否则将来把缺省改成 true 时，
    // 这里会静默地多出四行滑杆。
    expect(mockMeasureProps.current?.showMarginSides).toBe(false);
  });
});

describe("生成说明与警告分级", () => {
  it("shows the generation rationale in a collapsible section", async () => {
    renderPreviewWith({ rationale: "目标岗位「产品运营」：候选资料组成：项目 2 条。" });

    fireEvent.click(await screen.findByText("为什么是这样一份简历（生成说明）"));

    expect(await screen.findByText(/候选资料组成：项目 2 条/)).toBeInTheDocument();
  });

  it("renders structured coverage notes as a neutral group with an action button", async () => {
    renderPreviewWith({
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

  it("覆盖提示里的「打开手动调整」改为打开简历制作台", async () => {
    renderPreviewWith({
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

    // 入口还在（它是"这条没写进去，去哪儿改"的唯一指路），但改成打开制作台，
    // 不再就地弹编辑器。
    fireEvent.click(await screen.findByRole("button", { name: "打开手动调整" }));
    expect(screen.queryByText("手动调整简历内容")).toBeNull();
  });

  it("routes legacy plain-text coverage warnings away from the fabrication group", () => {
    renderPreviewWith({
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
  it("「简历制作台」打开三栏工作台，并把当前页数带过去", async () => {
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /简历制作台/ }));

    // 弹窗里复用同一个预览组件：页数必须与外面一致，否则制作台里看到的又是另一种分页。
    // 弹窗打开、并且说明里带上了当前页数（页数一致是这一块的重点）。
    expect(await screen.findByText(new RegExp(`与当前 ${LAYOUT.page_limit} 页的设置一致`)));
    // 三栏：左参数（两组控件都在里面）/ 中内容 / 右画布，预览仍由同一个 ResumePreview 渲染。
    const workbench = document.querySelector(".resume-wb-body");
    const params = workbench?.querySelector(".resume-wb-col-params");
    const editor = workbench?.querySelector(".resume-wb-col-editor");
    const canvas = workbench?.querySelector(".resume-wb-canvas");
    expect(params).not.toBeNull();
    expect(editor).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(params?.querySelector('[data-testid="template-controls"]')).not.toBeNull();
    expect(params?.querySelector('[data-testid="measure-controls"]')).not.toBeNull();
    expect(within(canvas as HTMLElement).getByTestId("preview-mode")).toHaveTextContent("draft");

    const dialog = screen.getByRole("dialog", { name: "简历制作台" });
    // 铺满视口（2026-10）：高度整屏、四周没有留白。尺寸读 style 属性比读 CSSOM 稳
    // （jsdom 对 calc 的解析实现随版本变化），所以这里断言的正是"不再有 calc"。
    const style = (dialog as HTMLElement).getAttribute("style") ?? "";
    expect(style).toContain("100dvh");
    expect(style).not.toContain("calc(");
    expect(dialog.closest(".ant-modal-wrap")).toHaveClass("resume-zoom-workbench-wrap");
  });

  it("「简历制作台」与主预览共用同一份口径：切到精确，制作台也是精确", async () => {
    renderPreview();

    // 主预览切到精确 → 状态住在 ResumeDetailPreview，两个预览实例都读它。
    fireEvent.click(screen.getByRole("button", { name: "切到精确" }));
    expect(screen.getAllByTestId("preview-mode").map((el) => el.textContent)).toEqual(["exact"]);

    fireEvent.click(screen.getByRole("button", { name: /简历制作台/ }));
    expect(await screen.findByRole("dialog", { name: "简历制作台" })).toBeInTheDocument();

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

  it("底部没有「手动调整」：编辑入口只剩「简历制作台」", async () => {
    renderPreview();

    await screen.findByRole("button", { name: /简历制作台/ });
    expect(screen.queryByRole("button", { name: /手动调整/ })).toBeNull();
  });

  it("中栏改过内容也不会禁用预览里的其它动作（不再有第二个编辑器抢草稿）", async () => {
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /简历制作台/ }));
    await screen.findByRole("dialog", { name: "简历制作台" });

    const nameInput = document.getElementById("name") as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    fireEvent.change(nameInput, { target: { value: "李四" } });

    // 预览里已经没有「手动调整」，脏值不再需要禁用任何按钮。
    expect(screen.queryByRole("button", { name: /手动调整/ })).toBeNull();
    expect(screen.getByRole("button", { name: /简历制作台/ })).not.toBeDisabled();
  });

  it("底部操作条使用 grid 布局类，且所有动作按钮都渲染出来", () => {
    renderPreview();

    // grid 布局类存在——每个按钮独占一格、block 拉满，整行不留右侧空当。
    const footer = document.querySelector(".resume-detail-footer");
    expect(footer).not.toBeNull();
    expect(footer!.className).toContain("resume-detail-footer");
    // 动作按钮都在（ExportButtons 在测试里被替成 null，不影响这一层）。
    for (const name of [
      "简历制作台",
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

    // 位置在 CSS 里、jsdom 不求值：读原文断言尾行的排布规则。
    // 2026 年样式表拆分后，`.resume-detail-footer*` 落在 resume-panels.css
    // （resume.css 现为 @import 清单，读它只剩两行 import）。
    const css = readFileSync(
      [process.cwd(), "src", "styles", "resume-panels.css"].join("/"),
      "utf8",
    );
    const tailRule = cssDeclarations(css, ".resume-detail-footer-tail");
    // 尾行独占页脚一整行，并且**自己换行**：装不下时整组落到下一行，而不是挤出卡片。
    expect(tailRule).toContain("grid-column: 1 / -1");
    expect(tailRule).toContain("flex-wrap: wrap");

    const rightGroupRule = cssDeclarations(
      css,
      ".resume-detail-footer-tail > .resume-detail-footer-export",
    );
    // 贴右收尾（同一行时吃中间空档、换行后把自己推到右边界）+ 极窄时不撑破行宽。
    expect(rightGroupRule).toContain("margin-left: auto");
    expect(rightGroupRule).toContain("min-width: 0");
    expect(rightGroupRule).toContain("flex-wrap: wrap");

    // 左侧两个次动作不许伸展：一伸展就把右侧动作组挤到下一行（2026-11 的排版事故之一）。
    const tailButtonRule = cssDeclarations(css, ".resume-detail-footer-tail > .ant-btn");
    expect(tailButtonRule).toContain("flex: 0 0 auto");
    // antd 的 `.ant-btn-block` 是 `width: 100%`，放进 flex 必须覆盖回 auto。
    expect(tailButtonRule).toContain("width: auto");

    // 反例守卫：不许再出现「从第 N 列起」。`auto-fill` 的列数随宽度在 2～5 之间变，
    // 5 列时 `4 / -1` 只剩 2 格（~330px）、4 列时只剩 1 格（~165px），列数再少一档时
    // 起止线相等还会补出一个隐式列——三条路都会让右侧动作组被压成一格一行，
    // 或者（`extraActions` 里有不可收缩的行时）直接画出页脚右边界。
    //
    // **在剥注释后的原文上断言**：上面 tail 的注释里逐字留着旧写法（"这里原来是
    // `grid-column: 4 / -1`"），直接匹配注释会命中它自己。剥完之后全文件只剩
    // `.resume-detail-footer-tail` 那条 `grid-column: 1 / -1`。
    expect(stripCssComments(css)).not.toMatch(/grid-column:\s*[2-9]/);
  });
});
