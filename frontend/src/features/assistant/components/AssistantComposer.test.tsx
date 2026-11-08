// SPDX-License-Identifier: Apache-2.0
/** 求职助手输入区：引用追问的「×」清除引用（只清上下文、不发送）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssistantComposer from "./AssistantComposer";
import { t } from "../../../i18n";
import { MAX_ATTACHMENT_COUNT } from "../assistantUtils";
import type { AssistantQuotedMessage } from "../../../types";

function composerProps(overrides: Partial<Parameters<typeof AssistantComposer>[0]> = {}) {
  return {
    content: "",
    attachments: [],
    sending: false,
    attachmentReads: 0,
    jobId: undefined,
    resumeId: undefined,
    webSearch: false,
    reasoningEffort: "" as const,
    skillCatalog: [],
    selectedSkills: [],
    skillBudget: null,
    skillsLoaded: true,
    togglingSkillId: null,
    onContentChange: vi.fn(),
    onJobChange: vi.fn(),
    onResumeChange: vi.fn(),
    onWebSearchChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onToggleSkill: vi.fn(),
    onManageSkills: vi.fn(),
    onAddAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    quoted: null,
    onClearQuote: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

function renderComposer(overrides: Partial<Parameters<typeof AssistantComposer>[0]> = {}) {
  const props = composerProps(overrides);
  return {
    props,
    ...render(
      <AntdApp>
        <AssistantComposer {...props} />
      </AntdApp>,
    ),
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AssistantComposer 引用追问", () => {
  it("显示引用标签与内容，点「×」清除引用且不发送", () => {
    const quoted: AssistantQuotedMessage = {
      id: 5,
      role: "assistant",
      excerpt: "这是被引用的回复内容",
    };
    const { props } = renderComposer({ quoted });

    expect(screen.getByText("引用助手的回复")).toBeInTheDocument();
    expect(screen.getByText("这是被引用的回复内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消引用" }));

    expect(props.onClearQuote).toHaveBeenCalledTimes(1);
    // 清除引用只是清空 quoted 上下文，绝不能顺带把消息发出去。
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("没有引用时不渲染引用标签", () => {
    renderComposer();
    expect(screen.queryByText(/引用/)).toBeNull();
  });

  it("长引用时取消按钮仍渲染且可点击（不会被挤掉）", () => {
    const longExcerpt =
      "这是一段会占满整行的超长被引用回答内容，应当被截断而不是把取消按钮挤出可视区。".repeat(30);
    const quoted: AssistantQuotedMessage = { id: 9, role: "assistant", excerpt: longExcerpt };
    const { props } = renderComposer({ quoted });

    // 超长引用下，引用文字被截断（不再整段铺满），但「取消引用」按钮始终在 DOM 里可点。
    const closeButton = screen.getByRole("button", { name: "取消引用" });
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(props.onClearQuote).toHaveBeenCalledTimes(1);
  });
});

describe("AssistantComposer 粘贴与附件", () => {
  const imageItem = (file: File) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  });
  const pasteIntoComposer = (items: unknown[]) =>
    fireEvent.paste(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      clipboardData: { items },
    });

  it("粘贴截图交给附件流程，并拦下这次粘贴", () => {
    const { props } = renderComposer({ compact: true });
    const file = new File([new Uint8Array(8)], "shot.png", { type: "image/png" });

    // 返回值是"事件没有被 preventDefault"，false 表示这次粘贴被接管了。
    const notPrevented = pasteIntoComposer([imageItem(file)]);

    expect(props.onAddAttachment).toHaveBeenCalledWith(file);
    expect(notPrevented).toBe(false);
  });

  it("粘贴纯文本原样放行，不吃掉换行和正常输入", () => {
    const { props } = renderComposer({ compact: true });

    const notPrevented = pasteIntoComposer([{ kind: "string", type: "text/plain" }]);

    expect(props.onAddAttachment).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("剪贴板里没有文件名的截图会被补一个能通过校验的名字", () => {
    const { props } = renderComposer({ compact: true });
    const nameless = new File([new Uint8Array(8)], "", { type: "image/png" });

    pasteIntoComposer([imageItem(nameless)]);

    expect(props.onAddAttachment).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onAddAttachment).mock.calls[0][0].name).toBe("clipboard-1.png");
  });

  it("浮窗里也渲染已选附件，并能逐个移除", () => {
    const attachment = {
      id: 3,
      name: "岗位截图.png",
      mime_type: "image/png",
      data: "data:image/png;base64,AAAA",
      size: 4,
      kind: "image" as const,
    };
    const { props } = renderComposer({ compact: true, attachments: [attachment] });

    expect(screen.getByAltText("岗位截图.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除附件 岗位截图.png" }));

    expect(props.onRemoveAttachment).toHaveBeenCalledWith(3);
  });

  it("附件入口收在 + 面板里；选满 4 个后不可再选", async () => {
    // R06-A：附件不再是工具栏上的一枚独立按钮，点 `+` 才看得到（限制照旧）。
    const openAttach = async () => {
      fireEvent.click(screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }));
      return screen.findByRole("button", { name: "添加附件" });
    };

    renderComposer({ compact: true });
    expect(await openAttach()).toBeEnabled();

    cleanup();
    const four = Array.from({ length: MAX_ATTACHMENT_COUNT }, (_, index) => ({
      id: index + 1,
      name: `${index}.png`,
      mime_type: "image/png",
      data: "data:image/png;base64,AAAA",
      size: 4,
      kind: "image" as const,
    }));
    renderComposer({ compact: true, attachments: four });

    expect(await openAttach()).toBeDisabled();
  });
});

describe("AssistantComposer 附件 Tooltip", () => {
  it("浮窗里使用短文案，并限宽抬层避免被卡片盖住或溢出视口", async () => {
    renderComposer({ compact: true });

    fireEvent.click(screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }));
    fireEvent.mouseEnter(await screen.findByRole("button", { name: "添加附件" }));
    // 用文案定位这一条 tooltip：点过 `+` 之后它自己的提示也可能挂在 DOM 里。
    const content = await screen.findByText(t("assistantComposer.tooltip.attachCompact"));
    const tooltip = content.closest(".ant-tooltip") as HTMLElement;
    // 卡片（3400）高于 antd Tooltip 默认 1070 会被盖住，显式抬到卡片内弹层基准
    // 3550 才稳在卡片之上；maxWidth 保证换行不水平溢出。
    expect(tooltip.style.zIndex).toBe("3550");
    expect(tooltip.style.maxWidth).toBe("240px");
  });

  it("整页分支保留完整文案", async () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }));
    fireEvent.mouseEnter(await screen.findByRole("button", { name: "添加附件" }));
    expect(await screen.findByText(t("assistantComposer.tooltip.attach"))).toBeInTheDocument();
  });
});

describe("AssistantComposer 输入区上方", () => {
  it("不再有常驻的虚线按钮行（关联 / 技能都收进工具栏的 +）", () => {
    renderComposer();

    // 两枚旧的空态入口都不在了
    expect(screen.queryByRole("button", { name: t("assistantComposer.context.add") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("conversationSkills.action.add") })).toBeNull();
    // 取而代之的是工具栏最左的 +（空对话里它是仅有的入口）
    expect(
      screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }),
    ).toBeInTheDocument();
  });

  it("空的关联 / 技能行不占位（不渲染空容器）", () => {
    const { container } = renderComposer();
    expect(container.querySelector(".assistant-context-chips")).toBeNull();
    expect(container.querySelector(".assistant-skill-chips")).toBeNull();
  });

  it("思考强度不再单独占一行：左侧没有标签、没有下拉", () => {
    renderComposer();
    expect(screen.queryByText(t("assistantComposer.effort.label"))).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: t("assistantComposer.effort.label") }),
    ).toBeNull();
  });

  it("麦克风在发送键左边（语音挪到右侧组）", () => {
    renderComposer();
    const mic = screen.getByRole("button", { name: t("voiceInput.aria.start") });
    const send = screen.getByRole("button", { name: t("assistantComposer.aria.send") });
    expect(mic.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// T14：对话技能 chip 行（按对话启用后的输入区入口）
// ---------------------------------------------------------------------------

function catalogSkill(id: number, name: string) {
  return {
    id,
    name,
    description: "",
    enabled: true,
    source_name: "",
    prompt_chars: 30,
    files: [],
    updated_at: "2026-11-07T00:00:00",
  };
}

function selectedSkill(id: number, name: string) {
  return { id, name, description: "" };
}

// 断言文案走变量 / t() 派生：中文 ByText 字面量会推高 i18n 棘轮（只降不升）。
const INTERVIEW_SKILL = "面试官追问";
const RESUME_SKILL = "简历诊断";

describe("AssistantComposer 对话技能 chip", () => {
  it("已启用技能逐个显示为 chip；点 × 只停用当个，其它 chip 不动", () => {
    const onToggleSkill = vi.fn();
    renderComposer({
      skillCatalog: [catalogSkill(1, "面试官追问"), catalogSkill(2, "简历诊断")],
      selectedSkills: [selectedSkill(1, "面试官追问"), selectedSkill(2, "简历诊断")],
      onToggleSkill,
    });

    expect(screen.getByText(INTERVIEW_SKILL)).toBeInTheDocument();
    expect(screen.getByText(RESUME_SKILL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停用技能「面试官追问」" }));

    expect(onToggleSkill).toHaveBeenCalledTimes(1);
    expect(onToggleSkill.mock.calls[0][0].id).toBe(1);
    expect(onToggleSkill.mock.calls[0][1]).toBe(false);
    // "不改其它"：第二枚 chip 仍在。
    expect(screen.getByText(RESUME_SKILL)).toBeInTheDocument();
  });

  it("一个都没启用时不渲染任何 chip（入口在工具栏的 + 面板里）", () => {
    renderComposer({ skillCatalog: [catalogSkill(1, "面试官追问")] });

    expect(screen.queryByText(INTERVIEW_SKILL)).toBeNull();
    expect(screen.queryByRole("group", { name: t("composerAddMenu.section.skills") })).toBeNull();
    expect(
      screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }),
    ).toBeInTheDocument();
  });

  it("菜单与 chip 同一数据源：已选的在菜单里是勾上的，点一下回传停用", async () => {
    const onToggleSkill = vi.fn();
    renderComposer({
      skillCatalog: [catalogSkill(1, "面试官追问")],
      selectedSkills: [selectedSkill(1, "面试官追问")],
      onToggleSkill,
    });

    // 入口现在是 `+` → 技能（二级面板与 chip 同一数据源）
    fireEvent.click(screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }));
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 1 })));
    expect(await screen.findByRole("checkbox")).toBeChecked();
    // chip 与列表项同名：要点列表里的那个文本，不能点 chip 上的名字。
    const picker = await screen.findByRole("group", {
      name: t("composerAddMenu.section.skills"),
    });
    fireEvent.click(within(picker).getByText(INTERVIEW_SKILL));

    expect(onToggleSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false);
  });

  it("菜单底部显示本对话预算（个 / 字数）", async () => {
    renderComposer({
      selectedSkills: [selectedSkill(1, "面试官追问")],
      skillCatalog: [catalogSkill(1, "面试官追问")],
      skillBudget: {
        used_chars: 1_200,
        loaded_chars: 1_200,
        limit_chars: 12_000,
        truncated_skill_ids: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }));
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 1 })));

    expect(
      await screen.findByText(
        t("conversationSkills.menu.budget", { count: 1, used: "1,200", limit: "12,000" }),
      ),
    ).toBeInTheDocument();
  });

  it("被截断的技能 chip 用琥珀描边，并有说明 tooltip", async () => {
    renderComposer({
      selectedSkills: [selectedSkill(1, "面试官追问")],
      skillCatalog: [catalogSkill(1, "面试官追问")],
      skillBudget: {
        used_chars: 13_000,
        loaded_chars: 12_000,
        limit_chars: 12_000,
        truncated_skill_ids: [1],
      },
    });

    const chip = screen.getByText(INTERVIEW_SKILL).closest(".assistant-skill-chip");
    expect(chip).toHaveClass("is-truncated");
    fireEvent.mouseEnter(screen.getByText(INTERVIEW_SKILL));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("提示词超出本对话预算");
  });

  it("浮窗（compact）里也渲染技能 chip 行", () => {
    renderComposer({
      compact: true,
      selectedSkills: [selectedSkill(1, "面试官追问")],
      skillCatalog: [catalogSkill(1, "面试官追问")],
    });

    expect(screen.getByText(INTERVIEW_SKILL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }),
    ).toBeInTheDocument();
  });
});
