/**
 * 视角切换器（T26）：页头下拉形态。
 *
 * 与 18C 的旧测试的差别（旧断言已不成立，属于预期变红）：
 * - 选项**不再**平铺在输入区上方，而是点开 Popover 才出现；
 * - 触发按钮文案是「视角 · {当前名}」，不是裸的「视角」；
 * - 切换后仍要回调（技能芯片刷新保留），但芯片里不会再出现「视角 · X」。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import PersonaSwitcher from "./PersonaSwitcher";

const apiMocks = vi.hoisted(() => ({
  readConversationPersona: vi.fn(),
  saveConversationPersona: vi.fn(),
}));

vi.mock("./personaApi", async () => {
  const actual = await vi.importActual<typeof import("./personaApi")>("./personaApi");
  return {
    ...actual,
    readConversationPersona: apiMocks.readConversationPersona,
    saveConversationPersona: apiMocks.saveConversationPersona,
  };
});

function renderSwitcher(conversationId: number | null, onChanged = vi.fn()) {
  render(
    <AntdApp>
      <PersonaSwitcher conversationId={conversationId} onChanged={onChanged} />
    </AntdApp>,
  );
  return { onChanged };
}

/** 触发按钮的可访问名：「视角 · {当前名}」。 */
function triggerName(personaLabel: string) {
  return `${t("assistantBreadth.persona.label")} · ${personaLabel}`;
}

afterEach(() => cleanup());
beforeEach(() => {
  apiMocks.readConversationPersona.mockReset();
  apiMocks.saveConversationPersona.mockReset();
  apiMocks.readConversationPersona.mockResolvedValue({ persona_id: "" });
  apiMocks.saveConversationPersona.mockResolvedValue({ persona_id: "interviewer" });
});

describe("PersonaSwitcher", () => {
  it("页头默认态：按钮写「视角 · 通用」，展开后四项各带一句说明", async () => {
    renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalledWith(7));

    const trigger = screen.getByRole("button", {
      name: triggerName(t("assistantBreadth.persona.default")),
    });
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    for (const key of [
      "assistantBreadth.persona.default",
      "assistantBreadth.persona.hr_scan",
      "assistantBreadth.persona.interviewer",
      "assistantBreadth.persona.headhunter",
    ] as const) {
      expect(screen.getByText(t(key))).toBeTruthy();
    }
    // 四项说明各一句（不带说明的裸列表就是"AI 味"的那一版）。
    for (const key of [
      "assistantBreadth.persona.desc.default",
      "assistantBreadth.persona.desc.hr_scan",
      "assistantBreadth.persona.desc.interviewer",
      "assistantBreadth.persona.desc.headhunter",
    ] as const) {
      expect(screen.getByText(t(key))).toBeTruthy();
    }
    // 当前项打勾。
    expect(screen.getByRole("menuitemradio", { checked: true }).textContent).toContain(
      t("assistantBreadth.persona.default"),
    );
  });

  it("点击一次后菜单保持打开，且能选中其中的选项（I-31 回归）", async () => {
    renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: triggerName(t("assistantBreadth.persona.default")) }),
    );
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());

    // 退出动画期间菜单仍在 DOM 里，只断言"出现过"抓不到"同一帧又被关掉"。
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole("menu")).toBeTruthy();

    // 还开着的直接证据：能点到里面的选项并保存。
    fireEvent.click(screen.getByText(t("assistantBreadth.persona.hr_scan")));
    await waitFor(() =>
      expect(apiMocks.saveConversationPersona).toHaveBeenCalledWith(7, "hr_scan"),
    );
  });

  it("选中预设后保存、变品牌色并通知刷新", async () => {
    const { onChanged } = renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: triggerName(t("assistantBreadth.persona.default")) }),
    );
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText(t("assistantBreadth.persona.interviewer")));

    await waitFor(() =>
      expect(apiMocks.saveConversationPersona).toHaveBeenCalledWith(7, "interviewer"),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // 非默认视角 = 品牌色文字 + wash 底（类名是那条样式的挂载点）。
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: triggerName(t("assistantBreadth.persona.interviewer")) })
          .className,
      ).toContain("is-customized"),
    );
  });

  it("草稿态（还没有会话）禁用且不查接口", () => {
    renderSwitcher(null);
    expect(apiMocks.readConversationPersona).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", {
      name: triggerName(t("assistantBreadth.persona.default")),
    });
    expect(trigger).toBeDisabled();
  });

  it("切换失败：提示但不假装成功", async () => {
    apiMocks.saveConversationPersona.mockRejectedValue(new Error("boom"));
    renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalled());

    fireEvent.click(
      screen.getByRole("button", { name: triggerName(t("assistantBreadth.persona.default")) }),
    );
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByText(t("assistantBreadth.persona.headhunter")));

    await waitFor(() => expect(screen.getByText(t("assistantBreadth.persona.error"))).toBeTruthy());
    // 触发按钮仍停在「通用」——失败不能顺手把界面也改了。
    expect(
      screen.getByRole("button", { name: triggerName(t("assistantBreadth.persona.default")) }),
    ).toBeTruthy();
  });
});
