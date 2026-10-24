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

describe("简历制作台 · 列宽（参数栏固定 / 内容栏可拖）", () => {
  /** 分隔条。**只剩内容栏那一条**：参数栏自 2026-10-23 起是固定宽。 */
  function resizers(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".resume-wb-resizer"));
  }

  /** 容器宽度量不到时 hook 回落到窗口宽度：给一个够宽的值，clamp 才不会一直压到下限。 */
  function wideWindow(): void {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1800 });
  }

  function cssVar(kind: "params" | "editor"): string {
    return body().style.getPropertyValue(`--resume-wb-${kind}`);
  }

  it("只有内容栏一条分隔条；参数栏固定 380、没有 separator 节点", () => {
    renderModal();

    const [editor] = resizers();
    // 用户口径："第一列没必要调整宽度" —— 参数栏连分隔条都不该出现（不是拖不动，
    // 是压根没有那 6px 的命中区，否则用户会反复去拖一条永远不变的分隔线）。
    expect(resizers()).toHaveLength(1);
    expect(editor).toBeDefined();
    expect(editor).toHaveAttribute("role", "separator");
    expect(editor).toHaveAttribute("aria-orientation", "vertical");
    expect(editor).toHaveAttribute("aria-valuemin", "380");
    expect(editor).toHaveAttribute("aria-valuemax", "760");
    expect(editor).toHaveAttribute("aria-valuenow", "448");
    expect(editor).toHaveAttribute("tabindex", "0");

    // 参数栏 380 是"所有参数行一行放下"的算术下限（去掉 40 padding 剩 340，最长一行 334）。
    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("448px");
  });

  it("拖动内容栏分隔条改宽，松手后写进 localStorage", () => {
    wideWindow();
    renderModal();

    const editor = resizers()[0];
    fireEvent.mouseDown(editor, { clientX: 700, button: 0 });
    // `buttons: 1` 不能省：jsdom 的 MouseEvent 默认 `buttons = 0`，而 hook 正是靠
    // `buttons === 0` 判断"松手发生在收不到 mouseup 的地方"（见下面那条用例）。
    // 真实浏览器里按住左键移动时 `buttons` 就是 1。
    fireEvent.mouseMove(window, { clientX: 760, buttons: 1 });
    // 拖动中宽度已经跟着走（不等松手、不等下一帧）：起点 448 + 60px = 508。
    // 这条断言钉的是"拖动期间只写 CSS 自定义属性也能立刻生效"，不能放宽。
    expect(cssVar("editor")).toBe("508px");
    expect(localStorage.getItem("resume.wb.widths")).toBeNull();

    fireEvent.mouseUp(window);
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 508 }),
    );
    // 松手后不再跟随鼠标：监听器必须摘掉。
    fireEvent.mouseMove(window, { clientX: 820, buttons: 1 });
    expect(cssVar("editor")).toBe("508px");
  });

  it("拖动中左键已经松开（buttons=0）时自动收尾，不会一直保持拖动（用户报的卡死）", () => {
    wideWindow();
    renderModal();

    const editor = resizers()[0];
    fireEvent.mouseDown(editor, { clientX: 700, button: 0 });
    fireEvent.mouseMove(window, { clientX: 760, buttons: 1 });
    expect(cssVar("editor")).toBe("508px");

    // 模拟"松手发生在收不到 mouseup 的地方"（鼠标移出窗口 / 在预览 iframe 里松开）：
    // 故意不派发 mouseup，只派发一个 buttons=0 的 mousemove。
    fireEvent.mouseMove(window, { clientX: 820, buttons: 0 });

    // 拖动必须已经结束：再移动不再改变宽度，且 `body` 的拖拽标记被摘掉。
    expect(cssVar("editor")).toBe("508px");
    expect(document.body).not.toHaveClass("is-resizing");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 508 }),
    );
  });

  it("键盘 ←/→ 每次 16px，并立即持久化", () => {
    wideWindow();
    renderModal();

    const editor = resizers()[0];
    fireEvent.keyDown(editor, { key: "ArrowRight" });
    expect(cssVar("editor")).toBe("464px");
    fireEvent.keyDown(editor, { key: "ArrowLeft" });
    fireEvent.keyDown(editor, { key: "ArrowLeft" });
    fireEvent.keyDown(editor, { key: "ArrowLeft" });
    // 464 − 48 = 416，仍在下限 380 之上（未被夹）。
    expect(cssVar("editor")).toBe("416px");
    // 再连按三格：416 − 48 = 368 → 被下限 380 夹住，这就是"越界夹紧"。
    fireEvent.keyDown(editor, { key: "ArrowLeft" });
    fireEvent.keyDown(editor, { key: "ArrowLeft" });
    fireEvent.keyDown(editor, { key: "ArrowLeft" });
    expect(cssVar("editor")).toBe("380px");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 380 }),
    );
    // 上限：连按会停在 760，不会跑到 900。
    for (let index = 0; index < 40; index += 1) fireEvent.keyDown(editor, { key: "ArrowRight" });
    expect(cssVar("editor")).toBe("760px");
  });

  it("双击分隔条复位默认宽度", () => {
    wideWindow();
    renderModal();

    fireEvent.keyDown(resizers()[0], { key: "ArrowRight" });
    expect(cssVar("editor")).not.toBe("448px");

    fireEvent.doubleClick(resizers()[0]);
    expect(cssVar("editor")).toBe("448px");
    expect(cssVar("params")).toBe("380px");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 448 }),
    );
  });

  it("读取时 clamp 历史越界值：参数栏永远回到 380，内容栏夹进 380–760", () => {
    localStorage.setItem("resume.wb.widths", JSON.stringify({ params: 9999, editor: 10 }));
    renderModal();

    // 参数栏的 min === max === 380：历史里那个 9999 只能被夹成常量。
    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("380px");
  });

  it("坏数据不炸：解析失败退回默认宽度", () => {
    localStorage.setItem("resume.wb.widths", "{not json");
    renderModal();

    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("448px");
  });

  it("只读宿主（两栏）同样不给分隔条", () => {
    renderModal({ onSaveContent: undefined });

    expect(resizers()).toHaveLength(0);
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
