// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」外壳：**三栏结构、折叠降级、窄屏降级、分边控件的位置**。
 *
 * 这一层此前没有任何用例（改名与三栏化之后只有 `ResumeDetailPreview.test.tsx` 的一条
 * "三栏都在"），而它恰好是本轮 P0 里最容易悄悄退化的部分：
 *
 * 1. 三栏是"同一份内容的三种视角"，任何一栏缺失都不会报错——用户只是发现某一列空了；
 * 2. 折叠是纯 CSS + 条件渲染，写错 `class` 时观感正确、行为错误（中栏还在但看不见）；
 * 3. 窄屏退化只有媒体查询，jsdom 不求值媒体查询，所以这里**读 CSS 原文**钉住那两条规则；
 * 4. 分边页边距是 P0-5 的核心："只在制作台"+"紧跟页边距滑杆"，后者只能用 DOM 顺序证明。
 *
 * 断言文案一律走 `t()`（`cjkRatchet` 的 tests 口径会把中文 `*ByText` 参数计入存量）；
 * 中文只出现在注释与样式类名里。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent } from "../../types";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { readWorkbenchCss } from "../../test/workbenchStyles";
import { body, CONTENT, narrowScreenBlock, renderModal } from "./ResumeZoomModal.testkit";

// 与 `ResumeDetailPreview.test.tsx` 同一套写法：从磁盘读 CSS 原文。

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

// 目录只取一次（组件自己调 hook）；这里直接下发夹具，避免多一次网络桩。
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布里的预览是真 iframe + 量高（`ResumePreview` 自有其用例），与结构断言无关。
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

describe("简历制作台 · 三栏结构", () => {
  it("参数栏、内容栏、画布栏同时存在（P0-2）", () => {
    renderModal();

    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-canvas")).not.toBeNull();
    // 未折叠：不能带折叠态那个 class（它会把栅格改成两列）。
    expect(body()).not.toHaveClass("is-editor-collapsed");
    expect(body()).not.toHaveClass("is-editor-hidden");
    // 画布复用同一个 ResumePreview（不是另写一个渲染器）。
    expect(screen.getByTestId("workbench-preview")).toBeInTheDocument();
  });

  it("左栏六个分组按 模板·版式 / 排版参数 / 层次与间距 / 外观 / 局部排版 / 分页 排列", () => {
    renderModal();

    const params = document.querySelector(".resume-wb-col-params") as HTMLElement;
    const titles = [
      t("workbench.group.layout"),
      t("workbench.group.measure"),
      t("workbench.group.spacing"),
      t("workbench.group.appearance"),
      // W07：角色级局部排版（姓名 / 板块标题 / 条目 / 正文 / 元信息 / 重点文字）。
      t("typography.group.title"),
      // W08：分页意图（板块级先挂，条目级等选择状态上提）。
      t("pagination.group.title"),
    ];
    // 按**DOM 顺序**比，不用 `innerHTML.indexOf` 找子串：子串定位会把"文案里恰好出现分组名"
    // 的任何节点也算进来（以后的按钮、aria-label、提示语），顺序一乱仍可能假通过。
    const labels = Array.from(
      params.querySelectorAll<HTMLElement>(".resume-wb-group-title .resume-wb-group-label"),
    ).map((node) => node.textContent ?? "");
    expect(labels).toEqual(titles);
  });

  it("中栏不再有折叠开关：动作条里找不到「收起内容栏」（2026-10-23 用户口径）", () => {
    renderModal();

    // 折叠会把中栏整个卸载，未保存的草稿只剩 sessionStorage 里那一份——用户回来时
    // 看到的是"上次的改动不见了"。所以这颗按钮被移除了，不是改名。
    expect(screen.queryByRole("button", { name: /收起内容栏|展开内容栏/ })).not.toBeInTheDocument();
    // 中栏始终存在，`is-editor-collapsed` 那一档不再产生。
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    expect(body()).not.toHaveClass("is-editor-collapsed");
  });

  it("只读宿主（没有 onSaveContent）退回两栏，中栏整体不渲染（§3.2）", () => {
    renderModal({ onSaveContent: undefined });

    expect(document.querySelector(".resume-wb-col-editor")).toBeNull();
    expect(body()).toHaveClass("is-editor-hidden");
  });
});

describe("简历制作台 · 窄档（≤1280 / ≤1000）", () => {
  /**
   * jsdom 的 `matchMedia` 桩恒返回 `matches: false`（= 宽屏三栏），测不到窄档分支。
   * 这条按查询串给结果，让 `useMediaQuery` 能真的走到两栏 / 单栏。
   */
  function mockViewport(matches: (query: string) => boolean) {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: matches(query),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  }

  it("≤1280：中栏不在栅格里，动作条给「编辑内容」，点开是抽屉且参数栏仍在", () => {
    mockViewport((query) => query.includes("1280"));
    renderModal();

    // 中栏不再「在栅格里绝对定位盖住参数栏」（AUDIT P0-1），而是根本不渲染。
    expect(document.querySelector(".resume-wb-col-editor")).toBeNull();
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    // 提示文案跟着入口走：说的是「编辑内容」那颗按钮，不是别处。
    expect(document.querySelector(".resume-wb-narrow-hint")?.textContent).toBe(
      t("workbench.narrow.editor"),
    );

    // 动作条上的入口：只在动作条范围内找，避免与左栏「排版参数」分组标题重名。
    // 按钮的可访问名带图标名（`edit 编辑内容`），所以按子串匹配。
    const actionBar = document.querySelector<HTMLElement>(".resume-wb-actionbar")!;
    fireEvent.click(
      within(actionBar).getByRole("button", {
        name: new RegExp(t("responsive.action.editContent")),
      }),
    );

    // 抽屉打开后内容栏才出现；参数栏仍在（抽屉是浮层，不参与栅格）。
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
  });

  it("≤1000：参数栏也进抽屉，画布独占一屏，两个入口互斥", () => {
    mockViewport((query) => query.includes("1280") || query.includes("1000"));
    renderModal();

    expect(document.querySelector(".resume-wb-col-params")).toBeNull();
    expect(document.querySelector(".resume-wb-col-editor")).toBeNull();
    expect(document.querySelector(".resume-wb-col-canvas")).not.toBeNull();

    // 参数抽屉。
    const actionBar = document.querySelector<HTMLElement>(".resume-wb-actionbar")!;
    fireEvent.click(
      within(actionBar).getByRole("button", { name: new RegExp(t("responsive.action.params")) }),
    );
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();

    // 再开内容抽屉：同一个 `openPanel` 状态 ⇒ 参数抽屉必须让位（两个 378 会把画布全盖住）。
    fireEvent.click(
      within(actionBar).getByRole("button", {
        name: new RegExp(t("responsive.action.editContent")),
      }),
    );
    expect(document.querySelector(".resume-wb-col-editor")).not.toBeNull();
    const openDrawers = [...document.querySelectorAll(".ant-drawer")].filter(
      (node) => !node.classList.contains("ant-drawer-hidden"),
    );
    expect(openDrawers.length).toBeLessThanOrEqual(1);
  });

  it("CSS 侧：同一档仍要摘掉分隔条、单栏时纵向排列（容器查询与视口断点各一份）", () => {
    const block = narrowScreenBlock();
    expect(block).toMatch(/\.resume-wb-body\s*\{[^}]*flex-direction:\s*column/);
    expect(block).toMatch(/\.resume-wb-resizer\s*\{[^}]*display:\s*none/);
    // 判据换成"弹窗体自己的宽"：容器查询必须存在，否则 §4.5 的等价换算无从谈起。
    expect(block).toContain("@supports (container-type: inline-size)");
    expect(block).toContain("@container wb (max-width: 1000px)");
  });
});

describe("简历制作台 · 铺满视口（2026-10）", () => {
  it("弹窗铺满整个视口：没有 12px 留白，也没有圆角外壳", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: t("workbench.title") });
    const style = (dialog as HTMLElement).getAttribute("style") ?? "";
    // 高度整屏；不再用 `calc(100dvh - 24px)`（那 24px 就是从遮罩透出来的那条黑边）。
    expect(style).toContain("100dvh");
    expect(style).not.toContain("calc(");

    // wrapper 的 12px 内边距与容器圆角/投影：一处留着，四周就还有缝。
    const css = readWorkbenchCss();
    expect(css).toMatch(/\.resume-zoom-workbench-wrap\s*\{\s*padding:\s*0;/);
    expect(css).toMatch(/\.ant-modal-container\s*\{[^}]*border-radius:\s*0/);
    expect(css).toMatch(/\.ant-modal-container\s*\{[^}]*box-shadow:\s*none/);
    // 作用域类必须留着：所有 `.ant-modal-*` 覆写都靠它限定（`antdOverrideGuard`）。
    expect(dialog.closest(".ant-modal-wrap")).toHaveClass("resume-zoom-workbench-wrap");
  });
});

describe("简历制作台 · 分边页边距（P0-5 / P0-6）", () => {
  it("制作台内渲染分边控件，且它跟在页边距滑杆之后（DOM 顺序）", () => {
    renderModal();

    const params = document.querySelector(".resume-wb-col-params") as HTMLElement;
    const paddingSlider = screen.getByRole("slider", { name: /页边距/ });
    const sides = params.querySelector(".resume-margin-sides");
    expect(sides).not.toBeNull();
    // 位置是这一项的全部意义：隔开放到栏尾会让人读不出"它解释的是页边距"。
    expect(
      paddingSlider.compareDocumentPosition(sides as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("分边控件在制作台里默认展开（不是需要先点开的折叠块）", () => {
    renderModal();

    // PRD P0-5 期望列：制作台内"分边控件默认展开"。
    expect(document.querySelector(".resume-margin-sides-panel")).not.toBeNull();
  });
});

describe("简历制作台 · 顶部动作条的保存与取消（需求 5）", () => {
  /**
   * 顶部动作条本身。
   *
   * 所有断言都用 `within(动作条)` 限定范围：制作台里**只有**这一对整体的保存/取消
   * （中栏底部那对被 `hideActions` 摘掉了），但弹窗、确认条里也有按钮，限定范围之后
   * 断言不会因为别处长了一颗同名按钮而串。
   */
  function actionbar(): HTMLElement {
    const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
    expect(node).not.toBeNull();
    return node as HTMLElement;
  }

  /** 姓名输入框：antd 给 `Form.Item name="name"` 生成的 id 就是字段名。 */
  function nameInput(): HTMLInputElement {
    const input = document.getElementById("name");
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  // 「保存修改」带图标，可访问名是「icon label + 文案」，所以按子串匹配。
  function topSave(): HTMLElement | null {
    return within(actionbar()).queryByRole("button", {
      name: new RegExp(t("workbench.action.save-changes")),
    });
  }

  function topCancel(): HTMLElement | null {
    return within(actionbar()).queryByRole("button", {
      name: new RegExp(t("workbench.action.cancel-changes")),
    });
  }

  it("没有未保存的修改时，动作条里没有这两颗按钮", () => {
    renderModal();

    // 常亮的保存按钮会让"有没有改动"失去信号，所以不脏就一颗都不给。
    expect(topSave()).toBeNull();
    expect(topCancel()).toBeNull();
  });

  it("改一个字段后动作条里出现这两颗按钮", async () => {
    renderModal();

    fireEvent.change(nameInput(), { target: { value: "李四" } });

    expect(
      await within(actionbar()).findByRole("button", {
        name: new RegExp(t("workbench.action.save-changes")),
      }),
    ).toBeInTheDocument();
    expect(topCancel()).not.toBeNull();
  });

  it("点顶部「保存修改」→ 宿主 onSaveContent 收到新内容一次，且制作台不关", async () => {
    // 显式给出签名：`vi.fn()` 不带参数类型时 `mock.calls[0]` 是空元组，取不到内容。
    const onSaveContent = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    const onClose = vi.fn();
    renderModal({ onSaveContent, onClose });

    fireEvent.change(nameInput(), { target: { value: "李四" } });
    const save = await within(actionbar()).findByRole("button", {
      name: new RegExp(t("workbench.action.save-changes")),
    });
    fireEvent.click(save);

    await waitFor(() => expect(onSaveContent).toHaveBeenCalledTimes(1));
    expect(onSaveContent.mock.calls[0][0].name).toBe("李四");
    // 存完**不关**制作台：用户下一步往往是接着调参数看版面。
    expect(onClose).not.toHaveBeenCalled();
    // 脏值清掉之后两颗按钮自己收起（不再需要"存完了还挂着按钮"）。
    await waitFor(() => expect(topSave()).toBeNull());
  });

  it("点顶部「取消修改」→ 就地出确认；「放弃修改」回填服务端内容、不保存", async () => {
    const onSaveContent = vi.fn(async () => undefined);
    renderModal({ onSaveContent });

    fireEvent.change(nameInput(), { target: { value: "李四" } });
    fireEvent.click(
      await within(actionbar()).findByRole("button", {
        name: new RegExp(t("workbench.action.cancel-changes")),
      }),
    );

    // 确认必须长在**顶部动作条里**（用户刚点的位置）：跑到中栏底部去等于点了没反应。
    const alert = await within(actionbar()).findByRole("alert");
    // 顶部这一对的确认句与中栏底部那条不同：它还要交代"排版参数也会一起回滚"。
    expect(alert).toHaveTextContent(t("workbench.actionbar.discard.body"));

    fireEvent.click(within(alert).getByRole("button", { name: t("common.action.discard") }));

    await waitFor(() => expect(nameInput().value).toBe(CONTENT.name));
    expect(within(actionbar()).queryByRole("alert")).toBeNull();
    // 放弃不等于保存：一次 PATCH 都不该发出去。
    expect(onSaveContent).not.toHaveBeenCalled();
  });

  it("确认态下动作条把剩余宽度让给确认条（56px 标题栏装不下一行以上的字）", async () => {
    renderModal();

    fireEvent.change(nameInput(), { target: { value: "李四" } });
    fireEvent.click(
      await within(actionbar()).findByRole("button", {
        name: new RegExp(t("workbench.action.cancel-changes")),
      }),
    );

    const alert = await within(actionbar()).findByRole("alert");
    expect(alert).toHaveClass("resume-wb-actionbar-discard");
    // CSS 那条规则用的是 `:has(> .resume-wb-actionbar-discard)` 的**直接子**选择器：
    // 确认条一旦被包进别的节点，规则会静默失效（不报错、只是折行），所以把结构钉住。
    expect(alert.parentElement).toBe(actionbar());

    // jsdom 不求值样式表，只能读原文：确认态下 spacer 必须收起，否则它和确认条都是
    // `flex: 1 1 auto`，两根平分剩余宽度，20 来字的确认句会被压到换行、顶出固定 56px 的标题栏。
    const css = readWorkbenchCss();
    expect(css).toMatch(
      /\.resume-wb-actionbar:has\(> \.resume-wb-actionbar-discard\) > \.resume-wb-actionbar-spacer\s*\{[^}]*flex:\s*0 1 0/,
    );
  });
});
