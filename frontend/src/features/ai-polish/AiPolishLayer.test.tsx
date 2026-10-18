import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AiPolishLayer from "./AiPolishLayer";
import { getLLMConfig } from "../../api/settings";
import { polishSelection } from "../../api/writing";

vi.mock("../../api/settings", () => ({ getLLMConfig: vi.fn() }));
vi.mock("../../api/writing", () => ({ polishSelection: vi.fn() }));

const getLLMConfigMock = vi.mocked(getLLMConfig);
const polishSelectionMock = vi.mocked(polishSelection);

const ORIGINAL = "负责后端接口开发";
const REWRITTEN = "主导后端接口开发，接口可用性提升到 99.9%";
/** 比选区防抖（150ms）多留一点余量，让"不出现按钮"的断言真的等过了那一拍。 */
const PAST_DEBOUNCE_MS = 220;

function configuredModel() {
  return { base_url: "http://fake", model: "fake-model" } as Awaited<
    ReturnType<typeof getLLMConfig>
  >;
}

function mountTextarea(value: string): HTMLTextAreaElement {
  const element = document.createElement("textarea");
  element.value = value;
  element.setAttribute("aria-label", "简历片段");
  document.body.append(element);
  return element;
}

async function selectWhole(element: HTMLTextAreaElement) {
  element.focus();
  element.setSelectionRange(0, element.value.length);
  fireEvent.mouseUp(element);
  return screen.findByRole("button", { name: "AI 润色" });
}

function renderLayer() {
  return render(
    <MemoryRouter>
      <AiPolishLayer />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getLLMConfigMock.mockResolvedValue(configuredModel());
  polishSelectionMock.mockResolvedValue({ result: REWRITTEN });
});

afterEach(() => {
  act(() => {
    window.getSelection()?.removeAllRanges();
  });
  cleanup();
  document.body.innerHTML = "";
});

describe("AiPolishLayer", () => {
  it("选中文字 → 出按钮 → 卡片 → 改写 → 替换，输入框里留下结果", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();

    fireEvent.click(await selectWhole(field));

    const card = await screen.findByRole("dialog", { name: "AI 润色" });
    // 卡片里既要有选中的原文，也要说清楚只发这一段。
    expect(card).toHaveTextContent(ORIGINAL);
    expect(card).toHaveTextContent("只发送选中的这段文字，不发送整份简历");

    fireEvent.click(screen.getByRole("button", { name: "开始改写" }));

    expect(await screen.findByLabelText("改写结果")).toHaveValue(REWRITTEN);
    // 只把选中的这一段发出去，且没写要求时 instruction 为空。
    expect(polishSelectionMock).toHaveBeenCalledTimes(1);
    expect(polishSelectionMock.mock.calls[0][0]).toBe(ORIGINAL);
    expect(polishSelectionMock.mock.calls[0][1]).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "替换选中" }));

    // await 一次再断言：确认替换不是"刚写进去又被 React 重渲染回滚"。
    await waitFor(() => expect(field.value).toBe(REWRITTEN));
    expect(screen.queryByRole("dialog", { name: "AI 润色" })).toBeNull();
  });

  it("点「取消」不替换原文", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();

    fireEvent.click(await selectWhole(field));
    await screen.findByRole("dialog", { name: "AI 润色" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI 润色" })).toBeNull());
    expect(field.value).toBe(ORIGINAL);
    expect(polishSelectionMock).not.toHaveBeenCalled();
  });

  it("密码框里选中文字不出按钮", async () => {
    const password = document.createElement("input");
    password.type = "password";
    password.value = "hunter2-value";
    password.setAttribute("aria-label", "密码");
    document.body.append(password);
    renderLayer();

    password.focus();
    password.setSelectionRange(0, 4);
    fireEvent.mouseUp(password);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    });
    expect(screen.queryByRole("button", { name: "AI 润色" })).toBeNull();
  });

  it("没配模型时卡片里给去设置的入口，且不发请求", async () => {
    getLLMConfigMock.mockResolvedValue({
      base_url: "",
      model: "",
    } as Awaited<ReturnType<typeof getLLMConfig>>);
    const field = mountTextarea(ORIGINAL);
    renderLayer();

    fireEvent.click(await selectWhole(field));
    await screen.findByRole("dialog", { name: "AI 润色" });
    fireEvent.click(screen.getByRole("button", { name: "开始改写" }));

    const link = await screen.findByRole("link", { name: "去设置配置模型" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(polishSelectionMock).not.toHaveBeenCalled();
  });

  it("接口报错时错误留在卡片里，选区与要求都还在", async () => {
    polishSelectionMock.mockRejectedValue(new Error("润色失败：模型返回超时"));
    const field = mountTextarea(ORIGINAL);
    renderLayer();

    fireEvent.click(await selectWhole(field));
    await screen.findByRole("dialog", { name: "AI 润色" });
    fireEvent.change(screen.getByLabelText("润色要求"), { target: { value: "更简洁" } });
    fireEvent.click(screen.getByRole("button", { name: "开始改写" }));

    expect(await screen.findByText("润色失败：模型返回超时")).toBeInTheDocument();
    // 要求没被清空，用户可以改一改直接重试；按钮回到可点状态（不在 loading）。
    expect(screen.getByLabelText("润色要求")).toHaveValue("更简洁");
    expect(screen.getByRole("button", { name: /开始改写/ })).toBeEnabled();
    expect(field.value).toBe(ORIGINAL);
  });
});
