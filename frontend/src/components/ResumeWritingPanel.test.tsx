// SPDX-License-Identifier: Apache-2.0
/** 简历写作增强面板：操作切换、调用接口、结果版本 / 编辑 / 微调与回填。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ResumeWritingPanel from "./ResumeWritingPanel";

const apiMocks = vi.hoisted(() => ({
  rewriteStar: vi.fn(),
  generatePhrases: vi.fn(),
  polishResumeText: vi.fn(),
  translateResumeText: vi.fn(),
}));

const refineMocks = vi.hoisted(() => ({ polishSelection: vi.fn() }));

const clipboardMock = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock("../api/resumeWriting", () => apiMocks);
vi.mock("../api/writing", () => refineMocks);
vi.mock("../utils/clipboard", () => clipboardMock);

const ORIGINAL = "负责后端服务开发";
const FIRST = "第一版：负责后端服务开发";
const SECOND = "第二版：负责后端服务开发，接口耗时下降 30%";
const THIRD = "第三版：负责后端服务";

function renderPanel(onApply?: (result: string) => boolean) {
  return render(
    <AntdApp>
      <ResumeWritingPanel resumeId={7} initialText={ORIGINAL} onApply={onApply} />
    </AntdApp>,
  );
}

/**
 * 按文案找按钮。
 *
 * antd 会在**两个汉字**之间插一个空格（"回填"渲染成"回 填"），所以可访问名要按
 * "每个字之间允许空白"匹配；顺带把 `「生成」` 这种只出现在说明块里的字样排除在外
 * （锚定首尾，说明块那整句不会被命中）。
 */
function buttonName(label: string): RegExp {
  return new RegExp(`^${label.split("").join("\\s*")}$`);
}

/** 点「生成」并等到第一版结果出现。 */
async function generateFirstVersion() {
  fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.generate")) }));
  return screen.findByDisplayValue(FIRST);
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  refineMocks.polishSelection.mockReset();
  clipboardMock.copyText.mockReset();
  clipboardMock.copyText.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeWritingPanel", () => {
  it("没有可写目标时动作是「复制」（回填无处可去）", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.generate")) }));

    // 结果现在是可编辑的输入框：读它的值，而不是找页面上的文本节点。
    expect(await screen.findByDisplayValue(FIRST)).toBeInTheDocument();
    expect(apiMocks.rewriteStar).toHaveBeenCalledWith(
      7,
      ORIGINAL,
      undefined,
      // T04-d：生成可被「停止」掐断，末尾参数是 AbortSignal。
      expect.anything(),
    );

    // 不传 `onApply` = 宿主没有可写目标（右键落在普通段落上），此时只能复制。
    expect(screen.queryByRole("button", { name: buttonName(t("writing.action.apply")) })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.copy")) }));
    expect(clipboardMock.copyText).toHaveBeenCalledWith(FIRST);
  });

  it("有可写目标时动作是「回填」：结果交给宿主写回选区，不碰剪贴板", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    const onApply = vi.fn();
    renderPanel(onApply);

    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.generate")) }));
    fireEvent.click(await screen.findByRole("button", { name: buttonName(t("writing.action.apply")) }));

    expect(onApply).toHaveBeenCalledWith(FIRST);
    // 回填与复制是两条互斥的出路：能写回就不该再往剪贴板塞一份。
    expect(clipboardMock.copyText).not.toHaveBeenCalled();
  });

  it("复制失败时给出可操作的提示，而不是假装成功", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    clipboardMock.copyText.mockResolvedValue(false);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.generate")) }));
    fireEvent.click(await screen.findByRole("button", { name: buttonName(t("writing.action.copy")) }));

    expect(await screen.findByText(t("writing.copy.failed"))).toBeInTheDocument();
  });

  it("话术生成展示三种版式", async () => {
    apiMocks.generatePhrases.mockResolvedValue({
      star: "STAR 改写结果",
      resume: "简历话术",
      interview: "口述内容",
    });
    renderPanel();

    fireEvent.click(screen.getByText("话术生成"));
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.generate")) }));

    expect(await screen.findByText("STAR 改写结果")).toBeInTheDocument();
    expect(screen.getByText("简历话术")).toBeInTheDocument();
    expect(screen.getByText("口述内容")).toBeInTheDocument();
    expect(apiMocks.generatePhrases).toHaveBeenCalledWith(
      7,
      ORIGINAL,
      ["star", "resume", "interview"],
      // T04-d：生成可被「停止」掐断，末尾参数是 AbortSignal。
      expect.anything(),
    );
  });

  it("接口报错时透出中文错误", async () => {
    apiMocks.rewriteStar.mockRejectedValue(new Error("STAR 改写失败：模型未返回有效结果"));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.generate")) }));

    expect(await screen.findByText(/STAR 改写失败/)).toBeInTheDocument();
  });

  it("点 chip 以上一版结果为输入继续微调，原文不被消耗", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    refineMocks.polishSelection.mockResolvedValue({ result: SECOND });
    renderPanel();

    await generateFirstVersion();
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.refine.shorter")) }));

    expect(await screen.findByDisplayValue(SECOND)).toBeInTheDocument();
    // 入参是"当前这一版"，不是原文。
    expect(refineMocks.polishSelection).toHaveBeenCalledWith(
      FIRST,
      expect.any(String),
      expect.anything(),
    );
    // 原文始终留在上方输入框里，迭代不消耗它。
    expect(screen.getByDisplayValue(ORIGINAL)).toBeInTheDocument();
  });

  it("每改一版推入版本栈，可切回旧版并回填选中的那一版", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    refineMocks.polishSelection
      .mockResolvedValueOnce({ result: SECOND })
      .mockResolvedValueOnce({ result: THIRD });
    const onApply = vi.fn();
    renderPanel(onApply);

    await generateFirstVersion();
    const shorter = screen.getByRole("button", { name: buttonName(t("writing.refine.shorter")) });
    fireEvent.click(shorter);
    await screen.findByDisplayValue(SECOND);
    fireEvent.click(shorter);
    await screen.findByDisplayValue(THIRD);

    // 生成 = v1，两次迭代 = v2 / v3。
    const v1 = screen.getByRole("button", { name: t("writing.version.label", { index: 1 }) });
    expect(
      screen.getByRole("button", { name: t("writing.version.label", { index: 3 }) }),
    ).toBeInTheDocument();

    fireEvent.click(v1);
    expect(screen.getByDisplayValue(FIRST)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.apply")) }));
    expect(onApply).toHaveBeenCalledWith(FIRST);
  });

  it("切版本不会丢掉手动改动：改动留在那一版里", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    refineMocks.polishSelection.mockResolvedValue({ result: SECOND });
    renderPanel();

    await generateFirstVersion();
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.refine.shorter")) }));
    const result = await screen.findByDisplayValue(SECOND);

    const edited = `${SECOND}（手工补充）`;
    fireEvent.change(result, { target: { value: edited } });

    const versionButton = (index: number) =>
      screen.getByRole("button", { name: t("writing.version.label", { index }) });
    fireEvent.click(versionButton(1));
    expect(screen.getByDisplayValue(FIRST)).toBeInTheDocument();
    fireEvent.click(versionButton(2));

    // 切走再切回，改过的字还在（编辑直接写进版本栈，不是"未保存草稿"）。
    expect(screen.getByDisplayValue(edited)).toBeInTheDocument();
    expect(screen.getByText(t("writing.result.edited"))).toBeInTheDocument();
  });

  it("版本栈最多保留 5 版，最早的一版被挤掉", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    refineMocks.polishSelection.mockImplementation(async (text: string) => ({
      result: `${text}!`,
    }));
    renderPanel();

    await generateFirstVersion();
    let expected = FIRST;
    for (let round = 0; round < 6; round += 1) {
      fireEvent.click(
        screen.getByRole("button", { name: buttonName(t("writing.refine.shorter")) }),
      );
      expected = `${expected}!`;
      // 等这一版落地再点下一次：在飞时 chip 是禁用的，提前点会被守卫吞掉。
      await screen.findByDisplayValue(expected);
    }

    const group = screen.getByRole("group", { name: t("writing.version.ariaLabel") });
    expect(within(group).getAllByRole("button")).toHaveLength(5);
  });

  it("自定义要求发给 polish-selection，输入上限 200 字", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    refineMocks.polishSelection.mockResolvedValue({ result: SECOND });
    renderPanel();

    await generateFirstVersion();
    const custom = screen.getByRole("textbox", { name: t("writing.refine.customAriaLabel") });
    // 超长在输入处就被截断（antd maxLength），不会带着 201 字发给后端。
    expect(custom).toHaveAttribute("maxlength", "200");

    fireEvent.change(custom, { target: { value: "突出增长数据" } });
    fireEvent.click(screen.getByRole("button", { name: t("writing.refine.submit") }));

    expect(await screen.findByDisplayValue(SECOND)).toBeInTheDocument();
    expect(refineMocks.polishSelection).toHaveBeenCalledWith(
      FIRST,
      "突出增长数据",
      expect.anything(),
    );
  });

  it("结果可直接编辑：回填写回改后的文本并标记已修改", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    const onApply = vi.fn();
    renderPanel(onApply);

    const result = await generateFirstVersion();
    const edited = `${FIRST}（手工补充）`;
    fireEvent.change(result, { target: { value: edited } });

    expect(screen.getByText(t("writing.result.edited"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.action.apply")) }));
    expect(onApply).toHaveBeenCalledWith(edited);
  });

  it("微调失败时保留原结果，不产生空版本", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: FIRST });
    // 非 Error 的拒绝走兜底文案（见 errorText）。
    refineMocks.polishSelection.mockRejectedValueOnce("network down");
    renderPanel();

    await generateFirstVersion();
    fireEvent.click(screen.getByRole("button", { name: buttonName(t("writing.refine.shorter")) }));

    expect(await screen.findByText(t("writing.refine.failed"))).toBeInTheDocument();
    // 旧结果还在，版本栈也没有多出一版（v2 不存在）。
    expect(screen.getByDisplayValue(FIRST)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("writing.version.label", { index: 2 }) }),
    ).toBeNull();
  });

  it("用法说明默认收成一行，点开才显示全文", () => {
    renderPanel();

    expect(screen.queryByText(t("writing.hint.body"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("writing.hint.expand")) }));
    expect(screen.getByText(t("writing.hint.body"))).toBeInTheDocument();
  });
});
