// SPDX-License-Identifier: Apache-2.0
/**
 * LLMRecordModal 的「高级调整」折叠头间距守卫。
 *
 * 两轮返工根因（为什么间距一直没达到预期）：
 * 1. 第一轮写在 modules.css——antd 6 的 cssinjs 组件样式运行时注入 <head>、排在静态
 *    样式表之后，同特异性下 `.llm-advanced-toggle` 的 margin/padding 被整体压掉，没生效。
 * 2. 第二轮换成内联 marginBlock:8px——内联本身生效，但 8px 远小于 antd 表单 24px 的
 *    分段节奏，且上方思考模式说明文字自带 margin-bottom:12px，与折叠头的 margin-top
 *    相邻塌陷取 max，margin 被吞，视觉上仍"贴着"。
 * 3. 三修改用不塌陷的载体：折叠头外包一层 spacer div，间距写成内联 **padding**
 *    （padding-top 16 / padding-bottom 8，上对齐 antd 表单节奏、下与 Alert/表单尾分隔）。
 *    padding 不参与 margin 塌陷，内联不受 CSS 注入顺序影响——机制上不再依赖构建新鲜度。
 *
 * 这条测试钉住「间距写在内联 style 且值正确」：jsdom 不解析外部 CSS 文件的规则，但能
 * 读取内联样式——若有人把它挪回 modules.css（或改回会塌陷的 margin），测试立刻变红。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App as AntdApp, ConfigProvider, Form } from "antd";
import type { LLMThinkingResult } from "../../types";
import type { RecordFormValues } from "../../features/settings/useLLMRecordTools";
import { t } from "../../i18n";
import { clearDraft, writeDraft } from "../../utils/formDraftStorage";
import LLMRecordModal from "./LLMRecordModal";

afterEach(() => {
  cleanup();
});

function renderModal({
  mode = "edit",
  recordId,
}: { mode?: "create" | "edit"; recordId?: string } = {}) {
  const thinkingOptions: LLMThinkingResult = {
    style: "openai",
    efforts: ["low", "medium", "high"],
    supported: true,
    note: "",
    probed: false,
    accepted: null,
    reasoning_seen: false,
    message: "",
  };
  const noop = vi.fn();
  const Harness = () => {
    const [form] = Form.useForm<RecordFormValues>();
    return (
      <AntdApp>
        <ConfigProvider>
          <LLMRecordModal
            open
            mode={mode}
            recordName="测试配置"
            recordId={recordId}
            form={form}
            saving={false}
            testing={false}
            testResult={null}
            checkingThinking={false}
            thinkingResult={null}
            showingCustomEffort={false}
            effortOptions={[{ value: "low", label: "低" }]}
            onProbe={async () => undefined}
            onLoadThinkingOptions={async () => thinkingOptions}
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
  };
  render(<Harness />);
}

describe("LLMRecordModal 高级调整折叠头间距（内联样式守卫）", () => {
  it("折叠头包在不塌陷的 spacer 里：内联 padding-top 16 / padding-bottom 8，按钮去水平 padding", () => {
    renderModal();
    // spacer 的 padding 不参与 margin 塌陷——改回 margin（会被上方说明文字的
    // margin-bottom 吞掉）或挪回静态 CSS（输给 cssinjs）都会让这里变红。
    const spacer = document.querySelector(".llm-advanced-toggle-spacing") as HTMLElement | null;
    expect(spacer).not.toBeNull();
    expect(spacer!.style.getPropertyValue("padding-top")).toBe("16px");
    expect(spacer!.style.getPropertyValue("padding-bottom")).toBe("8px");

    const toggle = document.querySelector(".llm-advanced-toggle") as HTMLElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.style.getPropertyValue("padding-inline")).toBe("0px");
  });
});

describe("LLMRecordModal viewport scrolling", () => {
  it("keeps the title and actions outside the scrolling form when advanced settings expand", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog", { name: "编辑配置记录「测试配置」" });
    expect(dialog).toHaveClass("llm-record-modal");
    const content = dialog.querySelector<HTMLElement>(".ant-modal-container");
    const body = dialog.querySelector<HTMLElement>(".ant-modal-body");
    expect(content).not.toBeNull();
    expect(body).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^高级调整/ }));
    expect(screen.getByRole("spinbutton", { name: /^Top P/ })).toBeInTheDocument();
    expect(body).toContainElement(screen.getByRole("spinbutton", { name: /^Top P/ }));
    expect(body).not.toContainElement(screen.getByRole("button", { name: /^保\s*存$/ }));
    expect(body).not.toContainElement(dialog.querySelector(".ant-modal-header"));
    expect(body!.style.overflowY).toBe("auto");
    expect(content!.style.maxHeight).not.toBe("");
    expect(screen.getByRole("button", { name: /^保\s*存$/ })).toBeInTheDocument();
  });
});

/**
 * 草稿接线（与 `TrackFormModal` / `ClaimFormModal` 同一形状）：作用域按"哪一条记录"分，
 * 新建态是 `llm.record#new`；命中草稿只出恢复条，**用户点了才应用**。
 *
 * 断言里不写中文：恢复条两颗按钮走 `t()` 的 key，输入框按 antd 依字段名生成的 id 取
 * （本弹窗的 Form 没有 name 前缀，所以 id 就是 `base_url`）。
 */
describe("LLMRecordModal 草稿恢复", () => {
  it("命中草稿不自动填充，点恢复条上的按钮才写进表单", async () => {
    const scope = "llm.record#new";
    clearDraft(scope);
    writeDraft(scope, { base_url: "https://draft.example.com", model: "draft-model" });

    renderModal({ mode: "create" });

    // 恢复条出现 = 读到了草稿；此刻表单仍是空的（自动填充会让用户以为"本来就填过"）。
    const restore = await screen.findByRole("button", { name: t("draft.restore.action") });
    expect(readBaseUrl()).toBe("");

    fireEvent.click(restore);

    await waitFor(() => expect(readBaseUrl()).toBe("https://draft.example.com"));
    // 取用之后恢复条消失：不会重复问第二遍。
    expect(screen.queryByRole("button", { name: t("draft.restore.action") })).toBeNull();
  });
});

/** 表单当前的 Base URL 输入框（每次重新查节点：恢复后 React 可能换掉 DOM）。 */
function readBaseUrl(): string {
  const input = document.getElementById("base_url") as HTMLInputElement | null;
  if (!input) throw new Error("base_url field is not rendered");
  return input.value;
}
