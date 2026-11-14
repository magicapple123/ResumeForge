// SPDX-License-Identifier: Apache-2.0
/**
 * 左侧「+」入口（R06-A）：开合、四组齐全、选岗位回传 id、技能二级的预算行、Esc 关闭，
 * 以及 `+` 展开时变成 `×` 的那个 **class 切换**。
 *
 * 刻意**不**断言 computed `transform`：jsdom 不做布局计算，`getComputedStyle` 拿到的
 * 永远是初始值——那种断言会"永远绿"，等于没测。旋转的正确性靠 class（`is-open`）+
 * 真机截图两层保证。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
const resumeMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));

vi.mock("../../../../api/jobs", () => jobMocks);
vi.mock("../../../../api/resumes", () => resumeMocks);

import AddMenu from "./AddMenu";
import type { AddMenuProps } from "./AddMenu";
import { t } from "../../../../i18n";

const JOB = { id: 12, title: "前端工程师", company: "示例公司" };
const RESUME = { id: 34, title: "我的简历" };

function renderMenu(overrides: Partial<AddMenuProps> = {}) {
  const props: AddMenuProps = {
    compact: false,
    sending: false,
    attachmentReads: 0,
    attachmentsCount: 0,
    jobId: undefined,
    resumeId: undefined,
    skillCatalog: [],
    selectedSkills: [],
    skillBudget: null,
    skillsLoaded: true,
    togglingSkillId: null,
    onJobChange: vi.fn(),
    onResumeChange: vi.fn(),
    onToggleSkill: vi.fn(),
    onManageSkills: vi.fn(),
    onAddAttachment: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <AntdApp>
        <AddMenu {...props} />
      </AntdApp>,
    ),
  };
}

/** 触发器本身（不受 tooltip 影响的无障碍名是无状态的那一条）。 */
function trigger() {
  return screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") });
}

/** 图标容器：旋转看的就是它的 class，而不是按钮。 */
function icon() {
  return document.querySelector(".composer-add-icon") as HTMLElement | null;
}

beforeEach(() => {
  jobMocks.listJobs.mockResolvedValue({ items: [JOB], total: 1, page: 1, page_size: 50 });
  jobMocks.getJob.mockResolvedValue(JOB);
  resumeMocks.listResumes.mockResolvedValue({ items: [RESUME], total: 1, page: 1, page_size: 50 });
  resumeMocks.getResume.mockResolvedValue(RESUME);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("AddMenu 开合", () => {
  it("默认收起：面板里那四组一个都不在", () => {
    renderMenu();
    expect(screen.queryByText(t("composerAddMenu.section.job"))).toBeNull();
    expect(screen.queryByText(t("composerAddMenu.action.attach"))).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("点开面板四组齐全：关联岗位 / 关联简历 / 添加附件 / 技能", async () => {
    renderMenu();
    fireEvent.click(trigger());

    expect(await screen.findByText(t("composerAddMenu.section.job"))).toBeInTheDocument();
    expect(screen.getByText(t("composerAddMenu.section.resume"))).toBeInTheDocument();
    expect(screen.getByText(t("composerAddMenu.action.attach"))).toBeInTheDocument();
    expect(screen.getByText(t("assistantComposer.skills.count", { count: 0 }))).toBeInTheDocument();
    // 技能那行右侧有箭头（二级入口）
    expect(document.querySelector(".composer-add-caret")).not.toBeNull();
  });

  it("展开时图标容器带 is-open，收起后移除（旋转只给 span，不给按钮）", () => {
    renderMenu();
    expect(icon()).not.toBeNull();
    expect(icon()?.classList.contains("is-open")).toBe(false);
    // 旋转不给按钮：按钮自身不能带这个 class
    expect(trigger().classList.contains("is-open")).toBe(false);

    fireEvent.click(trigger());
    expect(icon()?.classList.contains("is-open")).toBe(true);

    fireEvent.click(trigger());
    expect(icon()?.classList.contains("is-open")).toBe(false);
  });

  it("Esc 关闭面板（面板挂在 body 上，键盘事件不经过触发器）", async () => {
    renderMenu();
    fireEvent.click(trigger());
    await screen.findByText(t("composerAddMenu.section.job"));

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
    // jsdom 不跑 CSS 过渡，离场动画不会走完，所以"已关闭"用 aria-expanded + 离场/hidden
    // 这一层状态判定，而不是断言节点从 DOM 里消失（那会永远等不到）。
    const panel = document.querySelector(".composer-add-panel");
    if (panel) expect(panel.closest(".ant-dropdown")?.className).toMatch(/leave|hidden/);
  });

  it("生成中整块入口不可点（不能边发边改上下文）", () => {
    renderMenu({ sending: true });
    expect(trigger()).toBeDisabled();
  });
});

describe("AddMenu 四组内容", () => {
  it("选岗位后回传 id，面板不收起（搜索框继续可用）", async () => {
    const { props } = renderMenu();
    fireEvent.click(trigger());

    const combobox = await screen.findByRole("combobox", {
      name: t("assistantComposer.aria.jobSelect"),
    });
    fireEvent.mouseDown(combobox);
    fireEvent.click(await screen.findByText(`${JOB.title} · ${JOB.company}`));

    expect(props.onJobChange).toHaveBeenCalledWith(JOB.id, expect.anything());
    // 选完不用再点一次 `+`：面板仍在（这就是"不能把 Select 塞进 Menu item"的原因）。
    expect(screen.getByText(t("composerAddMenu.action.attach"))).toBeInTheDocument();
  });

  it("选简历后回传 id", async () => {
    const { props } = renderMenu();
    fireEvent.click(trigger());

    const combobox = await screen.findByRole("combobox", {
      name: t("assistantComposer.aria.resumeSelect"),
    });
    fireEvent.mouseDown(combobox);
    fireEvent.click(await screen.findByText(RESUME.title));

    expect(props.onResumeChange).toHaveBeenCalledWith(RESUME.id, expect.anything());
  });

  it("已选的岗位显示标题而不是 #id（深链带入的 id 靠 ensure 回查）", async () => {
    renderMenu({ jobId: JOB.id });
    fireEvent.click(trigger());

    expect(await screen.findByText(`${JOB.title} · ${JOB.company}`)).toBeInTheDocument();
    expect(
      screen.queryByText(t("assistantComposer.context.jobFallback", { id: JOB.id })),
    ).toBeNull();
  });

  it("添加附件走原来的 beforeUpload（数量与体积限制仍在 Upload 上）", async () => {
    const { props } = renderMenu();
    fireEvent.click(trigger());

    const input = document.querySelector(
      ".composer-add-panel input[type='file']",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = new File([new Uint8Array(4)], "note.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(props.onAddAttachment).toHaveBeenCalledTimes(1));
  });

  it("附件读满了就不能再加（与原来的禁用条件一致）", async () => {
    renderMenu({ attachmentsCount: 4 });
    fireEvent.click(trigger());

    const label = await screen.findByText(t("composerAddMenu.action.attach"));
    expect(label.closest("button")).toBeDisabled();
  });
});

describe("AddMenu 技能二级", () => {
  const SKILL = {
    id: 7,
    name: "interview-coach",
    description: "",
    enabled: true,
    source_name: "",
    prompt_chars: 30,
    files: [],
    updated_at: "",
  };

  it("点技能进二级，显示勾选列表与本对话预算行", async () => {
    renderMenu({
      skillCatalog: [SKILL],
      selectedSkills: [{ id: 7, name: SKILL.name, description: "" }],
      skillBudget: {
        used_chars: 1_200,
        loaded_chars: 1_200,
        limit_chars: 12_000,
        truncated_skill_ids: [],
      },
    });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 1 })));

    expect(await screen.findByRole("checkbox")).toBeChecked();
    expect(
      screen.getByText(
        t("conversationSkills.menu.budget", { count: 1, used: "1,200", limit: "12,000" }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("conversationSkills.action.manage"))).toBeInTheDocument();
  });

  it("二级展开时顶层仍算打开：图标保持 is-open，返回可退回顶级", async () => {
    renderMenu({ skillCatalog: [SKILL] });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 0 })));

    expect(icon()?.classList.contains("is-open")).toBe(true);
    expect(screen.getByText(t("composerAddMenu.section.skills"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("common.action.back") }));
    expect(await screen.findByText(t("composerAddMenu.section.job"))).toBeInTheDocument();
  });

  it("勾选技能回传 skill 与目标状态", async () => {
    const { props } = renderMenu({ skillCatalog: [SKILL] });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 0 })));

    fireEvent.click(await screen.findByRole("checkbox"));

    expect(props.onToggleSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), true);
  });
});

/**
 * #32：技能二级改成悬停浮出。
 *
 * 时序是真的等待（150 / 300ms），不用假计时器：antd 的弹层动画本身也走计时器，
 * 冻结时钟会把"面板开没开"和"动画走没走完"混在一起。用例文案一律走 `t()`，
 * 不新增中文字面量（语言包之外的写入会被 `cjkRatchet` 拦住）。
 *
 * React 把 `onMouseEnter/Leave` 挂在 `mouseover/mouseout` 上做合成，
 * 所以这里派发的是 `mouseOver/mouseOut`——派发非冒泡的 `mouseenter` 到不了 React 根容器。
 */
describe("AddMenu skills flyout", () => {
  const COACH = {
    id: 7,
    name: "interview-coach",
    description: "follow-up questions",
    enabled: true,
    source_name: "",
    prompt_chars: 30,
    files: [],
    updated_at: "",
  };
  const DIAG = { ...COACH, id: 8, name: "resume-diagnose", description: "ats check" };

  /** 打开一级面板，返回「技能」行的悬停容器（浮出层的定位基准）。 */
  async function openRoot() {
    renderMenu({ skillCatalog: [COACH, DIAG] });
    fireEvent.click(trigger());
    await screen.findByText(t("composerAddMenu.section.job"));
    const row = screen.getByText(t("assistantComposer.skills.count", { count: 0 }));
    return row.closest(".composer-add-skills-anchor") as HTMLElement;
  }

  function flyout() {
    return document.querySelector(".composer-add-flyout");
  }

  it("hover opens the flyout after 150ms and keeps the root panel visible", async () => {
    const anchor = await openRoot();
    fireEvent.mouseOver(anchor);
    // 150ms 之前不该出现：路过的鼠标不撑开面板
    expect(flyout()).toBeNull();

    await waitFor(() => expect(flyout()).not.toBeNull());
    // 一级没有被替换掉（悬停浮出与点击替换是两套形态）
    expect(screen.getByText(t("composerAddMenu.section.job"))).toBeInTheDocument();
    // 浮出层是一级的子元素：一级的 `overflow-y: auto`（高度上限）会把它裁没，
    // 所以浮出期间必须让出一级面板的裁切（见 assistant-composer-flyout.css）。
    expect(
      document.querySelector(".composer-add-panel")?.classList.contains("is-flyout-open"),
    ).toBe(true);
  });

  it("entering the flyout cancels the 300ms close, so crossing the gap does not flicker", async () => {
    const anchor = await openRoot();
    fireEvent.mouseOver(anchor);
    await waitFor(() => expect(flyout()).not.toBeNull());

    fireEvent.mouseOut(anchor);
    fireEvent.mouseOver(flyout() as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 360));

    expect(flyout()).not.toBeNull();
  });

  it("ArrowRight opens the flyout and focuses its first item; Esc closes it and returns focus", async () => {
    const anchor = await openRoot();
    const row = anchor.querySelector("button") as HTMLButtonElement;
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });

    const boxes = await screen.findAllByRole("checkbox");
    await waitFor(() => expect(boxes[0]).toHaveFocus());

    // 真的从焦点所在元素派发：二级的 Esc 走 React 处理器（带 stopPropagation），
    // 直接派到 document 会绕过它、让 antd 把整块面板一起收掉。
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(flyout()).toBeNull());
    expect(row).toHaveFocus();
    // Esc 只收二级：一级面板仍开着
    expect(screen.getByText(t("composerAddMenu.section.job"))).toBeInTheDocument();
  });

  it("search filters by name and description, and shows the no-match hint", async () => {
    renderMenu({ skillCatalog: [COACH, DIAG] });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 0 })));

    const search = await screen.findByRole("textbox", {
      name: t("composerAddMenu.skills.search"),
    });
    fireEvent.change(search, { target: { value: "ats" } });
    expect(screen.getByText(DIAG.name)).toBeInTheDocument();
    expect(screen.queryByText(COACH.name)).toBeNull();

    fireEvent.change(search, { target: { value: "nothing-matches" } });
    expect(screen.getByText(t("composerAddMenu.skills.noMatch"))).toBeInTheDocument();
    // 搜索不改预算口径：底部「管理技能」与本对话预算照旧
    expect(screen.getByText(t("conversationSkills.action.manage"))).toBeInTheDocument();
  });

  it("compact keeps click-to-replace and never renders the flyout", async () => {
    renderMenu({ compact: true, skillCatalog: [COACH] });
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 0 })));

    expect(screen.getByText(t("composerAddMenu.section.skills"))).toBeInTheDocument();
    expect(screen.queryByText(t("composerAddMenu.section.job"))).toBeNull();
    expect(flyout()).toBeNull();
  });

  it("short viewport stacks in place and never renders the flyout (F35)", async () => {
    // 只让高度查询命中：宽度仍按宽屏，证明"矮"单独就能触发整块替换。
    // setup 里的桩用 defineProperty 定义（不可直接赋值），所以这里也用 defineProperty 换掉。
    const stub = (query: string) => ({
      matches: query.includes("max-height"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: stub });
    try {
      renderMenu({ skillCatalog: [COACH] });
      fireEvent.click(trigger());
      const row = await screen.findByText(t("assistantComposer.skills.count", { count: 0 }));
      const anchor = row.closest(".composer-add-skills-anchor") as HTMLElement;
      fireEvent.mouseOver(anchor);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(flyout()).toBeNull();

      fireEvent.click(row);
      expect(screen.getByText(t("composerAddMenu.section.skills"))).toBeInTheDocument();
      expect(screen.queryByText(t("composerAddMenu.section.job"))).toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
    }
  });
});
