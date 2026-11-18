// SPDX-License-Identifier: Apache-2.0
/**
 * 设置弹窗里的「上下文窗口」控件（T01）：同形下拉 + 「填入参考值」。
 *
 * 钉三件事：
 * 1. 型号命中参考表时给「填入参考值」，点它把**表里的精确值**（1,047,576，不是 1.0M）
 *    写进表单字段 `context_window_tokens`；
 * 2. 未知型号（fallback）**不给**这颗按钮——保守估算被写成"用户确认过的手填值"会掩盖
 *    "这个数不是查到的"；
 * 3. 型号为空时压根不查参考表（不做无意义的请求）。
 */
import { App as AntdApp, ConfigProvider, Form, Input } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ getModelWindowReference: vi.fn() }));
vi.mock("../../../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/settings")>()),
  getModelWindowReference: apiMocks.getModelWindowReference,
}));

import ContextWindowField from "./ContextWindowField";
import { formatContextWindow } from "./contextWindowPresets";
import { t } from "../../../i18n";
import type { ModelWindowReference } from "../../../types";
import { createDefaults } from "../llmRecordFormValues";

afterEach(() => {
  cleanup();
  apiMocks.getModelWindowReference.mockReset();
});

const GPT_41: ModelWindowReference = {
  default_tokens: 128_000,
  entries: [],
  current: { model: "gpt-4.1", label: "GPT-4.1", tokens: 1_047_576, source: "reference" },
};

const UNKNOWN: ModelWindowReference = {
  default_tokens: 128_000,
  entries: [],
  current: { model: "mystery-model-v9", label: null, tokens: 128_000, source: "fallback" },
};

let formRef: FormInstance<ReturnType<typeof createDefaults>> | null = null;

function renderField(model: string) {
  const Harness = () => {
    const [form] = Form.useForm<ReturnType<typeof createDefaults>>();
    formRef = form;
    return (
      <AntdApp>
        <ConfigProvider>
          <Form form={form} layout="vertical" initialValues={{ ...createDefaults(), model }}>
            {/* 真实弹窗里 `model` 自己有一个 Form.Item；`Form.useWatch` 只能看到**已注册**
                的字段，所以夹具必须把它注册上，否则看的是一个空值——那是夹具不真实，不是
                控件坏了。 */}
            <Form.Item name="model" hidden>
              <Input />
            </Form.Item>
            <ContextWindowField form={form} />
          </Form>
        </ConfigProvider>
      </AntdApp>
    );
  };
  render(<Harness />);
}

/** 「填入参考值 1.05M」——按钮名由语言包与缩写格式合成，不写死中文。 */
function referenceButtonName(tokens: number): string {
  return t("llmRecord.contextWindow.applyReference", { window: formatContextWindow(tokens) });
}

describe("ContextWindowField（T01）", () => {
  it("命中参考表：点「填入参考值」把表里的精确值写进表单", async () => {
    apiMocks.getModelWindowReference.mockResolvedValue(GPT_41);
    renderField("gpt-4.1");

    // 只查这个型号——不是当前生效配置里的那个（弹窗里的型号可能还没保存）。
    await waitFor(() => expect(apiMocks.getModelWindowReference).toHaveBeenCalledWith("gpt-4.1"));

    fireEvent.click(await screen.findByRole("button", { name: referenceButtonName(1_047_576) }));

    await waitFor(() => expect(formRef?.getFieldValue("context_window_tokens")).toBe(1_047_576));
  });

  it("未知型号（fallback）不给「填入参考值」", async () => {
    apiMocks.getModelWindowReference.mockResolvedValue(UNKNOWN);
    renderField("mystery-model-v9");

    await waitFor(() =>
      expect(apiMocks.getModelWindowReference).toHaveBeenCalledWith("mystery-model-v9"),
    );
    expect(screen.queryByRole("button", { name: referenceButtonName(128_000) })).toBeNull();
  });

  it("型号为空时不查参考表；控件仍可手填", async () => {
    renderField("");
    // 等控件挂载完（Select 的 role 是 combobox），再确认确实没有发起请求。
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    expect(apiMocks.getModelWindowReference).not.toHaveBeenCalled();
  });

  it("文案不再宣称「0 = 不限制」：留空说明的是「按型号参考值 / 未知按 128,000」", () => {
    // 直接钉语言包的值：这是需求里点名要改的那句话，改回去必须变红。
    const hint = t("llmRecord.hint.contextWindow");
    expect(hint).not.toMatch(/0\s*=/u);
    expect(hint).toContain("128,000");
    expect(t("llmRecord.contextWindow.placeholder").length).toBeGreaterThan(0);
  });
});
