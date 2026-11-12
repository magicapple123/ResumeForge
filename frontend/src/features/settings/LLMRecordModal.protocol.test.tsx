// SPDX-License-Identifier: Apache-2.0
/**
 * T09：协议下拉第三项「OpenAI Responses（实验性）」与协议切换时的 Base URL 映射。
 *
 * 钉住三条交互口径（任务书 §4 T09 + D14）：
 * 1. 下拉有三项，默认仍是 OpenAI 兼容；选 Responses 时出现提示条；
 * 2. 只有 supports_responses 的预设才改地址：普通服务商追加 /responses，
 *    智谱换成 /api/v1（由预设的 responses_base_url 声明）；
 * 3. 不支持 Responses 的预设（Claude / Gemini / 硅基流动）切过去也不动地址；
 *    从 Responses 切回 OpenAI 兼容时还原 chat 地址。
 */
import { App as AntdApp, ConfigProvider, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordFormValues } from "./useLLMRecordTools";
import { t } from "../../i18n";
import type { LLMConfigRecord, LLMThinkingResult } from "../../types";
import LLMRecordModal from "./LLMRecordModal";
import LLMRecordViewModal from "./LLMRecordViewModal";

afterEach(() => {
  cleanup();
});

const THINKING_OPTIONS: LLMThinkingResult = {
  style: "reasoning_effort",
  efforts: ["low", "medium", "high"],
  supported: true,
  note: "",
  probed: false,
  accepted: null,
  reasoning_seen: false,
  message: "",
};

function Harness({ initial }: { initial: Record<string, unknown> }) {
  const [form] = Form.useForm<RecordFormValues>();
  useEffect(() => {
    form.setFieldsValue(initial as unknown as RecordFormValues);
  }, [form, initial]);
  const noop = vi.fn();
  return (
    <AntdApp>
      <ConfigProvider>
        <LLMRecordModal
          open
          mode="edit"
          recordName="测试配置"
          form={form}
          saving={false}
          testing={false}
          testResult={null}
          checkingThinking={false}
          thinkingResult={null}
          showingCustomEffort={false}
          effortOptions={[]}
          onProbe={async () => undefined}
          onLoadThinkingOptions={async () => THINKING_OPTIONS}
          onBackToEffortPresets={noop}
          onEffortCustom={() => true}
          onClearThinkingResult={noop}
          onSave={noop}
          onClose={noop}
          onTest={noop}
          onPresetChange={noop}
          onFetchModels={async () => ({ message: "", models: [] })}
        />
      </ConfigProvider>
    </AntdApp>
  );
}

const INITIAL = {
  provider: "deepseek",
  api_style: "openai",
  base_url: "https://api.deepseek.com",
  model: "deepseek-flash",
};

function baseUrlInput(): HTMLInputElement {
  const input = document.getElementById("base_url") as HTMLInputElement | null;
  if (!input) throw new Error("base_url field is not rendered");
  return input;
}

async function chooseProtocol(label: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: /接口协议/ }));
  fireEvent.click(await screen.findByTitle(label));
}

describe("Responses 协议下拉与 Base URL 映射", () => {
  it("offers three protocols and keeps OpenAI compatible as the default", async () => {
    render(<Harness initial={INITIAL} />);

    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com"));
    // 三项在打开下拉后才挂载（antd 的选项不是一开始就渲染的）。
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /接口协议/ }));
    // getAllByTitle：当前选中项的 title 与下拉里那一项会同时命中，数量断言不钉死。
    expect((await screen.findAllByTitle(t("llmRecord.protocol.openai"))).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(t("llmRecord.protocol.anthropic")).length).toBeGreaterThan(0);
    expect(screen.getByTitle(t("llmProtocol.protocol.responses"))).toBeInTheDocument();
    // 默认值没有被改动（D13）。
    expect(baseUrlInput().value).toBe("https://api.deepseek.com");
  });

  it("appends /responses for a supported preset and shows the switch toast", async () => {
    render(<Harness initial={INITIAL} />);
    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com"));

    await chooseProtocol(t("llmProtocol.protocol.responses"));

    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com/responses"));
    expect(await screen.findByText(t("llmProtocol.alert.responsesTitle"))).toBeInTheDocument();
    expect(await screen.findByText(t("llmProtocol.toast.baseUrlSwitched"))).toBeInTheDocument();
  });

  it("uses the dedicated Responses address for Zhipu", async () => {
    render(
      <Harness
        initial={{
          provider: "zhipu",
          api_style: "openai",
          base_url: "https://open.bigmodel.cn/api/paas/v4",
          model: "glm-5.3",
        }}
      />,
    );
    await waitFor(() => expect(baseUrlInput().value).toBe("https://open.bigmodel.cn/api/paas/v4"));

    await chooseProtocol(t("llmProtocol.protocol.responses"));

    await waitFor(() => expect(baseUrlInput().value).toBe("https://open.bigmodel.cn/api/v1"));
  });

  it("leaves the address untouched for presets that do not support Responses", async () => {
    render(
      <Harness
        initial={{
          provider: "gemini",
          api_style: "openai",
          base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
          model: "gemini-3.8-flash",
        }}
      />,
    );
    const original = "https://generativelanguage.googleapis.com/v1beta/openai";
    await waitFor(() => expect(baseUrlInput().value).toBe(original));

    await chooseProtocol(t("llmProtocol.protocol.responses"));

    // 提示条仍然出现（提醒用户这个服务商可能不支持），但地址一个字都不动。
    expect(await screen.findByText(t("llmProtocol.alert.responsesTitle"))).toBeInTheDocument();
    expect(baseUrlInput().value).toBe(original);
    expect(screen.queryByText(t("llmProtocol.toast.baseUrlSwitched"))).toBeNull();
  });

  it("restores the chat address when switching back from Responses", async () => {
    render(
      <Harness
        initial={{
          provider: "deepseek",
          api_style: "responses",
          base_url: "https://api.deepseek.com/responses",
          model: "deepseek-flash",
        }}
      />,
    );
    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com/responses"));

    await chooseProtocol(t("llmRecord.protocol.openai"));

    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com"));
  });

  it("uses the dedicated Anthropic address for DeepSeek and shows its own toast", async () => {
    render(<Harness initial={INITIAL} />);
    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com"));

    await chooseProtocol(t("llmRecord.protocol.anthropic"));

    // 官方入口是 /anthropic/v1/messages，provider 自己拼 /messages，所以地址写到 /anthropic/v1。
    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com/anthropic/v1"));
    expect(
      await screen.findByText(t("llmProtocol.toast.anthropicBaseUrlSwitched")),
    ).toBeInTheDocument();
  });

  it("leaves the address untouched for presets that declare no Anthropic entry", async () => {
    const original = "https://generativelanguage.googleapis.com/v1beta/openai";
    render(
      <Harness
        initial={{
          provider: "gemini",
          api_style: "openai",
          base_url: original,
          model: "gemini-3.8-flash",
        }}
      />,
    );
    await waitFor(() => expect(baseUrlInput().value).toBe(original));

    await chooseProtocol(t("llmRecord.protocol.anthropic"));

    // 没声明就一个字都不动，也不弹"已切换地址"。
    expect(baseUrlInput().value).toBe(original);
    expect(screen.queryByText(t("llmProtocol.toast.anthropicBaseUrlSwitched"))).toBeNull();
  });

  it("restores the chat address when switching back from Anthropic", async () => {
    render(
      <Harness
        initial={{
          provider: "deepseek",
          api_style: "anthropic",
          base_url: "https://api.deepseek.com/anthropic/v1",
          model: "deepseek-flash",
        }}
      />,
    );
    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com/anthropic/v1"));

    await chooseProtocol(t("llmRecord.protocol.openai"));

    await waitFor(() => expect(baseUrlInput().value).toBe("https://api.deepseek.com"));
    expect(await screen.findByText(t("llmProtocol.toast.chatBaseUrlRestored"))).toBeInTheDocument();
  });

  it("shows the Responses protocol in the read-only record view", () => {
    const record = {
      id: "p_1",
      name: "Responses 记录",
      provider: "deepseek",
      base_url: "https://api.deepseek.com/responses",
      api_key: "",
      model: "deepseek-flash",
      temperature: 0.1,
      timeout_seconds: 120,
      max_tokens: 0,
      api_style: "responses",
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
      models: [],
      is_active: false,
      created_at: "2026-11-07T00:00:00",
      updated_at: "2026-11-07T00:00:00",
    } satisfies LLMConfigRecord;

    render(
      <AntdApp>
        <ConfigProvider>
          <LLMRecordViewModal open record={record} onClose={() => undefined} />
        </ConfigProvider>
      </AntdApp>,
    );

    expect(screen.getByText(t("llmProtocol.protocol.responses"))).toBeInTheDocument();
  });
});
