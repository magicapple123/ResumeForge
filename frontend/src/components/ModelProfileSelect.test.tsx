/**
 * 页头模型切换下拉（C-3 / T8）：显示「使用中」记录、切换即 activate、无记录时不渲染，
 * 以及 T8 新增的双击语义——**双击只测连接，绝不切换当前配置**。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelProfileSelect from "./ModelProfileSelect";

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
});
