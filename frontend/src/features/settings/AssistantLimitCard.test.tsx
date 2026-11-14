// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「求职助手 · 运行上限与上下文压缩」卡（需求 #5 + #10）。
 *
 * 两张表都要守：读默认、改值保存、重进仍是新值；压缩这边多守两件事——阈值顺序不合法时
 * **不许保存**（前端与后端同口径），以及保存失败必须说出口而不是假装成功。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getAssistantLimitSetting: vi.fn(),
  saveAssistantLimitSetting: vi.fn(),
  getAssistantCompactionSetting: vi.fn(),
  saveAssistantCompactionSetting: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

import AssistantLimitCard from "./AssistantLimitCard";
import { t } from "../../i18n";

const LIMIT_DEFAULTS = { max_tool_rounds: 30, stream_budget_seconds: 1800 };
const COMPACTION_DEFAULTS = { model: "", mask_percent: 60, summary_percent: 75 };

function renderCard() {
  return render(
    <AntdApp>
      <AssistantLimitCard />
    </AntdApp>,
  );
}

function roundsInput() {
  return screen.getByRole("spinbutton", { name: t("assistantLimits.settings.rounds.label") });
}

function budgetInput() {
  return screen.getByRole("spinbutton", { name: t("assistantLimits.settings.budget.label") });
}

function modelInput() {
  return screen.getByRole("textbox", {
    name: t("assistantLimits.settings.compaction.model.label"),
  });
}

function maskInput() {
  return screen.getByRole("spinbutton", {
    name: t("assistantLimits.settings.compaction.mask.label"),
  });
}

function summaryInput() {
  return screen.getByRole("spinbutton", {
    name: t("assistantLimits.settings.compaction.summary.label"),
  });
}

function saveButton() {
  return screen.getByRole("button", { name: t("assistantLimits.settings.save") });
}

beforeEach(() => {
  apiMocks.getAssistantLimitSetting.mockReset();
  apiMocks.getAssistantLimitSetting.mockResolvedValue(LIMIT_DEFAULTS);
  apiMocks.saveAssistantLimitSetting.mockReset();
  apiMocks.saveAssistantLimitSetting.mockImplementation(async (setting) => setting);
  apiMocks.getAssistantCompactionSetting.mockReset();
  apiMocks.getAssistantCompactionSetting.mockResolvedValue(COMPACTION_DEFAULTS);
  apiMocks.saveAssistantCompactionSetting.mockReset();
  apiMocks.saveAssistantCompactionSetting.mockImplementation(async (setting) => setting);
});

afterEach(cleanup);

describe("AssistantLimitCard 运行上限", () => {
  it("加载后端当前值（缺省为 30 轮 / 1800 秒），未改动时保存按钮不可用", async () => {
    renderCard();

    await waitFor(() => expect(roundsInput()).toHaveValue("30"));
    expect(budgetInput()).toHaveValue("1800");
    expect(saveButton()).toBeDisabled();
  });

  it("改轮次 → 保存 → 重进卡片仍是新值", async () => {
    const setting = { max_tool_rounds: 5, stream_budget_seconds: 1800 };
    apiMocks.saveAssistantLimitSetting.mockResolvedValue(setting);
    const view = renderCard();
    await waitFor(() => expect(roundsInput()).toHaveValue("30"));

    fireEvent.change(roundsInput(), { target: { value: "5" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(apiMocks.saveAssistantLimitSetting).toHaveBeenCalledWith(setting));
    expect(await screen.findByText(t("assistantLimits.settings.saved"))).toBeInTheDocument();
    // 只改了上限：压缩那组没脏，不该被顺手重写一遍。
    expect(apiMocks.saveAssistantCompactionSetting).not.toHaveBeenCalled();

    // 重进：卸载后重新挂载，后端此时返回的是刚保存的值。
    view.unmount();
    apiMocks.getAssistantLimitSetting.mockResolvedValue(setting);
    renderCard();

    await waitFor(() => expect(roundsInput()).toHaveValue("5"));
    expect(budgetInput()).toHaveValue("1800");
  });

  it("保存失败时保留用户输入并提示，不假装成功", async () => {
    const failure = t("assistantLimits.settings.saveFailed");
    apiMocks.saveAssistantLimitSetting.mockRejectedValue(new Error(failure));
    renderCard();
    await waitFor(() => expect(roundsInput()).toHaveValue("30"));

    fireEvent.change(roundsInput(), { target: { value: "12" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(failure)).toBeInTheDocument();
    expect(roundsInput()).toHaveValue("12");
    expect(screen.queryByText(t("assistantLimits.settings.saved"))).toBeNull();
  });
});

describe("AssistantLimitCard 上下文压缩", () => {
  it("渲染默认值：模型为空并显示「跟随当前对话模型」占位，阈值 60 / 75", async () => {
    renderCard();

    await waitFor(() => expect(maskInput()).toHaveValue("60"));
    expect(summaryInput()).toHaveValue("75");
    expect(modelInput()).toHaveValue("");
    expect(modelInput()).toHaveAttribute(
      "placeholder",
      t("assistantLimits.settings.compaction.model.placeholder"),
    );
    // 默认值就是后端当前值：没改过 → 保存不可用，也不该冒出任何校验提示。
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("模型留空也能保存（空串 = 跟随当前对话模型），提交参数按用户填写", async () => {
    const setting = { model: "", mask_percent: 50, summary_percent: 75 };
    apiMocks.saveAssistantCompactionSetting.mockResolvedValue(setting);
    renderCard();
    await waitFor(() => expect(maskInput()).toHaveValue("60"));

    fireEvent.change(maskInput(), { target: { value: "50" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(apiMocks.saveAssistantCompactionSetting).toHaveBeenCalledWith(setting),
    );
    expect(await screen.findByText(t("assistantLimits.settings.saved"))).toBeInTheDocument();
    // 上限没改 → 不该多发一次 PUT。
    expect(apiMocks.saveAssistantLimitSetting).not.toHaveBeenCalled();
  });

  it("摘要阈值不大于遮蔽阈值时禁用保存并给出 inline 提示（遮蔽 80 / 摘要 75）", async () => {
    renderCard();
    await waitFor(() => expect(maskInput()).toHaveValue("60"));

    fireEvent.change(maskInput(), { target: { value: "80" } });

    expect(
      screen.getByText(
        t("assistantLimits.settings.compaction.orderHint", { mask: 80, summary: 75 }),
      ),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    // 禁用之外还必须真的不发请求：点一下也不能绕过校验。
    fireEvent.click(saveButton());
    expect(apiMocks.saveAssistantCompactionSetting).not.toHaveBeenCalled();
  });

  it("后端存了越界阈值（遮蔽 0）时不静默夹取，给出范围提示并禁用保存", async () => {
    // 界面上 antd 会把输入夹在 1–99，所以这条守卫真正防的是「库里已有一份越界值」
    // （手改 DB / 旧版本写入）。此时必须如实显示并拒绝保存，而不是悄悄改成 1 再存回去。
    apiMocks.getAssistantCompactionSetting.mockResolvedValue({
      model: "",
      mask_percent: 0,
      summary_percent: 75,
    });
    renderCard();
    await waitFor(() => expect(maskInput()).toHaveValue("0"));

    expect(
      screen.getByText(t("assistantLimits.settings.compaction.rangeHint", { min: 1, max: 99 })),
    ).toBeInTheDocument();
    fireEvent.change(summaryInput(), { target: { value: "80" } });
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(apiMocks.saveAssistantCompactionSetting).not.toHaveBeenCalled();
  });

  it("压缩设置保存失败时提示错误，且不回填成「已保存」的值", async () => {
    const failure = t("assistantLimits.settings.saveFailed");
    apiMocks.saveAssistantCompactionSetting.mockRejectedValue(new Error(failure));
    renderCard();
    await waitFor(() => expect(summaryInput()).toHaveValue("75"));

    fireEvent.change(summaryInput(), { target: { value: "80" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(failure)).toBeInTheDocument();
    expect(summaryInput()).toHaveValue("80");
    expect(screen.queryByText(t("assistantLimits.settings.saved"))).toBeNull();
  });
});

describe("AssistantLimitCard 排版结构（R-32）", () => {
  it("两个分区标题都在，卡头 intro 不再平铺（信息并入字段 hint）", async () => {
    renderCard();
    await waitFor(() => expect(roundsInput()).toHaveValue("30"));

    expect(screen.getByText(t("assistantLimits.settings.section.limits"))).toBeInTheDocument();
    expect(screen.getByText(t("assistantLimits.settings.compaction.title"))).toBeInTheDocument();
    expect(screen.queryByText(t("assistantLimits.settings.intro"))).toBeNull();
  });

  it("dirty 提示只在有改动时出现，保存成功后消失", async () => {
    const setting = { max_tool_rounds: 7, stream_budget_seconds: 1800 };
    apiMocks.saveAssistantLimitSetting.mockResolvedValue(setting);
    renderCard();
    await waitFor(() => expect(roundsInput()).toHaveValue("30"));
    expect(screen.queryByText(t("assistantLimits.settings.dirty"))).toBeNull();

    fireEvent.change(roundsInput(), { target: { value: "7" } });
    expect(screen.getByText(t("assistantLimits.settings.dirty"))).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.queryByText(t("assistantLimits.settings.dirty"))).toBeNull(),
    );
  });

  it("阈值错误挂在对应字段内（不是堆在保存按钮上方）", async () => {
    renderCard();
    await waitFor(() => expect(maskInput()).toHaveValue("60"));

    fireEvent.change(maskInput(), { target: { value: "80" } });

    const alert = screen.getByRole("alert");
    // 顺序错误说的是摘要必须大于遮蔽 → 必须紧挨摘要控件那一格。
    expect(alert.closest(".assistant-limits-field")?.contains(summaryInput())).toBe(true);
  });
});
