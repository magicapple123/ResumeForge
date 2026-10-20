// SPDX-License-Identifier: Apache-2.0
/**
 * 页头模型切换下拉（C-3 / T8）：显示「使用中」记录、切换即 activate、无记录时不渲染，
 * 以及 T8 新增的双击语义——**双击只测连接，绝不切换当前配置**。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelProfileSelect from "./ModelProfileSelect";
import {
  bumpLLMConfig,
  resetLLMConfigListenersForTests,
} from "../features/settings/llmConfigEvents";

const mocks = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  listLLMConfigRecords: vi.fn(),
  activateLLMRecord: vi.fn(),
  testLLM: vi.fn(),
}));

vi.mock("../api/settings", () => mocks);

function makeRecord(id: string, name: string, model: string, isActive = false) {
  return {
    id,
    name,
    model,
    provider: "custom",
    base_url: "https://api.example.com/v1",
    api_key: `********:profile:${id}`,
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: 0,
    api_style: "openai",
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
    extra_body: {},
    models: [model],
    is_active: isActive,
    created_at: "2026-10-19T10:00:00",
    updated_at: "2026-10-19T10:00:00",
  };
}

function renderSelect() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/jobs"]}>
        <ModelProfileSelect />
      </MemoryRouter>
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  // 兜底：任何用例让假时钟漏出来，后面的用例会集体超时。
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.getLLMConfig.mockReset();
  mocks.listLLMConfigRecords.mockReset();
  mocks.activateLLMRecord.mockReset();
  mocks.testLLM.mockReset();
  mocks.testLLM.mockResolvedValue({ ok: true, latency_ms: 123, message: "" });
});

describe("页头模型切换下拉", () => {
  it("显示当前使用中的记录名与模型", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord("p_a", "DeepSeek 日常", "deepseek-flash", true),
      makeRecord("p_b", "备用", "qwen3"),
    ]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });

    renderSelect();

    expect(await screen.findByText("DeepSeek 日常 · deepseek-flash")).toBeInTheDocument();
  });

  it("选择另一条记录后调用 activate 并更新当前值", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord("p_a", "DeepSeek 日常", "deepseek-flash", true),
      makeRecord("p_b", "备用", "qwen3"),
    ]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });
    mocks.activateLLMRecord.mockResolvedValue(makeRecord("p_b", "备用", "qwen3", true));

    renderSelect();
    await screen.findByText("DeepSeek 日常 · deepseek-flash");

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("备用 · qwen3"));

    await waitFor(() => expect(mocks.activateLLMRecord).toHaveBeenCalledWith("p_b"));
    expect(await screen.findByText(/已切换到配置「备用」/)).toBeInTheDocument();
  });

  it("单击不是立刻切换：延后 220ms 才 activate（给双击留出取消窗口）", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord("p_a", "DeepSeek 日常", "deepseek-flash", true),
      makeRecord("p_b", "备用", "qwen3"),
    ]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });
    mocks.activateLLMRecord.mockResolvedValue(makeRecord("p_b", "备用", "qwen3", true));

    renderSelect();
    await screen.findByText("DeepSeek 日常 · deepseek-flash");
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const option = await screen.findByText("备用 · qwen3");

    fireEvent.click(option);
    // 关键：点下去这一瞬间**没有**切换——延迟窗口就是留给"第二下"的。
    expect(mocks.activateLLMRecord).not.toHaveBeenCalled();

    // 窗口过去之后才真的切（用真实时钟：假时钟会让 antd 的浮层动画与 waitFor 互相卡住）。
    await waitFor(() => expect(mocks.activateLLMRecord).toHaveBeenCalledWith("p_b"), {
      timeout: 1500,
    });
    expect(mocks.activateLLMRecord).toHaveBeenCalledTimes(1);
  });

  it("双击只测连接：不切换、不收起、当前配置不变", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord("p_a", "DeepSeek 日常", "deepseek-flash", true),
      makeRecord("p_b", "备用", "qwen3"),
    ]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });

    renderSelect();
    await screen.findByText("DeepSeek 日常 · deepseek-flash");
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const option = await screen.findByText("备用 · qwen3");

    // 第二次按下（detail=2）：走"只测连接"这条路，并取消第一下排的切换。
    fireEvent.mouseDown(option, { detail: 2 });

    await waitFor(() => expect(mocks.testLLM).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/「备用」连接正常（123ms）/)).toBeInTheDocument();

    // 再等过切换窗口：仍然没有切换（双击永远不会换当前配置）。
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mocks.activateLLMRecord).not.toHaveBeenCalled();
    // 下拉保持展开（第二击要能落在同一行上）。
    expect(
      document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)"),
    ).not.toBeNull();
    // 当前配置没被换掉：没有"已切换"提示，顶部仍是原来那条。
    expect(screen.queryByText(/已切换到配置/)).not.toBeInTheDocument();
    expect(screen.getAllByText("DeepSeek 日常 · deepseek-flash").length).toBeGreaterThan(0);
  });

  it("测连接失败时如实说原因（并仍然不切换）", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord("p_a", "DeepSeek 日常", "deepseek-flash", true),
      makeRecord("p_b", "备用", "qwen3"),
    ]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });
    mocks.testLLM.mockResolvedValue({ ok: false, latency_ms: null, message: "401 未授权" });

    renderSelect();
    await screen.findByText("DeepSeek 日常 · deepseek-flash");
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const option = await screen.findByText("备用 · qwen3");

    fireEvent.mouseDown(option, { detail: 2 });

    expect(await screen.findByText(/「备用」连接失败：401 未授权/)).toBeInTheDocument();
    expect(mocks.activateLLMRecord).not.toHaveBeenCalled();
  });

  it("没有任何记录时不渲染，避免页头出现空下拉", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: null });

    const { container } = renderSelect();

    await waitFor(() => expect(mocks.listLLMConfigRecords).toHaveBeenCalled());
    expect(container.querySelector(".app-model-profile-select")).toBeNull();
  });

  /**
   * 项 2 的两处"静默失效"风险都钉在这里：
   * - base.css 的省略号规则挂在 **antd 6 的内部类名**上，类名猜错不会报错，只是永远不生效。
   * - 弹层宽度上限走 `styles.popup.root`，写错语义键同样不报错。
   * 所以断言"渲染出来的 DOM 长这样"，而不是断言"我们写了什么"。
   */
  it("选中值落在 .ant-select-content 里，弹层上限 320px（项 2 的选择器守卫）", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([
      makeRecord("p_a", "qwen3-max-preview", "qwen3-max-preview-2026-09-23", true),
    ]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });

    const { container } = renderSelect();
    const longName = "qwen3-max-preview · qwen3-max-preview-2026-09-23";
    await screen.findByText(longName);

    // 触发框：值文本在 `.ant-select-content` 里。
    // 单选走 SingleContent（`@rc-component/select/.../SingleContent.js:97`）；
    // `.ant-select-selection-item` 是多选专用的（`MultipleContent.js:52`），本组件没有 `mode`，
    // 所以那条类名在这里**必然为空** —— 把它写进 base.css 的省略号规则就是静默失效。
    const content = container.querySelector(".app-model-profile-select .ant-select-content");
    expect(content).not.toBeNull();
    expect(content!.textContent).toBe(longName);
    expect(
      container.querySelector(".app-model-profile-select .ant-select-selection-item"),
    ).toBeNull();

    // 弹层：`popupMatchSelectWidth={false}` + `maxWidth: 320` → 内联 max-width 落在下拉根上。
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const dropdown = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".ant-select-dropdown");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(dropdown.style.maxWidth).toBe("320px");
    // 选项行里的长名字也带 title，省略之后仍能看全。
    const optionLabel = document.querySelector<HTMLElement>(".model-option-label");
    expect(optionLabel).not.toBeNull();
    expect(optionLabel!.getAttribute("title")).toBe(longName);
  });

  /**
   * 设置页保存/启用/删除配置后，页头下拉必须立刻跟上（本轮新增）。
   *
   * 两棵子树互不相识：没有这条广播，用户只能切一次路由或刷新页面才看得到新配置。
   */
  it("设置里改了配置后，页头下拉立刻重新取数", async () => {
    mocks.listLLMConfigRecords.mockResolvedValue([makeRecord("p_a", "qwen", "qwen3-max", true)]);
    mocks.getLLMConfig.mockResolvedValue({ record_id: "p_a" });
    resetLLMConfigListenersForTests();

    renderSelect();
    await waitFor(() => expect(mocks.listLLMConfigRecords).toHaveBeenCalledTimes(1));

    act(() => bumpLLMConfig());

    await waitFor(() => expect(mocks.listLLMConfigRecords).toHaveBeenCalledTimes(2));
  });
});
