// SPDX-License-Identifier: Apache-2.0
/**
 * AI 润色卡片 ·「继续改写」（可反复迭代）+ 换选区（D2）。
 *
 * 「继续改写」最容易写错的地方是**输入源**：看起来只是"再发一次请求"，但如果又拿原文
 * 去发，用户上一版的改动（无论是模型改的还是他自己手改的）就白丢了，而且界面看起来
 * "没反应"——因为结果会退回第一版。所以这里钉住三件事：
 *
 * 1. 继续改写的第一个参数必须是**当前结果框里的文字**，第二个参数是这次写的要求；
 * 2. 成功后原地换成新结果并清空要求，仍停在结果态（可以再改一轮）；
 * 3. 失败不动上一版结果与要求（直接再点一次即可重试）；结果超长时不发请求。
 *
 * 换选区那组是**数据正确性**用例：卡片若被复用，上一段的改写结果会留在结果框里，
 * 用户在新选区点「替换选中」就把上一段的结果写了进去。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiPolishCard, { MAX_SELECTION_CHARS } from "./AiPolishCard";
import { getLLMConfig } from "../../api/settings";
import { polishSelection } from "../../api/writing";
import type { SelectionTarget } from "./selectionTarget";

vi.mock("../../api/settings", () => ({ getLLMConfig: vi.fn() }));
vi.mock("../../api/writing", () => ({ polishSelection: vi.fn() }));

const getLLMConfigMock = vi.mocked(getLLMConfig);
const polishSelectionMock = vi.mocked(polishSelection);

const ORIGINAL = "负责后端接口开发";
const FIRST = "主导后端接口开发，接口可用性提升到 99.9%";
const SECOND = "主导后端接口开发，可用性 99.9%，故障恢复 3 分钟内";
const THIRD = "主导后端接口开发（可用性 99.9%，恢复 <3min），支撑日均 200 万次调用";

function configuredModel() {
  return { base_url: "http://fake", model: "fake-model" } as Awaited<
    ReturnType<typeof getLLMConfig>
  >;
}

function makeTarget(text: string = ORIGINAL): SelectionTarget {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  return {
    kind: "textarea",
    element: textarea,
    start: 0,
    end: text.length,
    text,
    rect: { left: 100, top: 100, width: 120, height: 20, right: 220, bottom: 120 },
  };
}

function renderCard(target: SelectionTarget = makeTarget()) {
  return render(
    <AiPolishCard target={target} left={80} top={80} onClose={vi.fn()} onReplaced={vi.fn()} />,
  );
}

/** 走完"开始改写"，卡片进入结果态。 */
async function rewriteTo(result: string) {
  polishSelectionMock.mockResolvedValueOnce({ result });
  fireEvent.click(startButton());
  expect(await screen.findByLabelText("改写结果")).toHaveValue(result);
}

/**
 * 「开始改写」按钮。
 *
 * 与 `continueButton` 同一原因按名字片段匹配：请求发过一轮之后，antd 的 loading 退场
 * 图标会留在 jsdom 的 DOM 里（`aria-label="loading"`），可访问名变成 `loading开始改写`。
 */
function startButton(): HTMLElement {
  return screen.getByRole("button", { name: /开始改写/ });
}

/**
 * 「继续改写」按钮。
 *
 * 用正则而不是全名：antd 在 `loading` 转回 false 之后，会留一个"退场中"的转圈图标
 * （`aria-label="loading"`），可访问名因此变成 `loading继续改写`。真机上那段退场动画
 * 300ms 内跑完、图标随即移除，而 jsdom 不会推进动画——所以这里按名字片段匹配。
 */
function continueButton(): HTMLElement {
  return screen.getByRole("button", { name: /继续改写/ });
}

beforeEach(() => {
  getLLMConfigMock.mockResolvedValue(configuredModel());
  polishSelectionMock.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AiPolishCard 继续改写", () => {
  it("以上一次改写结果作为输入，成功后原地换成新结果并清空要求", async () => {
    renderCard();
    await rewriteTo(FIRST);
    polishSelectionMock.mockResolvedValueOnce({ result: SECOND });

    const followUp = screen.getByLabelText("继续改写要求");
    fireEvent.change(followUp, { target: { value: "突出量化结果" } });
    fireEvent.click(continueButton());

    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(SECOND));

    // 关键断言：第二次请求的输入是**上一次的结果**，不是原文。
    expect(polishSelectionMock).toHaveBeenCalledTimes(2);
    expect(polishSelectionMock.mock.calls[1][0]).toBe(FIRST);
    expect(polishSelectionMock.mock.calls[1][1]).toBe("突出量化结果");
    // 要求已兑现 → 输入框清空；仍停在结果态（还能再改一轮）。
    await waitFor(() => expect(screen.getByLabelText("继续改写要求")).toHaveValue(""));
    expect(screen.queryByLabelText("润色要求")).toBeNull();
  });

  it("可以连着改多轮，每一轮都把上一轮的输出当输入", async () => {
    renderCard();
    await rewriteTo(FIRST);

    polishSelectionMock.mockResolvedValueOnce({ result: SECOND });
    fireEvent.change(screen.getByLabelText("继续改写要求"), { target: { value: "再精简" } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(SECOND));

    polishSelectionMock.mockResolvedValueOnce({ result: THIRD });
    fireEvent.change(screen.getByLabelText("继续改写要求"), { target: { value: "补上规模数据" } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(THIRD));

    expect(polishSelectionMock).toHaveBeenCalledTimes(3);
    expect(polishSelectionMock.mock.calls[2][0]).toBe(SECOND);
    expect(polishSelectionMock.mock.calls[2][1]).toBe("补上规模数据");
  });

  it("失败时保留上一版结果与刚写的要求，再点一次可重试", async () => {
    renderCard();
    await rewriteTo(FIRST);

    polishSelectionMock.mockRejectedValueOnce(new Error("模型调用超时"));
    fireEvent.change(screen.getByLabelText("继续改写要求"), { target: { value: "去掉形容词" } });
    fireEvent.click(continueButton());

    expect(await screen.findByText("模型调用超时")).toBeInTheDocument();
    // 结果与要求都在：重试不该让用户重新输入一遍。
    expect(screen.getByLabelText("改写结果")).toHaveValue(FIRST);
    expect(screen.getByLabelText("继续改写要求")).toHaveValue("去掉形容词");

    polishSelectionMock.mockResolvedValueOnce({ result: SECOND });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(SECOND));
    expect(polishSelectionMock.mock.calls[2][0]).toBe(FIRST);
  });

  it("结果超过单次上限时禁用「继续改写」并说明原因", async () => {
    renderCard();
    await rewriteTo("字".repeat(MAX_SELECTION_CHARS + 1));

    expect(
      screen.getByText(`待改写内容超过 ${MAX_SELECTION_CHARS} 字，请先手动精简`),
    ).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();

    // 手改回上限以内就恢复可用，且发出去的就是精简后的这段。
    const result = screen.getByLabelText("改写结果");
    fireEvent.change(result, { target: { value: FIRST } });
    expect(continueButton()).toBeEnabled();
    expect(screen.queryByText(`待改写内容超过 ${MAX_SELECTION_CHARS} 字，请先手动精简`)).toBeNull();

    polishSelectionMock.mockResolvedValueOnce({ result: SECOND });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(SECOND));
    expect(polishSelectionMock.mock.calls[1][0]).toBe(FIRST);
  });

  it("「重新改写」仍然从原文重来，不走上一版结果", async () => {
    renderCard();
    await rewriteTo(FIRST);

    polishSelectionMock.mockResolvedValueOnce({ result: SECOND });
    fireEvent.change(screen.getByLabelText("继续改写要求"), { target: { value: "再精简" } });
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(SECOND));

    polishSelectionMock.mockResolvedValueOnce({ result: THIRD });
    fireEvent.click(screen.getByRole("button", { name: "重新改写" }));
    await waitFor(() => expect(screen.getByLabelText("改写结果")).toHaveValue(THIRD));

    // 第三条请求回到原文（且首个要求为空），与"继续改写"是两条不同的路径。
    expect(polishSelectionMock.mock.calls[2][0]).toBe(ORIGINAL);
    expect(polishSelectionMock.mock.calls[2][1]).toBe("");
  });

  it("超长提示能被读屏播报：status 角色 + 输入框的 aria-describedby 指向它", async () => {
    renderCard();
    await rewriteTo("字".repeat(MAX_SELECTION_CHARS + 1));

    const hint = screen.getByText(`待改写内容超过 ${MAX_SELECTION_CHARS} 字，请先手动精简`);
    expect(hint).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("继续改写要求")).toHaveAttribute("aria-describedby", hint.id);

    // 提示消失后不能留下指向空节点的 aria-describedby。
    fireEvent.change(screen.getByLabelText("改写结果"), { target: { value: FIRST } });
    expect(screen.getByLabelText("继续改写要求")).not.toHaveAttribute("aria-describedby");
  });

  it("「继续改写」在飞时「重新改写」是禁用的（不再『能点但没反应』）", async () => {
    renderCard();
    await rewriteTo(FIRST);

    // 永不返回：把卡片钉在"继续改写进行中"。
    polishSelectionMock.mockImplementationOnce(() => new Promise<never>(() => undefined));
    fireEvent.click(continueButton());

    await waitFor(() => expect(screen.getByRole("button", { name: "重新改写" })).toBeDisabled());
    // 与「替换选中」一致：整个卡片同一时刻只允许一条在飞。
    expect(screen.getByRole("button", { name: "替换选中" })).toBeDisabled();
    // 正在跑的那一颗反过来不该被置灰，否则看不出它在跑。
    expect(continueButton()).toBeEnabled();
  });
});

/**
 * 换选区（2026-10-21 QA 复核 D2）。
 *
 * 这是**数据正确性**问题，不是视觉问题：卡片若被复用，上一段的改写结果会留在
 * `rewritten` 里，用户在新选区里点「替换选中」就把上一段的结果写了进去。
 */
describe("AiPolishCard 换选区", () => {
  /** 换到另一段文字（新元素、新偏移、新文本），模拟浮层把卡片挪过去。 */
  function rerenderTo(rerender: (ui: ReactElement) => void, target: SelectionTarget, top = 160) {
    rerender(
      <AiPolishCard target={target} left={120} top={top} onClose={vi.fn()} onReplaced={vi.fn()} />,
    );
  }

  it("结果态下换成另一段选区：回到填写要求的状态，看不到上一段的结果", async () => {
    const { rerender } = renderCard();
    await rewriteTo(FIRST);
    expect(screen.getByLabelText("改写结果")).toHaveValue(FIRST);

    rerenderTo(rerender, makeTarget("负责渠道投放"));

    // 结果态的东西全没了：改写结果框、继续改写要求框都不该在。
    expect(screen.queryByLabelText("改写结果")).toBeNull();
    expect(screen.queryByLabelText("继续改写要求")).toBeNull();
    // 回到填写要求的状态，且要求也是空的（上一段写的要求不该跟过来）。
    expect(screen.getByLabelText("润色要求")).toHaveValue("");
    expect(startButton()).toBeInTheDocument();
    // 卡片里显示的是新选区的原文。
    expect(screen.getByRole("dialog", { name: "AI 润色" })).toHaveTextContent("负责渠道投放");
  });

  it("改写请求在飞时换成另一段选区：旧请求被中止，结果不会落到新选区", async () => {
    let signal: AbortSignal | undefined;
    // 永不返回：模拟"还在等模型"。若卡片不 abort，这条请求会一直挂着。
    polishSelectionMock.mockImplementationOnce((_text, _instruction, st) => {
      signal = st;
      return new Promise<never>(() => undefined);
    });
    const { rerender } = renderCard();

    fireEvent.click(startButton());
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    rerenderTo(rerender, makeTarget("负责渠道投放"));

    await waitFor(() => expect(signal?.aborted).toBe(true));
    // 旧请求的 finally 不该把新选区的状态锁住：按钮仍然可用。
    expect(startButton()).toBeEnabled();
    expect(screen.queryByLabelText("改写结果")).toBeNull();
  });

  it("同一段选区重渲（父组件换了个对象）不会清掉用户正在编辑的结果", async () => {
    const target = makeTarget();
    const { rerender } = renderCard(target);
    await rewriteTo(FIRST);

    // 同一段文字、同一个元素，只是又造了个对象：这是"父组件重渲"，不是换选区。
    const sameSelection: SelectionTarget = { ...target, rect: { ...target.rect } };
    rerenderTo(rerender, sameSelection);

    expect(screen.getByLabelText("改写结果")).toHaveValue(FIRST);
  });
});
