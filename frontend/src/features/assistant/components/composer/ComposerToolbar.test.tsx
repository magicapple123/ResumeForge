// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区工具栏的**结构契约**（R06）：顺序、唯一性、图标化。
 *
 * 这里只测"谁在哪、谁只剩一枚、按钮里有没有文字"——这些是 DOM 顺序与属性，jsdom 能答。
 * chip 文案 / 面板行为在 `ReasoningChip.test.tsx`，`+` 面板在 `AddMenu.test.tsx`；
 * 尺寸与像素（直径、高度、旋转方向）在真机浏览器里量，不在这里伪造数字。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  listLLMConfigRecords: vi.fn(),
}));

vi.mock("../../../../api/settings", () => settingsMocks);

import ComposerToolbar from "./ComposerToolbar";
import type { ComposerToolbarProps } from "./ComposerToolbar";
import { resetLLMConfigListenersForTests } from "../../../settings/llmConfigEvents";
import { FOLLOW_GLOBAL } from "../../assistantPermission";
import { t } from "../../../../i18n";
import type { LLMConfigRecord } from "../../../../types";

const RECORD: LLMConfigRecord = {
  id: "p_1",
  name: "我的记录",
  name_is_default: false,
  provider: "deepseek",
  base_url: "https://api.deepseek.com",
  api_key: "sk-***",
  model: "deepseek-flash",
  models: ["deepseek-flash"],
  temperature: 0.7,
  timeout_seconds: 60,
  max_tokens: 2048,
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
  thinking_style: "",
  extra_body: {},
  is_active: true,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

function renderToolbar(overrides: Partial<ComposerToolbarProps> = {}) {
  const props: ComposerToolbarProps = {
    compact: false,
    content: "你好",
    sending: false,
    attachmentsCount: 0,
    attachmentReads: 0,
    webSearch: false,
    reasoningEffort: "",
    voiceSlot: <span className="composer-voice-slot" data-testid="voice-slot" />,
    permission: {
      conversationId: 7,
      choice: FOLLOW_GLOBAL,
      effectiveLevel: "read_only",
      editable: true,
      onChange: vi.fn(),
    },
    addMenu: {
      compact: false,
      sending: false,
      attachmentReads: 0,
      attachmentsCount: 0,
      jobId: undefined,
      resumeId: undefined,
      skillCatalog: [],
      selectedSkills: [],
      skillBudget: null,
      skillsLoaded: true,
      togglingSkillId: null,
      onJobChange: vi.fn(),
      onResumeChange: vi.fn(),
      onToggleSkill: vi.fn(),
      onManageSkills: vi.fn(),
      onAddAttachment: vi.fn(),
    },
    onWebSearchChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ComposerToolbar {...props} />, { wrapper: AntdApp }) };
}

/** 可发送态 / 生成中态的发送键（都只有图标，没有文字）。 */
function sendButton() {
  return screen.getByRole("button", { name: t("assistantComposer.aria.send") });
}

function stopButton() {
  return screen.getByRole("button", { name: t("assistantComposer.aria.stop") });
}

beforeEach(() => {
  resetLLMConfigListenersForTests();
  window.localStorage.clear();
  settingsMocks.getLLMConfig.mockReset();
  settingsMocks.listLLMConfigRecords.mockReset();
  settingsMocks.getLLMConfig.mockResolvedValue({ record_id: RECORD.id, model: RECORD.model });
  settingsMocks.listLLMConfigRecords.mockResolvedValue([RECORD]);
});

afterEach(() => {
  cleanup();
  resetLLMConfigListenersForTests();
});

describe("工具栏顺序", () => {
  it("`+` 在数据权限**之前**（DOM 顺序，不是靠 CSS）", () => {
    renderToolbar();
    const add = screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") });
    const permission = screen.getByRole("button", { name: /跟随全局/ });
    expect(add.compareDocumentPosition(permission) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("麦克风在发送键之前（语音挪到右侧组，顺序 chip → 语音 → 发送）", () => {
    renderToolbar();
    const voice = screen.getByTestId("voice-slot");
    const send = sendButton();
    expect(voice.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 语音槽位进了提交区，不再留在左侧工具组
    expect(voice.closest(".assistant-composer-submit")).not.toBeNull();
  });

  it("联网开关仍在左侧原位（没被这次改动挪走）", () => {
    renderToolbar();
    const toggle = screen.getByText(t("assistantComposer.toggle.webSearch"));
    expect(toggle.closest(".assistant-composer-utility")).not.toBeNull();
  });

  it("联网开关读作「允许联网」，边界写在原生 title 里（不是 antd Tooltip）", () => {
    renderToolbar();
    const toggleSwitch = screen.getByRole("switch", {
      name: t("assistantComposer.toggle.webSearch"),
    });
    expect(toggleSwitch).not.toBeChecked();
    const label = toggleSwitch.closest("label");
    expect(label).not.toBeNull();
    expect(label).toHaveAttribute("title", t("assistantComposer.toggle.webSearchHint"));
    // 补的说明不能变成悬浮层：这里不该有 tooltip 角色
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("右侧只剩一枚可点 chip", () => {
  it("旧的「思考强度」控件组已经不存在（标签 / 问号 / 下拉都没了）", () => {
    renderToolbar();
    expect(screen.queryByText(t("assistantComposer.effort.label"))).toBeNull();
    expect(screen.queryByLabelText(t("assistantComposer.aria.effortHint"))).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: t("assistantComposer.effort.label") }),
    ).toBeNull();
  });

  it("附件按钮不再单独占工具栏（收进了 `+` 面板）", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: t("assistantComposer.aria.attach") })).toBeNull();
  });

  it("右侧提交区里可点的只有一枚 chip：模型 · 推理等级", async () => {
    const { container } = renderToolbar();
    // chip 要等模型配置读回来才渲染（没有记录时它整块不出现）
    await screen.findByText(RECORD.model);
    const submit = container.querySelector(".assistant-composer-submit") as HTMLElement;
    const chips = submit.querySelectorAll(".assistant-reasoning-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain(RECORD.model);
  });
});

describe("上下文用量 chip", () => {
  const USAGE = {
    buckets: [
      { key: "system", tokens: 12_000, percent: 12 },
      { key: "tools", tokens: 6_000, percent: 6 },
      { key: "conversation", tokens: 4_000, percent: 4 },
      { key: "connectors", tokens: 2_000, percent: 2 },
      { key: "skills", tokens: 1_500, percent: 1.5 },
    ],
    total: 25_500,
    window: 100_000,
    percent: 25.5,
    partial: false,
    usage_actual: 12_345,
  };

  it("有用量时显示整数百分比（没有数据时显示「—」，不猜数字）", () => {
    const { unmount } = renderToolbar({ contextUsage: USAGE });
    const chip = screen.getByRole("button", { name: t("contextUsage.aria.chip") });
    expect(chip.textContent).toContain("26%");
    // R-25：环形进度取代了文字标签，chip 文案里不该再出现「上下文」三个字。
    expect(chip.textContent).not.toContain(t("contextUsage.chip"));
    unmount();

    renderToolbar();
    const empty = screen.getByRole("button", { name: t("contextUsage.aria.chip") });
    expect(empty.textContent).toContain("—");
  });

  it("窗口未设置（0）时 chip 也不显示 0%（没有分母）", () => {
    renderToolbar({
      contextUsage: { ...USAGE, window: 0, percent: null },
    });
    const chip = screen.getByRole("button", { name: t("contextUsage.aria.chip") });
    expect(chip.textContent).toContain("—");
    expect(chip.textContent).not.toContain("0%");
  });
});

describe("发送键图标化", () => {
  it("按钮内没有任何文字节点，无障碍名照旧在", () => {
    renderToolbar();
    const send = sendButton();
    expect(send.textContent?.trim()).toBe("");
    expect(send).toHaveClass("ant-btn-circle");
  });

  it("生成中换成停止键：同样没有文字，位置在同一处", () => {
    renderToolbar({ sending: true });
    expect(screen.queryByRole("button", { name: t("assistantComposer.aria.send") })).toBeNull();
    const stop = stopButton();
    expect(stop.textContent?.trim()).toBe("");
    expect(stop).toHaveClass("ant-btn-circle");
  });

  it("发送键外层始终有 span 包裹（disabled 时 Tooltip 才可达）", () => {
    renderToolbar();
    const send = sendButton();
    expect(send.parentElement).toHaveClass("assistant-composer-send-wrap");
  });

  it("空输入时禁用，但外层包裹仍在、hover 仍出「发送」提示", async () => {
    renderToolbar({ content: "" });
    const send = sendButton();
    expect(send).toBeDisabled();
    const wrap = send.parentElement as HTMLElement;
    expect(wrap).toHaveClass("assistant-composer-send-wrap");

    fireEvent.mouseEnter(wrap);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("assistantComposer.action.send"),
    );
  });

  it("有附件也能发（空文本 + 附件 ≠ 空）", () => {
    renderToolbar({ content: "", attachmentsCount: 1 });
    expect(sendButton()).toBeEnabled();
  });

  it("附件还在读取时不可发", () => {
    renderToolbar({ attachmentReads: 1 });
    expect(sendButton()).toBeDisabled();
  });
});
