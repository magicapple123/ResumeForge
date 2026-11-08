// SPDX-License-Identifier: Apache-2.0
/**
 * 「模型 · 推理等级」合并 chip（R06-B）。
 *
 * 守住的四条：
 * 1. chip 文案 `{模型} · {档位}`，默认档显示「默认」、选了档位显示中文档位名；
 * 2. **模型行不可点**（`disabled`）、**没有箭头**（不给 `children`），提示挂在行内文字上；
 * 3. 推理等级行可点且二级给出五档 + 自定义，选中回传 `onReasoningEffortChange`；
 * 4. 自定义档位进得去出得来（回车/失焦回到 chip 形态，清空则退回默认）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMocks = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  listLLMConfigRecords: vi.fn(),
}));

vi.mock("../../../../api/settings", () => settingsMocks);

import ReasoningChip from "./ReasoningChip";
import { bumpLLMConfig, resetLLMConfigListenersForTests } from "../../../settings/llmConfigEvents";
import { REASONING_EFFORT_LABEL_KEYS } from "../../../../i18n/enum/assistant";
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

/** 档位显示名（与组件同源：enums 映射 + t()）。 */
const DEFAULT_LABEL = t(REASONING_EFFORT_LABEL_KEYS[""]);
const HIGH_LABEL = t(REASONING_EFFORT_LABEL_KEYS.high);

/** chip 上的一行文字：`{模型} · {档位}`（分隔号是独立 span，textContent 会带上它）。 */
function chipText(model: string, effort: string): string {
  return `${model}·${effort}`;
}

/**
 * 展开「推理等级」二级菜单：antd Menu 的二级是 hover 触发，且 hover 落在**标题**上
 * （PopupTrigger 的 child 是 `.ant-menu-submenu-title`，不是外层 li）。
 */
async function openEffortSubmenu(): Promise<void> {
  const row = (await screen.findByText(t("reasoningChip.row.effort"))).closest("li");
  // 二级菜单的 title 是 `[class*="submenu-title"]`：Dropdown 里的前缀是
  // `ant-dropdown-menu-*`，不是独立的 `.ant-menu-*`，所以用属性子串匹配。
  const title = row?.querySelector('[class*="submenu-title"]') ?? row;
  fireEvent.mouseEnter(title as Element);
}

/**
 * 带状态的壳：档位由**真实 state** 驱动，与页面里一样（父组件收到 onChange 会回填）。
 * 用 `vi.fn()` 裸渲染测不了"回车/失焦回到 chip"——输入框的值会被 React 回滚成旧值。
 */
function renderChip(initial: string) {
  const onReasoningEffortChange = vi.fn();
  function Harness() {
    const [effort, setEffort] = useState(initial);
    return (
      <AntdApp>
        <ReasoningChip
          compact={false}
          sending={false}
          reasoningEffort={effort}
          onReasoningEffortChange={(value: string) => {
            onReasoningEffortChange(value);
            setEffort(value);
          }}
        />
      </AntdApp>
    );
  }
  return { onReasoningEffortChange, ...render(<Harness />) };
}

beforeEach(() => {
  resetLLMConfigListenersForTests();
  settingsMocks.getLLMConfig.mockReset();
  settingsMocks.listLLMConfigRecords.mockReset();
  settingsMocks.getLLMConfig.mockResolvedValue({ record_id: RECORD.id, model: RECORD.model });
  settingsMocks.listLLMConfigRecords.mockResolvedValue([RECORD]);
});

afterEach(() => {
  cleanup();
  resetLLMConfigListenersForTests();
  document.body.innerHTML = "";
});

describe("ReasoningChip 的文案", () => {
  it("默认档显示「模型名 · 默认」", async () => {
    renderChip("");
    const chip = await screen.findByRole("button", {
      name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
    });
    expect(chip.textContent).toBe(chipText(RECORD.model, DEFAULT_LABEL));
  });

  it("选了具体档位就换成中文档位名（模型名不变）", async () => {
    renderChip("high");
    const chip = await screen.findByRole("button", {
      name: t("reasoningChip.aria", { model: RECORD.model, effort: HIGH_LABEL }),
    });
    expect(chip.textContent).toBe(chipText(RECORD.model, HIGH_LABEL));
  });

  it("一条模型记录都没有时整枚 chip 不渲染（不给看起来能点的假下拉）", async () => {
    settingsMocks.getLLMConfig.mockResolvedValue({ record_id: null, model: "" });
    settingsMocks.listLLMConfigRecords.mockResolvedValue([]);
    const { container } = renderChip("");
    await waitFor(() => expect(settingsMocks.listLLMConfigRecords).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector(".assistant-reasoning-chip")).toBeNull());
  });
});

describe("ReasoningChip 的两行面板", () => {
  it("模型行不可点、无箭头；推理等级行可点且带箭头", async () => {
    renderChip("");
    const chip = await screen.findByRole("button", {
      name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
    });
    fireEvent.click(chip);

    const modelRow = (await screen.findByText(t("reasoningChip.row.model"))).closest("li");
    expect(modelRow).not.toBeNull();
    // 不可点：disabled 的菜单项；**不是** submenu 所以没有展开箭头、也没有 aria-expanded
    expect(modelRow?.className).toContain("disabled");
    expect(modelRow?.querySelector('[class*="submenu-title"]')).toBeNull();
    expect(modelRow?.querySelector('[class*="submenu-arrow"]')).toBeNull();
    expect(modelRow?.getAttribute("aria-expanded")).toBeNull();

    // 推理等级行相反：是 submenu，带箭头，可展开
    const effortRow = screen.getByText(t("reasoningChip.row.effort")).closest("li");
    expect(effortRow?.className).toContain("submenu");
    expect(effortRow?.querySelector('[class*="submenu-title"]')).not.toBeNull();
    expect(effortRow?.querySelector('[class*="submenu-arrow"]')).not.toBeNull();
  });

  it("模型行 hover 提示「在顶部切换」挂在行内文字上", async () => {
    renderChip("");
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
      }),
    );

    fireEvent.mouseEnter(screen.getByText(`${RECORD.name} · ${RECORD.model}`));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(t("assistantComposer.modelChip.hoverHint"));
  });

  it("二级选「高」回传对应档位并收起面板", async () => {
    const { onReasoningEffortChange } = renderChip("");
    const chip = await screen.findByRole("button", {
      name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
    });
    fireEvent.click(chip);

    await openEffortSubmenu();

    const option = await screen.findByText(HIGH_LABEL);
    fireEvent.click(option);

    expect(onReasoningEffortChange).toHaveBeenCalledWith("high");
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: t("reasoningChip.aria", { model: RECORD.model, effort: HIGH_LABEL }),
        }),
      ).toBeInTheDocument(),
    );
  });

  it("二级里当前档位带勾（其余不带）", async () => {
    renderChip("medium");
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("reasoningChip.aria", {
          model: RECORD.model,
          effort: t(REASONING_EFFORT_LABEL_KEYS.medium),
        }),
      }),
    );

    await openEffortSubmenu();

    // 等二级弹层出现（它是 hover 后才挂载的）：
    await screen.findByText(HIGH_LABEL);
    // 档位名在 chip 上也有一份，所以要挑**菜单项**里的那一个。
    const option = screen
      .getAllByText(t(REASONING_EFFORT_LABEL_KEYS.medium))
      .map((element) => element.closest("li"))
      .find((element) => element?.getAttribute("role") === "menuitem");
    expect(option?.querySelector(".anticon-check")).not.toBeNull();

    // 其余档位不带勾
    const other = screen
      .getAllByText(t(REASONING_EFFORT_LABEL_KEYS.high))
      .map((element) => element.closest("li"))
      .find((element) => element?.getAttribute("role") === "menuitem");
    expect(other?.querySelector(".anticon-check")).toBeNull();
  });
});

describe("ReasoningChip 的自定义档位", () => {
  it("选「自定义…」后 chip 原地变成输入框，输入的值原样上抛", async () => {
    const { onReasoningEffortChange } = renderChip("");
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
      }),
    );

    await openEffortSubmenu();
    fireEvent.click(await screen.findByText(t("assistantComposer.effort.custom")));

    // 下拉换成输入框：档位词汇各家不同（xhigh / max / adaptive），只能自己填。
    const input = await screen.findByLabelText(t("assistantComposer.aria.customEffort"));
    fireEvent.change(input, { target: { value: "xhigh" } });

    expect(onReasoningEffortChange).toHaveBeenCalledWith("xhigh");
  });

  it("回车后回到 chip 形态，chip 显示自定义值（不猜中文）", async () => {
    renderChip("");
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
      }),
    );
    await openEffortSubmenu();
    fireEvent.click(await screen.findByText(t("assistantComposer.effort.custom")));

    const input = await screen.findByLabelText(t("assistantComposer.aria.customEffort"));
    fireEvent.change(input, { target: { value: "xhigh" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    });

    expect(screen.queryByLabelText(t("assistantComposer.aria.customEffort"))).toBeNull();
    expect(
      screen.getByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: "xhigh" }),
      }),
    ).toBeInTheDocument();
  });

  it("清空后失焦退回默认档，不留下一个空输入框", async () => {
    const { onReasoningEffortChange } = renderChip("xhigh");
    // 存下来的自定义值直接上 chip（不猜中文，原值显示）
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: "xhigh" }),
      }),
    );
    await openEffortSubmenu();
    fireEvent.click(await screen.findByText(t("assistantComposer.effort.custom")));

    const input = await screen.findByLabelText(t("assistantComposer.aria.customEffort"));
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(onReasoningEffortChange).toHaveBeenLastCalledWith("");
    expect(
      screen.getByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(t("assistantComposer.aria.customEffort"))).toBeNull();
  });
});

describe("ReasoningChip 跟随模型配置", () => {
  it("顶栏切模型（bumpLLMConfig 广播）后 chip 跟随更新", async () => {
    renderChip("");
    await screen.findByText(RECORD.model);

    const nextRecord: LLMConfigRecord = {
      ...RECORD,
      id: "p_2",
      name: "新记录",
      model: "deepseek-chat",
    };
    settingsMocks.getLLMConfig.mockResolvedValue({
      record_id: nextRecord.id,
      model: "deepseek-chat",
    });
    settingsMocks.listLLMConfigRecords.mockResolvedValue([RECORD, nextRecord]);

    await act(async () => {
      bumpLLMConfig();
    });

    expect(await screen.findByText("deepseek-chat")).toBeInTheDocument();
    expect(screen.queryByText(RECORD.model)).toBeNull();
  });

  it("默认记录名走语言包（不把内置默认名当用户数据原样显示）", async () => {
    settingsMocks.listLLMConfigRecords.mockResolvedValue([
      { ...RECORD, name: "内置默认", name_is_default: true },
    ]);
    renderChip("");
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("reasoningChip.aria", { model: RECORD.model, effort: DEFAULT_LABEL }),
      }),
    );

    expect(
      await screen.findByText(
        `${t("componentsMisc2.modelProfile.defaultRecordName")} · ${RECORD.model}`,
      ),
    ).toBeInTheDocument();
  });
});
