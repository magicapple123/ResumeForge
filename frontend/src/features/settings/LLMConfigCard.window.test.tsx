// SPDX-License-Identifier: Apache-2.0
/**
 * 记录卡上的「窗口 1M（参考表）」（T01 ③）。
 *
 * 为什么单独测：窗口数字本身在助手面板里也有，卡片上要的是**数字 + 来源**——「参考表」
 * 说明这个数是从内置表查到的，「未知模型」说明它是 128K 保守估算。两者混成同一个样子，
 * 用户会把估算值当成查到的值去填，填大了就是一次必然 400 的调用。
 *
 * 数字与来源都由后端的 `LLMGlobalRecordOut.window_tokens / window_source` 下发，这里
 * 只验证卡片把它们如实拼出来（缩写格式 1M / 64K 与助手侧同一份 `formatContextWindow`）。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settings")>()),
  getModelWindowReference: vi.fn(),
}));
// 恢复默认按钮自己会拉 /settings/reset-targets：与本用例无关，且不该让卡片渲染依赖网络。
vi.mock("./SettingsResetButton", () => ({ default: () => null }));

import LLMConfigCard from "./LLMConfigCard";
import { formatContextWindow } from "./llm/contextWindowPresets";
import { t } from "../../i18n";
import type { LLMConfigRecord } from "../../types";
import type { RecordFormValues } from "./useLLMRecordTools";

afterEach(() => {
  cleanup();
});

function record(overrides: Partial<LLMConfigRecord>): LLMConfigRecord {
  return {
    id: "p_test",
    name: "测试记录",
    provider: "custom",
    base_url: "https://api.example.com/v1",
    api_key: "",
    model: "gpt-4.1",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: 0,
    context_window_tokens: 0,
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
    models: [],
    is_active: false,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

/** 只渲染记录列表：弹窗保持关闭，其余动作全是空实现。 */
function renderCard(records: LLMConfigRecord[]) {
  const noop = () => undefined;
  const Harness = () => {
    const [form] = Form.useForm<RecordFormValues>();
    return (
      <AntdApp>
        <LLMConfigCard
          records={records}
          recordsLoading={false}
          activeRecordId={null}
          configSummary={null}
          recordApplyingId={null}
          recordDeletingId={null}
          recordTestingId={null}
          recordTestResults={{}}
          recordForm={form}
          recordModalOpen={false}
          editingRecord={null}
          recordSaving={false}
          draftTesting={false}
          draftTestResult={null}
          checkingThinking={false}
          thinkingResult={null}
          showingCustomEffort={false}
          effortOptions={[]}
          onProbeThinking={async () => undefined}
          onLoadThinkingOptions={async () => ({
            style: "auto",
            efforts: [],
            supported: true,
            note: "",
            probed: false,
            accepted: null,
            reasoning_seen: false,
            message: "",
          })}
          onBackToEffortPresets={noop}
          onEffortCustom={() => true}
          onClearThinkingResult={noop}
          onOpenCreate={noop}
          onOpenRecordEdit={noop}
          onSaveRecord={noop}
          onCloseRecordModal={noop}
          onApplyRecord={noop}
          onRemoveRecord={noop}
          onTestRecord={noop}
          onTestDraft={noop}
          onPresetChange={noop}
          onFetchDraftModels={async () => ({ models: [], message: "" })}
        />
      </AntdApp>
    );
  };
  render(<Harness />);
}

/** 卡片上的窗口行文本（语言包 + 生产同一份缩写格式合成，不写死中文）。 */
function windowLine(tokens: number, source: "manual" | "reference" | "fallback"): string {
  return t("llmConfigCard.window", {
    window: formatContextWindow(tokens),
    source: t(
      source === "manual"
        ? "contextUsage.window.source.manual"
        : source === "reference"
          ? "contextUsage.window.source.reference"
          : "contextUsage.window.source.fallback",
    ),
  });
}

describe("LLMConfigCard 记录卡上的窗口（T01 ③）", () => {
  it("按后端下发的窗口与来源显示「窗口 …（…）」", () => {
    renderCard([
      record({ id: "p_ref", name: "参考表", window_tokens: 1_000_000, window_source: "reference" }),
      record({ id: "p_man", name: "手填", window_tokens: 64_000, window_source: "manual" }),
      record({ id: "p_fb", name: "未知", window_tokens: 128_000, window_source: "fallback" }),
    ]);

    expect(screen.getByText(windowLine(1_000_000, "reference"))).toBeInTheDocument();
    expect(screen.getByText(windowLine(64_000, "manual"))).toBeInTheDocument();
    expect(screen.getByText(windowLine(128_000, "fallback"))).toBeInTheDocument();
  });

  it("后端没下发窗口时不渲染这一行（旧响应不至于显示成「窗口 0」）", () => {
    renderCard([record({ id: "p_old", name: "旧记录", window_tokens: undefined })]);
    expect(document.querySelector(".llm-record-window")).toBeNull();
  });
});
