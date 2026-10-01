/** 求职助手输入区：引用追问的「×」清除引用（只清上下文、不发送）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssistantComposer from "./AssistantComposer";
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
    skills: [],
    skillsLoaded: true,
    togglingSkillId: null,
    jobOptions: [],
    resumeOptions: [],
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

/**
 * 带状态的壳：思考强度由**真实 state** 驱动。
 *
 * 与页面里一样——父组件收到 onChange 会回填，受控输入框才拿得到新值。把 onChange 换成
 * `vi.fn()` 的裸渲染测不了"清空后回到预设"这类行为：输入框的值会被 React 回滚成旧值。
 */
function renderComposerWithEffort(initial: string) {
  const onReasoningEffortChange = vi.fn();
  function Harness() {
    const [effort, setEffort] = useState(initial);
    return (
      <AntdApp>
        <AssistantComposer
          {...composerProps({
            reasoningEffort: effort,
            onReasoningEffortChange: (value: string) => {
              onReasoningEffortChange(value);
              setEffort(value);
            },
          })}
        />
      </AntdApp>
    );
  }
  return { onReasoningEffortChange, ...render(<Harness />) };
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

  it("浮窗里保留「附件」入口，选满 4 个后不可再选", () => {
    renderComposer({ compact: true });
    expect(screen.getByRole("button", { name: "添加附件" })).toBeEnabled();

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

    expect(screen.getByRole("button", { name: "添加附件" })).toBeDisabled();
  });
});

describe("AssistantComposer 思考强度", () => {
  /** 打开下拉并选中某一项（antd 的下拉是虚拟列表，用键盘回车选更稳）。 */
  function chooseEffort(label: string) {
    const combobox = screen.getByRole("combobox", { name: "思考强度" });
    fireEvent.mouseDown(combobox);
    fireEvent.change(combobox, { target: { value: label } });
    fireEvent.keyDown(combobox, { key: "Enter", code: "Enter", keyCode: 13 });
  }

  it("选「自定义…」后出现输入框，输入的值原样上抛", () => {
    const { props } = renderComposer();

    chooseEffort("自定义…");

    // 下拉换成输入框：档位词汇各家不同（xhigh / max / adaptive），只能自己填。
    const input = screen.getByLabelText("自定义思考强度");
    fireEvent.change(input, { target: { value: "xhigh" } });

    expect(props.onReasoningEffortChange).toHaveBeenCalledWith("xhigh");
  });

  it("把本地存下来的自定义值直接显示在输入框里", () => {
    // 打开页面时读回的是自定义值——不该退化成下拉里的空白项。
    renderComposer({ reasoningEffort: "xhigh" });

    expect(screen.getByLabelText("自定义思考强度")).toHaveValue("xhigh");
    expect(screen.queryByRole("combobox", { name: "思考强度" })).toBeNull();
  });

  it("自定义值清空后回到预设下拉，不留下一个空输入框", () => {
    const { onReasoningEffortChange } = renderComposerWithEffort("xhigh");
    const input = screen.getByLabelText("自定义思考强度");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onReasoningEffortChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("combobox", { name: "思考强度" })).toBeInTheDocument();
    expect(screen.queryByLabelText("自定义思考强度")).toBeNull();
  });
});
